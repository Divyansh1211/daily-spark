// What can go on the shelf. Shared by the server (to validate) and the Shelf tab.
export const KINDS = [
  { id: "book", label: "Book", emoji: "📖", doing: "Reading" },
  { id: "article", label: "Article", emoji: "📰", doing: "Reading" },
  { id: "movie", label: "Movie", emoji: "🎬", doing: "Watching" },
  { id: "show", label: "Show", emoji: "📺", doing: "Watching" },
] as const;

export const STATUSES = [
  { id: "now", label: "Now" },
  { id: "want", label: "Up next" },
  { id: "done", label: "Done" },
] as const;

export type KindId = (typeof KINDS)[number]["id"];
export type Status = (typeof STATUSES)[number]["id"];

export type ShelfItem = {
  id: string;
  title: string;
  kind: KindId;
  status: Status;
  link: string | null;
  note: string;
  /** Who it's for; null when it's for both of you. */
  forId: string | null;
  forName: string | null;
  /** Set when someone suggested it for the other person. */
  fromName: string | null;
  updatedAt: number;
};

export function kind(id: string) {
  return KINDS.find((k) => k.id === id) ?? KINDS[0];
}

export function isKind(value: unknown): value is KindId {
  return KINDS.some((k) => k.id === value);
}

export function isStatus(value: unknown): value is Status {
  return STATUSES.some((s) => s.id === value);
}
