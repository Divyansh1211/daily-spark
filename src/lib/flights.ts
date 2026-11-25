import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";

// Flight status from FlightAware AeroAPI (FLIGHTAWARE_API_KEY), or AirLabs (AIRLABS_API_KEY) when
// that's all there is. Both charge per call past a small free allowance, so flights are checked on
// a schedule (see `checkEvery`) rather than whenever someone opens the app.
//
// FlightAware gives each flight its own id, which is kept once found, so a flight is followed
// from gate to gate. AirLabs only takes a flight number and answers with the nearest flight with
// it, so its "landed" has to be worked out (see `phaseFrom`).
// The URLs are overridable so they can be pointed at a stand-in when testing.
const FLIGHTAWARE = process.env.FLIGHTAWARE_API_URL ?? "https://aeroapi.flightaware.com/aeroapi";
const AIRLABS = process.env.AIRLABS_API_URL ?? "https://airlabs.co/api/v9";
const MAX_FLIGHTS = 4;

export type Phase = "scheduled" | "airborne" | "landed";

/** What the flight service said about a flight. Anything can be missing, depending on the flight and the plan. */
export type FlightInfo = {
  status?: string; // scheduled, en-route, landed, cancelled
  /** Set when this is known to be the very flight being followed, not just one with its number. */
  pinned?: boolean;
  progress?: number; // 0–100, from the service
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
  return Boolean(process.env.FLIGHTAWARE_API_KEY || process.env.AIRLABS_API_KEY);
}

/** Looks a flight up; `ref` is the service's own id for it, once known. */
async function lookup(code: string, ref: string | null): Promise<{ info: FlightInfo; ref: string | null }> {
  if (process.env.FLIGHTAWARE_API_KEY) return flightAware(code, ref);
  if (process.env.AIRLABS_API_KEY) return { info: await airLabs(code), ref: null };
  throw new FlightError("Flight tracking isn't set up on the server yet.");
}

