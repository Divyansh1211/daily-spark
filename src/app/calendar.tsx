"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { User } from "@/lib/auth";
import type { CalendarEvent } from "@/lib/calendar";
import { SignedOut } from "./auth-screen";
import {
  addEventAction,
  addFeedAction,
  deleteEventAction,
  loadCalendar,
  remindAboutEventAction,
  removeFeedAction,
  syncCalendarsAction,
  type CalendarData,
} from "./calendar-actions";
import { BellIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, LinkIcon, PlusIcon, TrashIcon, XIcon } from "./icons";
import { WhoPicker } from "./who-picker";

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** A local Date as YYYY-MM-DD. */
function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key: string, n: number) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** The 42 days (six weeks, Sunday first) shown for a month. */
function gridDays(month: string) {
  const first = fromKey(`${month}-01`);
  first.setDate(1 - first.getDay());
  const start = dateKey(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The local days an event touches. All-day events are stored as UTC dates. */
function eventDays(e: CalendarEvent) {
  const days: string[] = [];
  if (e.allDay) {
    for (let t = e.start; t < e.end && days.length < 60; t += DAY) days.push(new Date(t).toISOString().slice(0, 10));
  } else {
    const last = dateKey(new Date(Math.max(e.start, e.end - 1)));
    for (let k = dateKey(new Date(e.start)); k <= last && days.length < 60; k = addDays(k, 1)) days.push(k);
  }
  return days;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** What to show for an event's time on one day of it. */
function timeLabel(e: CalendarEvent, day: string) {
  if (e.allDay) return "All day";
  const dayStart = fromKey(day).getTime();
  const dayEnd = fromKey(addDays(day, 1)).getTime();
  const startsToday = e.start >= dayStart;
  const endsToday = e.end <= dayEnd;
  if (startsToday && endsToday) return e.end > e.start ? `${time(e.start)} – ${time(e.end)}` : time(e.start);
  if (startsToday) return `From ${time(e.start)}`;
  if (endsToday) return `Until ${time(e.end)}`;
  return "All day";
}

function ago(ms: number) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

type ReminderOption = { id: string; label: string; at: number; body: string };

const MINUTE = 60 * 1000;

/** When a reminder about an event can go off, leaving out times already past. */
function reminderOptions(e: Pick<CalendarEvent, "start" | "allDay">): ReminderOption[] {
  let options: ReminderOption[];
  if (e.allDay) {
    // All-day events are stored as UTC dates; remind at 9 AM local time.
    const day = new Date(e.start).toISOString().slice(0, 10);
    const morning = fromKey(day).getTime() + 9 * 60 * MINUTE;
    const dayBefore = fromKey(addDays(day, -1)).getTime() + 9 * 60 * MINUTE;
    options = [
      { id: "morning", label: "Morning of (9 AM)", at: morning, body: "Today" },
      { id: "day-before", label: "Day before (9 AM)", at: dayBefore, body: "Tomorrow" },
    ];
  } else {
    const at = time(e.start);
    options = [
      { id: "0", label: "When it starts", at: e.start, body: `Starting now (${at})` },
      { id: "10", label: "10 min before", at: e.start - 10 * MINUTE, body: `Starts at ${at}` },
      { id: "30", label: "30 min before", at: e.start - 30 * MINUTE, body: `Starts at ${at}` },
      { id: "60", label: "1 hour before", at: e.start - 60 * MINUTE, body: `Starts at ${at}` },
      { id: "1440", label: "1 day before", at: e.start - 24 * 60 * MINUTE, body: `Tomorrow at ${at}` },
    ];
  }
  return options.filter((o) => o.at > Date.now());
}

const personColor = (index: number) => `var(--person-${(index % 4) + 1})`;

type State = { status: "loading" } | { status: "locked" } | { status: "error" } | { status: "ready"; data: CalendarData };

const noSubscribe = () => () => {};

export function Calendar() {
  // Today comes from the phone's clock, so it's only known in the browser.
  const today = useSyncExternalStore(noSubscribe, () => dateKey(new Date()), () => null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const day = pickedDay ?? today;
  const month = pickedMonth ?? day?.slice(0, 7) ?? null;
  const [state, setState] = useState<State>({ status: "loading" });
  const lastSync = useRef(0);

  const refresh = useCallback(async () => {
    if (!month) return;
    const days = gridDays(month);
    const from = fromKey(days[0]).getTime();
    const to = fromKey(addDays(days[41], 1)).getTime();
    try {
      const result = await loadCalendar(from, to);
      setState(result);
      // Linked calendars are fetched in the background, then shown once they're in.
      if (result.status === "ready" && result.data.stale && Date.now() - lastSync.current > 60_000) {
        lastSync.current = Date.now();
        await syncCalendarsAction();
        const fresh = await loadCalendar(from, to);
        setState(fresh);
      }
    } catch {
      setState((s) => (s.status === "ready" ? s : { status: "error" }));
    }
  }, [month]);

  useEffect(() => {
    // Deferred so the first load doesn't set state synchronously inside the effect.
    const first = setTimeout(refresh, 0);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  if (state.status === "loading" || !today || !day || !month) {
    return (
      <div className="space-y-5">
        <div className="skeleton animate-shimmer h-80 rounded-3xl" />
        <div className="skeleton animate-shimmer h-40 rounded-3xl" />
      </div>
    );
  }
  if (state.status === "locked") return <SignedOut />;
  if (state.status === "error") {
    return (
      <div className="animate-rise rounded-3xl border border-line bg-card p-6 text-sm">
        Couldn&apos;t load the calendar. Check your connection and try again.
      </div>
    );
  }

  const { data } = state;
  const colorOf = new Map(data.people.map((p, i) => [p.id, personColor(i)]));
  const nameOf = new Map(data.people.map((p) => [p.id, p.id === data.me ? "You" : p.name]));
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of data.events) {
    for (const k of eventDays(e)) byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }

  function pickMonth(m: string) {
    setPickedMonth(m);
    // Keep the selected day inside the month on screen.
    setPickedDay(m === today!.slice(0, 7) ? today : `${m}-01`);
  }

  return (
    <div className="space-y-5">
      <MonthGrid
        month={month}
        day={day}
        today={today}
        byDay={byDay}
        colorOf={colorOf}
        onMonth={pickMonth}
        onDay={(k) => {
          setPickedDay(k);
          if (k.slice(0, 7) !== month) setPickedMonth(k.slice(0, 7));
        }}
      />

      {data.people.length > 1 && (
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Whose events">
          {data.people.map((p, i) => (
            <li key={p.id} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: personColor(i) }} />
              {p.id === data.me ? `${p.name} (you)` : p.name}
            </li>
          ))}
        </ul>
      )}

      <DayAgenda
        key={day}
        day={day}
        today={today}
        events={byDay.get(day) ?? []}
        me={data.me}
        people={data.people}
        colorOf={colorOf}
        nameOf={nameOf}
        onChange={refresh}
      />
      <LinkedCalendars data={data} onChange={refresh} />
    </div>
  );
}

function MonthGrid({
  month,
  day,
  today,
  byDay,
  colorOf,
  onMonth,
  onDay,
}: {
  month: string;
  day: string;
  today: string;
  byDay: Map<string, CalendarEvent[]>;
  colorOf: Map<string, string>;
  onMonth: (m: string) => void;
  onDay: (k: string) => void;
}) {
  const [y, m] = month.split("-").map(Number);
  const title = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <section className="rounded-3xl border border-line bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month" className={roundButton}>
          <ChevronLeftIcon />
        </button>
        <button
          onClick={() => onMonth(today.slice(0, 7))}
          key={month}
          className="animate-fade font-serif text-2xl"
          aria-label={`${title}. Go to today`}
        >
          {title}
        </button>
        <button onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month" className={roundButton}>
          <ChevronRightIcon />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted" aria-hidden>
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {gridDays(month).map((k) => {
          const inMonth = k.slice(0, 7) === month;
          const selected = k === day;
          const isToday = k === today;
          const events = byDay.get(k) ?? [];
          // One dot per person with something on, always in the same order.
          const owners = [...colorOf.keys()].filter((id) => events.some((e) => e.owner === id));
          return (
            <button
              key={k}
              onClick={() => onDay(k)}
              aria-pressed={selected}
              aria-label={`${fromKey(k).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}, ${
                events.length === 0 ? "nothing planned" : `${events.length} event${events.length === 1 ? "" : "s"}`
              }`}
              className="flex flex-col items-center gap-1 py-1 active:scale-90"
            >
              <span
                className={`flex size-9 items-center justify-center rounded-full text-sm transition-colors ${
                  selected
                    ? "bg-accent font-semibold text-on-accent"
                    : isToday
                      ? "font-semibold text-accent ring-1 ring-accent"
                      : inMonth
                        ? ""
                        : "text-muted/50"
                }`}
              >
                {Number(k.slice(8))}
              </span>
              <span className="flex h-1.5 gap-0.5">
                {owners.slice(0, 4).map((o) => (
                  <span key={o} className="size-1.5 rounded-full" style={{ background: colorOf.get(o) ?? "var(--muted)" }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DayAgenda({
  day,
  today,
  events,
  me,
  people,
  colorOf,
  nameOf,
  onChange,
}: {
  day: string;
  today: string;
  events: CalendarEvent[];
  me: string;
  people: User[];
  colorOf: Map<string, string>;
  nameOf: Map<string, string>;
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  // The event whose reminder form is open.
  const [reminding, setReminding] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const label =
    day === today
      ? "Today"
      : day === addDays(today, 1)
        ? "Tomorrow"
        : fromKey(day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const sorted = [...events].sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.title.localeCompare(b.title),
  );

  async function remove(id: string) {
    setRemoving(id);
    setMessage(null);
    // Let the exit animation play before the row disappears.
    await new Promise((r) => setTimeout(r, 250));
    await deleteEventAction(id);
    onChange();
    setRemoving(null);
  }

  return (
    <section className="rounded-3xl border border-line bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-2xl">{label}</h2>
        {!adding && (
          <button onClick={() => setAdding(true)} className={`${primaryButton} inline-flex items-center gap-1.5 py-2`}>
            <PlusIcon /> Add
          </button>
        )}
      </div>

      {adding && (
        <AddEvent
          day={day}
          me={me}
          people={people}
          onDone={(added, note) => {
            setAdding(false);
            setMessage(note ?? null);
            if (added) onChange();
          }}
        />
      )}

      {message && <p className="animate-rise mt-3 text-sm text-muted">{message}</p>}

      {sorted.length === 0 && !adding && <p className="mt-3 text-sm text-muted">Nothing planned. A free day!</p>}

      {sorted.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sorted.map((e) => (
            <li
              key={e.id}
              className={`animate-rise rounded-2xl bg-background transition-all duration-300 ${
                removing === e.id ? "translate-x-8 opacity-0" : ""
              }`}
            >
              <div className="flex items-center gap-1 p-3 pr-2">
                <span
                  className="mr-2 w-1 self-stretch rounded-full"
                  style={{ background: colorOf.get(e.owner) ?? "var(--muted)" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted">{timeLabel(e, day)}</p>
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <p className="text-xs text-muted">{nameOf.get(e.owner) ?? "Someone"}</p>
                </div>
                {reminderOptions(e).length > 0 && (
                  <button
                    onClick={() => (setReminding(reminding === e.id ? null : e.id), setMessage(null))}
                    aria-label={`Remind about ${e.title}`}
                    aria-expanded={reminding === e.id}
                    className={`rounded-xl p-2.5 transition-colors active:scale-90 ${
                      reminding === e.id ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"
                    }`}
                  >
                    <BellIcon />
                  </button>
                )}
                {e.owner === me && !e.linked ? (
                  <button
                    onClick={() => remove(e.id)}
                    aria-label={`Delete ${e.title}`}
                    className="rounded-xl p-2.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 active:scale-90"
                  >
                    <TrashIcon />
                  </button>
                ) : (
                  e.linked && (
                    <span className="p-2.5 text-muted" title="From a linked calendar">
                      <LinkIcon aria-label="From a linked calendar" />
                    </span>
                  )
                )}
              </div>
              {reminding === e.id && (
                <RemindForm
                  event={e}
                  me={me}
                  people={people}
                  onDone={(note) => {
                    setReminding(null);
                    setMessage(note);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The next whole hour, as HH:MM. */
function nextHour() {
  const h = (new Date().getHours() + 1) % 24;
  return `${pad(h)}:00`;
}

function plusHour(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${pad((h + 1) % 24)}:${pad(m)}`;
}

function AddEvent({
  day,
  me,
  people,
  onDone,
}: {
  day: string;
  me: string;
  people: User[];
  onDone: (added: boolean, note?: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(day);
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(nextHour);
  const [end, setEnd] = useState(() => plusHour(nextHour()));
  const [remind, setRemind] = useState<Reminding>({ option: "none", to: [me] });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startMs = new Date(`${date}T${start}`).getTime();
  let endMs = new Date(`${date}T${end}`).getTime();
  // 10 pm to 1 am ends the next day.
  if (endMs <= startMs) endMs = new Date(`${addDays(date, 1)}T${end}`).getTime();
  const options = Number.isFinite(startMs)
    ? reminderOptions(allDay ? { start: Date.parse(`${date}T00:00:00Z`), allDay } : { start: startMs, allDay })
    : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await addEventAction({ title, allDay, date, start: startMs, end: endMs });
      if (!result.ok) return setError(result.error);
      const picked = options.find((o) => o.id === remind.option);
      if (!picked) return onDone(true);
      const reminder = await remindAboutEventAction({ eventId: result.id, at: picked.at, body: picked.body, to: remind.to });
      onDone(true, reminder.ok ? (reminder.warning ?? "Added, with a reminder.") : `Added, but no reminder: ${reminder.error}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="animate-rise mt-4 space-y-3">
      <input
        autoFocus
        required
        maxLength={120}
        placeholder="What's happening?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Event name"
        className={input}
      />
      <label className="block">
        <span className={fieldLabel}>Date</span>
        {/* Phones give date inputs a fixed built-in width; min-w-0 and appearance-none let it fit the card. */}
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={`${input} block min-h-12 min-w-0 appearance-none text-left [&::-webkit-date-and-time-value]:text-left`}
        />
      </label>
      <label className="flex items-center justify-between rounded-xl border border-line bg-background px-4 py-3 text-sm">
        All day
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-5 accent-accent" />
      </label>
      {!allDay && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block min-w-0">
            <span className={fieldLabel}>Starts</span>
            <input
              type="time"
              required
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (e.target.value) setEnd(plusHour(e.target.value));
              }}
              className={`${input} block min-h-12 min-w-0 appearance-none text-left [&::-webkit-date-and-time-value]:text-left`}
            />
          </label>
          <label className="block min-w-0">
            <span className={fieldLabel}>Ends</span>
            <input
              type="time"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className={`${input} block min-h-12 min-w-0 appearance-none text-left [&::-webkit-date-and-time-value]:text-left`}
            />
          </label>
        </div>
      )}
      <ReminderFields options={options} me={me} people={people} value={remind} onChange={setRemind} optional />
      {error && <p className="animate-rise text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={`${primaryButton} flex-1`}>
          {saving ? "Adding…" : "Add to calendar"}
        </button>
        <button type="button" onClick={() => onDone(false)} className="px-3 text-sm text-muted">
          Cancel
        </button>
      </div>
    </form>
  );
}

type Reminding = { option: string; to: string[] };

/** When to remind and who; `optional` adds a "No reminder" choice. */
function ReminderFields({
  options,
  me,
  people,
  value,
  onChange,
  optional = false,
}: {
  options: ReminderOption[];
  me: string;
  people: User[];
  value: Reminding;
  onChange: (value: Reminding) => void;
  optional?: boolean;
}) {
  if (options.length === 0) return null;
  const picked = options.some((o) => o.id === value.option) ? value.option : optional ? "none" : options[0].id;
  return (
    <div className="space-y-3">
      <div>
        <span className={fieldLabel}>Reminder</span>
        <div className="flex flex-wrap gap-2">
          {[...(optional ? [{ id: "none", label: "None" }] : []), ...options].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange({ ...value, option: o.id })}
              aria-pressed={picked === o.id}
              className={`rounded-full px-3.5 py-2 text-sm font-medium transition-all active:scale-95 ${
                picked === o.id ? "bg-accent-soft text-accent ring-2 ring-accent" : "bg-background text-muted ring-1 ring-line"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {picked !== "none" && (
        <WhoPicker people={people} me={me} value={value.to} onChange={(to) => onChange({ ...value, to })} />
      )}
    </div>
  );
}

/** Sets a reminder about an event that's already on the calendar. */
function RemindForm({
  event,
  me,
  people,
  onDone,
}: {
  event: CalendarEvent;
  me: string;
  people: User[];
  onDone: (note: string) => void;
}) {
  const options = reminderOptions(event);
  // The other person's events default to reminding them too, since that's usually the point.
  const [value, setValue] = useState<Reminding>({
    option: options.find((o) => o.id === "30")?.id ?? options[0]?.id ?? "",
    to: event.owner === me ? [me] : [me, event.owner],
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const picked = options.find((o) => o.id === value.option) ?? options[0];
    if (!picked) return;
    setSaving(true);
    setError(null);
    try {
      const result = await remindAboutEventAction({ eventId: event.id, at: picked.at, body: picked.body, to: value.to });
      if (!result.ok) return setError(result.error);
      onDone(result.warning ?? `Reminder set for ${event.title}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="animate-rise space-y-3 border-t border-line p-3">
      <ReminderFields options={options} me={me} people={people} value={value} onChange={setValue} />
      {error && <p className="animate-rise text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={saving} className={`${primaryButton} w-full`}>
        {saving ? "Setting…" : "Set reminder"}
      </button>
    </form>
  );
}

function LinkedCalendars({ data, onChange }: { data: CalendarData; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justLinked, setJustLinked] = useState(false);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await addFeedAction(link);
      if (!result.ok) return setError(result.error);
      setLink("");
      setOpen(false);
      setJustLinked(true);
      setTimeout(() => setJustLinked(false), 2400);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await removeFeedAction(id);
    onChange();
  }

  return (
    <section className="rounded-3xl border border-line bg-card p-5">
      <h2 className="font-serif text-2xl">Your linked calendars</h2>
      <p className="mt-1 text-sm text-muted">
        Link your Google or Apple calendar and its events show up here for both of you. They refresh every few minutes.
      </p>

      {data.feeds.length > 0 && (
        <ul className="mt-4 space-y-2">
          {data.feeds.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-2xl bg-background p-3 pr-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <LinkIcon />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className={`text-xs ${f.error ? "text-red-500" : "text-muted"}`}>
                  {f.error ?? (f.syncedAt ? `Updated ${ago(f.syncedAt)}` : "Updating…")}
                </p>
              </div>
              <button
                onClick={() => remove(f.id)}
                aria-label={`Unlink ${f.name}`}
                className="rounded-xl p-2.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 active:scale-90"
              >
                <XIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      {justLinked && (
        <p className="animate-rise mt-3 inline-flex items-center gap-2 text-sm text-accent">
          <CheckIcon /> Linked
        </p>
      )}

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-medium text-accent ring-1 ring-inset ring-line transition-colors hover:bg-accent-soft active:scale-[0.98]"
        >
          Link a calendar
        </button>
      ) : (
        <form onSubmit={connect} className="animate-rise mt-4 space-y-3">
          <details className="rounded-xl bg-background p-3 text-sm">
            <summary className="cursor-pointer font-medium">Google Calendar: where&apos;s the link?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
              <li>On a computer, open calendar.google.com (the phone app doesn&apos;t show it).</li>
              <li>Settings ⚙ → under &ldquo;Settings for my calendars&rdquo; click your calendar.</li>
              <li>Scroll to &ldquo;Integrate calendar&rdquo; and copy &ldquo;Secret address in iCal format&rdquo;.</li>
            </ol>
          </details>
          <details className="rounded-xl bg-background p-3 text-sm">
            <summary className="cursor-pointer font-medium">Apple Calendar: where&apos;s the link?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
              <li>Open the Calendar app and tap Calendars at the bottom.</li>
              <li>Tap ⓘ next to an iCloud calendar.</li>
              <li>Turn on Public Calendar, tap Share Link, then Copy.</li>
            </ol>
          </details>
          <input
            autoFocus
            required
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://… or webcal://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            aria-label="Calendar link"
            className={input}
          />
          <p className="px-1 text-xs text-muted">
            Anyone with this link can see that calendar, so it&apos;s kept on the server and never shown again.
          </p>
          {error && <p className="animate-rise text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className={`${primaryButton} flex-1`}>
              {saving ? "Linking…" : "Link calendar"}
            </button>
            <button type="button" onClick={() => (setOpen(false), setError(null))} className="px-3 text-sm text-muted">
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

const input =
  "w-full rounded-xl border border-line bg-background px-4 py-3 text-base text-foreground outline-none transition-shadow placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15";
const fieldLabel = "mb-1.5 block px-1 text-xs font-medium text-muted";
const primaryButton =
  "rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-on-accent transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60";
const roundButton =
  "flex size-9 items-center justify-center rounded-full border border-line bg-card text-muted transition-colors hover:text-foreground active:scale-90";
