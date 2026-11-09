import { after, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { isPhotoId, listPhotoPage, nthPhoto, savePhoto } from "@/lib/photos";
import { sendPhotoPush } from "@/lib/push";

const MAX_FULL_BYTES = 8 * 1024 * 1024;
const MAX_THUMB_BYTES = 1024 * 1024;

// High enough that refreshing everything already scrolled through fits in one request.
const MAX_PAGE = 1000;

// GET /api/photos?limit=60&before={id} gives a page of photos, newest first; pass the
// previous page's `next` as `before` to get the one after it.
// GET /api/photos?nth=123 gives just the 123rd photo (wrapping around), for the photo of the day.
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Locked" }, { status: 401 });
  const params = request.nextUrl.searchParams;

  const nth = params.get("nth");
  if (nth !== null) {
    if (!/^\d{1,9}$/.test(nth)) return Response.json({ error: "Bad nth" }, { status: 400 });
    return Response.json({ photo: await nthPhoto(user.id, Number(nth)) });
  }

  const before = params.get("before");
  if (before !== null && !isPhotoId(before)) return Response.json({ error: "Bad cursor" }, { status: 400 });
  const limit = Math.min(MAX_PAGE, Math.max(1, Number(params.get("limit")) || 60));
  return Response.json(await listPhotoPage(user.id, before, limit));
}

// Expects multipart form data with `photo` and `thumb`, both JPEGs made in the browser.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Locked" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const photo = form?.get("photo");
  const thumb = form?.get("thumb");
  if (!(photo instanceof File) || !(thumb instanceof File)) {
    return Response.json({ error: "Missing photo" }, { status: 400 });
  }
  if (photo.size > MAX_FULL_BYTES || thumb.size > MAX_THUMB_BYTES) {
    return Response.json({ error: "Photo is too large" }, { status: 413 });
  }

  const full = Buffer.from(await photo.arrayBuffer());
  const small = Buffer.from(await thumb.arrayBuffer());
  if (!isJpeg(full) || !isJpeg(small)) {
    return Response.json({ error: "Not a JPEG" }, { status: 400 });
  }

  const saved = await savePhoto(full, small);
  // Sent once the response is out, so the upload finishes without waiting on it.
  after(() => sendPhotoPush(user));
  return Response.json(saved, { status: 201 });
}

function isJpeg(data: Buffer) {
  return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}
