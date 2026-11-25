"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { User } from "@/lib/auth";
import type { Letter } from "@/lib/letters";
import { CheckIcon, LockIcon, TrashIcon } from "./icons";
import { deleteLetterAction, loadLetters, openLetterAction, writeLetterAction } from "./letter-actions";

type State = { status: "loading" } | { status: "ready"; received: Letter[]; sent: Letter[]; others: User[] };

/** Letters for you, and the ones you've written, on the Today tab. Hidden until there's someone to write to. */
export function Letters() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const result = await loadLetters();
      if (result.status === "ready") setState(result);
    } catch {
      // Keeps what's showing; the next refresh tries again.
    }
  }, []);

  useEffect(() => {
    // Deferred so the first load doesn't set state synchronously inside the effect.
    const first = setTimeout(refresh, 0);
    const onShow = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onShow);
    // Keeps the countdowns moving.
    const tick = setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [refresh]);

  // A locked letter's words only come from the server once it unlocks.
  const nextUnlock =
    state.status === "ready"
      ? Math.min(...state.received.filter((l) => l.body === null).map((l) => l.opensAt!))
      : Infinity;
  useEffect(() => {
    if (nextUnlock === Infinity) return;
    // Fetched a moment after it unlocks; capped so long waits stay within what setTimeout allows.
    const wait = setTimeout(refresh, Math.min(Math.max(0, nextUnlock - Date.now()) + 1000, 2 ** 31 - 1));
    return () => clearTimeout(wait);
  }, [nextUnlock, refresh]);

  if (state.status !== "ready" || state.others.length === 0) return null;

  return (
    <div className="animate-rise space-y-3">
      {state.received.map((letter) => (
        <Envelope key={letter.id} letter={letter} now={now} />
      ))}
      <Write others={state.others} sent={state.sent} now={now} onChange={refresh} />
    </div>
  );
}

