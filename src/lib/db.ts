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
  const db = new DatabaseSync(FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
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

// One connection per process, shared across hot reloads.
const g = globalThis as unknown as { __haanjiDb?: DatabaseSync };
export const db = (g.__haanjiDb ??= open());
