"use server";

import type { PushSubscription as WebPushSubscription } from "web-push";
import { currentUser, listPeople, type User } from "@/lib/auth";
import { deviceIdFor, localDate, sendPush } from "@/lib/push";
import { createReminders } from "@/lib/reminders";
import { store, type Reminder, type Repeat } from "@/lib/store";

export type ReminderView = Pick<Reminder, "id" | "title" | "body" | "at" | "repeat"> & {
  /** Set when it's for someone else. */
  forName: string | null;
  /** Set when someone else set it for you. */
  fromName: string | null;
};

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

async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("Not logged in");
  return user;
}

/**
 * Saves the device's push subscription for the logged-in person and turns on the daily quote.
 * Also called when the app opens, to link devices that turned notifications on before accounts.
 */
export async function subscribeUser(sub: unknown, timeZone: string) {
  const user = await requireUser();
  if (!isSubscription(sub)) throw new Error("Invalid push subscription");
  const deviceId = deviceIdFor(sub.endpoint);
  await store.saveSubscription(
    deviceId,
    { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    user.id,
  );
  await store.claimReminders(deviceId, user.id);
  if (isTimeZone(timeZone) && !(await store.getDailyQuote(deviceId))) {
    // Today counts as sent, so the first quote arrives when the next day starts.
    await store.setDailyQuote(deviceId, { timeZone, lastSent: localDate(Date.now(), timeZone) });
  }
  return { ok: true };
}

export async function unsubscribeUser(endpoint: string) {
  await requireUser();
  await store.deleteDevice(deviceIdFor(endpoint));
  return { ok: true };
}

export async function sendTestNotification(endpoint: string, message: string) {
  await requireUser();
  const delivered = await sendPush(deviceIdFor(endpoint), {
    title: "Test notification",
    body: message.trim().slice(0, 200) || "Push notifications are working 🎉",
  });
  return { ok: delivered };
}

/** `to` is the user ids to remind: yourself, the other person, or both. */
export async function scheduleReminder(input: { title: string; body: string; at: number; repeat: Repeat; to: string[] }) {
  return createReminders(await requireUser(), input);
}

export async function listReminders(): Promise<{ me: string; people: User[]; reminders: ReminderView[] }> {
  const user = await requireUser();
  const people = listPeople();
  const name = (id: string | undefined) => people.find((p) => p.id === id)?.name ?? "Someone";
  const reminders = (await store.listReminders(user.id)).map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    at: r.at,
    repeat: r.repeat,
    forName: r.userId !== user.id ? name(r.userId) : null,
    fromName: r.userId === user.id && r.createdBy ? name(r.createdBy) : null,
  }));
  return { me: user.id, people, reminders };
}

export async function deleteReminder(id: string) {
  if (typeof id !== "string") return { ok: false };
  await store.deleteReminder(id, (await requireUser()).id);
  return { ok: true };
}

export async function getDailyQuote(endpoint: string) {
  await requireUser();
  return (await store.getDailyQuote(deviceIdFor(endpoint))) !== null;
}

export async function setDailyQuote(endpoint: string, enabled: boolean, timeZone: string) {
  await requireUser();
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
