const https = require('https');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const LIVE_URL = 'https://oppam-me.onrender.com';
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // Run every 1 Hour

const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const siteUploads = path.join(__dirname, 'site', 'uploads');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(siteUploads)) fs.mkdirSync(siteUploads, { recursive: true });

// Initialize local SQLite backup DB
const sqliteDb = new Database(path.join(dataDir, 'game.db'));
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

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(true); });
    }).on('error', () => {
      fs.unlink(destPath, () => {});
      resolve(false);
    });
  });
}

async function performHourlyBackup() {
  const timestamp = new Date().toLocaleString('en-IN');
  console.log(`[${timestamp}] 🔄 Starting hourly automated backup...`);

  try {
    const overview = await fetchJson(`${LIVE_URL}/api/admin/overview`, { 'X-User-Email': 'midhu@gmail.com' });
    if (!overview || !overview.data) {
      console.log(`[${timestamp}] ⚠️ Could not fetch live overview, retrying next hour.`);
      return;
    }

    const users = overview.data;
    fs.writeFileSync(path.join(dataDir, 'latest_hourly_backup.json'), JSON.stringify(users, null, 2));

    for (const u of users) {
      const email = u.participant_email.trim().toLowerCase();
      const name = u.participant_name.trim();

      // Update Local SQLite User
      sqliteDb.prepare(`INSERT INTO users (email, name) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name`).run(email, name);

      // Update Prize
      if (u.prize_amount && u.prize_code) {
        sqliteDb.prepare(`INSERT INTO prizes (user_email, amount, claim_code, paid) VALUES (?, ?, ?, ?) ON CONFLICT(user_email) DO NOTHING`).run(email, u.prize_amount, u.prize_code, u.prize_paid ? 1 : 0);
      }

      // Download Proof Files & Save Completions
      if (u.uploads && u.uploads.length > 0) {
        for (const file of u.uploads) {
          sqliteDb.prepare(`INSERT INTO completions (user_email, challenge_id, completed_at) VALUES (?, ?, ?) ON CONFLICT(user_email, challenge_id) DO NOTHING`).run(email, file.challenge_id, file.created_at || new Date().toISOString());
          sqliteDb.prepare(`INSERT INTO uploads (user_email, challenge_id, file_name, file_path, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(email, file.challenge_id, file.file_name, file.file_path, file.mime_type, file.size_bytes, file.created_at || new Date().toISOString());

          const filename = path.basename(file.file_path);
          const fileUrl = LIVE_URL + file.file_path;
          const target1 = path.join(uploadsDir, filename);
          const target2 = path.join(siteUploads, filename);

          if (!fs.existsSync(target1)) {
            await downloadFile(fileUrl, target1);
            await downloadFile(fileUrl, target2);
            console.log(`  📥 Downloaded new proof file: ${filename}`);
          }
        }
      }
    }

    console.log(`[${timestamp}] ✅ HOURLY BACKUP COMPLETE: Synced ${users.length} users and all proof media files into local DB!`);
  } catch (err) {
    console.error(`[${timestamp}] ❌ Hourly backup error:`, err.message);
  }
}

// Run immediately on start, then every 1 hour
performHourlyBackup();
setInterval(performHourlyBackup, BACKUP_INTERVAL_MS);
