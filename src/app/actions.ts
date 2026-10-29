"use server";

import { randomUUID } from "node:crypto";
import type { PushSubscription as WebPushSubscription } from "web-push";
import { grantAccess } from "@/lib/access";
import { deviceIdFor, localDate, sendPush } from "@/lib/push";
import { store, type Reminder, type Repeat } from "@/lib/store";

export type ReminderView = Pick<Reminder, "id" | "title" | "body" | "at" | "repeat">;

function isSubscription(value: unknown): value is WebPushSubscription {
  const sub = value as WebPushSubscription;
  return (
    typeof sub?.endpoint === "string" &&
    sub.endpoint.startsWith("https://") &&
    typeof sub.keys?.p256dh === "string" &&
    typeof sub.keys?.auth === "string"
  );
}

function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Saves the device's push subscription and turns on the daily quote. */
export async function subscribeUser(sub: unknown, timeZone: string) {
  if (!isSubscription(sub)) throw new Error("Invalid push subscription");
  const deviceId = deviceIdFor(sub.endpoint);
  await store.saveSubscription(deviceId, {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  if (isTimeZone(timeZone) && !(await store.getDailyQuote(deviceId))) {
    // Today counts as sent, so the first quote arrives when the next day starts.
    await store.setDailyQuote(deviceId, { timeZone, lastSent: localDate(Date.now(), timeZone) });
  }
  return { ok: true };
}

export async function unsubscribeUser(endpoint: string) {
  await store.deleteDevice(deviceIdFor(endpoint));
  return { ok: true };
}

export async function sendTestNotification(endpoint: string, message: string) {
  const delivered = await sendPush(deviceIdFor(endpoint), {
    title: "Test notification",
    body: message.trim().slice(0, 200) || "Push notifications are working 🎉",
  });
  return { ok: delivered };
}

export async function scheduleReminder(input: {
  endpoint: string;
  title: string;
  body: string;
  at: number;
  repeat: Repeat;
}) {
  const deviceId = deviceIdFor(input.endpoint);
  if (!(await store.getSubscription(deviceId))) {
    return { ok: false as const, error: "Enable notifications first." };
  }

  const title = input.title.trim().slice(0, 80);
  const body = input.body.trim().slice(0, 200);
  if (!title) return { ok: false as const, error: "Give the reminder a title." };
  if (!Number.isFinite(input.at) || input.at < Date.now() - 60_000) {
    return { ok: false as const, error: "Pick a time in the future." };
  }
  if (input.repeat !== "none" && input.repeat !== "daily") {
    return { ok: false as const, error: "Invalid repeat option." };
  }

  await store.saveReminder({
    id: randomUUID(),
    deviceId,
    title,
    body,
    at: input.at,
    repeat: input.repeat,
  });
  return { ok: true as const };
}

export async function listReminders(endpoint: string): Promise<ReminderView[]> {
  const reminders = await store.listReminders(deviceIdFor(endpoint));
  return reminders.map(({ id, title, body, at, repeat }) => ({ id, title, body, at, repeat }));
}

export async function deleteReminder(endpoint: string, id: string) {
  await store.deleteReminder(deviceIdFor(endpoint), id);
  return { ok: true };
}

export async function getDailyQuote(endpoint: string) {
  return (await store.getDailyQuote(deviceIdFor(endpoint))) !== null;
}

export async function setDailyQuote(endpoint: string, enabled: boolean, timeZone: string) {
  const deviceId = deviceIdFor(endpoint);
  if (!(await store.getSubscription(deviceId))) return { ok: false };
  if (!enabled) {
    await store.setDailyQuote(deviceId, null);
    return { ok: true };
  }
  if (!isTimeZone(timeZone)) return { ok: false };
  await store.setDailyQuote(deviceId, { timeZone, lastSent: localDate(Date.now(), timeZone) });
  return { ok: true };
}

export async function unlockPhotos(code: string) {
  if (typeof code !== "string" || code.length > 100) {
    return { ok: false as const, error: "That code isn't right." };
  }
  return grantAccess(code);
}
