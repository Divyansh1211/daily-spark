"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Reaction } from "@/lib/reactions";

export type Photo = { id: string; at: number; reactions?: Reaction[] };

export type PhotosState =
  | { status: "loading" }
  | { status: "locked" }
  | { status: "error" }
  | { status: "ready"; photos: Photo[]; total: number; hasMore: boolean };

type PhotoPage = { photos: Photo[]; total: number; next: string | null };

const PAGE = 60;

// The Photos tab and the Today tab both show photos; this event keeps them in sync.
const CHANGED = "haanji:photos-changed";

export function notifyPhotosChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

export function photoUrl(id: string, size: "full" | "thumb") {
  return size === "thumb" ? `/api/photos/${id}?size=thumb` : `/api/photos/${id}`;
}

/** Runs `load` now, whenever photos change, and whenever the app comes back to the foreground. */
function useReloadOnChange(load: () => void) {
  useEffect(() => {
    // Deferred so it doesn't set state synchronously inside the effect.
    const first = setTimeout(load, 0);
    const onVisible = () => document.visibilityState === "visible" && load();
    window.addEventListener(CHANGED, load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      window.removeEventListener(CHANGED, load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);
}

/** Photos from the server, newest first, a page at a time; `loadMore` fetches the next page. */
export function usePhotos() {
  const [state, setState] = useState<PhotosState>({ status: "loading" });
  // How many photos are loaded, so a refresh keeps the pages already scrolled through.
  const loaded = useRef(PAGE);
  const next = useRef<string | null>(null);
  const loadingMore = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/photos?limit=${loaded.current}`, { cache: "no-store" });
      if (res.status === 401) return setState({ status: "locked" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const page = (await res.json()) as PhotoPage;
      next.current = page.next;
      setState({ status: "ready", photos: page.photos, total: page.total, hasMore: page.next !== null });
    } catch {
      setState((s) => (s.status === "ready" ? s : { status: "error" }));
    }
  }, []);

  const loadMore = useCallback(async () => {
    const before = next.current;
    if (!before || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const res = await fetch(`/api/photos?limit=${PAGE}&before=${before}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const page = (await res.json()) as PhotoPage;
      // A refresh that ended somewhere else in the meantime makes this page stale.
      if (next.current !== before) return;
      next.current = page.next;
      loaded.current += page.photos.length;
      setState((s) => {
        if (s.status !== "ready") return s;
        const have = new Set(s.photos.map((p) => p.id));
        const photos = [...s.photos, ...page.photos.filter((p) => !have.has(p.id))];
        return { status: "ready", photos, total: page.total, hasMore: page.next !== null };
      });
    } catch {
      // Left as it was; scrolling to the end again retries.
    } finally {
      loadingMore.current = false;
    }
  }, []);

  useReloadOnChange(refresh);
  return { state, loadMore };
}

/** One photo for the day number `day`, a different one each day; null when there are none (or no access). */
export function usePhotoOfTheDay(day: number) {
  const [photo, setPhoto] = useState<Photo | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/photos?nth=${day}`, { cache: "no-store" });
      if (res.status === 401) return setPhoto(null);
      if (res.ok) setPhoto(((await res.json()) as { photo: Photo | null }).photo);
    } catch {
      // Keeps showing the last one.
    }
  }, [day]);

  useReloadOnChange(load);
  return photo;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode photo"))), "image/jpeg", quality),
  );
}

/** Draws `source` into a new canvas whose longest side is at most `maxSide`. */
function scaled(source: CanvasImageSource, width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Makes the upload-sized photo and its thumbnail as JPEGs. Drawing through an <img> applies
 * the camera's EXIF rotation and turns iPhone HEIC photos into JPEG.
 *
 * Phone photos can be 50 megapixels (~200 MB once decoded), and running out of memory makes
 * the phone kill the page, so the original is decoded once and released straight away, and
 * the thumbnail is made from the already-shrunk copy.
 */
export async function shrinkPhoto(file: Blob) {
  const url = URL.createObjectURL(file);
  let full: HTMLCanvasElement;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    full = scaled(img, img.naturalWidth, img.naturalHeight, 2560);
    img.src = "";
  } finally {
    URL.revokeObjectURL(url);
  }
  const thumb = scaled(full, full.width, full.height, 480);
  try {
    return { photo: await toJpeg(full, 0.9), thumb: await toJpeg(thumb, 0.8) };
  } finally {
    // Zero-sized canvases give their pixel memory back immediately (Safari holds on otherwise).
    full.width = full.height = thumb.width = thumb.height = 0;
  }
}

export async function reactToPhoto(id: string, emoji: string | null) {
  const res = await fetch(`/api/photos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok) throw new Error(`Reaction failed: ${res.status}`);
}

/**
 * Saves the full photo. On iPhone that's the share sheet, whose "Save Image" puts it in Photos
 * (a plain download only reaches the Files app, and does nothing in a home-screen app).
 */
export async function downloadPhoto(photo: Photo) {
  const res = await fetch(photoUrl(photo.id, "full"));
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  // The local date it was added, e.g. space-2026-11-01.jpg (sv-SE writes dates as YYYY-MM-DD).
  const name = `space-${new Date(photo.at).toLocaleDateString("sv-SE")}.jpg`;
  const file = new File([await res.blob()], name, { type: "image/jpeg" });
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (apple && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      // Closing the share sheet isn't a failure.
      if ((error as DOMException).name !== "AbortError") throw error;
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function uploadPhoto(file: Blob) {
  const { photo, thumb } = await shrinkPhoto(file);
  const form = new FormData();
  form.append("photo", photo, "photo.jpg");
  form.append("thumb", thumb, "thumb.jpg");
  const res = await fetch("/api/photos", { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}
