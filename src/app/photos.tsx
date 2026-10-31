"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { SignedOut } from "./auth-screen";
import { Camera, canUseInAppCamera } from "./camera";
import { CameraIcon, ChevronLeftIcon, ChevronRightIcon, ImageIcon, PlusIcon, TrashIcon, XIcon } from "./icons";
import { notifyPhotosChanged, photoUrl, uploadPhoto, usePhotos, type Photo } from "./use-photos";

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
  if (state.status === "locked") return <SignedOut />;
  if (state.status === "error") {
    return (
      <div className="animate-rise rounded-3xl border border-line bg-card p-6 text-sm">
        Couldn&apos;t load photos. Check your connection and try again.
      </div>
    );
  }
  return <Gallery photos={state.photos} />;
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
  const photo = photos[index];
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

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

      <PhotoStage
        key={photo.id}
        photo={photo}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={() => onIndex(index - 1)}
        onNext={() => onIndex(index + 1)}
      />

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

type Point = { x: number; y: number };
type View = { scale: number; x: number; y: number };
type Gesture =
  | { kind: "swipe"; start: Point; horizontal: boolean | null }
  | { kind: "pan"; start: Point; from: View }
  | { kind: "pinch"; distance: number; scale: number; anchor: Point };

const unzoomed: View = { scale: 1, x: 0, y: 0 };
const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;

