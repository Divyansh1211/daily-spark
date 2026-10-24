// Polls for due reminders and daily quotes in-process: always in local development, and in production
// when ENABLE_SCHEDULER=true (long-running servers such as a VM, where no external cron is needed).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "development" && process.env.ENABLE_SCHEDULER !== "true") return;

  const { sendDailyQuotes, sendDueReminders } = await import("@/lib/push");
  const g = globalThis as unknown as { __reminderTicker?: NodeJS.Timeout };
  if (g.__reminderTicker) clearInterval(g.__reminderTicker);

  g.__reminderTicker = setInterval(() => {
    sendDueReminders().catch((error) => console.error("[scheduler]", error));
    sendDailyQuotes().catch((error) => console.error("[scheduler]", error));
  }, 15_000);
  console.log("[scheduler] checking for due reminders every 15s");
}
