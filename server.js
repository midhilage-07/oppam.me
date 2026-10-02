const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Pool } = require("pg");
const Database = require("better-sqlite3");

// Ensure data and uploads directories exist
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const uploadsDir = process.env.UPLOADS_DIR || path.join(DATA_DIR, "uploads");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Check Database Connection (PostgreSQL if DATABASE_URL is set, else SQLite)
const DATABASE_URL = process.env.DATABASE_URL;
let isPg = false;
let sqliteDb = null;
let pgPool = null;

if (DATABASE_URL) {
  isPg = true;
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
  });
  console.log("Connected to PostgreSQL Database (Supabase / External DB)");
} else {
  sqliteDb = new Database(path.join(DATA_DIR, "game.db"));
  console.log("Connected to Local SQLite Database");
}

// Database Abstraction Helpers
async function dbQueryOne(sql, params = []) {
  if (isPg) {
    let pIdx = 1;
    const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
    const res = await pgPool.query(pgSql, params);
    return res.rows[0] || null;
  } else {
    return sqliteDb.prepare(sql).get(...params) || null;
  }
}

async function dbQueryAll(sql, params = []) {
  if (isPg) {
    let pIdx = 1;
    const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
    const res = await pgPool.query(pgSql, params);
    return res.rows;
  } else {
    return sqliteDb.prepare(sql).all(...params);
  }
}

async function dbRun(sql, params = []) {
  if (isPg) {
    let pIdx = 1;
    const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
    const res = await pgPool.query(pgSql, params);
    return res;
  } else {
    return sqliteDb.prepare(sql).run(...params);
  }
}

// Set up DB Schema
async function initDb() {
  if (isPg) {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS completions (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL,
        challenge_id INTEGER NOT NULL,
        completed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_email, challenge_id)
      );
      CREATE TABLE IF NOT EXISTS uploads (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL,
        challenge_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS prizes (
        id SERIAL PRIMARY KEY,
        user_email TEXT UNIQUE NOT NULL,
        amount INTEGER NOT NULL,
        claim_code TEXT UNIQUE NOT NULL,
        claimed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        paid INTEGER DEFAULT 0
      );
    `);
  } else {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS completions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        challenge_id INTEGER NOT NULL,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_email, challenge_id)
      );
      CREATE TABLE IF NOT EXISTS uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        challenge_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS prizes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT UNIQUE NOT NULL,
        amount INTEGER NOT NULL,
        claim_code TEXT UNIQUE NOT NULL,
        claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid INTEGER DEFAULT 0
      );
    `);
  }
}
initDb().catch(err => console.error("DB Init error:", err));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static web app and uploaded proof files
app.use(express.static(path.join(__dirname, "site")));
app.use("/uploads", express.static(uploadsDir));

// Multer storage for uploaded proof files (Max 2 MB limit for photos & videos)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "proof-" + uniqueSuffix + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 } // 2 MB max file size
});

// Helper: Prize Pool amounts & generator
const PRIZE_AMOUNTS = [5000, 2000, 1000, 500, 100, 50, 10];
function generateClaimCode() {
  const part1 = Math.random().toString(36).substring(2, 6).toUpperCase();
  const part2 = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `GFM-${part1}-${part2}`;
}

function getRandomPrize() {
  const idx = Math.floor(Math.random() * PRIZE_AMOUNTS.length);
  return PRIZE_AMOUNTS[idx];
}

// API Routes
const ADMIN_EMAILS = [
  "hr@oppam.me",
  "mubashira@oppam.me",
  "midhu@gmail.com"
];
function isAdminEmail(email) {
  if (!email) return false;
  const e = email.toString().trim().toLowerCase();
  return ADMIN_EMAILS.includes(e);
}

function parseSqliteDate(str) {
  if (!str) return Date.now();
  if (str instanceof Date) return str.getTime();
  if (typeof str === "number") return str;
  const iso = str.toString().replace(" ", "T") + (str.toString().includes("Z") ? "" : "Z");
  const ms = Date.parse(iso);
  return isNaN(ms) ? Date.now() : ms;
}

