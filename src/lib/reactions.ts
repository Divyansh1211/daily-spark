// The emoji you can react to a photo with. Shared by the server (to validate) and the viewer.
export const REACTIONS = ["❤️", "😍", "😂", "🥹", "🔥", "😮"] as const;

export type Reaction = { emoji: string; name: string; mine: boolean };

export function isReaction(emoji: unknown): emoji is (typeof REACTIONS)[number] {
  return REACTIONS.includes(emoji as (typeof REACTIONS)[number]);
}
