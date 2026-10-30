"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { User } from "@/lib/auth";
import { logoutAction } from "./auth-actions";

/** The person's initial in the header; tapping it shows who is logged in and a log out button. */
export function AccountMenu({ user }: { user: User }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const menu = useRef<HTMLDivElement>(null);

  // Close when tapping anywhere else.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  async function logOut() {
    setBusy(true);
    await logoutAction();
    startTransition(() => router.refresh());
  }

  return (
    <div ref={menu} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account"
        aria-expanded={open}
        className="flex size-10 items-center justify-center rounded-full border border-line bg-accent-soft font-serif text-xl text-accent active:scale-90"
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="animate-rise absolute right-0 top-12 z-30 w-56 rounded-2xl border border-line bg-card p-4 shadow-lg">
          <p className="text-xs text-muted">Logged in as</p>
          <p className="truncate font-medium">{user.name}</p>
          <button
            onClick={logOut}
            disabled={busy}
            className="mt-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium text-red-500 ring-1 ring-inset ring-line transition-colors hover:bg-red-500/10 active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? "Logging out…" : "Log out"}
          </button>
        </div>
      )}
    </div>
  );
}
