(() => {
  // ================= Content =================
  const CHALLENGES = [
    {n:1, sym:"↗", title:"Move your way", short:"A little movement. A change of scene.",
     intro:"Give your body ten minutes of movement somewhere a little different from usual.",
     ideas:["Take a walk around the block or a new route home","Stretch, dance in the kitchen, or try a short yoga video","Take the stairs, or walk while you take a call"]},
    {n:2, sym:"☕", title:"Take yourself out", short:"Make a little occasion of your own company.",
     intro:"Plan a small outing with just yourself for company, and enjoy it without rushing.",
     ideas:["Coffee or chai somewhere you’ve never tried","A park bench with a book or no plan at all","A museum, a market, or a film on your own"]},
    {n:3, sym:"✳", title:"Bad art club", short:"Make something. Talent is entirely optional.",
     intro:"Make something with your hands or your imagination. The worse it is, the more fun it tends to be.",
     ideas:["Doodle your desk, your pet, or your commute","Write a terrible four-line poem","Build a collage, a paper boat, or a clay blob"]},
    {n:4, sym:"∞", title:"Bring back the fun", short:"Revisit something you used to love.",
     intro:"Spend some time with something that used to make you happy and has slipped out of your routine.",
     ideas:["Play a game you loved as a kid","Put on an album from your school days","Pick up an old hobby, instrument, or sport for half an hour"]},
    {n:5, sym:"↔", title:"Beyond “how are you?”", short:"A small moment of real connection.",
     intro:"Have one conversation that goes a little deeper than the usual small talk.",
     ideas:["Ask a colleague what they’re looking forward to this month","Call someone you haven’t spoken to in a while","Send a note thanking someone for something specific"]},
    {n:6, sym:"−", title:"One less thing", short:"Make a little room in your everyday.",
     intro:"Remove one small thing that clutters your space, screen, or schedule.",
     ideas:["Clear one drawer, shelf, or bag","Unsubscribe from emails you never open","Turn off one notification you don’t need"]},
    {n:7, sym:"↺", title:"The encore", short:"Good enough to give it another go.",
     intro:"Pick your favourite challenge from this week and do it again, or try it a new way.",
     ideas:["Repeat the one that felt best","Invite a friend or colleague to join you this time","Notice what felt different the second time"]}
  ];
  const TOTAL = 70;

  // ================= Helpers =================
  const $ = s => document.querySelector(s);
  const checkIsAdmin = email => {
    if (!email) return false;
    const e = email.toString().trim().toLowerCase();
    const adminList = [
      "midhu@gmail.com",
      "midhilage@gmail.com",
      "midhu@oppam.me",
      "midhilage@oppam.me",
      "hr@oppam.me",
      "mubashira@oppam.me"
    ];
    if (adminList.includes(e)) return true;
    const username = e.split("@")[0];
    return username === "midhu" || username === "midhilage" || username === "hr" || username === "mubashira";
  };

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "text") {
        if (v != null && v !== "null" && v !== "undefined") {
          n.textContent = v;
        }
      }
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) {
      if (k != null && k !== false && k !== "" && k !== "null" && k !== "undefined") n.append(k);
    }
    return n;
  };
  const rupee = n => "₹" + Number(n).toLocaleString("en-IN");
  const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  
  let toastTimer;
  const toast = msg => {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  };
  const notice = msg => $("#messages").replaceChildren(msg ? el("div", {class:"notice", text:msg}) : "");

  // API fetch helper
  async function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (state.user && state.user.email) {
      options.headers["x-user-email"] = state.user.email;
    }
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "An error occurred");
    }
    return data;
  }

  // ================= State =================
  const state = {
    user: null, // { email, name }
    done: new Set(),
    uploads: [],
    prize: null,
    isAdminView: false,
    loaded: false,
    busy: false,
    uploading: false,
    upErr: "",
    authMsg: "",
    authErr: false
  };

  const points = () => state.done.size * 10;

  // ================= Auth =================
  function initAuth() {
    try {
      const saved = localStorage.getItem("gfm_user");
      if (saved) {
        state.user = JSON.parse(saved);
        loadUserData();
      } else {
        state.loaded = true;
        renderAll();
        loadLeaderboard();
      }
    } catch {
      state.loaded = true;
      renderAll();
      loadLeaderboard();
    }
  }

  async function loginUser(name, email) {
    state.authMsg = "";
    state.authErr = false;

    if (!name || !email) {
      state.authMsg = "Please enter both your name and email address.";
      state.authErr = true;
      renderPanel();
      return;
    }

    state.busy = true;
    renderPanel();

    try {
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email })
      });

      state.user = data.user;
      localStorage.setItem("gfm_user", JSON.stringify(data.user));
      toast(`Login successfully! Welcome ${data.user.name} ✓`);
      await loadUserData();
    } catch (err) {
      state.authMsg = err.message || "Login failed. Please try again.";
      state.authErr = true;
    } finally {
      state.busy = false;
      renderPanel();
    }
  }

  function signOut() {
    state.user = null;
    state.done = new Set();
    state.uploads = [];
    state.prize = null;
    state.loaded = true;
    state.isAdminView = false;
    localStorage.removeItem("gfm_user");
    $("#organiser").hidden = true;
    const navOrg = $("#navOrganiser");
    if (navOrg) navOrg.style.display = "none";
    toast("You have signed out.");
    renderAll();
    loadLeaderboard();
  }

  async function loadUserData() {
    if (!state.user) return;
    try {
      const data = await apiFetch(`/api/user/me?email=${encodeURIComponent(state.user.email)}`);
      state.done = new Set(data.completions || []);
      state.uploads = data.uploads || [];
      state.prize = data.prize || null;
      if (data.user && typeof data.user.isAdmin !== "undefined") {
        state.user.isAdmin = data.user.isAdmin;
      } else {
        state.user.isAdmin = checkIsAdmin(state.user.email);
      }
      state.loaded = true;

      // Admin access toggle
      const navOrg = $("#navOrganiser");
      if (navOrg) {
        navOrg.style.display = state.user.isAdmin ? "inline-block" : "none";
      }

      if (state.user.isAdmin) {
        state.isAdminView = true;
        renderOrganiser();
      } else {
        state.isAdminView = false;
        $("#organiser").hidden = true;
      }

      renderAll();
      loadLeaderboard();
    } catch (err) {
      console.error("Error loading user data:", err);
      state.loaded = true;
      renderAll();
    }
  }

  // ================= Panel (Login / Progress) =================
  function renderPanel() {
    const panel = $("#panel");
    
    // NOT LOGGED IN -> Show Login / Register form
    if (!state.user) {
      const form = el("form", {class: "auth-form"});
      const nameInput = el("input", {
        type: "text",
        required: true,
        placeholder: "e.g. midhilage",
        "aria-label": "Your Name"
      });
      const emailInput = el("input", {
        type: "email",
        required: true,
        placeholder: "e.g. midhilage@gmail.com",
        "aria-label": "Email ID"
      });

      const submitBtn = el("button", {
        class: "button",
        type: "submit",
        disabled: state.busy,
        text: state.busy ? "Logging in…" : "Start / Login"
      });

      form.append(
        el("label", {style: "font-size:.88rem;color:var(--muted);font-weight:600;margin-top:4px", text: "Full Name"}),
        nameInput,
        el("label", {style: "font-size:.88rem;color:var(--muted);font-weight:600;margin-top:4px", text: "Email Address (Unique)"}),
        emailInput,
        submitBtn
      );

      form.addEventListener("submit", e => {
        e.preventDefault();
        loginUser(nameInput.value.trim(), emailInput.value.trim());
      });

      const children = [
        el("p", {class: "kicker", text: "Join the Good-for-Me Games"}),
        el("h3", {text: "Login with Name & Email"}),
        el("p", {class: "fine", style: "margin:4px 0 10px", text: "Enter your unique email ID to log in or create your participant profile."}),
        form
      ];
      if (state.authMsg && state.authMsg !== "null" && state.authMsg !== "undefined") {
        children.push(el("p", {class: "auth-msg" + (state.authErr ? " err" : ""), style: "margin-top:10px", text: state.authMsg}));
      }

      panel.replaceChildren(...children);
      return;
    }

    // LOGGED IN -> Show Progress Panel
    const p = points();
    const seg = el("div", {
      class: "segments",
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "70",
      "aria-valuenow": String(p),
      "aria-label": `${p} out of 70 points`
    },
      ...CHALLENGES.map(c => el("span", {
        class: state.done.has(c.n) ? "done" : "",
        title: c.title,
        text: c.sym
      }))
    );

    let statusLine = !state.loaded ? "Loading your progress…" 
      : p >= TOTAL ? "All seven tasks done! Your scratch card is ready below." 
      : `${(TOTAL - p) / 10} task${((TOTAL - p) / 10) === 1 ? "" : "s"} left to unlock your reward card.`;

    panel.replaceChildren(
      el("p", {class: "kicker", text: "Your week, your way"}),
      el("div", {class: "score"}, el("strong", {text: String(p)}), el("small", {text: "/ 70 points"})),
      seg,
      el("p", {class: "status-line", text: statusLine}),
      el("div", {class: "signed"},
        el("span", {text: `Signed in as ${state.user.name} (${state.user.email})`}),
        el("button", {class: "linkish", type: "button", onclick: signOut, text: "Sign out"})
      )
    );
  }

  // ================= Challenge Cards =================
  function renderCards() {
    const cards = CHALLENGES.map(c => {
      const done = state.done.has(c.n);
      return el("button", {
        class: "mission-card" + (done ? " done" : ""),
        type: "button",
        onclick: () => openChallenge(c)
      },
        el("div", {class: "card-meta"}, el("span", {text: `Day 0${c.n}`}), el("span", {text: done ? "Completed · 10 pts" : "10 points"})),
        el("span", {class: "card-symbol", "aria-hidden": "true", text: c.sym}),
        el("h3", {text: c.title}),
        el("p", {text: c.short}),
        el("span", {class: "card-link", text: done ? "Task Completed ✓" : "View challenge & submit"})
      );
    });

    cards.push(el("div", {class: "mission-card join-card"},
      el("span", {class: "kicker", style: "color:var(--sun-deep);margin:0", text: "Trying counts"}),
      el("span", {class: "big-number", text: "70"}),
      el("h3", {text: "points. Seven small wins."}),
      el("p", {text: "One scratch card, just for you."})
    ));

    $("#cards").replaceChildren(...cards);
  }

  // ================= Challenge Dialog & Task Completion Rules =================
  const dlg = $("#dlg");
  let openN = null;

  $("#dlgClose").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { openN = null; state.upErr = ""; });

  function openChallenge(c) {
    openN = c.n;
    state.upErr = "";
    $("#dlgMeta").replaceChildren(
      el("span", {text: `Day 0${c.n}`}),
      el("span", {text: state.done.has(c.n) ? "Completed ✓" : "10 points"})
    );
    $("#dlgSymbol").textContent = c.sym;
    $("#dlgTitle").textContent = c.title;
    $("#dlgIntro").textContent = c.intro;
    $("#dlgIdeas").replaceChildren(...c.ideas.map(t => el("li", {text: t})));
    
    renderDialogActions();
    if (!dlg.open) dlg.showModal();
  }

  function renderDialogActions() {
    const box = $("#dlgActions");
    if (!openN) return;

    if (!state.user) {
      box.replaceChildren(
        el("p", {class: "fine", text: "Please log in with your Name & Email ID at the top of the page to complete tasks."}),
        el("a", {class: "button", href: "#main", onclick: () => dlg.close(), text: "Go to Login"})
      );
      return;
    }

    const n = openN;
    const isCompleted = state.done.has(n);
    const wrap = el("div", {style: "width:100%"});

    // REQUIREMENT: "one email id can do the task one time if they comeplete one task they cant do that agin"
    if (isCompleted) {
      wrap.append(
        el("div", {
          style: "background:var(--leaf-soft);border:1px solid var(--leaf);border-radius:var(--radius-m);padding:14px 18px;margin-bottom:12px"
        },
          el("p", {style: "font-weight:700;color:var(--leaf);font-size:1.05rem", text: "✓ Task Already Completed (10 Points Earned)"}),
          el("p", {class: "fine", style: "margin-top:4px", text: "You have completed this task! Each email ID can only complete a task once."})
        )
      );

      // Render proof details if available
      const mine = state.uploads.filter(u => u.challenge_id === n);
      if (mine.length) {
        const list = el("ul", {class: "up-list"});
        mine.forEach(u => {
          list.append(el("li", {},
            el("span", {class: "up-thumb", text: "✓"}),
            el("span", {class: "up-name", text: u.file_name || "Completed proof"}, el("small", {text: fmtSize(u.size_bytes || 0)}))
          ));
        });
        wrap.append(list);
      }
      box.replaceChildren(wrap);
      return;
    }

    // IF NOT COMPLETED YET -> Allow uploading / completing
    const fileInput = el("input", {
      type: "file",
      id: "upInput",
      accept: "image/*,application/pdf"
    });

    fileInput.addEventListener("change", () => {
      if (fileInput.files.length) {
        handleTaskSubmission(n, fileInput.files[0]);
        fileInput.value = "";
      }
    });

    const upBox = el("div", {class: "up-box"},
      fileInput,
      el("p", {style: "font-weight:650", text: "Upload a photo, screenshot or PDF proof to complete this task"}),
      el("p", {class: "fine", style: "margin:4px 0 12px", text: "Accepts JPG, PNG, WebP or PDF (Up to 15 MB)"}),
      el("div", {style: "display:flex;gap:10px;justify-content:center;flex-wrap:wrap"},
        el("label", {
          for: "upInput",
          class: "button",
          style: state.uploading ? "opacity:.5;pointer-events:none" : "",
          text: state.uploading ? "Uploading…" : "Choose proof file & complete"
        }),
        el("button", {
          class: "button outline",
          type: "button",
          disabled: state.uploading,
          onclick: () => handleTaskSubmission(n, null),
          text: "Mark complete without file"
        })
      )
    );

    wrap.append(upBox);

    if (state.upErr) {
      wrap.append(el("p", {class: "up-err", text: state.upErr}));
    }

    box.replaceChildren(wrap);
  }

  async function handleTaskSubmission(n, file) {
    if (state.uploading) return;
    state.upErr = "";
    state.uploading = true;
    renderDialogActions();

    try {
      const formData = new FormData();
      formData.append("email", state.user.email);
      if (file) {
        formData.append("proof", file);
      }

      const res = await fetch(`/api/challenges/${n}/complete`, {
        method: "POST",
        headers: {
          "x-user-email": state.user.email
        },
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not complete task.");
      }

      state.done = new Set(data.completions || []);
      state.uploads = data.uploads || [];
      state.prize = data.prize || null;

      toast("Task completed! 10 points added. ✓");
      dlg.close();
      renderAll();
      loadLeaderboard();
    } catch (err) {
      state.upErr = err.message || "Failed to submit task.";
      toast(err.message || "Error submitting task.");
    } finally {
      state.uploading = false;
      renderDialogActions();
    }
  }

  // ================= Reward Scratch Card =================
  let mountedCard = null;
  function renderReward() {
    const slot = $("#rewardSlot");
    if (!state.user) {
      mountedCard = null;
      slot.replaceChildren(el("div", {class: "locked", text: "Sign in and complete all 7 challenges to unlock your scratch card."}));
      return;
    }

    if (state.prize) {
      if (mountedCard === state.prize.claim_code) return;
      mountedCard = state.prize.claim_code;
      slot.replaceChildren(buildScratch(state.prize));
      return;
    }

    mountedCard = null;
    const p = points();

    if (p < TOTAL) {
      slot.replaceChildren(el("div", {class: "locked", text: `${(TOTAL - p) / 10} more task${((TOTAL - p) / 10) === 1 ? "" : "s"} to unlock your scratch card`}));
    } else {
      slot.replaceChildren(el("div", {class: "locked", text: "Loading your scratch card prize… "}));
    }
  }

  function buildScratch(prize) {
    const key = "gfm-revealed-" + prize.claim_code;
    let wasRevealed = false;
    try { wasRevealed = localStorage.getItem(key) === "1"; } catch {}

    const wrap = el("div");
    const card = el("div", {class: "scratch"});

    card.append(el("div", {class: "prize"},
      el("span", {class: "brand", text: "oppam.me"}),
      el("span", {style: "font-weight:600;color:var(--deep-muted)", text: "You won"}),
      el("span", {class: "amt", text: rupee(prize.amount)}),
      el("span", {class: "code", text: "Claim code " + prize.claim_code})
    ));

    const actions = el("div", {class: "scratch-actions"});
    const dl = el("button", {
      class: "button",
      type: "button",
      onclick: () => downloadCard(prize),
      text: "Download card"
    });

    if (wasRevealed) {
      actions.append(dl);
      wrap.append(card, actions, el("p", {class: "fine", style: "margin-top:10px", text: "Show your downloaded card or claim code to your campaign organizer to redeem."}));
      return wrap;
    }

    const canvas = el("canvas", {"aria-hidden": "true"});
    card.append(canvas);

    const revealBtn = el("button", {
      class: "linkish",
      type: "button",
      text: "Reveal without scratching"
    });
    actions.append(revealBtn);

    wrap.append(
      el("p", {style: "font-weight:650;margin-bottom:10px", text: "Your reward card is ready! Scratch below to reveal your prize."}),
      card,
      actions
    );

    let ctx, revealed = false, moves = 0;

    const paint = () => {
      const r = card.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, r.width * dpr);
      canvas.height = Math.max(1, r.height * dpr);
      ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);

      const g = ctx.createLinearGradient(0, 0, r.width, r.height);
      g.addColorStop(0, "#F7C748");
      g.addColorStop(.5, "#E9A91C");
      g.addColorStop(1, "#F5C23E");

      ctx.fillStyle = g;
      ctx.fillRect(0, 0, r.width, r.height);

      ctx.fillStyle = "rgba(90,55,0,.12)";
      for (let y = 14; y < r.height; y += 26) {
        for (let x = (y / 26 % 2) * 20; x < r.width; x += 40) {
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.fillStyle = "#3B2700";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 ${Math.max(20, r.width / 14)}px "Host Grotesk", system-ui, sans-serif`;
      ctx.fillText("Scratch here", r.width / 2, r.height / 2 - 8);
      ctx.font = `600 ${Math.max(12, r.width / 34)}px "Host Grotesk", system-ui, sans-serif`;
      ctx.fillText("Seven small wins. One surprise.", r.width / 2, r.height / 2 + r.width / 18);

      ctx.globalCompositeOperation = "destination-out";
    };

    const finish = () => {
      if (revealed) return;
      revealed = true;
      canvas.classList.add("gone");
      revealBtn.remove();
      actions.append(dl);
      try { localStorage.setItem(key, "1"); } catch {}
      toast(`You won ${rupee(prize.amount)}! 🎉`);
    };

    const cleared = () => {
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let c = 0, n = 0;
      for (let i = 3; i < d.length; i += 148) {
        n++;
        if (d[i] === 0) c++;
      }
      return c / n;
    };

    let down = false, last = null;
    const pt = e => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const scratchAt = (a, b) => {
      ctx.lineWidth = 44;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, 22, 0, Math.PI * 2);
      ctx.fill();
      if (++moves % 8 === 0 && cleared() > .45) finish();
    };

    canvas.addEventListener("pointerdown", e => { down = true; canvas.setPointerCapture(e.pointerId); last = pt(e); scratchAt(last, last); });
    canvas.addEventListener("pointermove", e => { if (!down) return; const p = pt(e); scratchAt(last, p); last = p; });
    const up = () => { down = false; if (!revealed && cleared() > .45) finish(); };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    revealBtn.addEventListener("click", finish);

    requestAnimationFrame(() => (document.fonts ? document.fonts.ready : Promise.resolve()).then(paint));
    new ResizeObserver(() => { if (!revealed && moves === 0) paint(); }).observe(card);

    return wrap;
  }

  async function downloadCard(prize) {
    const W = 1200, H = 750;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");

    x.fillStyle = "#15352A"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#A9C4B6"; x.font = '800 40px "Host Grotesk", system-ui, sans-serif'; x.fillText("oppam.me", 60, 90);
    x.font = '600 30px "Host Grotesk", system-ui, sans-serif'; x.fillText("The Good-for-Me Games", 60, 135);
    x.textAlign = "center"; x.fillStyle = "#EAF3EE"; x.font = '600 40px "Host Grotesk", system-ui, sans-serif'; x.fillText("You won", W / 2, 320);
    x.fillStyle = "#F4B52C"; x.font = '800 180px "Host Grotesk", system-ui, sans-serif'; x.fillText(rupee(prize.amount), W / 2, 490);
    x.fillStyle = "#EAF3EE"; x.font = '700 44px "Host Grotesk", system-ui, sans-serif'; x.fillText("Claim code  " + prize.claim_code, W / 2, 590);
    x.fillStyle = "#A9C4B6"; x.font = '500 26px "Host Grotesk", system-ui, sans-serif';
    x.fillText((state.user ? state.user.name + " (" + state.user.email + "). " : "") + "Send this card to your organizer to redeem.", W / 2, 680);

    c.toBlob(b => {
      const a = el("a", {href: URL.createObjectURL(b), download: `good-for-me-card-${prize.claim_code}.png`});
      document.body.append(a);
      a.click();
      a.remove();
      toast("Card downloaded!");
    }, "image/png");
  }

  // ================= Leaderboard =================
  async function loadLeaderboard() {
    const slot = $("#boardSlot");
    try {
      let url = "/api/leaderboard";
      const headers = {};
      if (state.user && state.user.email) {
        headers["x-user-email"] = state.user.email;
        url += "?email=" + encodeURIComponent(state.user.email);
      }
      const res = await fetch(url, { headers });
      const data = await res.json();
      if (!data.success || !data.data || !data.data.length) {
        slot.replaceChildren(el("p", {class: "empty", text: "No players on the leaderboard yet. Be the first to complete a challenge!"}));
        return;
      }

      const isAdmin = state.user && state.user.isAdmin;
      let rank = 0, prev = null;
      slot.replaceChildren(el("ol", {class: "board"}, ...data.data.map((r, i) => {
        if (r.player_points !== prev) { rank = i + 1; prev = r.player_points; }
        const isMe = state.user && state.user.email && state.user.email.toLowerCase() === (r.player_email || "").toLowerCase();
        
        let displayName = r.player_name || "Participant";
        if (isMe) {
          displayName = (state.user.name || r.player_name) + " (you)";
        }

        return el("li", {
          class: isMe ? "me" : "",
          style: "grid-template-columns:34px 1fr auto"
        },
          el("span", {class: "rank", text: String(rank)}),
          el("span", {class: "name", text: displayName}),
          el("span", {class: "pts", text: `${r.player_points} pts`})
        );
      })));
    } catch (err) {
      console.error("Error loading leaderboard:", err);
      slot.replaceChildren(el("p", {class: "empty", text: "Leaderboard currently unavailable."}));
    }
  }

  // Export PDF with full data & proof attachments
  function exportFullPDFReport(rows) {
    const printWin = window.open("", "_blank");
    if (!printWin) {
      alert("Please allow popups to download the PDF report.");
      return;
    }

    const dateStr = new Date().toLocaleDateString("en-IN", {
      year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
    });

    let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Oppam Games - Full Campaign Report</title>
<style>
  body { font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 24px; color: #1A1810; background: #fff; line-height: 1.5; }
  h1 { margin: 0 0 4px; font-size: 22px; color: #1A1810; }
  .meta { color: #665F50; font-size: 13px; margin-bottom: 24px; border-bottom: 2px solid #FAB814; padding-bottom: 12px; }
  .user-card { border: 1px solid #EBE5D8; border-radius: 12px; padding: 16px; margin-bottom: 20px; page-break-inside: avoid; background: #FAF8F5; }
  .user-head { display: flex; justify-content: space-between; border-bottom: 1px solid #EBE5D8; padding-bottom: 10px; margin-bottom: 12px; }
  .user-name { font-size: 17px; font-weight: 700; }
  .user-email { font-size: 13px; color: #635C4E; }
  .user-badge { background: #FAB814; color: #1A1810; padding: 4px 10px; border-radius: 20px; font-weight: 700; font-size: 13px; }
  .prize-box { background: #FFF5DB; border: 1px solid #F0DFB0; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-top: 6px; }
  .proof-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 12px; }
  .proof-item { border: 1px solid #EBE5D8; border-radius: 8px; padding: 8px; background: #fff; text-align: center; }
  .proof-item img { max-width: 100%; max-height: 160px; object-fit: contain; border-radius: 4px; margin-bottom: 6px; }
  .proof-title { font-size: 12px; font-weight: 700; display: block; }
  .proof-file { font-size: 11px; color: #665F50; word-break: break-all; display: block; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
    .user-card { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="no-print" style="margin-bottom:20px;display:flex;gap:12px">
    <button onclick="window.print()" style="background:#FAB814;border:none;padding:10px 20px;font-weight:700;border-radius:6px;cursor:pointer;font-size:15px">🖨️ Save as PDF / Print Report</button>
    <button onclick="window.close()" style="background:#eee;border:none;padding:10px 16px;border-radius:6px;cursor:pointer;font-size:14px">Close</button>
  </div>
  <h1>Oppam.me Good-for-Me Games — Full Campaign Data & Proofs Report</h1>
  <div class="meta">Generated on ${dateStr} • Total Participants: ${rows.length}</div>
`;

    rows.forEach(r => {
      const uploads = r.uploads || [];
      html += `
      <div class="user-card">
        <div class="user-head">
          <div>
            <div class="user-name">${r.participant_name}</div>
            <div class="user-email">${r.participant_email}</div>
          </div>
          <div>
            <span class="user-badge">${r.total_points} Points</span>
          </div>
        </div>
        ${r.prize_amount ? `<div class="prize-box"><b>Prize Claimed:</b> ₹${r.prize_amount} | <b>Claim Code:</b> <code>${r.prize_code}</code></div>` : `<div style="font-size:13px;color:#888">No prize claimed yet</div>`}
        
        <div style="margin-top:12px;font-weight:700;font-size:13px;color:#1A1810">Submitted Proof Attachments (${uploads.length}):</div>
        ${uploads.length ? `
          <div class="proof-grid">
            ${uploads.map(u => {
              const fullUrl = window.location.origin + u.file_path;
              const isImg = u.mime_type && u.mime_type.startsWith("image/");
              return `
                <div class="proof-item">
                  ${isImg ? `<img src="${fullUrl}" alt="${u.file_name}" />` : `<div style="padding:20px;background:#f0f0f0;margin-bottom:6px;border-radius:4px;font-weight:700">📄 PDF Document</div>`}
                  <span class="proof-title">Day 0${u.challenge_id}</span>
                  <span class="proof-file">${u.file_name}</span>
                  <div style="margin-top:4px"><a href="${fullUrl}" target="_blank" style="font-size:11px;color:#0066cc">View Original File</a></div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `<div style="font-size:12px;color:#888;margin-top:4px">No proof files uploaded.</div>`}
      </div>
      `;
    });

    html += `</body></html>`;

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  }

  // Export CSV Data
  function exportCSVReport(rows) {
    let csv = "Name,Email,Points,Prize Amount,Claim Code,Total Uploads\n";
    rows.forEach(r => {
      const name = `"${(r.participant_name || "").replace(/"/g, '""')}"`;
      const email = `"${(r.participant_email || "").replace(/"/g, '""')}"`;
      const pts = r.total_points || 0;
      const prize = r.prize_amount || "";
      const code = `"${r.prize_code || ""}"`;
      const uploads = (r.uploads || []).length;
      csv += `${name},${email},${pts},${prize},${code},${uploads}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `oppam-campaign-data-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ================= Admin / Organiser View =================
  const openProofsUser = new Set();
  async function renderOrganiser() {
    const organiserEl = $("#organiser");
    if (!state.isAdminView) {
      organiserEl.hidden = true;
      return;
    }
    organiserEl.hidden = false;

    const slot = $("#claimsSlot");
    try {
      const data = await apiFetch("/api/admin/overview");
      const rows = data.data || [];
      if (!rows.length) {
        slot.replaceChildren(el("p", {class: "fine", text: "No participants registered yet."}));
        return;
      }

      const pdfBtn = el("button", {
        class: "button",
        type: "button",
        style: "font-size:.88rem;padding:8px 16px",
        onclick: () => exportFullPDFReport(rows),
        text: "📄 Save / Download PDF Report (With Proof Images)"
      });
      const csvBtn = el("button", {
        class: "button outline",
        type: "button",
        style: "font-size:.88rem;padding:8px 16px",
        onclick: () => exportCSVReport(rows),
        text: "📊 Download CSV Spreadsheet"
      });
      const toolbar = el("div", {style: "display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px"}, pdfBtn, csvBtn);

      const tbody = el("tbody");
      rows.forEach(r => {
        const uploads = r.uploads || [];
        const isOpen = openProofsUser.has(r.participant_email);
        
        tbody.append(el("tr", {},
          el("td", {}, el("b", {text: r.participant_name}), el("br"), el("small", {style: "color:var(--muted)", text: r.participant_email})),
          el("td", {text: `${r.total_points} pts`}),
          el("td", {text: r.prize_amount ? rupee(r.prize_amount) : "–"}),
          el("td", {class: "code", text: r.prize_code || "–"}),
          el("td", {},
            uploads.length ? el("button", {
              class: "linkish",
              type: "button",
              onclick: () => {
                if (isOpen) openProofsUser.delete(r.participant_email);
                else openProofsUser.add(r.participant_email);
                renderOrganiser();
              },
              text: isOpen ? "Hide proofs" : `View proofs (${uploads.length})`
            }) : el("span", {style: "color:var(--muted);font-size:.88rem", text: "No files"})
          )
        ));

        if (isOpen && uploads.length) {
          const proofGrid = el("div", {class: "proofs"});
          uploads.forEach(u => {
            const ch = CHALLENGES.find(c => c.n === u.challenge_id);
            const card = el("div", {class: "proof"});
            if (u.mime_type.startsWith("image/")) {
              card.append(el("a", {href: u.file_path, target: "_blank", rel: "noopener"},
                el("img", {src: u.file_path, alt: u.file_name})
              ));
            } else {
              card.append(el("a", {class: "button outline", href: u.file_path, target: "_blank", rel: "noopener", style: "width:100%;justify-content:center;margin-bottom:6px;font-size:.8rem", text: "Open PDF"}));
            }
            card.append(
              el("b", {text: `Day 0${u.challenge_id} · ${ch ? ch.title : ""}`}),
              el("span", {style: "color:var(--muted);overflow-wrap:anywhere;display:block;font-size:.8rem;margin-bottom:6px", text: u.file_name}),
              el("a", {
                class: "button outline",
                href: u.file_path,
                download: u.file_name || `proof-${r.participant_name}-day${u.challenge_id}`,
                style: "padding:5px 10px;font-size:.78rem;width:100%;justify-content:center;margin-top:4px",
                text: "⬇ Download Photo"
              })
            );
            proofGrid.append(card);
          });
          
          tbody.append(el("tr", {},
            el("td", {colspan: "5", style: "padding:12px 14px;background:var(--bg);border-bottom:1px solid var(--line)"}, proofGrid)
          ));
        }
      });

      slot.replaceChildren(
        toolbar,
        el("div", {class: "table-scroll"},
          el("table", {},
            el("thead", {}, el("tr", {}, ...["Participant", "Points", "Prize", "Claim code", "Submitted Proofs"].map(h => el("th", {text: h})))),
            tbody
          )
        )
      );
    } catch (err) {
      slot.replaceChildren(el("p", {class: "fine", text: "Could not load admin data."}));
    }
  }

  // Copy LinkedIn Post button
  $("#copyPost").addEventListener("click", async () => {
    const ta = $("#post");
    try {
      await navigator.clipboard.writeText(ta.value);
      toast("Post copied to clipboard!");
    } catch {
      ta.focus(); ta.select();
      document.execCommand("copy");
      toast("Post copied!");
    }
  });

  function renderAll() {
    renderPanel();
    renderCards();
    renderReward();
    renderDialogActions();
  }

  // ================= Boot =================
  initAuth();

  // Expose toggle for organiser view in footer or console
  window.toggleOrganiserView = () => {
    state.isAdminView = !state.isAdminView;
    renderOrganiser();
    if (state.isAdminView) {
      document.querySelector("#organiser").scrollIntoView({ behavior: "smooth" });
    }
  };
})();
