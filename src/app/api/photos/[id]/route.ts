import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { deletePhoto, readPhoto } from "@/lib/photos";

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
