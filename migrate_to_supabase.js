const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.argv[2] || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Usage: node migrate_to_supabase.js <YOUR_SUPABASE_DATABASE_URL>");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    const backupFile = path.join(__dirname, 'live_backup_data.json');
    if (!fs.existsSync(backupFile)) {
      console.error("live_backup_data.json not found!");
      process.exit(1);
    }

    const raw = fs.readFileSync(backupFile, 'utf8');
    const backup = JSON.parse(raw);
    const users = backup.data || [];

    console.log(`Found ${users.length} users in live backup.`);

    // 1. Ensure Tables Exist
    await pool.query(`
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

    let importedUsers = 0;
    let importedUploads = 0;

    for (const u of users) {
      const email = (u.participant_email || "").trim().toLowerCase();
      const name = (u.participant_name || "").trim();
      if (!email || !name) continue;

      // Insert User
      await pool.query(
        `INSERT INTO users (email, name) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`,
        [email, name]
      );
      importedUsers++;

      // Insert Prize if claimed
      if (u.prize_amount && u.prize_code) {
        await pool.query(
          `INSERT INTO prizes (user_email, amount, claim_code, paid) VALUES ($1, $2, $3, $4) ON CONFLICT (user_email) DO NOTHING`,
          [email, u.prize_amount, u.prize_code, u.prize_paid ? 1 : 0]
        );
      }

      // Insert Uploads & Completions
      if (u.uploads && u.uploads.length > 0) {
        for (const file of u.uploads) {
          // Completion
          await pool.query(
            `INSERT INTO completions (user_email, challenge_id, completed_at) VALUES ($1, $2, $3) ON CONFLICT (user_email, challenge_id) DO NOTHING`,
            [email, file.challenge_id, file.created_at || new Date()]
          );

          // Upload
          await pool.query(
            `INSERT INTO uploads (user_email, challenge_id, file_name, file_path, mime_type, size_bytes, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [email, file.challenge_id, file.file_name, file.file_path, file.mime_type, file.size_bytes, file.created_at || new Date()]
          );
          importedUploads++;
        }
      } else if (u.total_points > 0) {
        // Mark Day 1 completion if points exist
        await pool.query(
          `INSERT INTO completions (user_email, challenge_id) VALUES ($1, 1) ON CONFLICT (user_email, challenge_id) DO NOTHING`,
          [email]
        );
      }
    }

    console.log(`✅ SUCCESS: Imported ${importedUsers} users and ${importedUploads} uploads directly into Supabase Postgres!`);
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await pool.end();
  }
}

migrate();
