"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { CATEGORIES, category, formatINR, type CategoryId } from "@/lib/expense-categories";
import type { MonthSummary } from "@/lib/expenses";
import { addExpenseAction, deleteExpenseAction, loadExpenses, saveBudgetAction } from "./expense-actions";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, TrashIcon } from "./icons";
import { Unlock } from "./photos";
import { UNLOCKED } from "./use-photos";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** The phone's local date as YYYY-MM-DD. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function monthName(month: string, style: "long" | "short") {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: style,
    ...(style === "long" ? { year: "numeric" } : {}),
  });
}

type State = { status: "loading" } | { status: "locked" } | { status: "error" } | { status: "ready"; summary: MonthSummary };

const noSubscribe = () => () => {};

export function Expenses() {
  // The current month comes from the phone's clock, so it's only known in the browser.
  const currentMonth = useSyncExternalStore(noSubscribe, () => today().slice(0, 7), () => null);
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? currentMonth;
  const setMonth = setPicked;
  const [state, setState] = useState<State>({ status: "loading" });

  const refresh = useCallback(async () => {
    if (!month) return;
    try {
      setState(await loadExpenses(month));
    } catch {
      setState((s) => (s.status === "ready" ? s : { status: "error" }));
    }
  }, [month]);

  useEffect(() => {
    // Deferred so the first load doesn't set state synchronously inside the effect.
    const first = setTimeout(refresh, 0);
    window.addEventListener(UNLOCKED, refresh);
    return () => {
      clearTimeout(first);
      window.removeEventListener(UNLOCKED, refresh);
    };
  }, [refresh]);

  if (state.status === "loading" || !month) {
    return (
      <div className="space-y-5">
        <div className="skeleton animate-shimmer h-44 rounded-3xl" />
        <div className="skeleton animate-shimmer h-72 rounded-3xl" />
      </div>
    );
  }
  if (state.status === "locked") return <Unlock what="keep track of your expenses" />;
  if (state.status === "error") {
    return (
      <div className="animate-rise rounded-3xl border border-line bg-card p-6 text-sm">
        Couldn&apos;t load expenses. Check your connection and try again.
      </div>
    );
  }

  const { summary } = state;
  const isCurrentMonth = month === today().slice(0, 7);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className={roundButton}>
          <ChevronLeftIcon />
        </button>
        <p key={month} className="animate-fade text-sm font-medium">
          {monthName(month, "long")}
        </p>
        <button
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={isCurrentMonth}
          aria-label="Next month"
          className={`${roundButton} disabled:opacity-0`}
        >
          <ChevronRightIcon />
        </button>
      </div>

      <Summary summary={summary} onChange={refresh} />
      {isCurrentMonth && <AddExpense onAdded={refresh} />}
      {summary.byCategory.length > 0 && <ByCategory summary={summary} />}
      <Trend summary={summary} onPick={setMonth} />
      <ExpenseList summary={summary} onChange={refresh} />
    </div>
  );
}

