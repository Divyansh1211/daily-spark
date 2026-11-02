"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { User } from "@/lib/auth";
import { KINDS, STATUSES, kind, type KindId, type ShelfItem, type Status } from "@/lib/shelf-kinds";
import { SignedOut } from "./auth-screen";
import { CheckIcon, PlusIcon, TrashIcon } from "./icons";
import { addShelfAction, deleteShelfAction, loadShelf, setShelfStatusAction } from "./shelf-actions";

type State =
  | { status: "loading" }
  | { status: "locked" }
  | { status: "error" }
  | { status: "ready"; items: ShelfItem[]; people: User[]; me: string };

/** "all", someone's user id, or "both" for the things you're doing together. */
type Who = string;

export function Shelf() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [tab, setTab] = useState<Status>("now");
  const [who, setWho] = useState<Who>("all");

  const refresh = useCallback(async () => {
    try {
      setState(await loadShelf());
    } catch {
      setState((s) => (s.status === "ready" ? s : { status: "error" }));
    }
  }, []);

  useEffect(() => {
    // Deferred so the first load doesn't set state synchronously inside the effect.
    const first = setTimeout(refresh, 0);
    // Pick up what the other person added while the app was in the background.
    const onShow = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [refresh]);

  if (state.status === "loading") {
    return (
      <div className="space-y-5">
        <div className="skeleton animate-shimmer h-12 rounded-2xl" />
        <div className="skeleton animate-shimmer h-72 rounded-3xl" />
      </div>
    );
  }
  if (state.status === "locked") return <SignedOut />;
  if (state.status === "error") {
    return (
      <div className="animate-rise rounded-3xl border border-line bg-card p-6 text-sm">
        Couldn&apos;t load the shelf. Check your connection and try again.
      </div>
    );
  }

  const { items, people, me } = state;
  const matchesWho = (i: ShelfItem) => who === "all" || (who === "both" ? i.forId === null : i.forId === who);
  const shown = items
    .filter((i) => i.status === tab && matchesWho(i))
    // Suggestions waiting for you come first in Up next.
    .sort((a, b) => Number(isSuggestionForMe(b, me)) - Number(isSuggestionForMe(a, me)));
  const waiting = items.filter((i) => i.status === "want" && isSuggestionForMe(i, me)).length;

  return (
    <div className="space-y-5">
      <AddToShelf people={people} me={me} onAdded={(status) => (setTab(status), refresh())} />

      <div className="relative flex rounded-2xl border border-line bg-card p-1">
        {STATUSES.map((s) => {
          const count = items.filter((i) => i.status === s.id && matchesWho(i)).length;
          const active = tab === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setTab(s.id)}
              aria-pressed={active}
              className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-colors ${
                active ? "bg-accent-soft text-accent" : "text-muted"
              }`}
            >
              {s.label}
              {count > 0 && <span className="text-xs opacity-70">{count}</span>}
              {s.id === "want" && waiting > 0 && (
                <span aria-label={`${waiting} suggested for you`} className="absolute right-2 top-1.5 size-2 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>

      {people.length > 1 && (
        <div className="-mt-2 flex flex-wrap gap-2">
          {[
            { id: "all", label: "Everyone" },
            { id: me, label: "Me" },
            ...people.filter((p) => p.id !== me).map((p) => ({ id: p.id, label: p.name })),
            { id: "both", label: "Together" },
          ].map((o) => (
            <button
              key={o.id}
              onClick={() => setWho(o.id)}
              aria-pressed={who === o.id}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 ${
                who === o.id ? "bg-accent text-on-accent" : "bg-card text-muted ring-1 ring-line"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      <ShelfList items={shown} tab={tab} me={me} onChange={refresh} onMoved={setTab} />
    </div>
  );
}

function isSuggestionForMe(item: ShelfItem, me: string) {
  return item.forId === me && item.fromName !== null;
}

function AddToShelf({ people, me, onAdded }: { people: User[]; me: string; onAdded: (status: Status) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [what, setWhat] = useState<KindId>("book");
  const [forId, setForId] = useState<string | null>(me);
  const [status, setStatus] = useState<Status>("want");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const suggesting = forId !== null && forId !== me;
  const other = people.find((p) => p.id !== me);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await addShelfAction({ title, kind: what, status, forId, link, note });
      if (!result.ok) return setError(result.error);
      setTitle("");
      setLink("");
      setNote("");
      setOpen(false);
      onAdded(suggesting ? "want" : status);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-card py-3.5 text-sm font-medium text-accent transition-all active:scale-[0.98]"
      >
        <PlusIcon /> Add a book, movie or more
      </button>
    );
  }

  const doing = kind(what).doing;

  return (
    <form onSubmit={submit} className="animate-rise space-y-3 rounded-3xl border border-line bg-card p-5">
      <div className="grid grid-cols-4 gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setWhat(k.id)}
            aria-pressed={what === k.id}
            className={`flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[11px] font-medium transition-all active:scale-95 ${
              what === k.id ? "bg-accent-soft text-accent ring-2 ring-accent" : "bg-background text-muted ring-1 ring-line"
            }`}
          >
            <span className="text-xl leading-none">{k.emoji}</span>
            {k.label}
          </button>
        ))}
      </div>

      <input
        autoFocus
        required
        maxLength={120}
        placeholder={what === "movie" || what === "show" ? "Title" : what === "article" ? "Headline" : "Title and author"}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Title"
        className={input}
      />

      {people.length > 1 && (
        <div>
          <span className={fieldLabel}>For</span>
          <div className="flex flex-wrap gap-2">
            {[
              { id: me as string | null, label: "Me" },
              ...(other ? [{ id: other.id as string | null, label: other.name }] : []),
              { id: null, label: "Together" },
            ].map((o) => (
              <Chip key={o.label} on={forId === o.id} onClick={() => setForId(o.id)}>
                {o.label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {suggesting ? (
        <p className="px-1 text-xs text-muted">
          Goes in {other?.name}&apos;s Up next, and they&apos;ll get a notification.
        </p>
      ) : (
        <div>
          <span className={fieldLabel}>Where</span>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <Chip key={s.id} on={status === s.id} onClick={() => setStatus(s.id)}>
                {s.id === "now" ? doing : s.id === "done" ? (doing === "Reading" ? "Read it" : "Watched it") : s.label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <input
        inputMode="url"
        placeholder="Link (optional)"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        aria-label="Link"
        className={input}
      />
      <input
        maxLength={200}
        placeholder={suggesting ? "Why they'll love it (optional)" : "Note (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Note"
        className={input}
      />

      {error && <p className="animate-rise text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={`${primaryButton} flex-1`}>
          {saving ? "Adding…" : suggesting ? `Suggest to ${other?.name}` : "Add"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 text-sm text-muted">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-all active:scale-95 ${
        on ? "bg-accent-soft text-accent ring-2 ring-accent" : "bg-background text-muted ring-1 ring-line"
      }`}
    >
      {on && <CheckIcon />}
      {children}
    </button>
  );
}

const EMPTY: Record<Status, { emoji: string; title: string; hint: string }> = {
  now: { emoji: "🍿", title: "Nothing on the go", hint: "Start something from Up next, or add what you're into." },
  want: { emoji: "📚", title: "Nothing lined up", hint: "Add something you want to get to, or suggest one." },
  done: { emoji: "✨", title: "Nothing finished yet", hint: "Things you've read and watched end up here." },
};

function ShelfList({
  items,
  tab,
  me,
  onChange,
  onMoved,
}: {
  items: ShelfItem[];
  tab: Status;
  me: string;
  onChange: () => Promise<void>;
  onMoved: (status: Status) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  if (items.length === 0) {
    const e = EMPTY[tab];
    return (
      <div key={tab} className="animate-rise rounded-3xl border border-dashed border-line px-6 py-10 text-center">
        <p className="text-3xl">{e.emoji}</p>
        <p className="mt-2 text-sm font-medium">{e.title}</p>
        <p className="text-xs text-muted">{e.hint}</p>
      </div>
    );
  }

  async function move(id: string, status: Status) {
    setOpenId(null);
    setRemoving(id);
    await new Promise((r) => setTimeout(r, 250));
    await setShelfStatusAction(id, status);
    await onChange();
    setRemoving(null);
    // Follow it to where it went.
    onMoved(status);
  }

  async function remove(id: string) {
    setRemoving(id);
    await new Promise((r) => setTimeout(r, 250));
    await deleteShelfAction(id);
    onChange();
    setRemoving(null);
  }

  return (
    <ul key={tab} className="space-y-2">
      {items.map((item, i) => {
        const k = kind(item.kind);
        const open = openId === item.id;
        const forMe = isSuggestionForMe(item, me) && item.status === "want";
        const whose = item.forId === null ? "Together" : item.forId === me ? "You" : item.forName;
        // The quick Start / Finish is for your own things; the other person's can still be moved from the card.
        const next =
          item.forId !== null && item.forId !== me ? null : item.status === "want" ? "now" : item.status === "now" ? "done" : null;
        return (
          <li
            key={item.id}
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            className={`animate-rise transition-all duration-300 ${removing === item.id ? "translate-x-8 opacity-0" : ""}`}
          >
            <div className={`rounded-2xl border bg-card p-3 ${forMe ? "border-accent/50" : "border-line"}`}>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setOpenId(open ? null : item.id)}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-lg">{k.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {whose}
                      {item.fromName && ` · from ${item.fromName}`}
                    </span>
                  </span>
                </button>
                {next && (
                  <button
                    onClick={() => move(item.id, next)}
                    className="shrink-0 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition-all active:scale-95"
                  >
                    {next === "now" ? "Start" : "Finish"}
                  </button>
                )}
              </div>

              {item.note && <p className="mt-2 pl-[3.25rem] text-sm text-muted">&ldquo;{item.note}&rdquo;</p>}

              {open && (
                <div className="animate-rise mt-3 space-y-3 border-t border-line pt-3 pl-[3.25rem]">
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {new URL(item.link).hostname.replace(/^www\./, "")} ↗
                    </a>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {STATUSES.filter((s) => s.id !== item.status).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => move(item.id, s.id)}
                        className="rounded-full bg-background px-3 py-1.5 text-xs font-medium text-muted ring-1 ring-line active:scale-95"
                      >
                        Move to {s.id === "now" ? k.doing : s.label}
                      </button>
                    ))}
                    <button
                      onClick={() => remove(item.id)}
                      aria-label={`Delete ${item.title}`}
                      className="ml-auto rounded-xl p-2 text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 active:scale-90"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const input =
  "w-full rounded-xl border border-line bg-background px-4 py-3 text-base text-foreground outline-none transition-shadow placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15";
const fieldLabel = "mb-1.5 block px-1 text-xs font-medium text-muted";
const primaryButton =
  "rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-on-accent transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60";
