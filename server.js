const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const Database = require("better-sqlite3");

// Ensure data and uploads directories exist
const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Initialize Database
const db = new Database(path.join(dataDir, "game.db"));

// Set up DB Schema
db.exec(`
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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static web app and uploaded proof files
app.use(express.static(path.join(__dirname, "site")));
app.use("/uploads", express.static(uploadsDir));

// Multer storage for uploaded proof files
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
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB max file size
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

const ADMIN_EMAILS = ["midhu@gmail.com"];
function isAdminEmail(email) {
  return ADMIN_EMAILS.includes((email || "").toString().trim().toLowerCase());
}

// 1. Auth Login / Register
app.post("/api/auth/login", (req, res) => {
  try {
    let { email, name } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: "Email and Name are required." });
    }

    email = email.trim().toLowerCase();
    name = name.trim();

    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    // Check if user exists
    let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (!user) {
      // Create new user (unique email)
      const info = db.prepare("INSERT INTO users (email, name) VALUES (?, ?)").run(email, name);
      user = { id: info.lastInsertRowid, email, name };
    } else {
      // If user exists, update name if changed
      if (user.name !== name) {
        db.prepare("UPDATE users SET name = ? WHERE email = ?").run(name, email);
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
app.get("/api/user/me", (req, res) => {
  try {
    const email = (req.headers["x-user-email"] || req.query.email || "").toString().trim().toLowerCase();
    if (!email) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const completionsRows = db.prepare("SELECT challenge_id FROM completions WHERE user_email = ?").all(email);
    const completedTaskIds = completionsRows.map(c => c.challenge_id);

    const uploads = db.prepare("SELECT * FROM uploads WHERE user_email = ? ORDER BY created_at ASC").all(email);
    const prize = db.prepare("SELECT * FROM prizes WHERE user_email = ?").get(email);

    return res.json({
      user: { id: user.id, email: user.email, name: user.name, isAdmin: isAdminEmail(user.email) },
      completions: completedTaskIds,
      uploads,
      prize: prize || null
    });
  } catch (err) {
    console.error("Get user error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// 3. Complete Task / Upload Proof
app.post("/api/challenges/:id/complete", upload.single("proof"), (req, res) => {
  try {
    const challengeId = parseInt(req.params.id, 10);
    const email = (req.body.email || req.headers["x-user-email"] || "").toString().trim().toLowerCase();

    if (!email) {
      return res.status(401).json({ error: "Please log in first to complete a task." });
    }

    if (isNaN(challengeId) || challengeId < 1 || challengeId > 7) {
      return res.status(400).json({ error: "Invalid challenge ID." });
    }

    // Check if user exists
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
      return res.status(404).json({ error: "User not found. Please log in again." });
    }

    // CRITICAL: Check if user has already completed this challenge!
    const existingCompletion = db.prepare(
      "SELECT * FROM completions WHERE user_email = ? AND challenge_id = ?"
    ).get(email, challengeId);

    if (existingCompletion) {
      return res.status(400).json({
        error: "Task already completed! Each email ID can only complete each task once."
      });
    }

    // Record completion in database
    db.prepare("INSERT INTO completions (user_email, challenge_id) VALUES (?, ?)").run(email, challengeId);

    // Save uploaded file if present
    if (req.file) {
      const filePath = "/uploads/" + req.file.filename;
      db.prepare(`
        INSERT INTO uploads (user_email, challenge_id, file_name, file_path, mime_type, size_bytes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(email, challengeId, req.file.originalname, filePath, req.file.mimetype, req.file.size);
    }

    // Check total completed tasks for this user
    const totalCompletions = db.prepare(
      "SELECT COUNT(*) as count FROM completions WHERE user_email = ?"
    ).get(email).count;

    // Check if 7 tasks are completed and generate Prize if not existing
    let prize = db.prepare("SELECT * FROM prizes WHERE user_email = ?").get(email);
    if (totalCompletions >= 7 && !prize) {
      const amount = getRandomPrize();
      const code = generateClaimCode();
      db.prepare("INSERT INTO prizes (user_email, amount, claim_code) VALUES (?, ?, ?)").run(email, amount, code);
      prize = db.prepare("SELECT * FROM prizes WHERE user_email = ?").get(email);
    }

    const completionsRows = db.prepare("SELECT challenge_id FROM completions WHERE user_email = ?").all(email);
    const completedTaskIds = completionsRows.map(c => c.challenge_id);
    const uploads = db.prepare("SELECT * FROM uploads WHERE user_email = ? ORDER BY created_at ASC").all(email);

    return res.json({
      success: true,
      message: "Task completed successfully!",
      completions: completedTaskIds,
      uploads,
      prize: prize || null
    });
  } catch (err) {
    console.error("Complete task error:", err);
    if (err.message && err.message.includes("UNIQUE constraint failed")) {
      return res.status(400).json({
        error: "Task already completed! Each email ID can only complete each task once."
      });
    }
    return res.status(500).json({ error: "Server error while saving task completion." });
  }
});

// 4. Leaderboard API
app.get("/api/leaderboard", (req, res) => {
  try {
    const query = `
      SELECT u.name as player_name, u.email as player_email, COUNT(c.challenge_id) * 10 as player_points
      FROM users u
      LEFT JOIN completions c ON u.email = c.user_email
      GROUP BY u.email
      ORDER BY player_points DESC, u.created_at ASC
      LIMIT 50
    `;
    const data = db.prepare(query).all();
    return res.json({ success: true, data });
  } catch (err) {
    console.error("Leaderboard error:", err);
    return res.status(500).json({ error: "Server error fetching leaderboard." });
  }
});

// 5. Admin Overview API (Strictly protected for midhu@gmail.com)
app.get("/api/admin/overview", (req, res) => {
  try {
    const email = (req.headers["x-user-email"] || req.query.email || "").toString().trim().toLowerCase();
    if (!isAdminEmail(email)) {
      return res.status(403).json({ error: "Access denied. Only admin (midhu@gmail.com) can view organiser details." });
    }

    const query = `
      SELECT u.id as participant_id, u.name as participant_name, u.email as participant_email,
             (COUNT(c.challenge_id) * 10) as total_points,
             p.id as prize_id, p.amount as prize_amount, p.claim_code as prize_code, p.paid as prize_paid, p.claimed_at as prize_claimed_at
      FROM users u
      LEFT JOIN completions c ON u.email = c.user_email
      LEFT JOIN prizes p ON u.email = p.user_email
      GROUP BY u.email
      ORDER BY total_points DESC, u.name ASC
    `;
    const users = db.prepare(query).all();
    users.forEach(u => {
      u.uploads = db.prepare("SELECT * FROM uploads WHERE user_email = ? ORDER BY challenge_id ASC").all(u.participant_email);
    });
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