// One photo in the viewer. Swipe to change photo, pinch or double-tap to zoom, drag to look
// around while zoomed. Keyed by photo, so the zoom resets when the photo changes.
function PhotoStage({
  photo,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  photo: Photo;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [view, setViewState] = useState(unzoomed);
  const current = useRef(unzoomed);
  const [dragX, setDragX] = useState(0);
  // While a finger is down the photo follows it exactly; afterwards it eases into place.
  const [touching, setTouching] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const tap = useRef<{ at: number; point: Point; moved: boolean } | null>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);

  function setView(next: View) {
    current.current = next;
    setViewState(next);
  }

  // Pointer position relative to the middle of the stage, which is where the zoom is anchored.
  function local(e: { clientX: number; clientY: number }): Point {
    const rect = stage.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };
  }

  // Keep the photo covering the screen: no panning past its edges, never smaller than fitted.
  function settle(v: View): View {
    const scale = Math.min(MAX_ZOOM, Math.max(1, v.scale));
    if (scale < 1.05) return unzoomed;
    const rect = stage.current!.getBoundingClientRect();
    const img = image.current;
    const fit =
      img && img.naturalWidth
        ? Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight)
        : 0;
    const width = fit ? img!.naturalWidth * fit : rect.width;
    const height = fit ? img!.naturalHeight * fit : rect.height;
    const maxX = Math.max(0, (width * scale - rect.width) / 2);
    const maxY = Math.max(0, (height * scale - rect.height) / 2);
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, v.x)),
      y: Math.min(maxY, Math.max(-maxY, v.y)),
    };
  }

  // Zoom to `scale`, keeping the spot under `at` where it is.
  function zoomAt(at: Point, scale: number, from = current.current): View {
    const anchor = { x: (at.x - from.x) / from.scale, y: (at.y - from.y) / from.scale };
    return { scale, x: at.x - anchor.x * scale, y: at.y - anchor.y * scale };
  }

  function startPinch() {
    const [a, b] = [...pointers.current.values()];
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const v = current.current;
    gesture.current = {
      kind: "pinch",
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      scale: v.scale,
      anchor: { x: (middle.x - v.x) / v.scale, y: (middle.y - v.y) / v.scale },
    };
    setDragX(0);
  }

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = local(e);
    pointers.current.set(e.pointerId, point);
    setTouching(true);
    if (pointers.current.size === 2) {
      tap.current = null;
      startPinch();
    } else if (pointers.current.size === 1) {
      tap.current = { at: Date.now(), point, moved: false };
      gesture.current =
        current.current.scale > 1
          ? { kind: "pan", start: point, from: current.current }
          : { kind: "swipe", start: point, horizontal: null };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    const point = local(e);
    pointers.current.set(e.pointerId, point);
    const g = gesture.current;
    if (tap.current && Math.hypot(point.x - tap.current.point.x, point.y - tap.current.point.y) > 8) {
      tap.current.moved = true;
    }

    if (g?.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // A little give past the limits, so it feels elastic rather than stuck.
      const raw = (g.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.distance;
      const scale = raw < 1 ? 1 - (1 - raw) / 3 : raw > MAX_ZOOM ? MAX_ZOOM + (raw - MAX_ZOOM) / 3 : raw;
      setView({ scale, x: middle.x - g.anchor.x * scale, y: middle.y - g.anchor.y * scale });
    } else if (g?.kind === "pan") {
      setView(settle({ ...g.from, x: g.from.x + point.x - g.start.x, y: g.from.y + point.y - g.start.y }));
    } else if (g?.kind === "swipe") {
      const dx = point.x - g.start.x;
      const dy = point.y - g.start.y;
      // Decide the direction once the finger has moved a little.
      if (g.horizontal === null && Math.hypot(dx, dy) > 8) g.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!g.horizontal) return;
      const atEnd = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext);
      setDragX(atEnd ? dx / 4 : dx);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;

    if (g?.kind === "swipe" && g.horizontal) {
      const threshold = Math.min(80, window.innerWidth * 0.18);
      if (dragX < -threshold && hasNext) onNext();
      else if (dragX > threshold && hasPrev) onPrev();
    }

    if (pointers.current.size === 1) {
      // One finger lifted from a pinch: carry on panning with the other.
      const [point] = pointers.current.values();
      const settled = settle(current.current);
      gesture.current = { kind: "pan", start: point, from: settled };
      setView(settled);
      return;
    }
    if (pointers.current.size > 0) return;

    gesture.current = null;
    setTouching(false);
    setDragX(0);
    setView(settle(current.current));

    // Double-tap zooms in on that spot, or back out.
    const t = tap.current;
    tap.current = null;
    if (e.type !== "pointerup" || !t || t.moved || Date.now() - t.at > 300) return;
    const last = lastTap.current;
    if (last && Date.now() - last.at < 350 && Math.hypot(t.point.x - last.point.x, t.point.y - last.point.y) < 40) {
      lastTap.current = null;
      setView(current.current.scale > 1 ? unzoomed : settle(zoomAt(t.point, DOUBLE_TAP_ZOOM, unzoomed)));
    } else {
      lastTap.current = { at: Date.now(), point: t.point };
    }
  }

  // Trackpad pinch and the mouse wheel zoom too. Added by hand: React's wheel listener is passive.
  useEffect(() => {
    const el = stage.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scale = current.current.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      setView(settle(zoomAt(local(e), Math.min(MAX_ZOOM, Math.max(1, scale)))));
    };
    // Safari's own pinch would zoom the whole page instead of the photo.
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", stop);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", stop);
    };
  }, []);

  const zoomed = view.scale !== 1 || view.x !== 0 || view.y !== 0;
  const ease = "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]";

  return (
    <div
      ref={stage}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // touch-none: the gestures are ours, not the browser's back/forward, scroll or page zoom.
      className={`animate-fade relative min-h-0 flex-1 touch-none overflow-hidden select-none ${
        dragX === 0 ? ease : ""
      }`}
      style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }}
    >
      <div
        className={`absolute inset-0 ${touching ? "" : ease}`}
        style={{ transform: zoomed ? `translate(${view.x}px, ${view.y}px) scale(${view.scale})` : undefined }}
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
          ref={image}
          src={photoUrl(photo.id, "full")}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-contain"
        />
      </div>
    </div>
  );
}

const primaryButton =
  "rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-on-accent transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60";
const secondaryButton =
  "rounded-xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent transition-all duration-200 active:scale-[0.98]";
const viewerButton =
  "flex h-10 min-w-10 items-center justify-center rounded-full bg-white/10 text-lg transition-colors active:scale-95";
