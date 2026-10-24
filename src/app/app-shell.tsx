"use client";

import { useState, useSyncExternalStore } from "react";
import { BellIcon, SunIcon } from "./icons";
import { RemindersApp } from "./reminders-app";
import { Today } from "./today";

const TABS = [
  { id: "today", label: "Today", Icon: SunIcon },
  { id: "reminders", label: "Reminders", Icon: BellIcon },
] as const;

type Tab = (typeof TABS)[number]["id"];

const noSubscribe = () => () => {};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function AppShell() {
  const [tab, setTab] = useState<Tab>("today");
  const hello = useSyncExternalStore(noSubscribe, greeting, () => "Hello");
  const activeIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <>
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-32 pt-[max(2.5rem,env(safe-area-inset-top))]">
        <header className="mb-6">
          <p key={`hello-${tab}`} className="animate-fade text-sm font-medium text-muted">
            {tab === "today" ? hello : "Stay on track"}
          </p>
          <h1 key={`title-${tab}`} className="animate-rise font-serif text-4xl tracking-tight">
            {tab === "today" ? "Your daily spark" : "Reminders"}
          </h1>
        </header>

        {/* Both stay mounted so switching tabs keeps state; un-hiding replays the rise animation. */}
        <div hidden={tab !== "today"} className="animate-rise">
          <Today />
        </div>
        <div hidden={tab !== "reminders"} className="animate-rise">
          <RemindersApp />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="relative mx-auto flex max-w-xs rounded-2xl border border-line bg-card/80 p-1.5 shadow-sm backdrop-blur-xl">
          <span
            aria-hidden
            className="absolute inset-y-1.5 left-1.5 w-[calc(50%-0.375rem)] rounded-xl bg-accent-soft transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ transform: `translateX(${activeIndex * 100}%)` }}
          />
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors duration-300 active:scale-95 ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <Icon className={`text-lg transition-transform duration-300 ${active ? "scale-110" : ""}`} />
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
