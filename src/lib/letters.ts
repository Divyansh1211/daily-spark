import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";

export type Letter = {
  id: string;
  title: string;
  /** Null while it's still locked, so it can't be read early. */
  body: string | null;
  opensAt: number | null;
  openedAt: number | null;
  fromName: string | null;
  toId: string;
  toName: string;
  createdAt: number;
};

type Row = {
  id: string;
  title: string;
  body: string;
  opens_at: number | null;
  opened_at: number | null;
  from_name: string | null;
  to_user: string;
  to_name: string;
  created_at: number;
};

const SELECT = `SELECT l.id, l.title, l.body, l.opens_at, l.opened_at, f.name AS from_name, l.to_user, t.name AS to_name, l.created_at`;
const JOINS = `JOIN users t ON t.id = l.to_user LEFT JOIN users f ON f.id = l.from_user`;

function toLetter(r: Row, now: number, sealed: boolean): Letter {
  const locked = sealed && r.opens_at !== null && r.opens_at > now;
  return {
    id: r.id,
    title: r.title,
    body: locked ? null : r.body,
    opensAt: r.opens_at,
    openedAt: r.opened_at,
    fromName: r.from_name,
    toId: r.to_user,
    toName: r.to_name,
    createdAt: r.created_at,
  };
}

/**
 * Letters `userId` was sent (locked ones without their words) and letters they wrote, newest first,
 * with the ones they've archived kept apart. Archiving only tidies away your own copy.
 */
export function listLetters(userId: string, now = Date.now()) {
  const received = db()
    .prepare(`${SELECT}, l.to_archived AS archived FROM letters l ${JOINS} WHERE l.to_user = ? ORDER BY l.created_at DESC`)
    .all(userId) as (Row & { archived: number })[];
  const sent = db()
    .prepare(`${SELECT}, l.from_archived AS archived FROM letters l ${JOINS} WHERE l.from_user = ? ORDER BY l.created_at DESC`)
    .all(userId) as (Row & { archived: number })[];
  const toReceived = (r: Row) => toLetter(r, now, true);
  // The writer can always reread their own.
  const toSent = (r: Row) => toLetter(r, now, false);
  return {
    received: received.filter((r) => !r.archived).map(toReceived),
    sent: sent.filter((r) => !r.archived).map(toSent),
    archived: {
      received: received.filter((r) => r.archived).map(toReceived),
      sent: sent.filter((r) => r.archived).map(toSent),
    },
  };
}

export function addLetter(from: string, to: string, title: string, body: string, opensAt: number | null) {
  const id = randomUUID();
  const now = Date.now();
  // One that can be opened now is announced when it's written; a timed one when it unlocks.
  const announced = opensAt === null || opensAt <= now ? 1 : 0;
  db().prepare(
    `INSERT INTO letters (id, to_user, from_user, title, body, opens_at, announced, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, to, from, title, body, opensAt, announced, now);
  return id;
}

/**
 * Rewrites a letter `userId` wrote. Returns who it's to, and whether to tell them it can be
 * opened now (it was sealed and isn't any more); null when it isn't theirs.
 */
export function updateLetter(id: string, userId: string, title: string, body: string, opensAt: number | null, now = Date.now()) {
  const row = db().prepare("SELECT to_user, announced FROM letters WHERE id = ? AND from_user = ?").get(id, userId) as
    | { to_user: string; announced: number }
    | undefined;
  if (!row) return null;
  const locked = opensAt !== null && opensAt > now;
  // A letter sealed again is announced when it unlocks.
  db().prepare("UPDATE letters SET title = ?, body = ?, opens_at = ?, announced = ? WHERE id = ?").run(
    title,
    body,
    locked ? opensAt : null,
    locked ? 0 : 1,
    id,
  );
  return { to: row.to_user, announce: !locked && row.announced === 0 };
}

/**
 * Marks a letter to `userId` as opened. Returns who wrote it the first time it's opened
 * (so they can be told), and null otherwise, including when it's still locked.
 */
export function markOpened(id: string, userId: string, now = Date.now()) {
  const row = db()
    .prepare("SELECT from_user, title, opens_at, opened_at FROM letters WHERE id = ? AND to_user = ?")
    .get(id, userId) as { from_user: string | null; title: string; opens_at: number | null; opened_at: number | null } | undefined;
  if (!row || row.opened_at !== null || (row.opens_at !== null && row.opens_at > now)) return null;
  db().prepare("UPDATE letters SET opened_at = ? WHERE id = ?").run(now, id);
  return row.from_user ? { from: row.from_user, title: row.title } : null;
}

/**
 * Puts a letter away (or brings it back) for `userId` only: the other person's copy stays where it is.
 * A letter you were sent can only be archived once you've opened it, so none goes unread.
 */
export function archiveLetter(id: string, userId: string, archived: boolean) {
  const flag = archived ? 1 : 0;
  db().prepare("UPDATE letters SET from_archived = ? WHERE id = ? AND from_user = ?").run(flag, id, userId);
  db().prepare("UPDATE letters SET to_archived = ? WHERE id = ? AND to_user = ? AND (? = 0 OR opened_at IS NOT NULL)").run(flag, id, userId, flag);
}

/** Timed letters that have just unlocked, marked as announced so each is only announced once. */
export function takeUnlockedLetters(now = Date.now()) {
  const rows = db()
    .prepare(
      `SELECT l.id, l.to_user, l.title, f.name AS from_name FROM letters l LEFT JOIN users f ON f.id = l.from_user
       WHERE l.announced = 0 AND l.opens_at <= ?`,
    )
    .all(now) as { id: string; to_user: string; title: string; from_name: string | null }[];
  const mark = db().prepare("UPDATE letters SET announced = 1 WHERE id = ?");
  for (const r of rows) mark.run(r.id);
  return rows;
}