// 1. Auth Login / Register
app.post("/api/auth/login", async (req, res) => {
  try {
    let { email, name } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: "Email and Name are required." });
    }

    email = email.trim().toLowerCase();
    name = name.trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    let user = await dbQueryOne("SELECT * FROM users WHERE email = ?", [email]);

    if (!user) {
      await dbRun("INSERT INTO users (email, name) VALUES (?, ?)", [email, name]);
      user = await dbQueryOne("SELECT * FROM users WHERE email = ?", [email]);
    } else {
      if (user.name !== name) {
        await dbRun("UPDATE users SET name = ? WHERE email = ?", [name, email]);
        user.name = name;
      }
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: isAdminEmail(user.email)
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Database or server error during login." });
  }
});

// 2. Get User State (Completions, Uploads, Prize)
app.get("/api/user/me", async (req, res) => {
  try {
    const email = (req.headers["x-user-email"] || req.query.email || "").toString().trim().toLowerCase();
    if (!email) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await dbQueryOne("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const completionsRows = await dbQueryAll("SELECT challenge_id, completed_at FROM completions WHERE user_email = ?", [email]);
    const completedTaskIds = completionsRows.map(c => c.challenge_id);
    const completionsMap = {};
    completionsRows.forEach(c => {
      completionsMap[c.challenge_id] = parseSqliteDate(c.completed_at);
    });

    const uploads = await dbQueryAll("SELECT * FROM uploads WHERE user_email = ? ORDER BY created_at ASC", [email]);
    const prize = await dbQueryOne("SELECT * FROM prizes WHERE user_email = ?", [email]);

    return res.json({
      user: { id: user.id, email: user.email, name: user.name, isAdmin: isAdminEmail(user.email) },
      completions: completedTaskIds,
      completionsMap,
      serverTime: Date.now(),
      uploads,
      prize: prize || null
    });
  } catch (err) {
    console.error("Get user error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// 3. Complete Task / Upload Proof (1 hour unlock delay, 2MB max file size)
app.post("/api/challenges/:id/complete", (req, res, next) => {
  upload.single("proof")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File size exceeds 2 MB limit. Please upload a photo or video under 2 MB." });
      }
      return res.status(400).json({ error: err.message || "File upload error." });
    }
    next();
  });
}, async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id, 10);
    const email = ((req.body && req.body.email) || req.headers["x-user-email"] || "").toString().trim().toLowerCase();

    if (!email) {
      return res.status(401).json({ error: "Please log in first to complete a task." });
    }

    if (isNaN(challengeId) || challengeId < 1 || challengeId > 7) {
      return res.status(400).json({ error: "Invalid challenge ID." });
    }

    const user = await dbQueryOne("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found. Please log in again." });
    }

    const existingCompletion = await dbQueryOne(
      "SELECT * FROM completions WHERE user_email = ? AND challenge_id = ?",
      [email, challengeId]
    );

    if (existingCompletion) {
      return res.status(400).json({
        error: "Task already completed! Each email ID can only complete each task once."
      });
    }

    // 1-hour delay between completing tasks
    if (challengeId > 1) {
      const prevCompletion = await dbQueryOne(
        "SELECT completed_at FROM completions WHERE user_email = ? AND challenge_id = ?",
        [email, challengeId - 1]
      );

      if (!prevCompletion) {
        return res.status(400).json({
          error: `Please complete Day ${challengeId - 1} task first before accessing Day ${challengeId}.`
        });
      }

      const prevMs = parseSqliteDate(prevCompletion.completed_at);
      const unlockTime = prevMs + (1 * 60 * 60 * 1000); // 1 HOUR DELAY
      const now = Date.now();

      if (now < unlockTime) {
        const diffMs = unlockTime - now;
        const hrs = Math.floor(diffMs / 3600000);
        const mins = Math.floor((diffMs % 3600000) / 60000);
        const secs = Math.floor((diffMs % 60000) / 1000);
        const timeRemainingStr = hrs > 0 ? `${hrs}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;
        return res.status(400).json({
          error: `Day ${challengeId - 1} task completed successfully. Day ${challengeId} task will be available in ${timeRemainingStr}.`
        });
      }
    }

    await dbRun("INSERT INTO completions (user_email, challenge_id) VALUES (?, ?)", [email, challengeId]);

    if (req.file) {
      const filePath = "/uploads/" + req.file.filename;
      await dbRun(`
        INSERT INTO uploads (user_email, challenge_id, file_name, file_path, mime_type, size_bytes)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [email, challengeId, req.file.originalname, filePath, req.file.mimetype, req.file.size]);
    }

    const totalCompletionsRow = await dbQueryOne(
      "SELECT COUNT(*) as count FROM completions WHERE user_email = ?",
      [email]
    );
    const totalCompletions = parseInt((totalCompletionsRow && totalCompletionsRow.count) || 0, 10);

    let prize = await dbQueryOne("SELECT * FROM prizes WHERE user_email = ?", [email]);
    if (totalCompletions >= 7 && !prize) {
      const amount = getRandomPrize();
      const code = generateClaimCode();
      await dbRun("INSERT INTO prizes (user_email, amount, claim_code) VALUES (?, ?, ?)", [email, amount, code]);
      prize = await dbQueryOne("SELECT * FROM prizes WHERE user_email = ?", [email]);
    }

    const completionsRows = await dbQueryAll("SELECT challenge_id, completed_at FROM completions WHERE user_email = ?", [email]);
    const completedTaskIds = completionsRows.map(c => c.challenge_id);
    const completionsMap = {};
    completionsRows.forEach(c => {
      completionsMap[c.challenge_id] = parseSqliteDate(c.completed_at);
    });

    const uploads = await dbQueryAll("SELECT * FROM uploads WHERE user_email = ? ORDER BY created_at ASC", [email]);

    return res.json({
      success: true,
      message: "Task completed successfully!",
      completions: completedTaskIds,
      completionsMap,
      serverTime: Date.now(),
      uploads,
      prize: prize || null
    });
  } catch (err) {
    console.error("Complete task error:", err);
    if (err.message && (err.message.includes("UNIQUE constraint failed") || err.message.includes("duplicate key"))) {
      return res.status(400).json({
        error: "Task already completed! Each email ID can only complete each task once."
      });
    }
    return res.status(500).json({ error: "Server error while saving task completion." });
  }
});

