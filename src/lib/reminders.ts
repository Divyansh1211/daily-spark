import "server-only";
import { randomUUID } from "node:crypto";
import { listPeople, type User } from "./auth";
import { store, type Repeat } from "./store";

export type NewReminder = {
  title: string;
  body: string;
  at: number;
  repeat: Repeat;
  /** User ids; the person setting it, the other person, or both. */
  to: string[];
  eventId?: string;
};

export type ReminderResult = { ok: true; warning?: string } | { ok: false; error: string };

/** Schedules one reminder per person in `to`. */
export async function createReminders(from: User, input: NewReminder): Promise<ReminderResult> {
  const title = String(input.title ?? "").trim().slice(0, 80);
  const body = String(input.body ?? "").trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the reminder a title." };
  if (!Number.isFinite(input.at) || input.at < Date.now() - 60_000) {
    return { ok: false, error: "Pick a time in the future." };
  }
  if (input.repeat !== "none" && input.repeat !== "daily") return { ok: false, error: "Invalid repeat option." };

  const people = new Map(listPeople().map((p) => [p.id, p]));
  const to = [...new Set(Array.isArray(input.to) ? input.to : [])].filter((id) => people.has(id));
  if (to.length === 0) return { ok: false, error: "Pick who to remind." };

  // Without notifications on, your own reminder could never arrive, so ask first. Someone
  // else's is kept: it reaches them if they turn notifications on before it's due.
  const offline: string[] = [];
  for (const id of to) {
    if ((await store.listUserDevices(id)).length > 0) continue;
    if (id === from.id) return { ok: false, error: "Turn on notifications in Reminders first." };
    offline.push(people.get(id)!.name);
  }

  for (const id of to) {
    const forSomeoneElse = id !== from.id;
    await store.saveReminder({
      id: randomUUID(),
      userId: id,
      ...(forSomeoneElse ? { createdBy: from.id, fromName: from.name } : {}),
      ...(input.eventId ? { eventId: input.eventId } : {}),
      title,
      body,
      at: input.at,
      repeat: input.repeat,
    });
  }

  const warning =
    offline.length > 0
      ? `${offline.join(" and ")} hasn't turned on notifications yet, so it'll only reach them once they do.`
      : undefined;
  return { ok: true, warning };
}
