"use client";

import { useState, useSyncExternalStore } from "react";
import type { User } from "@/lib/auth";
import { AccountMenu } from "./account-menu";
import { Calendar } from "./calendar";
import { Expenses } from "./expenses";
import { BookIcon, CalendarIcon, ChevronLeftIcon, ImageIcon, SunIcon } from "./icons";
import { Photos } from "./photos";
import { RemindersApp } from "./reminders-app";
import { Shelf } from "./shelf";
import { ThemeToggle } from "./theme-toggle";
import { Today } from "./today";
import { useCloseOnBack } from "./use-close-on-back";

const TABS = [
  { id: "today", label: "Today", Icon: SunIcon },
  { id: "calendar", label: "Calendar", Icon: CalendarIcon },
  { id: "photos", label: "Photos", Icon: ImageIcon },
  { id: "shelf", label: "Shelf", Icon: BookIcon },
] as const;

const HEADINGS = {
  today: { title: "Haanji", subtitle: null },
  calendar: { title: "Calendar", subtitle: "What we're both up to" },
  reminders: { title: "Reminders", subtitle: "Stay on track" },
  photos: { title: "Photos", subtitle: "Our little moments" },
  shelf: { title: "Shelf", subtitle: "Reading, watching, saving for later" },
  expenses: { title: "Expenses", subtitle: "Just for you" },
} as const;

// Expenses isn't in the bar: it opens from the account menu.
type Tab = (typeof TABS)[number]["id"] | "expenses";

const noSubscribe = () => () => {};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function AppShell({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>("today");
  // Reminders live inside the Calendar tab, behind a switch.
  const [calendarView, setCalendarView] = useState<"calendar" | "reminders">("calendar");
  const hello = useSyncExternalStore(noSubscribe, greeting, () => "Hello");
  const activeIndex = TABS.findIndex((t) => t.id === tab);
  const heading = HEADINGS[tab === "calendar" ? calendarView : tab];

  return (
    <>
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-32 pt-[max(2.5rem,env(safe-area-inset-top))]">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            {tab === "expenses" ? (
              <button
                onClick={() => setTab("today")}
                className="-ml-1 flex items-center gap-0.5 text-sm font-medium text-accent active:scale-95"
              >
                <ChevronLeftIcon /> Back
              </button>
            ) : (
              <p key={`hello-${heading.title}`} className="animate-fade text-sm font-medium text-muted">
                {heading.subtitle ?? hello}
              </p>
            )}
            <h1 key={`title-${heading.title}`} className="animate-rise font-serif text-4xl tracking-tight">
              {heading.title}
            </h1>
          </div>
          <div className="flex gap-2">
            <ThemeToggle />
            <AccountMenu user={user} onExpenses={() => setTab("expenses")} />
          </div>
        </header>

        {/* Both stay mounted so switching tabs keeps state; un-hiding replays the rise animation. */}
        <div hidden={tab !== "today"} className="animate-rise">
          <Today />
        </div>
        <div hidden={tab !== "calendar"} className="animate-rise">
          <div className="mb-5 flex rounded-2xl border border-line bg-card p-1">
            {(["calendar", "reminders"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setCalendarView(v)}
                aria-pressed={calendarView === v}
                className={`flex-1 rounded-xl py-2 text-sm font-medium transition-colors ${
                  calendarView === v ? "bg-accent-soft text-accent" : "text-muted"
                }`}
              >
                {v === "calendar" ? "Events" : "Reminders"}
              </button>
            ))}
          </div>
          <div hidden={calendarView !== "calendar"} className="animate-rise">
            <Calendar />
          </div>
          <div hidden={calendarView !== "reminders"} className="animate-rise">
            <RemindersApp />
          </div>
        </div>
        <div hidden={tab !== "photos"} className="animate-rise">
          <Photos />
        </div>
        <div hidden={tab !== "shelf"} className="animate-rise">
          <Shelf />
        </div>
        <div hidden={tab !== "expenses"} className="animate-rise">
          <Expenses />
        </div>
        {tab === "expenses" && <CloseOnBack onClose={() => setTab("today")} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="relative mx-auto flex max-w-sm rounded-2xl border border-line bg-card/80 p-1.5 shadow-sm backdrop-blur-xl">
          <span
            aria-hidden
            hidden={activeIndex < 0}
            className="absolute inset-y-1.5 left-1.5 rounded-xl bg-accent-soft transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              width: `calc((100% - 0.75rem) / ${TABS.length})`,
              transform: `translateX(${activeIndex * 100}%)`,
            }}
          />
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-2 text-[11px] font-medium transition-colors duration-300 active:scale-95 ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <Icon className={`text-xl transition-transform duration-300 ${active ? "scale-110" : ""}`} />
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

/** The phone's back button leaves Expenses for Today instead of closing the app. */
function CloseOnBack({ onClose }: { onClose: () => void }) {
  useCloseOnBack(onClose);
  return null;
}
