// Minimal structured logger. Emits one JSON object per line so Vercel's log
// drain (and anything downstream of it) can filter on real fields — level,
// scope, msg — instead of substring-matching free text.
//
// Deliberately ~25 lines of local code rather than pino/winston: on Vercel
// stdout IS the transport, so a logging library's main value (transports,
// async writes, redaction, child loggers) buys nothing here, and this app has
// 29 log call sites in total.
//
// The `[scope] ` prefix is kept OUTSIDE the JSON on purpose. Around 20 of the
// existing call sites already use a `[scope] message` convention
// ([RDV], [gemini-cost], [vehicle-suggestions], ...), and keeping the prefix
// means converted and unconverted lines stay greppable the same way while the
// migration is partial. See MIGRATION below.

type Level = "info" | "warn" | "error";

/**
 * Errors don't survive JSON.stringify (name/message/stack are non-enumerable,
 * so a bare Error serialises to `{}`). Unwrap the parts worth keeping and
 * leave anything non-Error as-is.
 */
export function serializeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return { errName: e.name, errMsg: e.message, ...(e.stack ? { stack: e.stack } : {}) };
  }
  return { err: String(e) };
}

/**
 * `scope` identifies the subsystem and should match the existing bracket
 * convention (e.g. "gemini-cost", "rate-limit"). `ctx` is merged into the
 * JSON object, so prefer flat, queryable keys over nesting.
 */
export function log(level: Level, scope: string, msg: string, ctx?: Record<string, unknown>): void {
  const line = JSON.stringify({ level, scope, msg, ts: new Date().toISOString(), ...ctx });
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(`[${scope}] ${line}`);
}

// MIGRATION (deliberately incomplete — see the commit that added this file).
// Three representative call sites were converted as a demonstration; the
// remaining ~26 console.* calls in src/ are intentionally untouched, to keep
// the introducing diff small and reviewable rather than sweeping the repo.
//
// One call site should NOT be converted: src/lib/ai/usage.ts's
// `[gemini-usage]` line already emits deliberate JSON-lines audit output whose
// durable copy is the Vercel log drain. Its shape is a de-facto contract;
// reformatting it would silently break anything parsing it.
