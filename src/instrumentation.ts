// In local development there is no external cron, so poll for due reminders here.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") return;

  const { sendDueReminders } = await import("@/lib/push");
  const g = globalThis as unknown as { __reminderTicker?: NodeJS.Timeout };
  if (g.__reminderTicker) clearInterval(g.__reminderTicker);

  g.__reminderTicker = setInterval(() => {
    sendDueReminders().catch((error) => console.error("[dev scheduler]", error));
  }, 15_000);
  console.log("[dev scheduler] checking for due reminders every 15s");
}
