"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  deleteReminder,
  getDailyQuote,
  listReminders,
  scheduleReminder,
  sendTestNotification,
  setDailyQuote,
  subscribeUser,
  unsubscribeUser,
  type ReminderView,
} from "./actions";
import { BellIcon, CheckIcon, RepeatIcon, SendIcon, ShareIcon, SunIcon, TrashIcon } from "./icons";

type Support = "checking" | "supported" | "needs-install" | "unsupported";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function getSupport(): Support {
  if (!("serviceWorker" in navigator)) return "unsupported";
  if ("PushManager" in window) return "supported";
  // iOS only exposes Web Push to apps added to the Home Screen.
  if (isIOS() && !isStandalone()) return "needs-install";
  return "unsupported";
}

const noSubscribe = () => () => {};

function timeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function RemindersApp() {
  const support = useSyncExternalStore<Support>(noSubscribe, getSupport, () => "checking");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => reg.pushManager?.getSubscription())
      .then((sub) => setSubscription(sub ?? null))
      .catch((e) => console.error("Service worker registration failed", e));
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Notifications are blocked. Allow them in Settings to get reminders.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
      await subscribeUser(sub.toJSON(), timeZone());
      setSubscription(sub);
    } catch (e) {
      console.error(e);
      setError("Couldn't turn on notifications. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!subscription) return;
    setBusy(true);
    try {
      await unsubscribeUser(subscription.endpoint);
      await subscription.unsubscribe();
      setSubscription(null);
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="space-y-5">
      {support === "checking" && <div className="skeleton animate-shimmer h-40 rounded-3xl" />}
      {support === "needs-install" && <InstallHint />}
      {support === "unsupported" && (
        <Card className="text-sm text-muted">
          This browser doesn&apos;t support push notifications. Open the app over HTTPS in Safari, Chrome or
          Firefox.
        </Card>
      )}

      {support === "supported" &&
        (subscription ? (
          <Card className="flex items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3">
              <span className="relative flex size-2.5">
                <span className="animate-ping-soft absolute inline-flex size-full rounded-full bg-emerald-400" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
              </span>
              <div>
                <p className="text-sm font-medium">Notifications are on</p>
                <p className="text-xs text-muted">Reminders will reach this device.</p>
              </div>
            </div>
            <button onClick={disable} disabled={busy} className={ghostButton}>
              Turn off
            </button>
          </Card>
        ) : (
          <section className="relative overflow-hidden rounded-3xl border border-line bg-card p-6 text-center">
            <div className="relative mx-auto flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-3xl text-accent">
              <BellIcon className="animate-wiggle origin-top" />
            </div>
            <h2 className="relative mt-4 font-serif text-2xl">Never miss a moment</h2>
            <p className="relative mx-auto mt-1 max-w-64 text-sm text-muted">
              Turn on notifications so your reminders arrive even when the app is closed.
            </p>
            <button onClick={enable} disabled={busy} className={`${primaryButton} relative mt-5 w-full`}>
              {busy ? "Turning on…" : "Enable notifications"}
            </button>
            {error && <p className="relative mt-3 text-sm text-red-500">{error}</p>}
          </section>
        ))}

      {subscription && <DailyQuoteToggle endpoint={subscription.endpoint} />}
      {subscription && <Reminders endpoint={subscription.endpoint} />}
    </div>
  );
}

function DailyQuoteToggle({ endpoint }: { endpoint: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    getDailyQuote(endpoint).then(setEnabled);
  }, [endpoint]);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    const result = await setDailyQuote(endpoint, next, timeZone());
    if (!result.ok) setEnabled(!next);
  }

  return (
    <Card className="flex items-center gap-4 py-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-lg text-accent">
        <SunIcon />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Daily quote at midnight</p>
        <p className="text-xs text-muted">A fresh quote as soon as the new day starts.</p>
      </div>
      <button
        role="switch"
        aria-checked={enabled ?? false}
        aria-label="Daily quote at midnight"
        onClick={toggle}
        disabled={enabled === null}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300 disabled:opacity-50 ${
          enabled ? "bg-accent" : "bg-line"
        }`}
      >
        <span
          className="absolute top-1 left-1 size-5 rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: enabled ? "translateX(1.25rem)" : "none" }}
        />
      </button>
    </Card>
  );
}

function Reminders({ endpoint }: { endpoint: string }) {
  const [reminders, setReminders] = useState<ReminderView[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  const [repeat, setRepeat] = useState<"none" | "daily">("none");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(() => listReminders(endpoint).then(setReminders), [endpoint]);

  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    // datetime-local is in the user's local time; convert to an absolute timestamp here.
    const at = new Date(when).getTime();
    setSaving(true);
    try {
      const result = await scheduleReminder({ endpoint, title, body, at, repeat });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTitle("");
      setBody("");
      setWhen("");
      setRepeat("none");
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setNotice(null);
    const result = await sendTestNotification(endpoint, "");
    setNotice(result.ok ? "Test sent. It should pop up in a few seconds." : "Couldn't send a test.");
  }

  async function remove(id: string) {
    setRemoving(id);
    // Let the exit animation play before the item disappears.
    await new Promise((r) => setTimeout(r, 250));
    await deleteReminder(endpoint, id);
    await refresh();
    setRemoving(null);
  }

  return (
    <>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-2xl">New reminder</h2>
            <button type="button" onClick={test} className={`${ghostButton} inline-flex items-center gap-1.5`}>
              <SendIcon /> Test
            </button>
          </div>
          <input
            required
            maxLength={80}
            placeholder="What should we remind you about?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={input}
          />
          <input
            maxLength={200}
            placeholder="Add a note (optional)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={input}
          />
          <input
            required
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className={input}
          />

          <div className="relative grid grid-cols-2 rounded-xl bg-background p-1 ring-1 ring-inset ring-line">
            <span
              aria-hidden
              className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-card shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ transform: repeat === "daily" ? "translateX(100%)" : "none" }}
            />
            {(["none", "daily"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRepeat(value)}
                className={`relative py-2 text-sm font-medium transition-colors ${
                  repeat === value ? "text-foreground" : "text-muted"
                }`}
              >
                {value === "none" ? "Once" : "Every day"}
              </button>
            ))}
          </div>

          {error && <p className="animate-rise text-sm text-red-500">{error}</p>}

          <button type="submit" disabled={saving} className={`${primaryButton} w-full`}>
            {justSaved ? (
              <span className="inline-flex animate-rise items-center gap-2">
                <CheckIcon /> Scheduled
              </span>
            ) : saving ? (
              "Saving…"
            ) : (
              "Schedule reminder"
            )}
          </button>
          {notice && <p className="animate-rise text-center text-sm text-muted">{notice}</p>}
        </form>
      </Card>

      <section>
        <div className="mb-3 flex items-baseline justify-between px-1">
          <h2 className="font-serif text-2xl">Upcoming</h2>
          {reminders.length > 0 && <span className="text-xs text-muted">{reminders.length} scheduled</span>}
        </div>

        {reminders.length === 0 ? (
          <div className="animate-rise rounded-3xl border border-dashed border-line px-6 py-10 text-center">
            <p className="text-3xl">🗓️</p>
            <p className="mt-2 text-sm font-medium">Nothing scheduled yet</p>
            <p className="text-xs text-muted">Your upcoming reminders will show up here.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {reminders.map((r, i) => {
              const at = new Date(r.at);
              return (
                <li
                  key={r.id}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className={`animate-rise transition-all duration-300 ${
                    removing === r.id ? "translate-x-8 opacity-0" : ""
                  }`}
                >
                  <div className="flex items-center gap-4 rounded-2xl border border-line bg-card p-3 pr-2">
                    <div className="flex w-16 shrink-0 flex-col items-center rounded-xl bg-accent-soft py-2 text-accent">
                      <span className="text-sm font-semibold">
                        {at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">
                        {r.repeat === "daily"
                          ? "Daily"
                          : at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.title}</p>
                      {r.body ? (
                        <p className="truncate text-sm text-muted">{r.body}</p>
                      ) : (
                        r.repeat === "daily" && (
                          <p className="flex items-center gap-1 text-xs text-muted">
                            <RepeatIcon /> Repeats every day
                          </p>
                        )
                      )}
                    </div>
                    <button
                      onClick={() => remove(r.id)}
                      aria-label={`Delete ${r.title}`}
                      className="rounded-xl p-2.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 active:scale-90"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function InstallHint() {
  const steps = [
    { icon: <ShareIcon />, text: "Tap the Share button in Safari" },
    { icon: <span className="text-base leading-none">＋</span>, text: "Choose “Add to Home Screen”" },
    { icon: <BellIcon />, text: "Open the app and enable notifications" },
  ];
  return (
    <Card>
      <h2 className="font-serif text-2xl">Install the app first</h2>
      <p className="mt-1 text-sm text-muted">On iPhone, notifications only work from the Home Screen app.</p>
      <ol className="mt-4 space-y-2.5">
        {steps.map((step, i) => (
          <li
            key={i}
            style={{ animationDelay: `${i * 90}ms` }}
            className="animate-rise flex items-center gap-3 rounded-2xl bg-background p-3 text-sm"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              {step.icon}
            </span>
            {step.text}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-line bg-card p-5 ${className}`}>{children}</div>;
}

const input =
  "w-full rounded-xl border border-line bg-background px-4 py-3 text-base outline-none transition-shadow placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15";
const primaryButton =
  "rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60";
const ghostButton =
  "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-muted ring-1 ring-inset ring-line transition-colors hover:text-foreground active:scale-95";