// 4. Leaderboard API
app.get("/api/leaderboard", async (req, res) => {
  try {
    const requesterEmail = (req.headers["x-user-email"] || req.query.email || "").toString().trim().toLowerCase();
    const requesterIsAdmin = isAdminEmail(requesterEmail);

    const query = `
      SELECT u.name as player_name, u.email as player_email, COUNT(c.challenge_id) * 10 as player_points
      FROM users u
      LEFT JOIN completions c ON u.email = c.user_email
      GROUP BY u.email, u.name, u.created_at
      ORDER BY player_points DESC, u.created_at ASC
      LIMIT 50
    `;
    const data = await dbQueryAll(query);

    const sanitized = data.map(r => {
      const isMe = requesterEmail && requesterEmail === r.player_email.toLowerCase();
      return {
        player_name: r.player_name,
        player_email: (requesterIsAdmin || isMe) ? r.player_email : "",
        player_points: parseInt(r.player_points || 0, 10)
      };
    });

    return res.json({ success: true, data: sanitized });
  } catch (err) {
    console.error("Leaderboard error:", err);
    return res.status(500).json({ error: "Server error fetching leaderboard." });
  }
});

// 5. Admin Overview API (Strictly for authorised admin emails)
app.get("/api/admin/overview", async (req, res) => {
  try {
    const email = (req.headers["x-user-email"] || req.query.email || "").toString().trim().toLowerCase();
    if (!isAdminEmail(email)) {
      return res.status(403).json({ error: "Access denied. Only authorized admins (hr@oppam.me, mubashira@oppam.me) can view organiser details." });
    }

    const query = `
      SELECT u.id as participant_id, u.name as participant_name, u.email as participant_email,
             (COUNT(c.challenge_id) * 10) as total_points,
             p.id as prize_id, p.amount as prize_amount, p.claim_code as prize_code, p.paid as prize_paid, p.claimed_at as prize_claimed_at
      FROM users u
      LEFT JOIN completions c ON u.email = c.user_email
      LEFT JOIN prizes p ON u.email = p.user_email
      GROUP BY u.id, u.name, u.email, p.id, p.amount, p.claim_code, p.paid, p.claimed_at
      ORDER BY total_points DESC, u.name ASC
    `;
    const users = await dbQueryAll(query);
    for (let u of users) {
      u.total_points = parseInt(u.total_points || 0, 10);
      u.uploads = await dbQueryAll("SELECT * FROM uploads WHERE user_email = ? ORDER BY challenge_id ASC", [u.participant_email]);
    }
    return res.json({ success: true, data: users });
  } catch (err) {
    console.error("Admin overview error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Fallback route to serve SPA index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "site", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
