import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export const sqlite = new Database('wedding.db');
sqlite.pragma('foreign_keys = ON');
export const db = drizzle(sqlite, { schema });

export async function initDb() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS households (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      allow_plus_one INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      reminder_email TEXT
    );

    CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES households(id),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      nickname TEXT,
      email TEXT,
      type TEXT NOT NULL DEFAULT 'adult',
      attending INTEGER,
      comments TEXT,
      entree_choice TEXT
    );

    CREATE TABLE IF NOT EXISTS plus_ones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL UNIQUE REFERENCES households(id),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      attending INTEGER NOT NULL DEFAULT 1,
      comments TEXT,
      entree_choice TEXT
    );

    CREATE TABLE IF NOT EXISTS schedule_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      time TEXT NOT NULL,
      end_time TEXT,
      location TEXT NOT NULL,
      description TEXT,
      "order" INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS entree_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      available_for TEXT NOT NULL DEFAULT 'both',
      "order" INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS faqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      image_path TEXT,
      "order" INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rsvp_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES households(id),
      action TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      snapshot TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id ON admin_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
  `);

  //images in faq migration
  const faqColumns = sqlite.prepare('PRAGMA table_info(faqs)').all() as Array<{ name: string }>;
  if (!faqColumns.some((c) => c.name === 'image_path')) {
    sqlite.exec('ALTER TABLE faqs ADD COLUMN image_path TEXT');
  }

  // purge sessions that have expired
  sqlite.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now());

  const householdCount = sqlite.prepare('SELECT COUNT(*) as count FROM households').get() as { count: number };
  if (householdCount.count === 0) {
    console.log('Database empty, seeding sample data...');
    const { seedDb } = await import('./seed.js');
    await seedDb();
  }

  const { seedAdmin } = await import('./seed.js');
  await seedAdmin();

  console.log('Database initialized');
}

export * from './schema.js';
