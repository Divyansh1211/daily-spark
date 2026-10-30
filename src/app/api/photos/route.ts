import { currentUser } from "@/lib/auth";
import { listPhotos, savePhoto } from "@/lib/photos";

const MAX_FULL_BYTES = 8 * 1024 * 1024;
const MAX_THUMB_BYTES = 1024 * 1024;

export async function GET() {
  if (!(await currentUser())) return Response.json({ error: "Locked" }, { status: 401 });
  return Response.json({ photos: await listPhotos() });
}

// Expects multipart form data with `photo` and `thumb`, both JPEGs made in the browser.
export async function POST(request: Request) {
  if (!(await currentUser())) return Response.json({ error: "Locked" }, { status: 401 });

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

  return Response.json(await savePhoto(full, small), { status: 201 });
}

function isJpeg(data: Buffer) {
  return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}
