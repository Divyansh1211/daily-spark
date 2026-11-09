import "server-only";
import { randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { db } from "./db";
import type { Reaction } from "./reactions";

// Photos live on disk next to the data file (or in .data/photos locally):
//   {id}.jpg        full size, resized in the browser to at most 2560px
//   {id}.thumb.jpg  thumbnail for the grid
const DIR =
  process.env.PHOTOS_DIR ??
  (process.env.DATA_FILE
    ? join(dirname(process.env.DATA_FILE), "photos")
    : join(process.cwd(), ".data", "photos"));

export type Photo = { id: string; at: number; reactions?: Reaction[] };

// `${uploadedAtMs}-${8 hex chars}`; also keeps ids safe to use in file paths.
const ID = /^(\d{13})-[0-9a-f]{8}$/;

export function isPhotoId(id: string) {
  return ID.test(id);
}

/** Every photo id, oldest first. */
async function listPhotoIds() {
  let names: string[];
  try {
    names = await readdir(DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((n) => n.endsWith(".jpg") && !n.endsWith(".thumb.jpg"))
    .map((n) => n.slice(0, -4))
    .filter(isPhotoId)
    .sort();
}

export type PhotoPage = { photos: Photo[]; total: number; next: string | null };

/**
 * Up to `limit` photos, newest first, starting after the photo `before` (the previous page's
 * `next`). Paging by id rather than by offset keeps pages steady while new photos arrive.
 */
export async function listPhotoPage(viewerId: string, before: string | null, limit: number): Promise<PhotoPage> {
  const ids = (await listPhotoIds()).reverse();
  const start = before ? ids.findIndex((id) => id < before) : 0;
  const page = start < 0 ? [] : ids.slice(start, start + limit);
  const more = start >= 0 && start + limit < ids.length;
  return { photos: withReactions(page, viewerId), total: ids.length, next: more ? page[page.length - 1] : null };
}

/** The `n`th photo (oldest first, wrapping around), so each day can show a different one. */
export async function nthPhoto(viewerId: string, n: number): Promise<Photo | null> {
  const ids = await listPhotoIds();
  if (ids.length === 0) return null;
  return withReactions([ids[((n % ids.length) + ids.length) % ids.length]], viewerId)[0];
}

/** Photos for `ids`, with their reactions as `viewerId` sees them. */
function withReactions(ids: string[], viewerId: string): Photo[] {
  if (ids.length === 0) return [];
  const rows = db()
    .prepare(
      `SELECT r.photo_id, r.user_id, r.emoji, u.name FROM photo_reactions r
       JOIN users u ON u.id = r.user_id
       WHERE r.photo_id IN (${ids.map(() => "?").join(", ")}) ORDER BY r.created_at`,
    )
    .all(...ids) as { photo_id: string; user_id: string; emoji: string; name: string }[];
  const byPhoto = new Map<string, Reaction[]>();
  for (const r of rows) {
    const list = byPhoto.get(r.photo_id) ?? [];
    list.push({ emoji: r.emoji, name: r.name, mine: r.user_id === viewerId });
    byPhoto.set(r.photo_id, list);
  }
  return ids.map((id) => ({ id, at: Number(id.slice(0, 13)), reactions: byPhoto.get(id) ?? [] }));
}

export async function photoExists(id: string) {
  if (!isPhotoId(id)) return false;
  return access(join(DIR, `${id}.jpg`)).then(
    () => true,
    () => false,
  );
}

/** Sets the person's reaction to a photo, replacing any earlier one; null removes it. */
export function setReaction(photoId: string, userId: string, emoji: string | null) {
  if (emoji === null) {
    db().prepare("DELETE FROM photo_reactions WHERE photo_id = ? AND user_id = ?").run(photoId, userId);
    return;
  }
  db()
    .prepare(
      `INSERT INTO photo_reactions (photo_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (photo_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
    )
    .run(photoId, userId, emoji, Date.now());
}

export async function savePhoto(full: Buffer, thumb: Buffer): Promise<Photo> {
  const at = Date.now();
  const id = `${at}-${randomBytes(4).toString("hex")}`;
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${id}.thumb.jpg`), thumb);
  // Written last: a photo only shows up in the list once both files exist.
  await writeFile(join(DIR, `${id}.jpg`), full);
  return { id, at };
}

export async function readPhoto(id: string, size: "full" | "thumb") {
  if (!isPhotoId(id)) return null;
  try {
    return await readFile(join(DIR, size === "thumb" ? `${id}.thumb.jpg` : `${id}.jpg`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function deletePhoto(id: string) {
  if (!isPhotoId(id)) return;
  await rm(join(DIR, `${id}.jpg`), { force: true });
  await rm(join(DIR, `${id}.thumb.jpg`), { force: true });
  db().prepare("DELETE FROM photo_reactions WHERE photo_id = ?").run(id);
}
