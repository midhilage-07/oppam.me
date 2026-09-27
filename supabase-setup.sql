-- =====================================================================
--  The Good-for-Me Games: database setup for Supabase
--  1. Change the TWO lines marked  >>> EDIT  below.
--  2. Paste this whole file into Supabase > SQL Editor > New query > Run.
--  Run it once. It creates tables, security rules, file storage,
--  the 200-prize pool and the secure prize draw.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Settings: which email domains may join ----------
create table public.settings (
  id int primary key default 1 check (id = 1),
  allowed_domains text[] not null,
  draw_open boolean not null default false
);
-- >>> EDIT: your company email domain(s), without the @. Add more like: array['oppam.me','oppam.in']
insert into public.settings (allowed_domains) values (array['yourcompany.com']);

-- ---------- Organisers (admins) ----------
create table public.admins (email text primary key);
-- >>> EDIT: organiser email address(es). Add more rows the same way.
insert into public.admins (email) values ('you@yourcompany.com');

-- ---------- Helper functions ----------
create or replace function public.jwt_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where lower(email) = jwt_email());
$$;

create or replace function public.is_employee() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    split_part(jwt_email(), '@', 2) in (select lower(unnest(allowed_domains)) from settings where id = 1)
    or is_admin()
  );
$$;

-- Block sign-ups from any other email domain, at the server.
create or replace function public.check_signup_domain() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if split_part(lower(new.email), '@', 2) not in (select lower(unnest(allowed_domains)) from settings where id = 1)
     and not exists (select 1 from admins where lower(email) = lower(new.email)) then
    raise exception 'Only company email addresses can join.';
  end if;
  return new;
end $$;
create trigger check_signup_domain before insert on auth.users
  for each row execute function public.check_signup_domain();

-- ---------- Prizes: fixed pool of 200 totalling Rs 25,000 ----------
create table public.prizes (
  id serial primary key,
  amount int not null,
  claimed_by uuid unique references auth.users on delete set null,
  claim_code text unique,
  claimed_at timestamptz,
  paid boolean not null default false,
  paid_at timestamptz
);
insert into public.prizes (amount)
select v.a from (values (5000,1),(2000,2),(1000,5),(500,10),(100,2),(50,100),(10,80)) as v(a,n),
     generate_series(1, v.n);

-- ---------- Profiles (leaderboard names) ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);

-- ---------- Completions (written only by the server) ----------
create table public.completions (
  user_id uuid not null references auth.users on delete cascade,
  challenge int not null check (challenge between 1 and 7),
  completed_at timestamptz not null default now(),
  primary key (user_id, challenge)
);

-- ---------- Uploads ----------
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  challenge int not null check (challenge between 1 and 7),
  path text not null unique,
  file_name text not null,
  mime text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);

-- A challenge is completed automatically when its first upload lands,
-- and un-completed if every upload for it is removed.
create or replace function public.after_upload_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from uploads u where u.user_id = new.user_id and u.challenge = new.challenge) > 3 then
    raise exception 'Up to 3 files per challenge.';
  end if;
  insert into completions (user_id, challenge) values (new.user_id, new.challenge)
  on conflict do nothing;
  return new;
end $$;
create trigger after_upload_insert after insert on public.uploads
  for each row execute function public.after_upload_insert();

create or replace function public.after_upload_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from uploads u where u.user_id = old.user_id and u.challenge = old.challenge) then
    delete from completions c where c.user_id = old.user_id and c.challenge = old.challenge;
  end if;
  return old;
end $$;
create trigger after_upload_delete after delete on public.uploads
  for each row execute function public.after_upload_delete();

-- ---------- Row-level security ----------
alter table public.settings    enable row level security;
alter table public.admins      enable row level security;
alter table public.prizes      enable row level security;
alter table public.profiles    enable row level security;
alter table public.completions enable row level security;
alter table public.uploads     enable row level security;

create policy "employees read settings" on public.settings for select using (public.is_employee());

create policy "read own prize" on public.prizes for select using (claimed_by = auth.uid());

create policy "read own profile"   on public.profiles for select using (id = auth.uid());
create policy "create own profile" on public.profiles for insert with check (id = auth.uid() and public.is_employee());
create policy "update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "read own completions" on public.completions for select using (user_id = auth.uid());

