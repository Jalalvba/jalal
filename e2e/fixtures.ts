import { test as base, expect } from "@playwright/test";
import { authenticatedCookie } from "./helpers/auth";

/**
 * Drop-in replacement for @playwright/test's own test/expect — every spec
 * file in this suite imports from here instead, and gets a `page` that's
 * already logged in (cookie set on the context before any navigation).
 * `page.request` (used to cross-check UI counts against the real API,
 * since these flows hit real live Sheets/Mongo data) shares the same
 * context and cookie automatically.
 */
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    const cookie = await authenticatedCookie(baseURL ?? "http://localhost:3000");
    await context.addCookies([cookie]);
    await use(context);
  },
});

export { expect };
