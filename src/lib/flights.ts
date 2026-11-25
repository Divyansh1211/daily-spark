import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";

// Flight status from AirLabs (https://airlabs.co/docs/flight), which takes a flight number and
// returns the nearest live, scheduled or landed flight with it. Needs AIRLABS_API_KEY; the free
// plan allows about 1,000 calls a month, so flights are checked on a schedule (see `checkEvery`)
// rather than whenever someone opens the app.
// Overridable so it can be pointed at a stand-in when testing.
const API = process.env.AIRLABS_API_URL ?? "https://airlabs.co/api/v9";
const MAX_FLIGHTS = 4;

export type Phase = "scheduled" | "airborne" | "landed";

/** What AirLabs said about a flight. Anything can be missing, depending on the flight and the plan. */
export type FlightInfo = {
  status?: string; // scheduled, en-route, landed, …
  dep?: string; // airport IATA codes
  arr?: string;
  depLocal?: string; // "2026-11-25 18:50", at the airport
  arrLocal?: string;
  depEstLocal?: string;
  arrEstLocal?: string;
  depAt?: number; // ms
  arrAt?: number;
  depEstAt?: number;
  arrEstAt?: number;
  depDelay?: number; // minutes
  arrDelay?: number;
  depTerminal?: string;
  depGate?: string;
  arrTerminal?: string;
  arrGate?: string;
  baggage?: string;
  lat?: number;
  lng?: number;
  alt?: number; // metres
  speed?: number; // km/h
  dir?: number; // degrees
  seenAt?: number; // ms, the last signal from the plane
  aircraft?: string;
};

export type Airport = { code: string; name: string | null; city: string | null; lat: number | null; lng: number | null; tz: string | null };

export type Flight = {
  id: string;
  /** For showing, e.g. "EY 211". */
  code: string;
  phase: Phase;
  info: FlightInfo | null;
  from: Airport | null;
  to: Airport | null;
  /** When it leaves and lands (ms), the latest estimate if there is one. */
  departs: number | null;
  arrives: number | null;
  /** 0–1 of the way there, while it's in the air and we can tell. */
  progress: number | null;
  error: string | null;
  checkedAt: number | null;
  addedBy: string | null;
};

export class FlightError extends Error {}

/** "ey 211" → { code: "EY211", param: "flight_iata" }, or null when it doesn't look like a flight number. */
export function parseFlightCode(input: string) {
  const code = String(input ?? "").toUpperCase().replace(/[\s-]/g, "");
  if (/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(code)) return { code, param: "flight_iata" as const };
  if (/^[A-Z]{3}\d{1,4}[A-Z]?$/.test(code)) return { code, param: "flight_icao" as const };
  return null;
}

function display(code: string) {
  return code.replace(/^([A-Z0-9]{2}|[A-Z]{3})(?=\d)/, "$1 ");
}

export function trackingEnabled() {
  return Boolean(process.env.AIRLABS_API_KEY);
}

async function call(path: string, params: Record<string, string>): Promise<unknown> {
  const key = process.env.AIRLABS_API_KEY;
  if (!key) throw new FlightError("Flight tracking isn't set up on the server yet.");
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", key);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  } catch {
    throw new FlightError("Couldn't reach the flight service.");
  }
  const json = (await res.json().catch(() => null)) as { error?: { message?: string }; response?: unknown } | null;
  if (json?.error) throw new FlightError(String(json.error.message ?? "The flight service said no.").slice(0, 160));
  if (!res.ok || !json) throw new FlightError(`The flight service answered ${res.status}.`);
  return json.response;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const ms = (v: unknown) => (num(v) !== undefined ? num(v)! * 1000 : undefined);

