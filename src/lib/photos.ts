import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Photos live on disk next to the data file (or in .data/photos locally):
//   {id}.jpg        full size, resized in the browser to at most 1600px
//   {id}.thumb.jpg  thumbnail for the grid
const DIR =
  process.env.PHOTOS_DIR ??
  (process.env.DATA_FILE
    ? join(dirname(process.env.DATA_FILE), "photos")
    : join(process.cwd(), ".data", "photos"));

export type Photo = { id: string; at: number };

// `${uploadedAtMs}-${8 hex chars}`; also keeps ids safe to use in file paths.
const ID = /^(\d{13})-[0-9a-f]{8}$/;

export function isPhotoId(id: string) {
  return ID.test(id);
}

/** All photos, oldest first. */
export async function listPhotos(): Promise<Photo[]> {
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
    .sort()
    .map((id) => ({ id, at: Number(id.slice(0, 13)) }));
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
}
