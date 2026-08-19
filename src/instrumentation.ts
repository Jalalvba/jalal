// Next.js boot hook — register() runs once, before any route is served.
//
// This is the documented place for startup-time side effects, and the only
// one that covers both Route Handlers and Server Components. proxy.ts would
// run per-request; root layout.tsx would miss /api/* entirely.
//
// Note this also runs during `next build`, so an incomplete .env.local now
// fails the build rather than only the dev server. That is deliberate: a
// build that cannot boot is not a build worth producing.

export async function register() {
  // register() is invoked for every runtime Next.js builds for. The env
  // schema uses Buffer (Node-only) and only server code reads these vars, so
  // skip anything that isn't the Node.js runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateEnv } = await import("@/config/env");
  validateEnv();
}
