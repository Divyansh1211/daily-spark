import "server-only";
import { getDaily as getLocalDaily, type Quote } from "./quotes";

export type DailyQuote = Quote & { source: "zenquotes" | "local" };

export type Daily = {
  date: string;
  quote: DailyQuote;
  pepTalk: { title: string; text: string };
};

const ZENQUOTES = "https://zenquotes.io/api";
const HOUR_MS = 60 * 60 * 1000;

type ZenQuote = { q: string; a: string };

// Cached in memory so we stay well under ZenQuotes' free limit (5 requests / 30s).
const cache = globalThis as unknown as {
  __zenToday?: { date: string; quote: Quote };
  __zenBatch?: { fetchedAt: number; quotes: Quote[] };
};

async function fetchZen(path: string): Promise<Quote[]> {
  const res = await fetch(`${ZENQUOTES}/${path}`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`ZenQuotes ${path} responded ${res.status}`);
  const data = (await res.json()) as ZenQuote[];
  const quotes = data
    .filter((z) => typeof z.q === "string" && typeof z.a === "string")
    // ZenQuotes returns this placeholder when the rate limit is hit.
    .filter((z) => !z.q.startsWith("Too many requests"))
    .map((z) => ({ text: z.q.trim(), author: z.a.trim() }));
  if (quotes.length === 0) throw new Error(`ZenQuotes ${path} returned no quotes`);
  return quotes;
}

/** ZenQuotes' quote of the day, fetched once per date. */
async function zenToday(date: string) {
  if (cache.__zenToday?.date === date) return cache.__zenToday.quote;
  const [quote] = await fetchZen("today");
  cache.__zenToday = { date, quote };
  return quote;
}

/** A batch of 50 random quotes for "Another", refreshed hourly. */
async function zenBatch() {
  if (cache.__zenBatch && Date.now() - cache.__zenBatch.fetchedAt < HOUR_MS) {
    return cache.__zenBatch.quotes;
  }
  const quotes = await fetchZen("quotes");
  cache.__zenBatch = { fetchedAt: Date.now(), quotes };
  return quotes;
}

/**
 * Quote and pep talk for a calendar day (YYYY-MM-DD). Quotes come from ZenQuotes,
 * falling back to the built-in list if it's unreachable; pep talks are built in.
 */
export async function getDaily(date: string, quoteShift = 0, talkShift = 0): Promise<Daily> {
  const local = getLocalDaily(date, quoteShift, talkShift);

  let quote: DailyQuote;
  try {
    if (quoteShift === 0) {
      quote = { ...(await zenToday(date)), source: "zenquotes" };
    } else {
      const batch = await zenBatch();
      quote = { ...batch[(quoteShift - 1) % batch.length], source: "zenquotes" };
    }
  } catch (error) {
    console.warn("[daily] falling back to built-in quotes:", error);
    quote = { ...local.quote, source: "local" };
  }

  return { date, quote, pepTalk: local.pepTalk };
}
