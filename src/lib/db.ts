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
  `);
  return db;
}

// One connection per process, shared across hot reloads. Opened on first use, not on import,
// so build workers that only load a route's code don't race to create the tables.
const g = globalThis as unknown as { __haanjiDb?: DatabaseSync };
export function db() {
  return (g.__haanjiDb ??= open());
}
