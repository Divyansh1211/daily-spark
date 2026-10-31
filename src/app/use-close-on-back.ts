"use client";

import { useEffect, useRef } from "react";

/**
 * Makes the phone's back button (or back swipe) close a full-screen overlay instead of leaving
 * the app. Opening the overlay adds a history entry; going back pops it and calls `onClose`.
 * Closing it any other way (the X button) removes that entry again.
 */
export function useCloseOnBack(onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const id = Math.random().toString(36).slice(2);
    // Keeps the router's own state in the entry: Next.js reloads the page on entries without it.
    history.pushState({ ...history.state, overlay: id }, "");
    let popped = false;
    const onPop = () => {
      // Still on this overlay's entry (e.g. a forward navigation back onto it): nothing to do.
      if (history.state?.overlay === id) return;
      popped = true;
      close.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!popped && history.state?.overlay === id) history.back();
    };
  }, []);
}
