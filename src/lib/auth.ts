import "server-only";
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";

export type User = { id: string; name: string };

const SESSION_COOKIE = "haanji_session";
// Cookies from before accounts: the photos code, and a random id that owned this phone's expenses.
const LEGACY_ACCESS_COOKIE = "haanji_access";
const LEGACY_OWNER_COOKIE = "haanji_me";

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  // The longest browsers allow; the session itself never expires until logout.
  maxAge: 400 * 24 * 60 * 60,
  path: "/",
};

type Result = { ok: true } | { ok: false; error: string };

function equal(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** Stored as scrypt$salt$hash. scripts/admin.mjs writes the same format. */
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await derive(password, salt)).toString("hex")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  return equal(await derive(password, Buffer.from(salt, "hex")), Buffer.from(hash, "hex"));
}

// A real hash to check against when the name doesn't exist, so both cases take as long.
const dummyHash = hashPassword(randomBytes(16).toString("hex"));

// Slow down guessing: after too many failures for a key, refuse for a while.
const failures = globalThis as unknown as { __authFailures?: Map<string, number[]> };

function tooManyFailures(key: string) {
  const map = (failures.__authFailures ??= new Map<string, number[]>());
  const now = Date.now();
  const recent = (map.get(key) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
  map.set(key, recent);
  return recent.length >= MAX_FAILURES;
}

function recordFailure(key: string) {
  failures.__authFailures?.get(key)?.push(Date.now());
}

/** The invite code is ACCESS_CODE, the code that used to unlock photos. */
function inviteCodeMatches(code: string) {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return false;
  // HMAC both so the comparison is constant-time whatever their lengths.
  const mac = (v: string) => createHmac("sha256", "haanji-invite").update(v.trim().toLowerCase()).digest();
  return equal(mac(code), mac(expected));
}

function cleanName(name: string) {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

/** The logged-in person, or null. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db()
    .prepare("SELECT users.id, users.name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?")
    .get(sha256(token)) as User | undefined;
  return row ? { id: row.id, name: row.name } : null;
}

export async function register(input: { name: string; password: string; code: string }): Promise<Result> {
  if (tooManyFailures("register")) return { ok: false, error: "Too many tries. Wait a few minutes and try again." };
  if (!process.env.ACCESS_CODE) return { ok: false, error: "Sign-up isn't set up on the server yet." };
  if (!inviteCodeMatches(String(input.code ?? ""))) {
    recordFailure("register");
    return { ok: false, error: "That invite code isn't right." };
  }

  const name = cleanName(input.name);
  const password = String(input.password ?? "");
  if (name.length < 1 || name.length > 30) return { ok: false, error: "Pick a name up to 30 letters long." };
  if (password.length < 6) return { ok: false, error: "Use a password of at least 6 characters." };
  if (password.length > 200) return { ok: false, error: "That password is too long." };
  if (db().prepare("SELECT 1 FROM users WHERE name = ?").get(name)) {
    return { ok: false, error: "That name is taken. Log in instead." };
  }

  const id = randomBytes(16).toString("hex");
  db().prepare("INSERT INTO users (id, name, password, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    name,
    await hashPassword(password),
    Date.now(),
  );
  await startSession(id);
  return { ok: true };
}

export async function login(input: { name: string; password: string }): Promise<Result> {
  const name = cleanName(input.name);
  const key = `login:${name.toLowerCase()}`;
  if (tooManyFailures(key)) return { ok: false, error: "Too many tries. Wait a few minutes and try again." };

  const user = db().prepare("SELECT id, password FROM users WHERE name = ?").get(name) as
    | { id: string; password: string }
    | undefined;
  const ok = await verifyPassword(String(input.password ?? ""), user?.password ?? (await dummyHash));
  if (!user || !ok) {
    recordFailure(key);
    return { ok: false, error: "That name and password don't match." };
  }
  await startSession(user.id);
  return { ok: true };
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) db().prepare("DELETE FROM sessions WHERE token = ?").run(sha256(token));
  jar.delete(SESSION_COOKIE);
}

async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  db().prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(sha256(token), userId, Date.now());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions);
  claimLegacyExpenses(jar.get(LEGACY_OWNER_COOKIE)?.value, userId);
  jar.delete(LEGACY_OWNER_COOKIE);
  jar.delete(LEGACY_ACCESS_COOKIE);
}

/** Moves expenses made on this phone before accounts existed to the person logging in. */
function claimLegacyExpenses(owner: string | undefined, userId: string) {
  if (!owner || !/^[0-9a-f]{32}$/.test(owner) || owner === userId) return;
  // Only an id that isn't an account, so one person's data can never move to another.
  if (db().prepare("SELECT 1 FROM users WHERE id = ?").get(owner)) return;
  db().exec("BEGIN");
  try {
    db().prepare("UPDATE expenses SET owner = ? WHERE owner = ?").run(userId, owner);
    db().prepare(
      "INSERT INTO budgets (owner, amount) SELECT ?, amount FROM budgets WHERE owner = ? ON CONFLICT (owner) DO NOTHING",
    ).run(userId, owner);
    db().prepare("DELETE FROM budgets WHERE owner = ?").run(owner);
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}
