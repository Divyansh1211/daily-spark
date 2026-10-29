"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RepeatIcon, XIcon } from "./icons";

type Facing = "environment" | "user";

export function canUseInAppCamera() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Full-screen camera that runs inside the page. Opening the phone's camera app instead
 * sends the browser to the background, where low-memory phones close it and the photo is lost.
 * Stays open after each shot so several photos can be taken in a row.
 */
export function Camera({
  onCapture,
  onClose,
  onFallback,
}: {
  onCapture: (photo: Blob) => void;
  onClose: () => void;
  /** Called when the camera can't start, to use the phone's camera app instead. */
  onFallback: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<Facing>("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [taken, setTaken] = useState(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      })
      .then(async (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const el = video.current!;
        el.srcObject = s;
        await el.play();
        setReady(true);
      })
      .catch((e: DOMException) => {
        if (cancelled) return;
        setError(
          e.name === "NotAllowedError"
            ? "Camera access is blocked. Allow it for this app in your phone's settings, or use the phone's camera instead."
            : "Couldn't start the camera.",
        );
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      setReady(false);
    };
  }, [facing]);

  // Stop the page behind from scrolling while the camera is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function shoot() {
    const el = video.current;
    if (!el || !ready || !el.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    const ctx = canvas.getContext("2d")!;
    if (facing === "user") {
      // Save selfies the way they looked in the mirrored preview.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(el, 0, 0);
    canvas.toBlob(
      (blob) => {
        canvas.width = canvas.height = 0;
        if (!blob) return;
        onCapture(blob);
        setTaken((n) => n + 1);
      },
      "image/jpeg",
      0.92,
    );
    setFlash((n) => n + 1);
  }

  // Rendered into <body> so the animated tab panels can't trap the fixed overlay.
  return createPortal(
    <div className="animate-fade fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="relative min-h-0 flex-1">
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          className={`absolute inset-0 size-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`}
        />
        {flash > 0 && <div key={flash} className="flash pointer-events-none absolute inset-0 bg-white" />}
        {!ready && !error && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white/60">Starting camera…</p>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-sm text-white/80">{error}</p>
            <button onClick={onFallback} className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black">
              Use phone camera
            </button>
          </div>
        )}
        <button
          onClick={onClose}
          aria-label="Close camera"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] flex size-10 items-center justify-center rounded-full bg-black/40 text-lg backdrop-blur"
        >
          <XIcon />
        </button>
      </div>

      <div className="flex items-center justify-between px-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
        <span className="w-16 text-xs text-white/70">{taken > 0 && `${taken} saved`}</span>
        <button
          onClick={shoot}
          disabled={!ready}
          aria-label="Take photo"
          className="flex size-18 items-center justify-center rounded-full border-4 border-white/90 transition-transform active:scale-90 disabled:opacity-40"
        >
          <span className="size-14 rounded-full bg-white" />
        </button>
        <button
          onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          aria-label="Switch camera"
          className="flex size-12 items-center justify-center rounded-full bg-white/15 text-xl active:scale-90"
        >
          <RepeatIcon />
        </button>
      </div>
    </div>,
    document.body,
  );
}