create policy "read own uploads or admin" on public.uploads for select
  using (user_id = auth.uid() or public.is_admin());
create policy "add own uploads" on public.uploads for insert with check (
  user_id = auth.uid() and public.is_employee()
  and path like auth.uid()::text || '/%'
  and not exists (select 1 from public.prizes p where p.claimed_by = auth.uid()));
create policy "remove own uploads" on public.uploads for delete using (
  user_id = auth.uid()
  and not exists (select 1 from public.prizes p where p.claimed_by = auth.uid()));

-- ---------- Private file storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/gif','application/pdf']);

create policy "employees upload own proofs" on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text and public.is_employee());
create policy "read own proofs or admin" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "delete own proofs" on storage.objects for delete to authenticated
  using (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Leaderboard ----------
create or replace function public.get_leaderboard()
returns table(player_name text, player_points int, is_me boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(p.display_name, 'A colleague'), (count(*) * 10)::int, c.user_id = auth.uid()
  from completions c left join profiles p on p.id = c.user_id
  where public.is_employee()
  group by c.user_id, p.display_name
  order by 2 desc, max(c.completed_at) asc
  limit 50;
$$;

-- ---------- Secure prize draw ----------
create or replace function public.claim_prize()
returns table(prize_amount int, prize_code text, prize_time timestamptz)
language plpgsql security definer set search_path = public as $$
declare p prizes%rowtype; v_code text;
begin
  if not is_employee() then raise exception 'NOT_ALLOWED'; end if;
  select * into p from prizes where claimed_by = auth.uid();
  if found then
    return query select p.amount, p.claim_code, p.claimed_at; return;
  end if;
  if not (select draw_open from settings where id = 1) then raise exception 'DRAW_CLOSED'; end if;
  if (select count(*) from completions c where c.user_id = auth.uid()) < 7 then raise exception 'NOT_COMPLETE'; end if;
  select * into p from prizes where claimed_by is null order by random() limit 1 for update skip locked;
  if not found then raise exception 'NONE_LEFT'; end if;
  v_code := 'GFM-' || upper(substr(md5(gen_random_uuid()::text), 1, 4)) || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4));
  update prizes set claimed_by = auth.uid(), claim_code = v_code, claimed_at = now() where id = p.id;
  return query select p.amount, v_code, now();
end $$;

-- ---------- Organiser tools ----------
create or replace function public.admin_overview()
returns table(participant_id uuid, participant_name text, participant_email text, total_points int,
              prize_id int, prize_amount int, prize_code text, prize_paid boolean, prize_claimed_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'NOT_ALLOWED'; end if;
  return query
    select u.id, pr.display_name, u.email::text,
           ((select count(*) from completions c where c.user_id = u.id) * 10)::int,
           z.id, z.amount, z.claim_code, z.paid, z.claimed_at
    from auth.users u
    left join profiles pr on pr.id = u.id
    left join prizes z on z.claimed_by = u.id
    where exists (select 1 from completions c where c.user_id = u.id) or z.id is not null
    order by 4 desc, 2;
end $$;

create or replace function public.admin_pool()
returns table(pool_amount int, pool_total int, pool_remaining int)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'NOT_ALLOWED'; end if;
  return query
    select z.amount, count(*)::int, (count(*) filter (where z.claimed_by is null))::int
    from prizes z group by z.amount order by z.amount desc;
end $$;

create or replace function public.admin_set_paid(p_prize_id int, p_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'NOT_ALLOWED'; end if;
  update prizes set paid = p_paid, paid_at = case when p_paid then now() end where id = p_prize_id;
end $$;

create or replace function public.admin_set_draw(p_open boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'NOT_ALLOWED'; end if;
  update settings set draw_open = p_open where id = 1;
end $$;

-- Only signed-in people may call these.
revoke execute on function public.claim_prize(), public.admin_overview(), public.admin_pool(),
  public.admin_set_paid(int, boolean), public.admin_set_draw(boolean), public.get_leaderboard()
  from public, anon;
grant execute on function public.claim_prize(), public.admin_overview(), public.admin_pool(),
  public.admin_set_paid(int, boolean), public.admin_set_draw(boolean), public.get_leaderboard(),
  public.is_admin(), public.is_employee()
  to authenticated;

-- Done! You should see "Success. No rows returned".
