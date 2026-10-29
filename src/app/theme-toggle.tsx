"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "./icons";

type Theme = "light" | "dark";

// The choice lives in localStorage; layout.tsx applies it before the first paint.
export const THEME_KEY = "haanji-theme";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function current(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or blocked storage: the theme still applies until the app closes.
  }
  listeners.forEach((l) => l());
}

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme>(subscribe, current, () => "light");
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      onClick={() => apply(next)}
      aria-label={`Switch to ${next} mode`}
      className="flex size-10 items-center justify-center rounded-full border border-line bg-card text-lg text-muted transition-colors hover:text-foreground active:scale-90"
    >
      <span key={theme} className="animate-rise">
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </span>
    </button>
  );
}
