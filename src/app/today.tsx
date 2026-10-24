"use client";

import { useEffect, useState } from "react";
import type { Daily } from "@/lib/daily";
import { CheckIcon, FlameIcon, ShareIcon, ShuffleIcon } from "./icons";

/** The user's local calendar date as YYYY-MM-DD. */
function localDate() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function fetchDaily(date: string, quoteShift: number, talkShift: number): Promise<Daily> {
  const params = new URLSearchParams({
    date,
    quoteShift: String(quoteShift),
    talkShift: String(talkShift),
  });
  const res = await fetch(`/api/daily?${params}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export function Today() {
  // Offsets from today's pick when the user taps "Another".
  const [quoteShift, setQuoteShift] = useState(0);
  const [talkShift, setTalkShift] = useState(0);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [loaded, setLoaded] = useState({ quote: -1, talk: -1 });
  const [error, setError] = useState(false);

  const quoteLoading = loaded.quote !== quoteShift;
  const talkLoading = loaded.talk !== talkShift;

  useEffect(() => {
    let cancelled = false;
    fetchDaily(localDate(), quoteShift, talkShift)
      .then((data) => {
        if (cancelled) return;
        setDaily(data);
        setLoaded({ quote: quoteShift, talk: talkShift });
        setError(false);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [quoteShift, talkShift]);

  if (!daily) {
    return error ? (
      <div className="animate-rise rounded-3xl border border-line bg-card p-6 text-sm">
        Couldn&apos;t load today&apos;s quote. Check your connection and try again.
      </div>
    ) : (
      <TodaySkeleton />
    );
  }

  const { quote, pepTalk } = daily;
  const [y, m, d] = daily.date.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const minutes = Math.max(1, Math.round(pepTalk.text.split(/\s+/).length / 200));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-muted">
          {date.toLocaleDateString(undefined, { weekday: "long" })}
        </span>
        <span className="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-muted">
          {date.toLocaleDateString(undefined, { month: "long", day: "numeric" })}
        </span>
      </div>

      {/* Quote of the day */}
      <section className="relative overflow-hidden rounded-3xl bg-hero p-6 text-hero-fg">
        <span
          aria-hidden
          className="pointer-events-none absolute right-5 top-2 h-24 select-none font-serif text-[8rem] leading-[0.9] text-hero-fg/15"
        >
          &ldquo;
        </span>

        <p className="relative text-[11px] font-semibold uppercase tracking-[0.2em] text-hero-fg/60">
          {quoteShift === 0 ? "Quote of the day" : `Quote #${quoteShift + 1}`}
        </p>

        <div
          key={quote.text}
          className={`relative animate-rise transition-opacity duration-300 ${quoteLoading ? "opacity-40" : ""}`}
        >
          <blockquote className="mt-4 font-serif text-[1.75rem] leading-[1.2]">
            {quote.text}
          </blockquote>
          <p className="mt-4 flex items-center gap-2 text-sm text-hero-fg/80">
            <span className="h-px w-6 bg-hero-fg/50" />
            {quote.author}
          </p>
        </div>

        <div className="relative mt-6 flex gap-2">
          <ActionButton
            variant="glass"
            onClick={() => setQuoteShift((s) => s + 1)}
            disabled={quoteLoading}
            icon={<ShuffleIcon className={quoteLoading ? "animate-spin" : ""} />}
          >
            Another
          </ActionButton>
          <ShareButton variant="glass" text={`“${quote.text}” — ${quote.author}`} />
        </div>

        {quote.source === "zenquotes" && (
          <p className="relative mt-5 text-[11px] text-hero-fg/55">
            Inspirational quotes provided by{" "}
            <a href="https://zenquotes.io/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
              ZenQuotes API
            </a>
          </p>
        )}
      </section>

      {/* Pep talk */}
      <section className="animate-rise rounded-3xl border border-line bg-card p-6 [animation-delay:120ms]">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-500">
            <FlameIcon className="text-sm" />
            {talkShift === 0 ? "Today's pep talk" : "Pep talk"}
          </p>
          <span className="text-xs text-muted">{minutes} min read</span>
        </div>

        <div
          key={pepTalk.title}
          className={`animate-rise transition-opacity duration-300 ${talkLoading ? "opacity-40" : ""}`}
        >
          <h2 className="mt-3 font-serif text-3xl leading-tight">{pepTalk.title}</h2>
          <p className="mt-3 text-[15px] leading-7 text-foreground/80">{pepTalk.text}</p>
        </div>

        <div className="mt-6 flex gap-2">
          <ActionButton
            variant="soft"
            onClick={() => setTalkShift((s) => s + 1)}
            disabled={talkLoading}
            icon={<ShuffleIcon className={talkLoading ? "animate-spin" : ""} />}
          >
            Another
          </ActionButton>
          <ShareButton variant="soft" text={`${pepTalk.title}\n\n${pepTalk.text}`} />
        </div>
      </section>
    </div>
  );
}

const variants = {
  glass: "bg-hero-fg/10 text-hero-fg hover:bg-hero-fg/15",
  soft: "bg-accent-soft text-accent hover:brightness-95",
};

function ActionButton({
  variant,
  icon,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: keyof typeof variants;
  icon: React.ReactNode;
}) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 active:scale-95 disabled:cursor-wait ${variants[variant]}`}
    >
      {icon}
      {children}
    </button>
  );
}

function ShareButton({ text, variant }: { text: string; variant: keyof typeof variants }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // User closed the share sheet.
      }
      return;
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <ActionButton
      variant={variant}
      onClick={share}
      icon={copied ? <CheckIcon className="animate-rise" /> : <ShareIcon />}
    >
      {copied ? "Copied" : "Share"}
    </ActionButton>
  );
}

function TodaySkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="flex gap-2">
        <div className="skeleton animate-shimmer h-6 w-20 rounded-full" />
        <div className="skeleton animate-shimmer h-6 w-24 rounded-full" />
      </div>
      <div className="skeleton animate-shimmer h-72 rounded-3xl" />
      <div className="skeleton animate-shimmer h-80 rounded-3xl" />
    </div>
  );
}