/** The fields we use from an AirLabs flight, leaving out anything it didn't send. */
function toInfo(r: Record<string, unknown>): FlightInfo {
  const info: FlightInfo = {
    status: str(r.status),
    dep: str(r.dep_iata),
    arr: str(r.arr_iata),
    depLocal: str(r.dep_time),
    arrLocal: str(r.arr_time),
    depEstLocal: str(r.dep_actual) ?? str(r.dep_estimated),
    arrEstLocal: str(r.arr_actual) ?? str(r.arr_estimated),
    depAt: ms(r.dep_time_ts),
    arrAt: ms(r.arr_time_ts),
    depEstAt: ms(r.dep_actual_ts) ?? ms(r.dep_estimated_ts),
    arrEstAt: ms(r.arr_actual_ts) ?? ms(r.arr_estimated_ts),
    depDelay: num(r.dep_delayed),
    arrDelay: num(r.arr_delayed),
    depTerminal: str(r.dep_terminal),
    depGate: str(r.dep_gate),
    arrTerminal: str(r.arr_terminal),
    arrGate: str(r.arr_gate),
    baggage: str(r.arr_baggage),
    lat: num(r.lat),
    lng: num(r.lng),
    alt: num(r.alt),
    speed: num(r.speed),
    dir: num(r.dir),
    seenAt: ms(r.updated),
    aircraft: str(r.model) ?? str(r.aircraft_icao),
  };
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined)) as FlightInfo;
}

/** Asks AirLabs about a flight number. */
async function lookup(code: string): Promise<FlightInfo> {
  const parsed = parseFlightCode(code);
  if (!parsed) throw new FlightError("That doesn't look like a flight number.");
  const response = await call("flight", { [parsed.param]: parsed.code });
  if (!response || typeof response !== "object" || Array.isArray(response) || Object.keys(response).length === 0) {
    throw new FlightError(`Couldn't find ${display(parsed.code)}. Check the number, or try again closer to the day.`);
  }
  return toInfo(response as Record<string, unknown>);
}

/** An airport's name, place and time zone, fetched once and kept. */
async function airport(code: string | undefined): Promise<void> {
  if (!code || !/^[A-Z]{3}$/.test(code)) return;
  const known = db().prepare("SELECT fetched_at FROM airports WHERE iata = ?").get(code) as { fetched_at: number } | undefined;
  if (known && Date.now() - known.fetched_at < 30 * 86_400_000) return;
  let row: Record<string, unknown> = {};
  try {
    const response = await call("airports", { iata_code: code });
    if (Array.isArray(response) && response[0] && typeof response[0] === "object") row = response[0] as Record<string, unknown>;
  } catch (error) {
    // Not worth failing the flight over; it's shown with just the code. Tried again next time.
    console.error("[flights] airport", code, error instanceof Error ? error.message : error);
    return;
  }
  const tz = str(row.timezone);
  db().prepare(
    `INSERT INTO airports (iata, name, city, lat, lng, tz, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (iata) DO UPDATE SET name = excluded.name, city = excluded.city, lat = excluded.lat, lng = excluded.lng,
       tz = excluded.tz, fetched_at = excluded.fetched_at`,
  ).run(code, str(row.name) ?? null, str(row.city) ?? null, num(row.lat) ?? null, num(row.lng) ?? null, tz && isZone(tz) ? tz : null, Date.now());
}

function isZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function getAirport(code: string | undefined): Airport | null {
  if (!code) return null;
  const r = db().prepare("SELECT name, city, lat, lng, tz FROM airports WHERE iata = ?").get(code) as
    | { name: string | null; city: string | null; lat: number | null; lng: number | null; tz: string | null }
    | undefined;
  return { code, name: r?.name ?? null, city: r?.city ?? null, lat: r?.lat ?? null, lng: r?.lng ?? null, tz: r?.tz ?? null };
}

/** "2026-11-25 18:50" at an airport in `tz` → ms. */
export function zonedTime(local: string | undefined, tz: string | null | undefined): number | undefined {
  const m = local?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m || !tz) return undefined;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // The zone's offset at that moment, found by reading the guess back as wall time there.
  const offset = (at: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
        .formatToParts(at)
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - at;
  };
  const first = wall - offset(wall);
  return wall - offset(first);
}