async function getJson(url: URL, headers: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  } catch {
    throw new FlightError("Couldn't reach the flight service.");
  }
  return { res, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

// --- FlightAware AeroAPI (https://www.flightaware.com/aeroapi/portal/documentation) ---

async function faCall(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${FLIGHTAWARE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const { res, json } = await getJson(url, { "x-apikey": process.env.FLIGHTAWARE_API_KEY! });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok || !json) {
    const detail = str(json?.detail) ?? str(json?.title);
    throw new FlightError((detail ? `The flight service said: ${detail}` : `The flight service answered ${res.status}.`).slice(0, 160));
  }
  return json;
}

type FaFlight = Record<string, unknown> & { fa_flight_id?: string };

const at = (v: unknown) => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

/** Of the flights with a number (about two weeks of them), the one to follow: in the air, else the next to leave. */
function pick(flights: FaFlight[], now: number) {
  const leaves = (f: FaFlight) => at(f.scheduled_out) ?? at(f.scheduled_off) ?? 0;
  const flying = flights.find((f) => f.actual_off && !f.actual_on && !f.cancelled);
  if (flying) return flying;
  const upcoming = flights
    .filter((f) => !f.actual_on && !f.cancelled && leaves(f) > now - 6 * 3_600_000)
    .sort((a, b) => leaves(a) - leaves(b));
  // Otherwise the latest one, which is first, as they come newest first.
  return upcoming[0] ?? flights[0];
}

function saveAirport(a: unknown) {
  if (!a || typeof a !== "object") return undefined;
  const r = a as Record<string, unknown>;
  const code = str(r.code_iata) ?? str(r.code);
  if (!code) return undefined;
  const tz = str(r.timezone);
  db().prepare(
    `INSERT INTO airports (iata, name, city, tz, fetched_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (iata) DO UPDATE SET name = excluded.name, city = excluded.city, tz = COALESCE(excluded.tz, tz), fetched_at = excluded.fetched_at`,
  ).run(code, str(r.name) ?? null, str(r.city) ?? null, tz && isZone(tz) ? tz : null, Date.now());
  return code;
}

async function flightAware(code: string, ref: string | null): Promise<{ info: FlightInfo; ref: string | null }> {
  const parsed = parseFlightCode(code);
  if (!parsed) throw new FlightError("That doesn't look like a flight number.");
  const found = ref
    ? await faCall(`/flights/${encodeURIComponent(ref)}`, { ident_type: "fa_flight_id" })
    : await faCall(`/flights/${encodeURIComponent(parsed.code)}`, { ident_type: "designator" });
  const flights = (Array.isArray(found?.flights) ? found.flights : []) as FaFlight[];
  const f = ref ? flights.find((x) => !x.diverted) ?? flights[0] : pick(flights, Date.now());
  if (!f) throw new FlightError(`Couldn't find ${display(parsed.code)}. Check the number, or try again closer to the day.`);

  const dep = saveAirport(f.origin);
  const arr = saveAirport(f.destination);
  // A diverted flight still takes off and lands, just somewhere else, so it's followed the same way.
  const status = f.actual_on || f.actual_in ? "landed" : f.actual_off ? "en-route" : f.cancelled ? "cancelled" : "scheduled";
  const secondsToMinutes = (v: unknown) => (num(v) !== undefined ? Math.round(num(v)! / 60) : undefined);
  const info: FlightInfo = {
    status,
    pinned: true,
    progress: num(f.progress_percent),
    dep,
    arr,
    depAt: at(f.scheduled_out) ?? at(f.scheduled_off),
    arrAt: at(f.scheduled_in) ?? at(f.scheduled_on),
    depEstAt: at(f.actual_out) ?? at(f.estimated_out) ?? at(f.actual_off) ?? at(f.estimated_off),
    arrEstAt: at(f.actual_in) ?? at(f.estimated_in) ?? at(f.actual_on) ?? at(f.estimated_on),
    depDelay: secondsToMinutes(f.departure_delay),
    arrDelay: secondsToMinutes(f.arrival_delay),
    depTerminal: str(f.terminal_origin),
    depGate: str(f.gate_origin),
    arrTerminal: str(f.terminal_destination),
    arrGate: str(f.gate_destination),
    baggage: str(f.baggage_claim),
    aircraft: str(f.aircraft_type),
  };
  // Where it is, only while it's flying, as it's another call.
  if (status === "en-route" && f.fa_flight_id) {
    try {
      const position = await faCall(`/flights/${encodeURIComponent(f.fa_flight_id)}/position`);
      const p = (position?.last_position ?? null) as Record<string, unknown> | null;
      if (p) {
        info.lat = num(p.latitude);
        info.lng = num(p.longitude);
        // Hundreds of feet and knots, kept as metres and km/h like the rest.
        if (num(p.altitude) !== undefined) info.alt = num(p.altitude)! * 100 * 0.3048;
        if (num(p.groundspeed) !== undefined) info.speed = num(p.groundspeed)! * 1.852;
        info.dir = num(p.heading);
        info.seenAt = at(p.timestamp);
      }
    } catch (error) {
      console.error("[flights] position", error instanceof Error ? error.message : error);
    }
  }
  return { info: clean(info), ref: str(f.fa_flight_id) ?? ref };
}

function clean(info: FlightInfo) {
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined)) as FlightInfo;
}

// --- AirLabs (https://airlabs.co/docs/flight) ---

async function call(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${AIRLABS}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", process.env.AIRLABS_API_KEY!);
  const { res, json } = await getJson(url, {});
  const error = json?.error as { message?: string } | undefined;
  if (error) throw new FlightError(String(error.message ?? "The flight service said no.").slice(0, 160));
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
  return clean(info);
}

