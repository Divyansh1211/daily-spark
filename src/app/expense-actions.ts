"use server";

import { currentUser } from "@/lib/auth";
import { isCategory } from "@/lib/expense-categories";
import { addExpense, deleteExpense, monthSummary, setBudget, type MonthSummary } from "@/lib/expenses";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_PAISE = 1_00_00_000_00; // ₹1 crore

/** Rupees as typed ("250", "99.5") to paise, or null if it isn't a sensible amount. */
function toPaise(rupees: string) {
  const value = Number(String(rupees).trim().replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  const paise = Math.round(value * 100);
  return paise > 0 && paise <= MAX_PAISE ? paise : null;
}

export async function loadExpenses(
  month: string,
): Promise<{ status: "locked" } | { status: "ready"; summary: MonthSummary }> {
  const user = await currentUser();
  if (!user) return { status: "locked" };
  if (!MONTH.test(month)) throw new Error("Invalid month");
  return { status: "ready", summary: monthSummary(user.id, month) };
}

export async function addExpenseAction(input: { amount: string; category: string; note: string; date: string }) {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "Log in first." };
  const amount = toPaise(input.amount);
  if (amount === null) return { ok: false as const, error: "Enter an amount, like 250." };
  if (!isCategory(input.category)) return { ok: false as const, error: "Pick a category." };
  if (!DATE.test(input.date)) return { ok: false as const, error: "Pick a date." };
  addExpense(user.id, {
    amount,
    category: input.category,
    note: String(input.note ?? "").trim().slice(0, 80),
    spentOn: input.date,
  });
  return { ok: true as const };
}

export async function deleteExpenseAction(id: string) {
  const user = await currentUser();
  if (!user || typeof id !== "string") return { ok: false };
  deleteExpense(user.id, id);
  return { ok: true };
}

/** Empty string removes the budget. */
export async function saveBudgetAction(rupees: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "Log in first." };
  if (String(rupees).trim() === "") {
    setBudget(user.id, null);
    return { ok: true as const };
  }
  const amount = toPaise(rupees);
  if (amount === null) return { ok: false as const, error: "Enter a budget, like 20000." };
  setBudget(user.id, amount);
  return { ok: true as const };
}
