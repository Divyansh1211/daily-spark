import { after, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { sendReactionPush } from "@/lib/push";
import { deletePhoto, photoExists, readPhoto, setReaction } from "@/lib/photos";
import { isReaction } from "@/lib/reactions";

// GET /api/photos/{id}?size=thumb serves the thumbnail; without `size`, the full photo.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/photos/[id]">) {
  if (!(await currentUser())) return new Response("Locked", { status: 401 });
  const { id } = await ctx.params;
  const size = request.nextUrl.searchParams.get("size") === "thumb" ? "thumb" : "full";
  const data = await readPhoto(id, size);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/jpeg",
      // A photo's bytes never change for its id.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/photos/[id]">) {
  if (!(await currentUser())) return new Response("Locked", { status: 401 });
  const { id } = await ctx.params;
  await deletePhoto(id);
  return new Response(null, { status: 204 });
}

// PUT /api/photos/{id} with {"emoji": "❤️"} reacts to the photo; {"emoji": null} takes it back.
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/photos/[id]">) {
  const user = await currentUser();
  if (!user) return new Response("Locked", { status: 401 });
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { emoji?: unknown } | null;
  const emoji = body?.emoji ?? null;
  if (emoji !== null && !isReaction(emoji)) return new Response("Unknown reaction", { status: 400 });
  if (!(await photoExists(id))) return new Response("Not found", { status: 404 });
  setReaction(id, user.id, emoji);
  // Sent once the response is out, so reacting feels instant.
  if (emoji) after(() => sendReactionPush(user, id, emoji));
  return new Response(null, { status: 204 });
}