/** Asks AirLabs about a flight number. */
async function airLabs(code: string): Promise<FlightInfo> {
  const parsed = parseFlightCode(code);
  if (!parsed) throw new FlightError("That doesn't look like a flight number.");
  const response = await call("flight", { [parsed.param]: parsed.code });
  if (!response || typeof response !== "object" || Array.isArray(response) || Object.keys(response).length === 0) {
    throw new FlightError(`Couldn't find ${display(parsed.code)}. Check the number, or try again closer to the day.`);
  }
  const info = toInfo(response as Record<string, unknown>);
  await Promise.all([airport(info.dep), airport(info.arr)]);
  return info;
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
  if (info.progress !== undefined) return Math.min(1, Math.max(0, info.progress / 100));
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
 * Where a flight is now, from what the service said and where it was before. A FlightAware answer is
 * about the very flight being followed, so it's taken as it is. AirLabs always answers with
 * the nearest flight with that number, so once one lands it can move on to tomorrow's: anything that
 * was in the air and isn't any more has landed.
 */
export function phaseFrom(info: FlightInfo, prev: Phase, addedAt: number, arrives: number | null, now: number): Phase {
  const s = info.status;
  // Yesterday's landed flight doesn't count as today's having landed.
  if (s === "landed" && (info.pinned || prev === "airborne" || (arrives !== null && arrives > addedAt))) return "landed";
  if (info.pinned) return s === "en-route" ? "airborne" : "scheduled";
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
  ref: string | null;
  phase: Phase;
  info: string | null;
  error: string | null;
  delay_told: number;
  checked_at: number | null;
  landed_at: number | null;
  created_at: number;
  added_by_name: string | null;
};

const SELECT = `SELECT f.id, f.code, f.ref, f.phase, f.info, f.error, f.delay_told, f.checked_at, f.landed_at, f.created_at, u.name AS added_by_name
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

  const { info, ref } = await lookup(parsed.code, null);
  const now = Date.now();
  const id = randomUUID();
  const { arrives } = times(info, getAirport(info.dep), getAirport(info.arr));
  const phase = phaseFrom(info, "scheduled", now, arrives, now);
  db().prepare(
    `INSERT INTO flights (id, code, ref, added_by, phase, info, delay_told, checked_at, landed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, parsed.code, ref, userId, phase, JSON.stringify(info), info.depDelay ?? 0, now, phase === "landed" ? now : null, now);
  return id;
}

export function removeFlight(id: string) {
  db().prepare("DELETE FROM flights WHERE id = ?").run(id);
}

/** How long to wait between checks, or null to stop: often while it's flying or about to, rarely before. */
function checkEvery(f: Flight, now: number) {
  if (f.phase === "landed" || f.info?.status === "cancelled") return null;
  if (f.phase === "airborne") return 5 * 60_000;
  if (f.departs !== null && f.departs - now > 3 * 3_600_000) return 60 * 60_000;
  // Close to leaving, or we can't tell when it leaves.
  return f.departs === null ? 15 * 60_000 : 5 * 60_000;
}

export type FlightChange =
  | { kind: "took-off" | "landed" | "cancelled"; flight: Flight }
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
      let ref: string | null;
      try {
        ({ info, ref } = await lookup(row.code, row.ref));
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
      else if (keep.status === "cancelled" && before.info?.status !== "cancelled") changes.push({ kind: "cancelled", flight: after });
      else if (row.phase !== "landed" && next === "landed") changes.push({ kind: "landed", flight: after });
      // Only worth a notification when it's late by another quarter of an hour or more.
      else if (next === "scheduled" && delay >= 15 && delay - told >= 15) {
        changes.push({ kind: "delayed", flight: after, minutes: delay });
        told = delay;
      }
      db().prepare(
        "UPDATE flights SET phase = ?, info = ?, ref = ?, error = NULL, checked_at = ?, landed_at = COALESCE(landed_at, ?), delay_told = ? WHERE id = ?",
      ).run(next, JSON.stringify(keep), ref, now, next === "landed" ? now : null, told, row.id);
    }
    return changes;
  } finally {
    checking = false;
  }
}
