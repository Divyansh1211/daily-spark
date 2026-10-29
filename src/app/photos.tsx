"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { unlockPhotos } from "./actions";
import { Camera, canUseInAppCamera } from "./camera";
import { CameraIcon, ChevronLeftIcon, ChevronRightIcon, ImageIcon, LockIcon, PlusIcon, TrashIcon, XIcon } from "./icons";
import { notifyPhotosChanged, notifyUnlocked, photoUrl, uploadPhoto, usePhotos, type Photo } from "./use-photos";

export function Photos() {
  const state = usePhotos();

  if (state.status === "loading") {
    return (
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton animate-shimmer aspect-square rounded-2xl" />
        ))}
      </div>
    );
  }
  if (state.status === "locked") return <Unlock />;
  if (state.status === "error") {
    return (
      <div className="animate-rise rounded-3xl border border-line bg-card p-6 text-sm">
        Couldn&apos;t load photos. Check your connection and try again.
      </div>
    );
  }
  return <Gallery photos={state.photos} />;
}

export function Unlock({ what = "see and add photos" }: { what?: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await unlockPhotos(code);
      if (result.ok) notifyUnlocked();
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-3xl border border-line bg-card p-6 text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-3xl text-accent">
        <LockIcon />
      </div>
      <h2 className="mt-4 font-serif text-2xl">Just for us</h2>
      <p className="mx-auto mt-1 max-w-64 text-sm text-muted">
        Enter the code once on this phone to {what}.
      </p>
      <input
        required
        autoComplete="off"
        autoCapitalize="none"
        placeholder="Code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="mt-5 w-full rounded-xl border border-line bg-background px-4 py-3 text-center text-base tracking-widest outline-none transition-shadow placeholder:tracking-normal placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
      />
      <button type="submit" disabled={busy} className={`${primaryButton} mt-3 w-full`}>
        {busy ? "Checking…" : "Unlock"}
      </button>
      {error && <p className="animate-rise mt-3 text-sm text-red-500">{error}</p>}
    </form>
  );
}

