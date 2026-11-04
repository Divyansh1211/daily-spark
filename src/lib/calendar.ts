import "server-only";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import ICAL from "ical.js";
import { db } from "./db";

export type CalendarEvent = {
  id: string;
  owner: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  /** Copied from a linked Google/Apple calendar, so it can't be deleted here. */
  linked: boolean;
};

export type Feed = { id: string; name: string; syncedAt: number | null; error: string | null };

const DAY = 24 * 60 * 60 * 1000;
export const MAX_FEEDS = 5;
// A linked calendar is refreshed when someone opens the calendar and it's older than this.
const STALE_AFTER = 10 * 60 * 1000;
// Repeating events are copied for this window around now.
const KEEP_BEFORE = 90 * DAY;
const KEEP_AFTER = 400 * DAY;
const MAX_EVENTS_PER_FEED = 5000;
const MAX_FEED_BYTES = 10 * 1024 * 1024;
// Times without a usable time zone (rare: floating times, Windows zone names) are read as Indian time.
const FALLBACK_ZONE = "Asia/Kolkata";

/** Everyone's events overlapping [from, to). All-day events are matched a day wider, since their stored UTC day can sit either side of local midnight. */
export function listEvents(from: number, to: number): CalendarEvent[] {
  const rows = db()
    .prepare(
      `SELECT id, owner, title, starts_at, ends_at, all_day, feed_id FROM events
       WHERE starts_at < ? AND ends_at > ? ORDER BY all_day DESC, starts_at`,
    )
    .all(to + DAY, from - DAY) as {
    id: string;
    owner: string;
    title: string;
    starts_at: number;
    ends_at: number;
    all_day: number;
    feed_id: string | null;
  }[];
  return rows
    .filter((r) => r.all_day || (r.starts_at < to && r.ends_at > from))
    .map((r) => ({
      id: r.id,
      owner: r.owner,
      title: r.title,
      start: r.starts_at,
      end: r.ends_at,
      allDay: r.all_day === 1,
      linked: r.feed_id !== null,
    }));
}

