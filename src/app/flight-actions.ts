"use server";

import { currentUser } from "@/lib/auth";
import { addFlight, FlightError, listFlights, removeFlight, trackingEnabled, type Flight } from "@/lib/flights";

export async function loadFlights(): Promise<{ status: "locked" } | { status: "ready"; flights: Flight[]; enabled: boolean }> {
  const user = await currentUser();
  if (!user) return { status: "locked" };
  return { status: "ready", flights: listFlights(), enabled: trackingEnabled() };
}

export async function trackFlightAction(code: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "Log in first." };
  try {
    await addFlight(String(code ?? ""), user.id);
    return { ok: true as const };
  } catch (error) {
    if (error instanceof FlightError) return { ok: false as const, error: error.message };
    console.error("[flights] add", error);
    return { ok: false as const, error: "Couldn't add it. Try again in a bit." };
  }
}

export async function removeFlightAction(id: string) {
  const user = await currentUser();
  if (!user || typeof id !== "string") return { ok: false };
  removeFlight(id);
  return { ok: true };
}
