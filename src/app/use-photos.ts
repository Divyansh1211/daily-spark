"use client";

import { useCallback, useEffect, useState } from "react";

export type Photo = { id: string; at: number };

export type PhotosState =
  | { status: "loading" }
  | { status: "locked" }
  | { status: "error" }
  | { status: "ready"; photos: Photo[] };

// The Photos tab and the Today tab both show photos; this event keeps them in sync.
const CHANGED = "haanji:photos-changed";

export function notifyPhotosChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

// Fired when the access code is entered, so every locked section reloads.
export const UNLOCKED = "haanji:unlocked";

export function notifyUnlocked() {
  window.dispatchEvent(new Event(UNLOCKED));
  notifyPhotosChanged();
}

export function photoUrl(id: string, size: "full" | "thumb") {
  return size === "thumb" ? `/api/photos/${id}?size=thumb` : `/api/photos/${id}`;
}

/** Photos from the server, oldest first, refreshed whenever they change. */
export function usePhotos() {
  const [state, setState] = useState<PhotosState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/photos", { cache: "no-store" });
      if (res.status === 401) return setState({ status: "locked" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const { photos } = (await res.json()) as { photos: Photo[] };
      setState({ status: "ready", photos });
    } catch {
      setState((s) => (s.status === "ready" ? s : { status: "error" }));
    }
  }, []);

  useEffect(() => {
    // Defer the first load so it doesn't set state synchronously inside the effect.
    const first = setTimeout(refresh, 0);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener(CHANGED, refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      window.removeEventListener(CHANGED, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return state;
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

export async function uploadPhoto(file: Blob) {
  const { photo, thumb } = await shrinkPhoto(file);
  const form = new FormData();
  form.append("photo", photo, "photo.jpg");
  form.append("thumb", thumb, "thumb.jpg");
  const res = await fetch("/api/photos", { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}
