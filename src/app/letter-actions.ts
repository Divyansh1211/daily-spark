"use server";

import { after } from "next/server";
import { currentUser, listPeople, type User } from "@/lib/auth";
import { addLetter, deleteLetter, listLetters, markOpened, type Letter } from "@/lib/letters";
import { sendLetterOpenedPush, sendLetterPush } from "@/lib/push";

export async function loadLetters(): Promise<
  { status: "locked" } | { status: "ready"; received: Letter[]; sent: Letter[]; others: User[] }
> {
  const user = await currentUser();
  if (!user) return { status: "locked" };
  return { status: "ready", ...listLetters(user.id), others: listPeople().filter((p) => p.id !== user.id) };
}

/** `opensAt` is when it unlocks (ms), or null to let it be opened straight away. */
export async function writeLetterAction(input: { to: string; title: string; body: string; opensAt: number | null }) {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "Log in first." };
  const to = listPeople().find((p) => p.id === input.to && p.id !== user.id);
  if (!to) return { ok: false as const, error: "Pick who it's for." };
  const title = String(input.title ?? "").trim().slice(0, 60);
  if (!title) return { ok: false as const, error: "Write something on the envelope." };
  const body = String(input.body ?? "").trim().slice(0, 4000);
  if (!body) return { ok: false as const, error: "The letter is empty." };
  const opensAt = input.opensAt === null ? null : Number(input.opensAt);
  if (opensAt !== null && !Number.isFinite(opensAt)) return { ok: false as const, error: "Pick when it opens." };
  // A time that's already passed just means it can be opened now.
  const locked = opensAt !== null && opensAt > Date.now();

  const id = addLetter(user.id, to.id, title, body, locked ? opensAt : null);
  after(() => sendLetterPush(user, to.id, id, title, locked));
  return { ok: true as const };
}

export async function openLetterAction(id: string) {
  const user = await currentUser();
  if (!user || typeof id !== "string") return { ok: false };
  const first = markOpened(id, user.id);
  if (first) after(() => sendLetterOpenedPush(user, first.from, id, first.title));
  return { ok: true };
}

export async function deleteLetterAction(id: string) {
  const user = await currentUser();
  if (!user || typeof id !== "string") return { ok: false };
  deleteLetter(id, user.id);
  return { ok: true };
}
