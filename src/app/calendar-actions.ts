"use server";

import { currentUser, listPeople } from "@/lib/auth";
import {
  addEvent,
  addFeed,
  anyFeedStale,
  deleteEvent,
  getEvent,
  listEvents,
  listFeeds,
  normaliseFeedUrl,
  removeFeed,
  syncStaleFeeds,
  type CalendarEvent,
  type Feed,
} from "@/lib/calendar";
import { createReminders } from "@/lib/reminders";
import { store } from "@/lib/store";

const DAY = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type CalendarData = {
  me: string;
  people: { id: string; name: string }[];
  events: CalendarEvent[];
  feeds: Feed[];
  /** A linked calendar is due a refresh; call syncCalendarsAction and load again. */
  stale: boolean;
};

const isTime = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Everyone's events between two times (the month grid on screen). */
export async function loadCalendar(
  from: number,
  to: number,
): Promise<{ status: "locked" } | { status: "ready"; data: CalendarData }> {
  const user = await currentUser();
  if (!user) return { status: "locked" };
  if (!isTime(from) || !isTime(to) || to <= from || to - from > 50 * DAY) throw new Error("Invalid range");
  return {
    status: "ready",
    data: {
      me: user.id,
      people: listPeople(),
      events: listEvents(from, to),
      feeds: listFeeds(user.id),
      stale: anyFeedStale(),
    },
  };
}

export async function syncCalendarsAction() {
  if (!(await currentUser())) return;
  await syncStaleFeeds();
}

/**
 * All-day events send their date; timed ones send start and end as ms, worked out on the
 * phone so they're in its time zone.
 */
export async function addEventAction(input: { title: string; allDay: boolean; date: string; start: number; end: number }) {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "Log in first." };
  const title = String(input.title ?? "").trim().slice(0, 120);
  if (!title) return { ok: false as const, error: "Give it a name." };

  if (input.allDay) {
    if (!DATE.test(input.date)) return { ok: false as const, error: "Pick a date." };
    const [y, m, d] = input.date.split("-").map(Number);
    const start = Date.UTC(y, m - 1, d);
    return { ok: true as const, id: addEvent(user.id, { title, start, end: start + DAY, allDay: true }) };
  }
  const { start, end } = input;
  if (!isTime(start) || !isTime(end)) return { ok: false as const, error: "Pick a time." };
  if (end <= start || end - start > 7 * DAY) return { ok: false as const, error: "Check the start and end times." };
  return { ok: true as const, id: addEvent(user.id, { title, start, end, allDay: false }) };
}

export async function deleteEventAction(id: string) {
  const user = await currentUser();
  if (!user || typeof id !== "string") return { ok: false };
  if (deleteEvent(user.id, id)) await store.deleteEventReminders(id);
  return { ok: true };
}

/**
 * A reminder about an event, for you, the other person or both. The phone works out `at` and
 * the text ("Starts at 6:00 PM") since it knows the local time.
 */
export async function remindAboutEventAction(input: { eventId: string; at: number; body: string; to: string[] }) {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "Log in first." };
  const event = typeof input.eventId === "string" ? getEvent(input.eventId) : null;
  if (!event) return { ok: false as const, error: "That event is gone." };
  if (isTime(input.at) && input.at > event.end) return { ok: false as const, error: "That's after the event ends." };
  return createReminders(user, {
    title: event.title,
    body: input.body,
    at: input.at,
    repeat: "none",
    to: input.to,
    // Linked events are copied afresh on every sync, so their ids don't last.
    eventId: event.linked ? undefined : input.eventId,
  });
}

export async function addFeedAction(link: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "Log in first." };
  const url = normaliseFeedUrl(link);
  if (!url) return { ok: false as const, error: "Paste the full link, starting with https:// or webcal://." };
  return addFeed(user.id, url);
}

export async function removeFeedAction(id: string) {
  const user = await currentUser();
  if (!user || typeof id !== "string") return { ok: false };
  removeFeed(user.id, id);
  return { ok: true };
}
