# The Good-for-Me Games: setup guide

This puts your campaign on its own website that anyone with a company email address can use. No ChatGPT or Claude account is needed. Allow about 45 minutes. You don't need to know how to code; you'll copy and paste.

**What's in this folder**

- `site/` is the website itself (three files: `index.html`, `app.js`, `config.js`).
- `supabase-setup.sql` sets up the secure database, file storage and prize draw.
- `SETUP-GUIDE.md` is this guide.

You'll use two free services: **Supabase** (stores progress, uploads and prizes, and sends sign-in emails) and **Netlify** (puts the website online).

---

## Step 1. Create your Supabase project

1. Go to **supabase.com** and sign up (you can use your work Google or GitHub account, or email).
2. Click **New project**.
3. Name it `good-for-me-games`, create a strong database password (save it somewhere safe), and choose the region **South Asia (Mumbai)**.
4. Click **Create new project** and wait a minute or two while it sets up.

## Step 2. Set up the database

1. Open `supabase-setup.sql` in a text editor (Notepad on Windows, TextEdit on Mac).
2. Find the two lines marked `>>> EDIT` and change them:
   - Replace `yourcompany.com` with your company email domain, for example `oppam.me`. If staff use more than one domain, list them all: `array['oppam.me','oppam.in']`.
   - Replace `you@yourcompany.com` with your own email address. This makes you an organiser. Add a line for each extra organiser, for example `insert into public.admins (email) values ('hr@oppam.me');`
3. In Supabase, click **SQL Editor** in the left menu, then **New query**.
4. Paste the entire file and click **Run**. You should see "Success. No rows returned".

## Step 3. Set up sign-in emails (important)

Supabase's built-in email service only sends to your own Supabase team, so employees would never get their sign-in emails. You need to connect a real email sender.

**Easiest option: ask your IT team** for your company's SMTP details (host, port, username, password). Microsoft 365 and Google Workspace both support this.

**Or use a free email service**, such as Brevo (300 emails a day free) or Resend (3,000 a month free). Sign up, verify your sender address or domain as they instruct, and copy their SMTP details.

Then, in Supabase:

1. Go to **Authentication → Emails → SMTP Settings** and turn on **Enable custom SMTP**.
2. Enter the host, port, username and password. For the sender, use something like `wellbeing@yourcompany.com` and the name `Oppam Good-for-Me Games`.
3. Save.
4. Go to **Authentication → Rate Limits** and raise **Rate limit for sending emails** to at least `200` per hour, so launch day doesn't get blocked.

## Step 4. Update the email wording

Some company email systems (like Microsoft Outlook's link scanning) can "use up" sign-in links before the person clicks them. Including a code in the email solves this, because people can type the code instead.

In Supabase, go to **Authentication → Emails → Templates**. Open **Magic Link**, set the subject to `Your sign-in link for the Good-for-Me Games`, and replace the message body with:

```html
<h2>Welcome to the Good-for-Me Games</h2>
<p>Click below to sign in:</p>
<p><a href="{{ .ConfirmationURL }}">Sign in to the Good-for-Me Games</a></p>
<p>Or type this code on the website: <strong style="font-size:22px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>This link and code expire in one hour. If you didn't ask to sign in, you can ignore this email.</p>
```

Save, then open **Confirm signup** and paste the same subject and body there too (first-time sign-ins use that one).

## Step 5. Put the website online with Netlify

1. Go to **app.netlify.com/drop** and create a free account when prompted.
2. Drag the whole **`site`** folder onto the page. In a few seconds you'll get an address like `https://jolly-otter-123abc.netlify.app`.
3. To get a nicer address, open **Site configuration → Change site name** and pick something like `oppam-goodforme`. Your site becomes `https://oppam-goodforme.netlify.app`.

(If you own a domain, Netlify's **Domain management** page lets you use something like `games.oppam.me` instead. Your IT team may need to add one DNS record.)

## Step 6. Connect the website to Supabase

1. In Supabase, go to **Project Settings → API Keys** (or **Settings → API** on older screens).
2. Copy the **Project URL** and the **publishable key** (older projects call it the **anon public** key). Never use the secret or service_role key.
3. Open `site/config.js` in a text editor and paste them in, keeping the quote marks. Also set your email domain:

```js
window.GFM_CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_KEY: "sb_publishable_xxxxxxxx",
  ALLOWED_DOMAINS: ["oppam.me"]
};
```

4. Save the file. In Netlify, open your site, go to **Deploys**, and drag the `site` folder onto the drop area again to publish the update.

## Step 7. Tell Supabase your website address

In Supabase, go to **Authentication → URL Configuration**:

1. Set **Site URL** to your Netlify address, for example `https://oppam-goodforme.netlify.app`.
2. Under **Redirect URLs**, click **Add URL** and add the same address with `/**` on the end, for example `https://oppam-goodforme.netlify.app/**`.
3. Save.

## Step 8. Test it yourself

1. Open your website and sign in with your work email. Check your inbox (and spam folder).
2. Pick your leaderboard name.
3. Open a challenge and upload a photo. It should turn green and add 10 points.
4. Scroll to the bottom: you should see the **Organiser view** with your name and a **View uploads** button.
5. Try signing in with a personal email like Gmail. It should be refused.

## Step 9. Launch

1. When you want prizes to become available, press **Open the prize draw** in the organiser view. Until then, people who finish see "The prize draw opens soon".
2. Send the website address to your employees.

**Paying out prizes:** when someone sends you their card, find them in the organiser view, check their uploads and that the claim code matches, pay them, then tick **Paid**. **Download as CSV** gives you a spreadsheet of everything.

---

## Good to know

- **Storage:** the free Supabase plan includes 1 GB of file storage. Photos are shrunk before upload (usually 200 to 400 KB each), which is enough for roughly 300 to 400 people doing all seven challenges. You can check usage under **Project Settings → Usage**. If you'll have more participants, Supabase Pro costs about $25 a month and includes 100 GB.
- **Inactive projects pause:** free Supabase projects pause after a week with no activity. If you set up early and launch later, open the Supabase dashboard and click **Restore** if you see a paused notice. During the campaign, normal use keeps it awake.
- **Security:** only company email addresses can sign in. Points are awarded by the server only after a real upload, each person can claim exactly one card, and the random draw happens on the server, so it can't be tampered with from a browser. Uploaded files are visible only to the person who uploaded them and to organisers.
- **Adding or removing organisers later:** in Supabase, open **Table Editor → admins** and add or delete rows.
- **Changing the challenge text:** it's at the top of `site/app.js`. Edit the words between the quote marks, save, and drag the `site` folder into Netlify again.
