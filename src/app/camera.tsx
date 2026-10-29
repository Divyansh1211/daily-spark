"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, RepeatIcon, XIcon } from "./icons";

type Facing = "environment" | "user";

// Chrome on Android can take a real still photo (full resolution, the camera's own
// processing) instead of a frame grabbed from the video preview. Not in Safari.
type ImageCaptureLike = { takePhoto(): Promise<Blob> };
declare const ImageCapture: { new (track: MediaStreamTrack): ImageCaptureLike } | undefined;

export function canUseInAppCamera() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Full-screen camera that runs inside the page. Opening the phone's camera app instead
 * sends the browser to the background, where low-memory phones close it and the photo is lost.
 * Each shot is shown for a Send / Retake choice, and the camera stays open afterwards.
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
  const track = useRef<MediaStreamTrack | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [shooting, setShooting] = useState(false);
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
        // Ask for the sharpest preview the camera offers; it picks the closest it supports.
        video: { facingMode: facing, width: { ideal: 4032 }, height: { ideal: 3024 } },
        audio: false,
      })
      .then(async (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        track.current = s.getVideoTracks()[0] ?? null;
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
      track.current = null;
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

  /** A frame from the live preview, for browsers without a still-photo API. */
  function grabFrame() {
    const el = video.current!;
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
    return new Promise<Blob | null>((resolve) =>
      canvas.toBlob(
        (blob) => {
          canvas.width = canvas.height = 0;
          resolve(blob);
        },
        "image/jpeg",
        0.95,
      ),
    );
  }

  async function shoot() {
    const el = video.current;
    if (!el || !ready || !el.videoWidth || shooting) return;
    setShooting(true);
    setFlash((n) => n + 1);
    try {
      let blob: Blob | null = null;
      if (typeof ImageCapture !== "undefined" && track.current) {
        blob = await new ImageCapture(track.current).takePhoto().catch(() => null);
      }
      blob ??= await grabFrame();
      if (blob) setShot({ blob, url: URL.createObjectURL(blob) });
    } finally {
      setShooting(false);
    }
  }

  function retake() {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
  }

  function send() {
    if (!shot) return;
    onCapture(shot.blob);
    setTaken((n) => n + 1);
    retake();
  }

  // Free the preview image if the camera closes while one is showing.
  useEffect(() => () => void (shot && URL.revokeObjectURL(shot.url)), [shot]);

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
        {shot && (
          // eslint-disable-next-line @next/next/no-img-element -- local preview of the photo just taken
          <img src={shot.url} alt="Photo just taken" className="animate-fade absolute inset-0 size-full bg-black object-contain" />
        )}
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

      {shot ? (
        <div className="flex items-center justify-between gap-3 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
          <button onClick={retake} className="flex-1 rounded-xl bg-white/15 py-3.5 text-sm font-semibold active:scale-95">
            Retake
          </button>
          <button
            onClick={send}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-3.5 text-sm font-semibold text-black active:scale-95"
          >
            <CheckIcon /> Send
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between px-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
          <span className="w-16 text-xs text-white/70">{taken > 0 && `${taken} sent`}</span>
          <button
            onClick={shoot}
            disabled={!ready || shooting}
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
      )}
    </div>,
    document.body,
  );
}