function Envelope({ letter, now }: { letter: Letter; now: number }) {
  const [open, setOpen] = useState(false);
  const locked = letter.body === null;
  const unread = !locked && letter.openedAt === null && !open;

  function toggle() {
    if (locked) return;
    if (!open && letter.openedAt === null) openLetterAction(letter.id).catch(() => {});
    setOpen(!open);
  }

  return (
    <section
      className={`overflow-hidden rounded-3xl border transition-colors ${
        unread ? "border-accent/40 bg-accent-soft" : "border-line bg-card"
      }`}
    >
      <button
        onClick={toggle}
        disabled={locked}
        aria-expanded={open}
        className="flex w-full items-center gap-4 p-5 text-left disabled:cursor-default"
      >
        <span
          className={`flex size-12 shrink-0 items-center justify-center rounded-2xl text-2xl ${
            locked ? "bg-background text-muted" : "bg-card"
          } ${unread ? "animate-pulse" : ""}`}
        >
          {locked ? <LockIcon className="text-xl" /> : open ? "💌" : "✉️"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
            {letter.fromName ? `A letter from ${letter.fromName}` : "A letter"}
          </span>
          <span className="mt-0.5 block font-serif text-xl leading-snug">{letter.title}</span>
          <span className={`mt-1 block text-xs ${unread ? "font-medium text-accent" : "text-muted"}`}>
            {locked
              ? `Opens ${at(letter.opensAt!, now)} · in ${until(letter.opensAt!, now)}`
              : open
                ? "Tap to fold it away"
                : unread
                  ? "Tap to open"
                  : "Opened · tap to read again"}
          </span>
        </span>
      </button>
      {open && letter.body !== null && (
        <div className="animate-rise border-t border-line px-6 pt-5 pb-6">
          <p className="whitespace-pre-wrap font-serif text-lg leading-8">{letter.body}</p>
          {letter.fromName && <p className="mt-4 text-right font-serif text-lg italic text-muted">— {letter.fromName}</p>}
        </div>
      )}
    </section>
  );
}

function Write({ others, sent, now, onChange }: { others: User[]; sent: Letter[]; now: number; onChange: () => void }) {
  const [writing, setWriting] = useState(false);
  const [to, setTo] = useState(others[0].id);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [timed, setTimed] = useState(false);
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = others.find((p) => p.id === to)?.name ?? others[0].name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      // datetime-local is in this phone's local time; turn it into an absolute time here.
      const opensAt = timed && when ? new Date(when).getTime() : null;
      const result = await writeLetterAction({ to, title, body, opensAt });
      if (!result.ok) return setError(result.error);
      setWriting(false);
      setTitle("");
      setBody("");
      setTimed(false);
      setWhen("");
      onChange();
    } catch {
      setError("Couldn't send it. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {writing ? (
        <form onSubmit={submit} className="animate-rise space-y-3 rounded-3xl border border-line bg-card p-5">
          {others.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {others.map((p) => (
                <Chip key={p.id} on={to === p.id} onClick={() => setTo(p.id)}>
                  {p.name}
                </Chip>
              ))}
            </div>
          )}
          <input
            autoFocus
            required
            maxLength={60}
            placeholder="On the envelope, e.g. Open when you land"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="On the envelope"
            className={input}
          />
          <textarea
            required
            maxLength={4000}
            rows={7}
            placeholder={`Dear ${name},`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Letter"
            className={`${input} resize-y font-serif text-lg leading-7`}
          />
          <div>
            <span className={fieldLabel}>{name} can open it</span>
            <div className="flex flex-wrap gap-2">
              <Chip on={!timed} onClick={() => setTimed(false)}>
                Right away
              </Chip>
              <Chip on={timed} onClick={() => setTimed(true)}>
                From a time
              </Chip>
            </div>
          </div>
          {timed && (
            <input
              required
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              aria-label="Opens at"
              className={`${input} block min-h-12 min-w-0 appearance-none text-left [&::-webkit-date-and-time-value]:text-left`}
            />
          )}
          <p className="px-1 text-xs text-muted">
            {timed
              ? `${name} sees a sealed envelope now, and gets a notification when it unlocks.`
              : `${name} gets a notification straight away.`}
          </p>
          {error && <p className="animate-rise text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setWriting(false)} className={`${secondaryButton} flex-1`}>
              Cancel
            </button>
            <button disabled={saving} className={`${primaryButton} flex-[2]`}>
              {saving ? "Sealing…" : "Seal it 💌"}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setWriting(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-card py-3.5 text-sm font-medium text-accent transition-all active:scale-[0.98]"
        >
          💌 Write {others.length === 1 ? others[0].name : "someone"} a letter
        </button>
      )}

      {sent.length > 0 && (
        <ul className="space-y-1.5">
          {sent.map((letter) => (
            <SentLetter key={letter.id} letter={letter} now={now} onChange={onChange} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SentLetter({ letter, now, onChange }: { letter: Letter; now: number; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    if (!confirming) return setConfirming(true);
    await deleteLetterAction(letter.id);
    onChange();
  }

  const status =
    letter.openedAt !== null
      ? `Opened ${at(letter.openedAt, now)}`
      : letter.opensAt !== null && letter.opensAt > now
        ? `Sealed until ${clock(letter.opensAt, now)}`
        : "Not opened yet";

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-2.5">
      <span className="text-lg">{letter.openedAt !== null ? "💌" : letter.opensAt! > now ? "🔒" : "✉️"}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{letter.title}</span>
        <span className={`flex items-center gap-1 text-xs ${letter.openedAt !== null ? "text-accent" : "text-muted"}`}>
          {letter.openedAt !== null && <CheckIcon />}
          To {letter.toName} · {status}
        </span>
      </span>
      <button
        onClick={remove}
        onBlur={() => setConfirming(false)}
        aria-label="Take back this letter"
        className={`shrink-0 rounded-full p-2 text-sm transition-colors ${
          confirming ? "bg-red-500 px-3 font-medium text-white" : "text-muted"
        }`}
      >
        {confirming ? "Delete?" : <TrashIcon />}
      </button>
    </li>
  );
}

/** "6:40 PM" today, otherwise "Wed, Nov 26, 6:40 PM". */
function clock(ms: number, now: number) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

/** "at 6:40 PM" today, otherwise "Wed, Nov 26, 6:40 PM". */
function at(ms: number, now: number) {
  const d = new Date(ms);
  return d.toDateString() === new Date(now).toDateString() ? `at ${clock(ms, now)}` : clock(ms, now);
}

/** "45 min", "2h 5m" or "3d 4h" from `now` until `ms`. */
function until(ms: number, now: number) {
  const minutes = Math.max(1, Math.ceil((ms - now) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all active:scale-95 ${
        on ? "bg-accent-soft text-accent ring-2 ring-accent" : "bg-background text-muted ring-1 ring-line"
      }`}
    >
      {children}
    </button>
  );
}

const input =
  "w-full rounded-xl border border-line bg-background px-4 py-3 text-base text-foreground outline-none transition-shadow placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15";
const fieldLabel = "mb-1.5 block px-1 text-xs font-medium text-muted";
const primaryButton =
  "rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-on-accent transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60";
const secondaryButton =
  "rounded-xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent transition-all duration-200 active:scale-[0.98]";
