// Shared by the server (validation) and the client (labels and emoji).
export const CATEGORIES = [
  { id: "food", label: "Food", emoji: "🍜" },
  { id: "groceries", label: "Groceries", emoji: "🛒" },
  { id: "travel", label: "Travel", emoji: "🛺" },
  { id: "shopping", label: "Shopping", emoji: "🛍️" },
  { id: "bills", label: "Bills", emoji: "🧾" },
  { id: "fun", label: "Fun", emoji: "🎬" },
  { id: "health", label: "Health", emoji: "💊" },
  { id: "other", label: "Other", emoji: "✨" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export function isCategory(value: unknown): value is CategoryId {
  return CATEGORIES.some((c) => c.id === value);
}

export function category(id: string) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

/** ₹ amount from paise, without decimals when it's a whole number of rupees. */
export function formatINR(paise: number) {
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(paise / 100);
}
