"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { loginAction, registerAction } from "./auth-actions";

type Mode = "login" | "register";

/** Shown before the app until the person logs in or creates their account. */
export function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("register");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "register" ? await registerAction({ name, password, code }) : await loginAction({ name, password });
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
      // Re-renders the page on the server, which now finds the session and shows the app.
      startTransition(() => router.refresh());
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-[max(2.5rem,env(safe-area-inset-top))]">
      <p className="animate-fade text-sm font-medium text-muted">Welcome</p>
      <h1 className="animate-rise font-serif text-5xl tracking-tight">Space</h1>
      <p className="animate-rise mt-2 text-sm text-muted">
        {mode === "register"
          ? "Make your account once. If you ever reinstall the app, just log in and everything is still here."
          : "Log in to get your photos, expenses and reminders back."}
      </p>

      <div className="relative mt-8 grid grid-cols-2 rounded-xl bg-card p-1 ring-1 ring-inset ring-line">
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-accent-soft transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: mode === "login" ? "translateX(100%)" : "none" }}
        />
        {(["register", "login"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => switchTo(value)}
            className={`relative py-2 text-sm font-medium transition-colors ${
              mode === value ? "text-accent" : "text-muted"
            }`}
          >
            {value === "register" ? "Create account" : "Log in"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-4 space-y-3 rounded-3xl border border-line bg-card p-5">
        <Field label="Your name">
          <input
            required
            maxLength={30}
            autoComplete="username"
            autoCapitalize="words"
            placeholder="Purvi"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
          />
        </Field>
        <Field label="Password">
          <input
            required
            type="password"
            minLength={mode === "register" ? 6 : undefined}
            maxLength={200}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            placeholder={mode === "register" ? "At least 6 characters" : ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
        </Field>
        {mode === "register" && (
          <Field label="Invite code" hint="The code you used to unlock photos.">
            <input
              required
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${input} tracking-widest`}
            />
          </Field>
        )}

        {error && <p className="animate-rise text-sm text-red-500">{error}</p>}

        <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
          {busy ? "One moment…" : mode === "register" ? "Create account" : "Log in"}
        </button>
      </form>
    </main>
  );
}

/** Shown in a tab if the session ends while the app is open. */
export function SignedOut() {
  return (
    <div className="animate-rise rounded-3xl border border-line bg-card p-6 text-center">
      <h2 className="font-serif text-2xl">You&apos;re logged out</h2>
      <p className="mx-auto mt-1 max-w-64 text-sm text-muted">Log in again to see this.</p>
      <button onClick={() => window.location.reload()} className={`${primaryButton} mt-5 w-full`}>
        Log in
      </button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-1 text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block px-1 text-xs text-muted">{hint}</span>}
    </label>
  );
}

const input =
  "w-full rounded-xl border border-line bg-background px-4 py-3 text-base outline-none transition-shadow placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15";
const primaryButton =
  "rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-on-accent transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60";
