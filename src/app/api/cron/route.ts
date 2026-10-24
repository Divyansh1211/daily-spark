import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { sendDueReminders } from "@/lib/push";

// Call this every minute from an external scheduler (e.g. cron-job.org) with
// `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`.
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendDueReminders();
  return Response.json(result);
}

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  const provided =
    (header?.startsWith("Bearer ") ? header.slice(7) : null) ??
    request.nextUrl.searchParams.get("secret");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
