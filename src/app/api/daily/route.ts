import type { NextRequest } from "next/server";
import { getDaily } from "@/lib/daily";

// GET /api/daily?date=YYYY-MM-DD&quoteShift=0&talkShift=0
// The client sends its local date so the pick follows the user's own day.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const quoteShift = toShift(params.get("quoteShift"));
  const talkShift = toShift(params.get("talkShift"));
  return Response.json(await getDaily(date, quoteShift, talkShift));
}

function toShift(value: string | null) {
  const n = Number(value ?? 0);
  return Number.isInteger(n) && n >= 0 && n < 10_000 ? n : 0;
}
