"use server";

import { after } from "next/server";
import { currentUser, listPeople, type User } from "@/lib/auth";
import { sendShelfFinishedPush, sendShelfSuggestionPush } from "@/lib/push";
import { addShelfItem, deleteShelfItem, getShelfItem, listShelf, setShelfStatus } from "@/lib/shelf";
import { isKind, isStatus, kind, type ShelfItem } from "@/lib/shelf-kinds";

export async function loadShelf(): Promise<
  { status: "locked" } | { status: "ready"; items: ShelfItem[]; people: User[]; me: string }
> {
  const user = await currentUser();
  if (!user) return { status: "locked" };
  return { status: "ready", items: listShelf(), people: listPeople(), me: user.id };
}

/** Only https links, so a pasted link can't run script when tapped. */
function cleanLink(input: unknown) {
  const text = String(input ?? "").trim();
  if (!text) return { ok: true as const, link: null };
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if ((url.protocol === "https:" || url.protocol === "http:") && text.length <= 2000) {
      return { ok: true as const, link: url.toString() };
    }
  } catch {}
  return { ok: false as const };
}

/** `forId` is who it's for: yourself, the other person, or null for both of you. */
export async function addShelfAction(input: {
  title: string;
  kind: string;
  status: string;
  forId: string | null;
  link: string;
  note: string;
}) {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "Log in first." };
  const title = String(input.title ?? "").trim().slice(0, 120);
  if (!title) return { ok: false as const, error: "What's it called?" };
  if (!isKind(input.kind)) return { ok: false as const, error: "Pick what it is." };
  if (!isStatus(input.status)) return { ok: false as const, error: "Pick where it goes." };
  const forId = input.forId ?? null;
  if (forId !== null && !listPeople().some((p) => p.id === forId)) return { ok: false as const, error: "Pick who it's for." };
  const link = cleanLink(input.link);
  if (!link.ok) return { ok: false as const, error: "That link doesn't look right." };

  // Suggesting something for someone else always lands in their "Up next".
  const status = forId !== null && forId !== user.id ? "want" : input.status;
  const id = addShelfItem(user.id, {
    title,
    kind: input.kind,
    status,
    owner: forId,
    link: link.link,
    note: String(input.note ?? "").trim().slice(0, 200),
  });
  if (forId !== user.id) {
    const what = `${kind(input.kind).emoji} ${title}`;
    after(() => sendShelfSuggestionPush(user, forId, id, what));
  }
  return { ok: true as const };
}

export async function setShelfStatusAction(id: string, status: string) {
  const user = await currentUser();
  if (!user || typeof id !== "string" || !isStatus(status)) return { ok: false };
  const found = getShelfItem(id);
  if (!found) return { ok: false };
  setShelfStatus(id, status);
  // Let whoever suggested it know it's been read or watched.
  const { item, addedBy } = found;
  if (status === "done" && item.status !== "done" && addedBy && addedBy !== user.id) {
    const k = kind(item.kind);
    after(() => sendShelfFinishedPush(user, addedBy, id, `${k.finished} ${k.emoji} ${item.title}`));
  }
  return { ok: true };
}

export async function deleteShelfAction(id: string) {
  const user = await currentUser();
  if (!user || typeof id !== "string") return { ok: false };
  deleteShelfItem(id);
  return { ok: true };
}
