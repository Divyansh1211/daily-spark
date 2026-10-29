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

/**
 * Shrinks a photo in the browser and re-encodes it as JPEG. Drawing through an <img>
 * applies the camera's EXIF rotation, and it turns iPhone HEIC photos into JPEG.
 */
export async function resizeImage(file: Blob, maxSide: number, quality: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode photo"))), "image/jpeg", quality),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadPhoto(file: File) {
  const [photo, thumb] = await Promise.all([resizeImage(file, 1600, 0.85), resizeImage(file, 480, 0.8)]);
  const form = new FormData();
  form.append("photo", photo, "photo.jpg");
  form.append("thumb", thumb, "thumb.jpg");
  const res = await fetch("/api/photos", { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}
