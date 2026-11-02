import "server-only";
import { createHash } from "node:crypto";
import webpush, { type PushSubscription as WebPushSubscription, WebPushError } from "web-push";
import { listPeople, type User } from "./auth";
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

/** Sends a push to each of `userIds`, on every device they have notifications on. */
async function notifyUsers(userIds: string[], payload: PushPayload) {
  const devices = (await Promise.all(userIds.map((id) => store.listUserDevices(id)))).flat();
  const results = await Promise.allSettled(devices.map((deviceId) => sendPush(deviceId, payload)));
  for (const r of results) if (r.status === "rejected") console.error("[push] failed", payload.tag, r.reason);
}

/** Sends a push to everyone except `from`. */
function notifyOthers(from: User, payload: PushPayload) {
  return notifyUsers(
    listPeople()
      .filter((p) => p.id !== from.id)
      .map((p) => p.id),
    payload,
  );
}

/** Tells `to` that `from` suggested something for them, or added something for both of them (`to` omitted). */
export function sendShelfSuggestionPush(from: User, to: string | null, itemId: string, what: string) {
  const payload = { title: "Space", body: `${from.name} ${to ? "suggested" : "added for you both:"} ${what}`, tag: `shelf-${itemId}` };
  return to ? notifyUsers([to], payload) : notifyOthers(from, payload);
}

/** Tells whoever suggested something that `from` finished it. */
export function sendShelfFinishedPush(from: User, to: string, itemId: string, what: string) {
  return notifyUsers([to], { title: "Space", body: `${from.name} finished ${what} ✨`, tag: `shelf-done-${itemId}` });
}

/** Tells everyone else that `from` reacted to a photo. */
export function sendReactionPush(from: User, photoId: string, emoji: string) {
  return notifyOthers(from, {
    title: "Space",
    body: `${from.name} reacted ${emoji} to a photo`,
    // Changing the reaction replaces the notification instead of stacking another.
    tag: `reaction-${photoId}-${from.id}`,
  });
}

/** Tells everyone else that `from` added a photo. */
export function sendPhotoPush(from: User) {
  return notifyOthers(from, {
    title: "Space",
    body: `${from.name} added a photo`,
    // Uploading several at once shows one notification rather than a pile of them.
    tag: `photo-${from.id}`,
  });
}

/** Sends every reminder that is due and reschedules or removes it. */
export async function sendDueReminders(now = Date.now()) {
  const due = await store.dueReminders(now);
  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    const devices = reminder.userId
      ? await store.listUserDevices(reminder.userId)
      : reminder.deviceId
        ? [reminder.deviceId]
        : [];
    let delivered = false;
    for (const deviceId of devices) {
      try {
        const from = reminder.fromName ? `from ${reminder.fromName}` : "";
        const body = [reminder.body, from].filter(Boolean).join(" · ");
        if (await sendPush(deviceId, { title: reminder.title, body, tag: reminder.id })) {
          delivered = true;
        }
      } catch (error) {
        failed++;
        console.error("[push] failed to send reminder", reminder.id, error);
      }
    }
    if (delivered) sent++;
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
    await store.deleteReminder(reminder.id);
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
        title: "Space ✨",
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
