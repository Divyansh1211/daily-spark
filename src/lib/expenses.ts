import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";

export type Expense = {
  id: string;
  amount: number;
  category: string;
  note: string;
  spentOn: string;
};

export type MonthSummary = {
  month: string;
  expenses: Expense[];
  total: number;
  byCategory: { category: string; total: number }[];
  /** Totals for the six months ending with `month`, oldest first. */
  trend: { month: string; total: number }[];
  budget: number | null;
};

/** YYYY-MM shifted by `delta` months. */
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function addExpense(owner: string, e: Omit<Expense, "id">) {
  db().prepare(
    "INSERT INTO expenses (id, owner, amount, category, note, spent_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), owner, e.amount, e.category, e.note, e.spentOn, Date.now());
}

export function deleteExpense(owner: string, id: string) {
  db().prepare("DELETE FROM expenses WHERE owner = ? AND id = ?").run(owner, id);
}

export function setBudget(owner: string, amount: number | null) {
  if (amount === null) db().prepare("DELETE FROM budgets WHERE owner = ?").run(owner);
  else
    db().prepare(
      "INSERT INTO budgets (owner, amount) VALUES (?, ?) ON CONFLICT (owner) DO UPDATE SET amount = excluded.amount",
    ).run(owner, amount);
}

export function monthSummary(owner: string, month: string): MonthSummary {
  const start = `${month}-01`;
  const end = `${shiftMonth(month, 1)}-01`;

  const expenses = db()
    .prepare(
      `SELECT id, amount, category, note, spent_on AS spentOn FROM expenses
       WHERE owner = ? AND spent_on >= ? AND spent_on < ?
       ORDER BY spent_on DESC, created_at DESC`,
    )
    .all(owner, start, end) as Expense[];

  const byCategory = db()
    .prepare(
      `SELECT category, SUM(amount) AS total FROM expenses
       WHERE owner = ? AND spent_on >= ? AND spent_on < ?
       GROUP BY category ORDER BY total DESC`,
    )
    .all(owner, start, end) as { category: string; total: number }[];

  const firstTrendMonth = shiftMonth(month, -5);
  const rows = db()
    .prepare(
      `SELECT substr(spent_on, 1, 7) AS month, SUM(amount) AS total FROM expenses
       WHERE owner = ? AND spent_on >= ? AND spent_on < ?
       GROUP BY month`,
    )
    .all(owner, `${firstTrendMonth}-01`, end) as { month: string; total: number }[];
  const trend = Array.from({ length: 6 }, (_, i) => {
    const m = shiftMonth(firstTrendMonth, i);
    return { month: m, total: rows.find((r) => r.month === m)?.total ?? 0 };
  });

  const budget = db().prepare("SELECT amount FROM budgets WHERE owner = ?").get(owner) as
    | { amount: number }
    | undefined;

  return {
    month,
    expenses: expenses.map((e) => ({ ...e })),
    total: byCategory.reduce((sum, c) => sum + c.total, 0),
    byCategory: byCategory.map((c) => ({ ...c })),
    trend,
    budget: budget?.amount ?? null,
  };
}
