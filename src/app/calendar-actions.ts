"use server";

import { currentUser } from "@/lib/auth";
import {
  addEvent,
  addFeed,
  anyFeedStale,
  deleteEvent,
  listEvents,
  listFeeds,
  listPeople,
  normaliseFeedUrl,
  removeFeed,
  syncStaleFeeds,
  type CalendarEvent,
  type Feed,
} from "@/lib/calendar";

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
    addEvent(user.id, { title, start, end: start + DAY, allDay: true });
  } else {
    const { start, end } = input;
    if (!isTime(start) || !isTime(end)) return { ok: false as const, error: "Pick a time." };
    if (end <= start || end - start > 7 * DAY) return { ok: false as const, error: "Check the start and end times." };
    addEvent(user.id, { title, start, end, allDay: false });
  }
  return { ok: true as const };
}

export async function deleteEventAction(id: string) {
  const user = await currentUser();
  if (!user || typeof id !== "string") return { ok: false };
  deleteEvent(user.id, id);
  return { ok: true };
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