function Gallery({ photos }: { photos: Photo[] }) {
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [camera, setCamera] = useState(false);
  const phoneCamera = useRef<HTMLInputElement>(null);
  // Newest first in the grid.
  const shown = [...photos].reverse();

  function add(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    upload(files);
  }

  function openCamera() {
    if (canUseInAppCamera()) setCamera(true);
    else phoneCamera.current?.click();
  }

  async function upload(files: Blob[]) {
    if (files.length === 0) return;
    setError(null);
    setUploading((n) => n + files.length);
    let failed = 0;
    for (const file of files) {
      try {
        await uploadPhoto(file);
      } catch (err) {
        console.error(err);
        failed++;
      } finally {
        setUploading((n) => n - 1);
        notifyPhotosChanged();
      }
    }
    if (failed) setError(failed === 1 ? "One photo couldn't be uploaded." : `${failed} photos couldn't be uploaded.`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-muted">
          {photos.length === 0 ? "No photos yet" : `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`}
        </p>
        <div className="flex gap-2">
          <button onClick={openCamera} className={`${secondaryButton} inline-flex items-center gap-1.5 py-2.5`}>
            <CameraIcon className="text-base" /> Camera
          </button>
          {/* Fallback when the in-app camera can't run: `capture` opens the phone's camera app. */}
          <input ref={phoneCamera} type="file" accept="image/*" capture="environment" onChange={add} className="sr-only" />
          <label className={`${primaryButton} inline-flex cursor-pointer items-center gap-1.5 py-2.5`}>
            <PlusIcon className="text-base" /> Gallery
            <input type="file" accept="image/*" multiple onChange={add} className="sr-only" />
          </label>
        </div>
      </div>

      {error && <p className="animate-rise px-1 text-sm text-red-500">{error}</p>}

      {shown.length === 0 && uploading === 0 ? (
        <div className="animate-rise rounded-3xl border border-dashed border-line px-6 py-12 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-2xl text-accent">
            <ImageIcon />
          </div>
          <p className="mt-3 text-sm font-medium">Your photos will live here</p>
          <p className="text-xs text-muted">Take one or pick from your library. You&apos;ll both see them.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: uploading }, (_, i) => (
            <li key={`uploading-${i}`} className="skeleton animate-shimmer aspect-square rounded-2xl" />
          ))}
          {shown.map((photo, i) => (
            <li key={photo.id} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} className="animate-rise">
              <button
                onClick={() => setOpen(i)}
                className="block aspect-square w-full overflow-hidden rounded-2xl bg-line transition-transform active:scale-95"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- private images served by our own route */}
                <img src={photoUrl(photo.id, "thumb")} alt="" loading="lazy" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {camera && (
        <Camera
          onCapture={(photo) => upload([photo])}
          onClose={() => setCamera(false)}
          onFallback={() => {
            setCamera(false);
            phoneCamera.current?.click();
          }}
        />
      )}

      {open !== null && shown[open] && (
        <Viewer photos={shown} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function Viewer({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: Photo[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [dragX, setDragX] = useState(0);
  const drag = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null);
  const photo = photos[index];
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  // Swipe left/right to change photo. The photo follows the finger, and resists at either end.
  function onPointerDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, horizontal: null };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // Decide the direction once the finger has moved a little.
    if (d.horizontal === null && Math.hypot(dx, dy) > 8) d.horizontal = Math.abs(dx) > Math.abs(dy);
    if (!d.horizontal) return;
    const atEnd = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext);
    setDragX(atEnd ? dx / 4 : dx);
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (d?.horizontal) {
      const threshold = Math.min(80, window.innerWidth * 0.18);
      if (dragX < -threshold && hasNext) onIndex(index + 1);
      else if (dragX > threshold && hasPrev) onIndex(index - 1);
    }
    setDragX(0);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "ArrowRight" && index < photos.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onIndex, onClose]);

  // Stop the page behind from scrolling while the viewer is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  async function remove() {
    if (!confirming) return setConfirming(true);
    await fetch(`/api/photos/${photo.id}`, { method: "DELETE" });
    onClose();
    notifyPhotosChanged();
  }

  // Rendered into <body>: the tab panels animate with transforms, and a transformed
  // ancestor would pin this "fixed" overlay to the panel instead of the screen.
  return createPortal(
    <div className="animate-fade fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label="Close" className={viewerButton}>
          <XIcon />
        </button>
        <span className="text-xs text-white/60">
          {new Date(photo.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </span>
        <button
          onClick={remove}
          onBlur={() => setConfirming(false)}
          className={`${viewerButton} ${confirming ? "bg-red-500 px-4 text-sm font-medium" : ""}`}
          aria-label="Delete photo"
        >
          {confirming ? "Delete?" : <TrashIcon />}
        </button>
      </div>

      <div
        key={photo.id}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // touch-none: the swipe is ours, not the browser's back/forward or scroll gesture.
        className={`animate-fade relative min-h-0 flex-1 touch-none select-none ${
          dragX === 0 ? "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]" : ""
        }`}
        style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }}
      >
        {/* The thumbnail is usually cached, so it shows instantly while the full photo loads on top. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- private images served by our own route */}
        <img
          src={photoUrl(photo.id, "thumb")}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-contain"
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- private images served by our own route */}
        <img
          src={photoUrl(photo.id, "full")}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-contain"
        />
      </div>

      <div className="flex items-center justify-between px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button
          onClick={() => onIndex(index - 1)}
          disabled={!hasPrev}
          aria-label="Previous photo"
          className={`${viewerButton} disabled:opacity-0`}
        >
          <ChevronLeftIcon />
        </button>
        <span className="text-xs text-white/60">
          {index + 1} / {photos.length}
        </span>
        <button
          onClick={() => onIndex(index + 1)}
          disabled={!hasNext}
          aria-label="Next photo"
          className={`${viewerButton} disabled:opacity-0`}
        >
          <ChevronRightIcon />
        </button>
      </div>
    </div>,
    document.body,
  );
}

const primaryButton =
  "rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-on-accent transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60";
const secondaryButton =
  "rounded-xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent transition-all duration-200 active:scale-[0.98]";
const viewerButton =
  "flex h-10 min-w-10 items-center justify-center rounded-full bg-white/10 text-lg transition-colors active:scale-95";
