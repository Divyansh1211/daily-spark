"use client";

import type { User } from "@/lib/auth";
import { CheckIcon } from "./icons";

/** Who gets a reminder: you, the other person, or both. Always keeps at least one picked. */
export function WhoPicker({
  people,
  me,
  value,
  onChange,
}: {
  people: User[];
  me: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  if (people.length < 2) return null;

  function toggle(id: string) {
    const next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
    if (next.length > 0) onChange(next);
  }

  return (
    <div>
      <span className="mb-1.5 block px-1 text-xs font-medium text-muted">Remind</span>
      <div className="flex flex-wrap gap-2">
        {people.map((p) => {
          const on = value.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-all active:scale-95 ${
                on ? "bg-accent-soft text-accent ring-2 ring-accent" : "bg-background text-muted ring-1 ring-line"
              }`}
            >
              {on && <CheckIcon />}
              {p.id === me ? "Me" : p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