/** When it leaves and lands, best estimate first, from timestamps or the airports' local times. */
function times(info: FlightInfo, from: Airport | null, to: Airport | null) {
  return {
    departs: info.depEstAt ?? zonedTime(info.depEstLocal, from?.tz) ?? info.depAt ?? zonedTime(info.depLocal, from?.tz) ?? null,
    arrives: info.arrEstAt ?? zonedTime(info.arrEstLocal, to?.tz) ?? info.arrAt ?? zonedTime(info.arrLocal, to?.tz) ?? null,
  };
}

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** How far along it is, from where the plane is, or failing that from the clock. */
function progressOf(phase: Phase, info: FlightInfo, from: Airport | null, to: Airport | null, departs: number | null, arrives: number | null, now: number) {
  if (phase === "landed") return 1;
  if (phase !== "airborne") return null;
  if (info.lat !== undefined && info.lng !== undefined && from?.lat != null && from.lng != null && to?.lat != null && to.lng != null) {
    const here = { lat: info.lat, lng: info.lng };
    const done = distance({ lat: from.lat, lng: from.lng }, here);
    const left = distance(here, { lat: to.lat, lng: to.lng });
    if (done + left > 0) return Math.min(1, Math.max(0, done / (done + left)));
  }
  if (departs && arrives && arrives > departs) return Math.min(1, Math.max(0, (now - departs) / (arrives - departs)));
  return null;
}

/**
 * Where a flight is now, from what AirLabs said and where it was before. AirLabs always answers with
 * the nearest flight with that number, so once one lands it can move on to tomorrow's: anything that
 * was in the air and isn't any more has landed.
 */
export function phaseFrom(info: FlightInfo, prev: Phase, addedAt: number, arrives: number | null, now: number): Phase {
  const s = info.status;
  // Yesterday's landed flight doesn't count as today's having landed.
  if (s === "landed" && (prev === "airborne" || (arrives !== null && arrives > addedAt))) return "landed";
  const live = info.lat !== undefined && info.lng !== undefined && (info.seenAt === undefined || now - info.seenAt < 30 * 60_000);
  if (s === "en-route" || (!s && live)) return "airborne";
  if (prev === "airborne") {
    // Without a status, a plane out of range over the sea looks the same as one that's landed.
    if (!s && arrives !== null && now < arrives - 30 * 60_000) return "airborne";
    return "landed";
  }
  return "scheduled";
}

type Row = {
  id: string;
  code: string;
  phase: Phase;
  info: string | null;
  error: string | null;
  delay_told: number;
  checked_at: number | null;
  landed_at: number | null;
  created_at: number;
  added_by_name: string | null;
};

const SELECT = `SELECT f.id, f.code, f.phase, f.info, f.error, f.delay_told, f.checked_at, f.landed_at, f.created_at, u.name AS added_by_name
  FROM flights f LEFT JOIN users u ON u.id = f.added_by`;

function parseInfo(json: string | null): FlightInfo | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as FlightInfo;
  } catch {
    return null;
  }
}

function toFlight(r: Row, now: number): Flight {
  const info = parseInfo(r.info);
  const from = getAirport(info?.dep);
  const to = getAirport(info?.arr);
  const { departs, arrives } = info ? times(info, from, to) : { departs: null, arrives: null };
  return {
    id: r.id,
    code: display(r.code),
    phase: r.phase,
    info,
    from,
    to,
    departs,
    arrives,
    progress: info ? progressOf(r.phase, info, from, to, departs, arrives, now) : null,
    error: r.error,
    checkedAt: r.checked_at,
    addedBy: r.added_by_name,
  };
}

/** Flights being watched, soonest first. Landed ones drop off after a day, and anything after four. */
export function listFlights(now = Date.now()) {
  db().prepare("DELETE FROM flights WHERE (landed_at IS NOT NULL AND landed_at < ?) OR created_at < ?").run(now - 86_400_000, now - 4 * 86_400_000);
  const flights = (db().prepare(`${SELECT} ORDER BY f.created_at`).all() as Row[]).map((r) => toFlight(r, now));
  return flights.sort((a, b) => (a.departs ?? Infinity) - (b.departs ?? Infinity));
}

