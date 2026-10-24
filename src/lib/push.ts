import "server-only";
import { createHash } from "node:crypto";
import webpush, { type PushSubscription as WebPushSubscription, WebPushError } from "web-push";
import { getDaily } from "./daily";
import { store, type Reminder } from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;

let configured = false;

function configure() {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY");
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
    publicKey,
    privateKey,
  );
  configured = true;
}

/** Stable id for a browser/device, derived from its push endpoint. */
export function deviceIdFor(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/**
 * Sends a push to one device. Returns false when the subscription is gone
 * (the user uninstalled the app or revoked permission); the device is then removed.
 */
export async function sendPush(deviceId: string, payload: PushPayload) {
  configure();
  const sub = await store.getSubscription(deviceId);
  if (!sub) return false;
  try {
    await webpush.sendNotification(sub as WebPushSubscription, JSON.stringify(payload), {
      TTL: 60 * 60,
    });
    return true;
  } catch (error) {
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
      await store.deleteDevice(deviceId);
      return false;
    }
    throw error;
  }
}

/** Sends every reminder that is due and reschedules or removes it. */
export async function sendDueReminders(now = Date.now()) {
  const due = await store.dueReminders(now);
  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    try {
      if (await sendPush(reminder.deviceId, { title: reminder.title, body: reminder.body, tag: reminder.id })) {
        sent++;
      }
    } catch (error) {
      failed++;
      console.error("[push] failed to send reminder", reminder.id, error);
    }
    await advance(reminder, now);
  }

  return { due: due.length, sent, failed };
}

async function advance(reminder: Reminder, now: number) {
  if (reminder.repeat === "daily") {
    let next = reminder.at + DAY_MS;
    // Skip occurrences missed while the scheduler wasn't running.
    while (next <= now) next += DAY_MS;
    await store.saveReminder({ ...reminder, at: next });
  } else {
    await store.deleteReminder(reminder.deviceId, reminder.id);
  }
}

/** Calendar date (YYYY-MM-DD) at `now` in an IANA time zone such as "Asia/Kolkata". */
export function localDate(now: number, timeZone: string) {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

/** Sends the day's quote to every opted-in device whose local date has changed since the last one. */
export async function sendDailyQuotes(now = Date.now()) {
  let sent = 0;
  let failed = 0;

  for (const [deviceId, setting] of await store.listDailyQuotes()) {
    const today = localDate(now, setting.timeZone);
    if (today === setting.lastSent) continue;
    // Mark it sent first so a failing push isn't retried on every tick.
    await store.setDailyQuote(deviceId, { ...setting, lastSent: today });
    try {
      const { quote } = await getDaily(today);
      const delivered = await sendPush(deviceId, {
        title: "Today's spark ✨",
        body: `“${quote.text}” — ${quote.author}`,
        tag: "daily-quote",
      });
      if (delivered) sent++;
    } catch (error) {
      failed++;
      console.error("[push] failed to send daily quote", deviceId, error);
    }
  }

  return { sent, failed };
}
