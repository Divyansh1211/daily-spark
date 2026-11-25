"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Airport, Flight } from "@/lib/flights";
import { loadFlights, removeFlightAction, trackFlightAction } from "./flight-actions";
import { TrashIcon } from "./icons";

type State = { status: "loading" } | { status: "ready"; flights: Flight[]; enabled: boolean };

/** Flights being watched, on the Today tab. Hidden until the server has a flight data key. */
export function Flights() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const result = await loadFlights();
      if (result.status === "ready") setState(result);
      setNow(Date.now());
    } catch {
      // Keeps what's showing; the next refresh tries again.
    }
  }, []);

  useEffect(() => {
    // Deferred so the first load doesn't set state synchronously inside the effect.
    const first = setTimeout(refresh, 0);
    const onShow = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onShow);
    // The server checks the flights every few minutes; this picks up what it found.
    const poll = setInterval(() => document.visibilityState === "visible" && refresh(), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [refresh]);

  if (state.status !== "ready" || !state.enabled) return null;

  return (
    <div className="animate-rise space-y-3">
      {state.flights.map((flight) => (
        <FlightCard key={flight.id} flight={flight} now={now} onChange={refresh} />
      ))}
      <Track onChange={refresh} />
    </div>
  );
}

function Track({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setCode("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const result = await trackFlightAction(code);
      if (!result.ok) return setError(result.error);
      close();
      onChange();
    } catch {
      setError("Couldn't add it. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-card py-3.5 text-sm font-medium text-accent transition-all active:scale-[0.98]"
      >
        ✈️ Track a flight
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="animate-rise space-y-3 rounded-3xl border border-line bg-card p-5">
      <input
        autoFocus
        required
        maxLength={10}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Flight number, e.g. EY 211"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        aria-label="Flight number"
        className={input}
      />
      <p className="px-1 text-xs text-muted">
        You&apos;ll both get a notification when it takes off and lands, and if it&apos;s delayed.
      </p>
      {error && <p className="animate-rise text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={close} className={`${secondaryButton} flex-1`}>
          Cancel
        </button>
        <button disabled={saving || !code.trim()} className={`${primaryButton} flex-[2]`}>
          {saving ? "Finding it…" : "Track it"}
        </button>
      </div>
    </form>
  );
}

function FlightCard({ flight, now, onChange }: { flight: Flight; now: number; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const info = flight.info ?? {};
  const delay = info.depDelay ?? 0;
  const airborne = flight.phase === "airborne";

  async function remove() {
    if (!confirming) return setConfirming(true);
    await removeFlightAction(flight.id);
    onChange();
  }

  const pill =
    flight.phase === "landed"
      ? { text: "Landed", tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" }
      : airborne
        ? { text: "In the air", tone: "bg-accent-soft text-accent" }
        : info.status && !["scheduled", "en-route", "landed"].includes(info.status)
          ? { text: capitalise(info.status), tone: "bg-red-500/15 text-red-500" }
          : delay >= 15
            ? { text: `Delayed ${delay} min`, tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400" }
            : { text: "Scheduled", tone: "bg-background text-muted" };

  const details: string[] = [];
  if (airborne) {
    if (flight.arrives) details.push(flight.arrives > now ? `Lands in ${until(flight.arrives, now)}` : "Landing any minute");
    // In the units pilots use.
    if (info.alt) details.push(`${Math.round((info.alt * 3.28084) / 100) * 100} ft`.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
    if (info.speed) details.push(`${Math.round(info.speed / 1.852)} kt`);
  } else if (flight.phase === "landed") {
    if (info.baggage) details.push(`Bags on belt ${info.baggage}`);
  } else if (flight.departs) {
    details.push(flight.departs > now ? `Leaves in ${until(flight.departs, now)}` : "Should be leaving now");
  }

  return (
    <section
      className={`overflow-hidden rounded-3xl border p-5 transition-colors ${
        airborne ? "border-accent/40 bg-accent-soft" : "border-line bg-card"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
          Flight {flight.code}
          {info.aircraft && <span className="normal-case tracking-normal"> · {info.aircraft}</span>}
        </p>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${pill.tone}`}>
          {airborne && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
          {pill.text}
        </span>
      </div>

      <div className="mt-4 flex items-start justify-between gap-3">
        <End airport={flight.from} at={flight.departs} local={info.depEstLocal ?? info.depLocal} now={now} />
        <End airport={flight.to} at={flight.arrives} local={info.arrEstLocal ?? info.arrLocal} now={now} right />
      </div>

      <Route progress={flight.progress} phase={flight.phase} />

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        {gateLine("Leaves", info.depTerminal, info.depGate) && flight.phase === "scheduled" && (
          <span>{gateLine("Leaves", info.depTerminal, info.depGate)}</span>
        )}
        {gateLine("Arrives", info.arrTerminal, info.arrGate) && flight.phase !== "scheduled" && (
          <span>{gateLine("Arrives", info.arrTerminal, info.arrGate)}</span>
        )}
      </div>
      {details.length > 0 && <p className="mt-1 text-sm font-medium">{details.join(" · ")}</p>}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className={`min-w-0 truncate text-xs ${flight.error ? "text-red-500" : "text-muted"}`}>
          {flight.error ??
            (flight.checkedAt
              ? `Checked ${ago(flight.checkedAt, now)}${flight.addedBy ? ` · added by ${flight.addedBy}` : ""}`
              : "")}
        </p>
        <button
          onClick={remove}
          onBlur={() => setConfirming(false)}
          aria-label={`Stop tracking ${flight.code}`}
          className={`shrink-0 rounded-full p-2 text-sm transition-colors ${
            confirming ? "bg-red-500 px-3 font-medium text-white" : "text-muted"
          }`}
        >
          {confirming ? "Remove?" : <TrashIcon />}
        </button>
      </div>
    </section>
  );
}

/** One end of the trip: the airport, and the time there and on this phone. */
function End({ airport, at, local, now, right = false }: { airport: Airport | null; at: number | null; local?: string; now: number; right?: boolean }) {
  const here = at ? clock(at, now) : null;
  // The time at the airport, when it's different from this phone's.
  const there = at && airport?.tz ? airportClock(at, airport.tz) : (local?.slice(11, 16) ?? null);
  return (
    <div className={`min-w-0 ${right ? "text-right" : ""}`}>
      <p className="font-serif text-3xl leading-none">{airport?.code ?? "—"}</p>
      <p className="mt-1 truncate text-xs text-muted">{airport?.city ?? airport?.name ?? ""}</p>
      {here && <p className="mt-2 text-sm font-semibold">{here}</p>}
      {there && there !== here && (
        <p className="text-[11px] text-muted">
          {there} {here ? "local" : `${airport?.code ?? ""} time`}
        </p>
      )}
    </div>
  );
}

function Route({ progress, phase }: { progress: number | null; phase: Flight["phase"] }) {
  const p = progress ?? (phase === "landed" ? 1 : 0);
  return (
    <div className="relative mt-4 h-6" aria-hidden>
      <div className="absolute top-1/2 right-2 left-2 h-px -translate-y-1/2 border-t border-dashed border-muted/50" />
      <div className="absolute top-1/2 left-2 h-0.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: `calc((100% - 1rem) * ${p})` }} />
      <span className="absolute top-1/2 left-0 size-2 -translate-y-1/2 rounded-full bg-accent" />
      <span className={`absolute top-1/2 right-0 size-2 -translate-y-1/2 rounded-full ${phase === "landed" ? "bg-accent" : "bg-muted/50"}`} />
      <span
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-accent transition-[left] duration-700"
        style={{ left: `calc(0.5rem + (100% - 1rem) * ${p})` }}
      >
        <PlaneIcon className="size-6 rounded-full bg-card p-0.5" />
      </span>
    </div>
  );
}

const PlaneIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M21 14.5v-1.7l-8-4.9V3.2a1.5 1.5 0 0 0-3 0v4.7l-8 4.9v1.7l8-2.4v4.5l-2 1.5v1.3l3.5-1 3.5 1v-1.3l-2-1.5v-4.5z" transform="rotate(90 12 12)" />
  </svg>
);

function gateLine(what: string, terminal?: string, gate?: string) {
  const parts = [terminal && `Terminal ${terminal}`, gate && `Gate ${gate}`].filter(Boolean);
  return parts.length ? `${what}: ${parts.join(", ")}` : null;
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "6:40 PM" today, otherwise "Wed 6:40 PM"; in `timeZone` when given, else this phone's. */
function clock(ms: number, now: number, timeZone?: string) {
  const time = new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
  const day = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone });
  if (day(ms) === day(now)) return time;
  return `${new Date(ms).toLocaleDateString(undefined, { weekday: "short", timeZone })} ${time}`;
}

/** "3:40 AM" at the airport, with the day when it's a different date there than on this phone. */
function airportClock(ms: number, timeZone: string) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
  if (d.toLocaleDateString("en-CA", { timeZone }) === d.toLocaleDateString("en-CA")) return time;
  return `${d.toLocaleDateString(undefined, { weekday: "short", timeZone })} ${time}`;
}

/** "45 min", "2h 5m" or "3d 4h" from `now` until `ms`. */
function until(ms: number, now: number) {
  const minutes = Math.max(1, Math.ceil((ms - now) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function ago(ms: number, now: number) {
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

const input =
  "w-full rounded-xl border border-line bg-background px-4 py-3 text-base tracking-wide text-foreground uppercase outline-none transition-shadow placeholder:normal-case placeholder:tracking-normal placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15";
const primaryButton =
  "rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-on-accent transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60";
const secondaryButton =
  "rounded-xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent transition-all duration-200 active:scale-[0.98]";
