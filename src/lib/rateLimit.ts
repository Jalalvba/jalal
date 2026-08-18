import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo";

// Fixed-window rate limiter backed by MongoDB — Vercel's serverless model
// (even under Fluid Compute, which reuses warm instances but gives no
// guarantee a given sequence of requests lands on the same one) doesn't
// provide reliable shared memory across invocations, so an in-memory
// counter wouldn't give a real limit here. Mongo is the one piece of state
// every invocation already reaches identically.
//
// Keyed by route:identifier:windowBucket, incremented atomically via
// findOneAndUpdate's $inc — safe under concurrent requests across any
// number of instances. The rate_limits collection's TTL index (see
// scripts/add-indexes.ts) auto-expires old window documents; no manual
// cleanup needed here.

type RateLimitDoc = {
  _id: string;
  count: number;
  expiresAt: Date;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * @param route      short identifier for the endpoint, e.g. "export"
 * @param identifier caller identity, e.g. an IP — see clientIp() below
 * @param limit      max requests allowed per window
 * @param windowMs   window size in ms
 */
export async function checkRateLimit(
  route: string,
  identifier: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const windowBucket = Math.floor(Date.now() / windowMs);
  const windowEnd = (windowBucket + 1) * windowMs;
  const key = `${route}:${identifier}:${windowBucket}`;

  // Fails OPEN, not closed: a transient Mongo connectivity blip (confirmed
  // live via Vercel's runtime error logs — MongoNetworkError/
  // MongoNetworkTimeoutError/MongoServerSelectionError recur across nearly
  // every route in this app, not just this one) used to propagate as an
  // uncaught exception from here, through rateLimitOrNull's un-try/caught
  // call site, into a raw unhandled-request 500 with no JSON body — turning
  // a rate limiter (an abuse-prevention safety net, not a security control,
  // for what's a single-authorized-user app) into a hard outage for every
  // rate-limited route the moment Mongo hiccups. Letting the request through
  // when the limiter itself can't be consulted is the correct tradeoff here.
  let doc: (RateLimitDoc & { _id: string }) | null;
  try {
    const col = await getCollection<RateLimitDoc>("rate_limits");
    doc = await col.findOneAndUpdate(
      { _id: key },
      {
        $inc: { count: 1 },
        // TTL cushion past the window's own end so the document outlives the
        // window it's counting for, without lingering indefinitely.
        $setOnInsert: { expiresAt: new Date(windowEnd + windowMs) },
      },
      { upsert: true, returnDocument: "after" }
    );
  } catch (e) {
    console.error(`checkRateLimit: Mongo unreachable for ${key}, failing open`, e);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const count = doc?.count ?? 1;
  const retryAfterSeconds = Math.max(0, Math.ceil((windowEnd - Date.now()) / 1000));

  return { allowed: count <= limit, retryAfterSeconds };
}

/** Standard x-forwarded-for / x-real-ip precedence for identifying the caller. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * One-line rate-limit guard for route handlers: returns a ready-to-return
 * 429 NextResponse if the caller is over budget, or null if they're clear
 * to proceed. Collapses the checkRateLimit()-then-429-JSON boilerplate
 * app/api/article and app/api/export already had inline into something the
 * 17 Sheets mutation routes (parking/atelier/depot/rdv/bdd) can each apply
 * in one line, so a runaway script loop or accidental double-submit can't
 * exhaust the Sheets API's 60 req/min quota unchecked.
 */
export async function rateLimitOrNull(
  req: Request,
  route: string,
  limit: number,
  windowMs: number
): Promise<NextResponse | null> {
  const { allowed, retryAfterSeconds } = await checkRateLimit(route, clientIp(req), limit, windowMs);
  if (allowed) return null;
  return NextResponse.json(
    { ok: false, error: `Trop de requêtes. Réessayez dans ${retryAfterSeconds}s.` },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}