function Summary({ summary, onChange }: { summary: MonthSummary; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { total, budget } = summary;
  const used = budget ? total / budget : 0;
  const over = budget !== null && total > budget;

  async function save(e: FormEvent) {
    e.preventDefault();
    const result = await saveBudgetAction(value);
    if (!result.ok) return setError(result.error);
    setError(null);
    setEditing(false);
    onChange();
  }

  return (
    <section className="rounded-3xl bg-hero p-6 text-hero-fg">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">Spent in {monthName(summary.month, "short")}</p>
      <p key={total} className="animate-rise mt-1 font-serif text-5xl tracking-tight">
        {formatINR(total)}
      </p>

      {budget !== null && !editing && (
        <div className="mt-5">
          {/* Meter: spending against the monthly budget. */}
          <div
            role="meter"
            aria-label="Budget used"
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-valuenow={Math.min(total, budget)}
            className="h-2.5 overflow-hidden rounded-full bg-card/70"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                over ? "bg-red-500" : "bg-accent"
              }`}
              style={{ width: `${Math.min(100, used * 100)}%` }}
            />
          </div>
          <p className="mt-2 flex justify-between text-sm">
            <span className={over ? "font-medium text-red-600 dark:text-red-400" : ""}>
              {over ? `⚠ ${formatINR(total - budget)} over budget` : `${formatINR(budget - total)} left`}
            </span>
            <button onClick={() => (setValue(String(budget / 100)), setEditing(true))} className="opacity-70 underline-offset-2 hover:underline">
              of {formatINR(budget)}
            </button>
          </p>
        </div>
      )}

      {budget === null && !editing && (
        <button onClick={() => (setValue(""), setEditing(true))} className="mt-4 text-sm font-medium underline underline-offset-4 opacity-80">
          Set a monthly budget
        </button>
      )}

      {editing && (
        <form onSubmit={save} className="animate-rise mt-4 flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
            <input
              autoFocus
              inputMode="decimal"
              placeholder="Monthly budget"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={`${input} pl-7`}
            />
          </div>
          <button type="submit" className={`${primaryButton} px-4`}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="px-2 text-sm opacity-70">
            Cancel
          </button>
        </form>
      )}
      {editing && budget !== null && (
        <p className="mt-2 text-xs opacity-70">Leave it empty and save to remove the budget.</p>
      )}
      {error && <p className="animate-rise mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function AddExpense({ onAdded }: { onAdded: () => void }) {
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState<CategoryId>("food");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await addExpenseAction({ amount, category: cat, note, date });
      if (!result.ok) return setError(result.error);
      setAmount("");
      setNote("");
      setDate(today());
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-3xl border border-line bg-card p-5">
      <h2 className="font-serif text-2xl">Add expense</h2>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-serif text-3xl text-muted">₹</span>
        <input
          required
          inputMode="decimal"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount in rupees"
          className={`${input} py-3.5 pl-10 font-serif text-3xl`}
        />
      </div>

      <div className="grid grid-cols-4 gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCat(c.id)}
            aria-pressed={cat === c.id}
            className={`flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[11px] font-medium transition-all active:scale-95 ${
              cat === c.id ? "bg-accent-soft text-accent ring-2 ring-accent" : "bg-background text-muted ring-1 ring-line"
            }`}
          >
            <span className="text-xl leading-none">{c.emoji}</span>
            {c.label}
          </button>
        ))}
      </div>

      <label className="block">
        <span className={fieldLabel}>Note (optional)</span>
        <input
          maxLength={80}
          placeholder="e.g. Dosa with Purvi"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={input}
        />
      </label>
      <label className="block">
        <span className={fieldLabel}>Date</span>
        {/* Phones give date inputs a fixed built-in width; min-w-0 and appearance-none let it fit the card. */}
        <input
          type="date"
          required
          max={today()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={`${input} block min-h-12 min-w-0 appearance-none text-left [&::-webkit-date-and-time-value]:text-left`}
        />
      </label>

      {error && <p className="animate-rise text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={saving} className={`${primaryButton} w-full`}>
        {justSaved ? (
          <span className="inline-flex animate-rise items-center gap-2">
            <CheckIcon /> Added
          </span>
        ) : saving ? (
          "Adding…"
        ) : (
          "Add expense"
        )}
      </button>
    </form>
  );
}

/** Horizontal bars, one per category, largest first; one hue since the labels carry identity. */
function ByCategory({ summary }: { summary: MonthSummary }) {
  const max = summary.byCategory[0]?.total ?? 1;
  return (
    <section className="rounded-3xl border border-line bg-card p-5">
      <h2 className="font-serif text-2xl">Where it went</h2>
      <ul className="mt-4 space-y-3.5">
        {summary.byCategory.map((row, i) => {
          const c = category(row.category);
          const share = Math.round((row.total / summary.total) * 100);
          return (
            <li key={row.category} style={{ animationDelay: `${i * 50}ms` }} className="animate-rise">
              <div className="flex items-baseline justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span aria-hidden>{c.emoji}</span>
                  {c.label}
                </span>
                <span>
                  <span className="font-medium">{formatINR(row.total)}</span>
                  <span className="ml-2 text-xs text-muted">{share}%</span>
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ width: `${Math.max(2, (row.total / max) * 100)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Six-month columns: the selected month in the accent, the rest as quiet context. Tap a column to open it. */
function Trend({ summary, onPick }: { summary: MonthSummary; onPick: (month: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...summary.trend.map((t) => t.total), 1);
  const shown = summary.trend.find((t) => t.month === (hover ?? summary.month))!;

  return (
    <section className="rounded-3xl border border-line bg-card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-2xl">Last 6 months</h2>
        <p className="text-sm">
          <span className="text-muted">{monthName(shown.month, "short")} </span>
          <span className="font-medium">{formatINR(shown.total)}</span>
        </p>
      </div>
      <div className="mt-4 flex h-36 items-end gap-2 border-b border-line">
        {summary.trend.map((t) => {
          const selected = t.month === summary.month;
          return (
            <button
              key={t.month}
              onClick={() => onPick(t.month)}
              onPointerEnter={() => setHover(t.month)}
              onPointerLeave={() => setHover(null)}
              aria-label={`${monthName(t.month, "long")}: ${formatINR(t.total)}`}
              className="group flex h-full flex-1 items-end"
            >
              <span
                className={`w-full rounded-t-[4px] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  selected ? "bg-accent" : "bg-line group-hover:bg-muted/40"
                }`}
                style={{ height: `${t.total ? Math.max(3, (t.total / max) * 100) : 0}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2">
        {summary.trend.map((t) => (
          <span
            key={t.month}
            className={`flex-1 text-center text-[11px] ${t.month === summary.month ? "font-medium text-accent" : "text-muted"}`}
          >
            {monthName(t.month, "short")}
          </span>
        ))}
      </div>
    </section>
  );
}

function ExpenseList({ summary, onChange }: { summary: MonthSummary; onChange: () => void }) {
  const [removing, setRemoving] = useState<string | null>(null);

  if (summary.expenses.length === 0) {
    return (
      <div className="animate-rise rounded-3xl border border-dashed border-line px-6 py-10 text-center">
        <p className="text-3xl">🪙</p>
        <p className="mt-2 text-sm font-medium">No expenses this month</p>
        <p className="text-xs text-muted">Add one above and it&apos;ll show up here.</p>
      </div>
    );
  }

  // Group by day, newest first (the server already sorts them).
  const days: { date: string; items: MonthSummary["expenses"] }[] = [];
  for (const e of summary.expenses) {
    const last = days[days.length - 1];
    if (last?.date === e.spentOn) last.items.push(e);
    else days.push({ date: e.spentOn, items: [e] });
  }

  async function remove(id: string) {
    setRemoving(id);
    // Let the exit animation play before the row disappears.
    await new Promise((r) => setTimeout(r, 250));
    await deleteExpenseAction(id);
    onChange();
    setRemoving(null);
  }

  return (
    <section className="space-y-4">
      {days.map((day) => {
        const [y, m, d] = day.date.split("-").map(Number);
        const label =
          day.date === today()
            ? "Today"
            : new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
        return (
          <div key={day.date}>
            <div className="mb-2 flex justify-between px-1 text-xs text-muted">
              <span className="font-medium uppercase tracking-wide">{label}</span>
              <span>{formatINR(day.items.reduce((s, e) => s + e.amount, 0))}</span>
            </div>
            <ul className="space-y-2">
              {day.items.map((e) => {
                const c = category(e.category);
                return (
                  <li
                    key={e.id}
                    className={`animate-rise transition-all duration-300 ${removing === e.id ? "translate-x-8 opacity-0" : ""}`}
                  >
                    <div className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 pr-2">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-lg">
                        {c.emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{e.note || c.label}</p>
                        {e.note && <p className="text-xs text-muted">{c.label}</p>}
                      </div>
                      <span className="text-sm font-semibold">{formatINR(e.amount)}</span>
                      <button
                        onClick={() => remove(e.id)}
                        aria-label={`Delete ${e.note || c.label}`}
                        className="rounded-xl p-2.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 active:scale-90"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
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
