#!/usr/bin/env node
// Account admin for Haanji. Run on the server from the app folder:
//
//   node --env-file=.env.production.local scripts/admin.mjs users
//   node --env-file=.env.production.local scripts/admin.mjs reset-password <name>
//   node --env-file=.env.production.local scripts/admin.mjs orphans
//   node --env-file=.env.production.local scripts/admin.mjs move-expenses <old-owner-id> <name>
//
// `orphans` lists expenses whose phone lost its cookie before the person made an account;
// `move-expenses` gives them to that person.
import { randomBytes, scrypt } from "node:crypto";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";

// Same location as src/lib/db.ts.
const FILE =
  process.env.DB_FILE ??
  (process.env.DATA_FILE ? join(dirname(process.env.DATA_FILE), "haanji.db") : join(process.cwd(), ".data", "haanji.db"));

const db = new DatabaseSync(FILE);
db.exec("PRAGMA foreign_keys = ON");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function userByName(name) {
  const user = db.prepare("SELECT id, name FROM users WHERE name = ?").get(String(name ?? "").trim());
  if (!user) fail(`No account called "${name}". Run \`users\` to see them.`);
  return user;
}

/** Reads a line without echoing it. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

// Same format as src/lib/auth.ts.
function hashPassword(password) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`),
    ),
  );
}

const [command, ...args] = process.argv.slice(2);
console.log(`Database: ${FILE}`);

// The app creates the account tables when it first touches them.
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) {
  fail("No accounts yet. Create one in the app first.");
}

switch (command) {
  case "users": {
    const rows = db
      .prepare(
        `SELECT users.name, users.id, users.created_at,
           (SELECT COUNT(*) FROM expenses WHERE owner = users.id) AS expenses,
           (SELECT COUNT(*) FROM sessions WHERE user_id = users.id) AS sessions
         FROM users ORDER BY created_at`,
      )
      .all();
    if (rows.length === 0) console.log("No accounts yet.");
    for (const r of rows) {
      console.log(
        `${r.name}  id=${r.id}  joined=${new Date(r.created_at).toISOString().slice(0, 10)}  expenses=${r.expenses}  logged-in-phones=${r.sessions}`,
      );
    }
    break;
  }

  case "reset-password": {
    const user = userByName(args[0]);
    const password = await askHidden(`New password for ${user.name}: `);
    if (password.length < 6) fail("Use at least 6 characters.");
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(await hashPassword(password), user.id);
    // Log every phone out so only the new password works.
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    console.log(`Password changed for ${user.name}. They're logged out everywhere; log in with the new one.`);
    break;
  }

  case "orphans": {
    const rows = db
      .prepare(
        `SELECT owner, COUNT(*) AS n, SUM(amount) AS total, MIN(spent_on) AS first, MAX(spent_on) AS last
         FROM expenses WHERE owner NOT IN (SELECT id FROM users) GROUP BY owner ORDER BY last DESC`,
      )
      .all();
    if (rows.length === 0) console.log("No expenses without an account.");
    for (const r of rows) {
      console.log(`${r.owner}  ${r.n} expenses  ₹${(r.total / 100).toLocaleString("en-IN")}  ${r.first} → ${r.last}`);
    }
    break;
  }

  case "move-expenses": {
    const [owner, name] = args;
    if (!/^[0-9a-f]{32}$/.test(owner ?? "")) fail("Give the old owner id from `orphans`.");
    if (db.prepare("SELECT 1 FROM users WHERE id = ?").get(owner)) fail("That id is an account, not an orphan.");
    const user = userByName(name);
    db.exec("BEGIN");
    const moved = db.prepare("UPDATE expenses SET owner = ? WHERE owner = ?").run(user.id, owner).changes;
    db.prepare(
      "INSERT INTO budgets (owner, amount) SELECT ?, amount FROM budgets WHERE owner = ? ON CONFLICT (owner) DO NOTHING",
    ).run(user.id, owner);
    db.prepare("DELETE FROM budgets WHERE owner = ?").run(owner);
    db.exec("COMMIT");
    console.log(`Moved ${moved} expenses to ${user.name}.`);
    break;
  }

  default:
    fail("Commands: users | reset-password <name> | orphans | move-expenses <old-owner-id> <name>");
}