export function addEvent(owner: string, e: { title: string; start: number; end: number; allDay: boolean }) {
  const id = randomUUID();
  db().prepare(
    "INSERT INTO events (id, owner, title, starts_at, ends_at, all_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, owner, e.title, e.start, e.end, e.allDay ? 1 : 0, Date.now());
  return id;
}

export function getEvent(id: string) {
  const row = db().prepare("SELECT title, ends_at, feed_id FROM events WHERE id = ?").get(id) as
    | { title: string; ends_at: number; feed_id: string | null }
    | undefined;
  return row ? { title: row.title, end: row.ends_at, linked: row.feed_id !== null } : null;
}

/** Only events added in the app; linked ones come back on the next sync anyway. Returns whether it was deleted. */
export function deleteEvent(owner: string, id: string) {
  return db().prepare("DELETE FROM events WHERE id = ? AND owner = ? AND feed_id IS NULL").run(id, owner).changes > 0;
}

export function listFeeds(owner: string): Feed[] {
  const rows = db()
    .prepare("SELECT id, name, synced_at, error FROM calendar_feeds WHERE owner = ? ORDER BY created_at")
    .all(owner) as { id: string; name: string; synced_at: number | null; error: string | null }[];
  return rows.map((r) => ({ id: r.id, name: r.name, syncedAt: r.synced_at, error: r.error }));
}

export function anyFeedStale(now = Date.now()) {
  return !!db().prepare("SELECT 1 FROM calendar_feeds WHERE synced_at IS NULL OR synced_at < ?").get(now - STALE_AFTER);
}

/** Google's and Apple's share links, normalised; null if it isn't a link we can fetch. */
export function normaliseFeedUrl(input: string) {
  const text = String(input ?? "").trim().replace(/^webcals?:\/\//i, "https://");
  if (text.length > 2000) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export type AddFeedResult = { ok: true } | { ok: false; error: string };

export async function addFeed(owner: string, url: string): Promise<AddFeedResult> {
  const count = db().prepare("SELECT COUNT(*) AS n FROM calendar_feeds WHERE owner = ?").get(owner) as { n: number };
  if (count.n >= MAX_FEEDS) return { ok: false, error: `You can link up to ${MAX_FEEDS} calendars.` };
  if (db().prepare("SELECT 1 FROM calendar_feeds WHERE owner = ? AND url = ?").get(owner, url)) {
    return { ok: false, error: "That calendar is already linked." };
  }

  let parsed: { name: string | null; events: ParsedEvent[] };
  try {
    parsed = parseFeed(await download(url), Date.now());
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  const id = randomUUID();
  const host = new URL(url).hostname;
  const name =
    parsed.name?.slice(0, 60) ||
    (host.endsWith("google.com") ? "Google Calendar" : host.endsWith("icloud.com") ? "iCloud Calendar" : host);
  db().prepare("INSERT INTO calendar_feeds (id, owner, url, name, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    owner,
    url,
    name,
    Date.now(),
  );
  replaceFeedEvents(id, owner, parsed.events);
  return { ok: true };
}

export function removeFeed(owner: string, id: string) {
  // Its events go with it (ON DELETE CASCADE).
  db().prepare("DELETE FROM calendar_feeds WHERE id = ? AND owner = ?").run(id, owner);
}

// Feeds being synced right now, so two phones opening the calendar don't fetch the same one twice.
const syncing = globalThis as unknown as { __calendarSyncing?: Set<string> };

/** Refreshes every linked calendar (both people's) that hasn't been fetched recently. */
export async function syncStaleFeeds(now = Date.now()) {
  const busy = (syncing.__calendarSyncing ??= new Set());
  const feeds = db()
    .prepare("SELECT id, owner, url FROM calendar_feeds WHERE synced_at IS NULL OR synced_at < ?")
    .all(now - STALE_AFTER) as { id: string; owner: string; url: string }[];

  await Promise.all(
    feeds
      .filter((f) => !busy.has(f.id))
      .map(async (feed) => {
        busy.add(feed.id);
        try {
          const { events } = parseFeed(await download(feed.url), now);
          // The feed may have been removed while it downloaded.
          if (!db().prepare("SELECT 1 FROM calendar_feeds WHERE id = ?").get(feed.id)) return;
          replaceFeedEvents(feed.id, feed.owner, events);
        } catch (error) {
          // Keep the last good copy and say why it's out of date.
          db().prepare("UPDATE calendar_feeds SET synced_at = ?, error = ? WHERE id = ?").run(now, describe(error), feed.id);
        } finally {
          busy.delete(feed.id);
        }
      }),
  );
}

function replaceFeedEvents(feedId: string, owner: string, events: ParsedEvent[]) {
  const now = Date.now();
  const insert = db().prepare(
    "INSERT INTO events (id, owner, feed_id, title, starts_at, ends_at, all_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  db().exec("BEGIN");
  try {
    db().prepare("DELETE FROM events WHERE feed_id = ?").run(feedId);
    for (const e of events) insert.run(randomUUID(), owner, feedId, e.title, e.start, e.end, e.allDay ? 1 : 0, now);
    db().prepare("UPDATE calendar_feeds SET synced_at = ?, error = NULL WHERE id = ?").run(now, feedId);
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}

class FeedError extends Error {}

function describe(error: unknown) {
  if (error instanceof FeedError) return error.message;
  console.error("Calendar sync failed", error);
  return "Couldn't read that calendar. Check the link and try again.";
}

// ---- Downloading ----

// The link comes from a person, so never let it point the server at itself or its network.
const privateRanges = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 3],
] as const) {
  privateRanges.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  privateRanges.addSubnet(net, prefix, "ipv6");
}

async function assertPublic(url: URL) {
  if (url.protocol !== "https:") throw new FeedError("Use the https:// link to the calendar.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new FeedError("Couldn't find that website. Check the link.");
  for (const a of addresses) {
    // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as the IPv4 address inside it.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a.address)?.[1];
    const blocked = mapped
      ? privateRanges.check(mapped, "ipv4")
      : privateRanges.check(a.address, a.family === 6 ? "ipv6" : "ipv4");
    if (blocked) throw new FeedError("That link isn't a public calendar.");
  }
}

async function download(link: string) {
  let url = new URL(link);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { Accept: "text/calendar, */*;q=0.5", "User-Agent": "Space calendar" },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new FeedError("Couldn't reach that calendar. Try again in a bit.");
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (res.status === 404 || res.status === 403 || res.status === 401) {
      throw new FeedError("That link doesn't open a calendar. It may have been reset; copy it again.");
    }
    if (!res.ok || !res.body) throw new FeedError(`The calendar server said ${res.status}. Try again later.`);

    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      size += r.value.byteLength;
      if (size > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new FeedError("That calendar is too big to show.");
      }
      chunks.push(r.value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text.includes("BEGIN:VCALENDAR")) {
      throw new FeedError("That link opens a web page, not a calendar. Use the iCal (.ics) link.");
    }
    return text;
  }
  throw new FeedError("That link redirects too many times.");
}

// ---- Parsing ----

type ParsedEvent = { title: string; start: number; end: number; allDay: boolean };

const offsetFormats = new Map<string, Intl.DateTimeFormat>();

function zoneOffset(ms: number, zone: string) {
  let format = offsetFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    offsetFormats.set(zone, format);
  }
  const p = Object.fromEntries(format.formatToParts(ms).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** A wall-clock time in an IANA zone, as ms since the epoch. */
function wallClockToMs(t: ICAL.Time, zone: string) {
  const guess = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const first = guess - zoneOffset(guess, zone);
  const second = guess - zoneOffset(first, zone);
  return second;
}

function isZone(name: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** `tzid` is the TZID written on the event, for zones the feed names but doesn't define. */
function toMs(t: ICAL.Time, tzid: string | undefined) {
  const zone = t.zone?.tzid;
  if (zone === "UTC") return t.toUnixTime() * 1000;
  // Prefer the real zone rules over the feed's own (often trimmed) definition.
  const name = zone && zone !== "floating" ? zone : tzid;
  if (name && isZone(name)) return wallClockToMs(t, name);
  if (t.zone?.component) return t.toUnixTime() * 1000;
  return wallClockToMs(t, FALLBACK_ZONE);
}

function toEvent(item: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null): ParsedEvent {
  const title = (item.summary?.trim() || "Busy").slice(0, 120);
  if (start.isDate) {
    const s = Date.UTC(start.year, start.month - 1, start.day);
    const e = end?.isDate ? Date.UTC(end.year, end.month - 1, end.day) : s + DAY;
    return { title, start: s, end: Math.max(e, s + DAY), allDay: true };
  }
  const tzid = (prop: string) => {
    const value = item.component.getFirstProperty(prop)?.getParameter("tzid");
    return typeof value === "string" ? value : undefined;
  };
  const s = toMs(start, tzid("dtstart"));
  const e = end ? toMs(end, tzid("dtend") ?? tzid("dtstart")) : s;
  return { title, start: s, end: Math.max(e, s), allDay: false };
}

function parseFeed(text: string, now: number) {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new FeedError("That calendar file couldn't be read.");
  }
  const from = now - KEEP_BEFORE;
  const to = now + KEEP_AFTER;
  const events: ParsedEvent[] = [];
  const keep = (e: ParsedEvent) => {
    if (e.start < to && e.end > from && events.length < MAX_EVENTS_PER_FEED) events.push(e);
  };

  // Moved or edited single occurrences of a repeating event.
  const all = root.getAllSubcomponents("vevent").map((v) => new ICAL.Event(v));
  const masters = new Map<string, ICAL.Event>();
  for (const e of all) if (!e.isRecurrenceException()) masters.set(e.uid, e);
  for (const e of all) if (e.isRecurrenceException()) masters.get(e.uid)?.relateException(e);

  const cancelled = (e: ICAL.Event) => String(e.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";

  for (const e of all) {
    if (!e.startDate) continue;
    if (e.isRecurrenceException()) {
      // Shown through its master, unless the master isn't in the feed.
      if (!masters.has(e.uid) && !cancelled(e)) keep(toEvent(e, e.startDate, e.endDate));
      continue;
    }
    if (cancelled(e)) continue;
    if (!e.isRecurring()) {
      keep(toEvent(e, e.startDate, e.endDate));
      continue;
    }
    const it = e.iterator();
    for (let i = 0; i < 20000; i++) {
      const next = it.next();
      if (!next) break;
      const o = e.getOccurrenceDetails(next);
      if (cancelled(o.item)) continue;
      const occurrence = toEvent(o.item, o.startDate, o.endDate);
      if (occurrence.start >= to) break;
      keep(occurrence);
    }
  }
  const name = root.getFirstPropertyValue("x-wr-calname");
  return { name: typeof name === "string" ? name.trim() : null, events };
}
