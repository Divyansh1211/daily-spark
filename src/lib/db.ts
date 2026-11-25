import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// SQLite file next to the other data (or in .data locally). Node's built-in driver,
// so there's no database server or native dependency.
const FILE =
  process.env.DB_FILE ??
  (process.env.DATA_FILE
    ? join(dirname(process.env.DATA_FILE), "haanji.db")
    : join(process.cwd(), ".data", "haanji.db"));

function open() {
  mkdirSync(dirname(FILE), { recursive: true });
  // Wait for another process (the backup, the admin script) instead of failing straight away.
  const db = new DatabaseSync(FILE, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL,        -- scrypt$salt$hash, hex
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,        -- sha256 of the cookie value, so a leaked database can't log anyone in
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,           -- users.id
      amount INTEGER NOT NULL,       -- paise
      category TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      spent_on TEXT NOT NULL,        -- YYYY-MM-DD, the owner's local date
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS expenses_owner_date ON expenses (owner, spent_on);
    CREATE TABLE IF NOT EXISTS budgets (
      owner TEXT PRIMARY KEY,
      amount INTEGER NOT NULL        -- paise per month
    );
    CREATE TABLE IF NOT EXISTS calendar_feeds (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      url TEXT NOT NULL,             -- secret iCal link; never sent back to the browser
      name TEXT NOT NULL,
      synced_at INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      feed_id TEXT REFERENCES calendar_feeds (id) ON DELETE CASCADE, -- null when added in the app
      title TEXT NOT NULL,
      starts_at INTEGER NOT NULL,    -- ms; all-day events are UTC midnight of their date
      ends_at INTEGER NOT NULL,      -- ms, exclusive
      all_day INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_starts ON events (starts_at);
    CREATE INDEX IF NOT EXISTS events_feed ON events (feed_id);
    CREATE TABLE IF NOT EXISTS photo_reactions (
      photo_id TEXT NOT NULL,        -- photos live on disk, so no foreign key
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (photo_id, user_id) -- one reaction each, like a tapback
    );
    CREATE TABLE IF NOT EXISTS shelf_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,            -- book, article, movie, show, song
      status TEXT NOT NULL,          -- want (up next), now, done
      owner TEXT REFERENCES users (id) ON DELETE CASCADE, -- who it's for; null when it's for both
      added_by TEXT REFERENCES users (id) ON DELETE SET NULL,
      link TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS letters (
      id TEXT PRIMARY KEY,
      to_user TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      from_user TEXT REFERENCES users (id) ON DELETE SET NULL,
      title TEXT NOT NULL,           -- what the envelope says, e.g. "Open when you land"
      body TEXT NOT NULL,
      opens_at INTEGER,              -- ms; null when it can be opened straight away
      announced INTEGER NOT NULL DEFAULT 0, -- 1 once the recipient was told they can open it
      opened_at INTEGER,
      to_archived INTEGER NOT NULL DEFAULT 0,   -- 1 once the recipient put it away; letters are archived, never deleted
      from_archived INTEGER NOT NULL DEFAULT 0, -- the same, for whoever wrote it
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS flights (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,            -- flight number without spaces, e.g. EY211 (IATA) or ETD211 (ICAO)
      ref TEXT,                      -- the flight service's own id for this one flight, once found
      added_by TEXT REFERENCES users (id) ON DELETE SET NULL,
      phase TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, airborne, landed
      info TEXT,                     -- JSON: what AirLabs last said about it
      error TEXT,                    -- why the last check failed, if it did
      delay_told INTEGER NOT NULL DEFAULT 0, -- departure delay (minutes) people were last told about
      checked_at INTEGER,
      landed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS airports (
      iata TEXT PRIMARY KEY,
      name TEXT,
      city TEXT,
      lat REAL,
      lng REAL,
      tz TEXT,                       -- IANA time zone, e.g. Asia/Dubai
      fetched_at INTEGER NOT NULL
    );
  `);
  // Columns added after their table first shipped.
  const has = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  if (!has("flights", "ref")) db.exec("ALTER TABLE flights ADD COLUMN ref TEXT");
  if (!has("letters", "to_archived")) db.exec("ALTER TABLE letters ADD COLUMN to_archived INTEGER NOT NULL DEFAULT 0");
  if (!has("letters", "from_archived")) db.exec("ALTER TABLE letters ADD COLUMN from_archived INTEGER NOT NULL DEFAULT 0");
  return db;
}

// One connection per process, shared across hot reloads. Opened on first use, not on import,
// so build workers that only load a route's code don't race to create the tables.
const g = globalThis as unknown as { __haanjiDb?: DatabaseSync };
export function db() {
  return (g.__haanjiDb ??= open());
}
