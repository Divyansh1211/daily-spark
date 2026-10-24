"use server";

import { randomUUID } from "node:crypto";
import type { PushSubscription as WebPushSubscription } from "web-push";
import { deviceIdFor, sendPush } from "@/lib/push";
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

export async function subscribeUser(sub: unknown) {
  if (!isSubscription(sub)) throw new Error("Invalid push subscription");
  await store.saveSubscription(deviceIdFor(sub.endpoint), {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
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
