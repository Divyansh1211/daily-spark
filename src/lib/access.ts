import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// Photos are private: a browser gets access once someone types ACCESS_CODE on it.
const COOKIE = "haanji_access";
// Random id for this browser; keeps each person's expenses separate.
const OWNER_COOKIE = "haanji_me";
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

const failures = globalThis as unknown as { __accessFailures?: number[] };

function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Cookie value for the current code, so changing ACCESS_CODE signs every browser out. */
function token() {
  const code = process.env.ACCESS_CODE;
  if (!code) return null;
  return createHmac("sha256", code.toLowerCase()).update("haanji-photos-v1").digest("hex");
}

export async function hasAccess() {
  const expected = token();
  const value = (await cookies()).get(COOKIE)?.value;
  return !!expected && !!value && equal(value, expected);
}

/** Checks the code and, if it matches, remembers this browser. */
export async function grantAccess(code: string) {
  const expected = token();
  if (!expected) return { ok: false as const, error: "Photos aren't set up on the server yet." };

  // Slow down guessing: after too many wrong codes, refuse for a while.
  const now = Date.now();
  const recent = (failures.__accessFailures ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
  failures.__accessFailures = recent;
  if (recent.length >= MAX_FAILURES) {
    return { ok: false as const, error: "Too many tries. Wait a few minutes and try again." };
  }

  const attempt = createHmac("sha256", code.trim().toLowerCase()).update("haanji-photos-v1").digest("hex");
  if (!equal(attempt, expected)) {
    recent.push(now);
    return { ok: false as const, error: "That code isn't right." };
  }

  (await cookies()).set(COOKIE, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 400 * 24 * 60 * 60,
    path: "/",
  });
  return { ok: true as const };
}

/** This browser's private owner id, created on first use. Call from a server action. */
export async function ownerId() {
  const jar = await cookies();
  const existing = jar.get(OWNER_COOKIE)?.value;
  if (existing && /^[0-9a-f]{32}$/.test(existing)) return existing;
  const id = randomBytes(16).toString("hex");
  jar.set(OWNER_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 400 * 24 * 60 * 60,
    path: "/",
  });
  return id;
}