/** Starts watching a flight; checks it straight away so a wrong number is caught now. */
export async function addFlight(input: string, userId: string) {
  const parsed = parseFlightCode(input);
  if (!parsed) throw new FlightError("That doesn't look like a flight number. Try something like EY 211.");
  const count = (db().prepare("SELECT COUNT(*) AS n FROM flights").get() as { n: number }).n;
  if (count >= MAX_FLIGHTS) throw new FlightError(`You can watch up to ${MAX_FLIGHTS} flights at once. Remove one first.`);
  if (db().prepare("SELECT 1 FROM flights WHERE code = ?").get(parsed.code)) throw new FlightError(`${display(parsed.code)} is already on the list.`);

  const info = await lookup(parsed.code);
  await Promise.all([airport(info.dep), airport(info.arr)]);
  const now = Date.now();
  const id = randomUUID();
  const { arrives } = times(info, getAirport(info.dep), getAirport(info.arr));
  const phase = phaseFrom(info, "scheduled", now, arrives, now);
  db().prepare(
    `INSERT INTO flights (id, code, added_by, phase, info, delay_told, checked_at, landed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, parsed.code, userId, phase, JSON.stringify(info), info.depDelay ?? 0, now, phase === "landed" ? now : null, now);
  return id;
}

export function removeFlight(id: string) {
  db().prepare("DELETE FROM flights WHERE id = ?").run(id);
}

/** How long to wait between checks, or null to stop: often while it's flying or about to, rarely before. */
function checkEvery(f: Flight, now: number) {
  if (f.phase === "landed") return null;
  if (f.phase === "airborne") return 5 * 60_000;
  if (f.departs !== null && f.departs - now > 3 * 3_600_000) return 60 * 60_000;
  // Close to leaving, or we can't tell when it leaves.
  return f.departs === null ? 15 * 60_000 : 5 * 60_000;
}

export type FlightChange =
  | { kind: "took-off" | "landed"; flight: Flight }
  | { kind: "delayed"; flight: Flight; minutes: number };

let checking = false;

/** Checks every flight that's due a check, and says which ones took off, landed or got delayed. */
export async function checkFlights(now = Date.now()): Promise<FlightChange[]> {
  if (checking || !trackingEnabled()) return [];
  checking = true;
  try {
    const rows = db().prepare(`${SELECT}`).all() as Row[];
    const changes: FlightChange[] = [];
    for (const row of rows) {
      const before = toFlight(row, now);
      const every = checkEvery(before, now);
      if (every === null || (row.checked_at !== null && now - row.checked_at < every)) continue;

      let info: FlightInfo;
      try {
        info = await lookup(row.code);
        await Promise.all([airport(info.dep), airport(info.arr)]);
      } catch (error) {
        const message = error instanceof FlightError ? error.message : "Couldn't check it.";
        db().prepare("UPDATE flights SET error = ?, checked_at = ? WHERE id = ?").run(message, now, row.id);
        continue;
      }
      // Once AirLabs has moved on to the next flight with this number, keep the last one we saw.
      const next = phaseFrom(info, row.phase, row.created_at, times(info, getAirport(info.dep), getAirport(info.arr)).arrives, now);
      const keep = next === "landed" && row.phase === "airborne" && info.status !== "landed" ? parseInfo(row.info) ?? info : info;
      const after = toFlight({ ...row, phase: next, info: JSON.stringify(keep) }, now);
      const delay = keep.depDelay ?? 0;
      let told = row.delay_told;
      if (row.phase === "scheduled" && next === "airborne") changes.push({ kind: "took-off", flight: after });
      else if (row.phase !== "landed" && next === "landed") changes.push({ kind: "landed", flight: after });
      // Only worth a notification when it's late by another quarter of an hour or more.
      else if (next === "scheduled" && delay >= 15 && delay - told >= 15) {
        changes.push({ kind: "delayed", flight: after, minutes: delay });
        told = delay;
      }
      db().prepare(
        "UPDATE flights SET phase = ?, info = ?, error = NULL, checked_at = ?, landed_at = COALESCE(landed_at, ?), delay_told = ? WHERE id = ?",
      ).run(next, JSON.stringify(keep), now, next === "landed" ? now : null, told, row.id);
    }
    return changes;
  } finally {
    checking = false;
  }
}
