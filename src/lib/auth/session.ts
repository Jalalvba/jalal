import { SessionOptions } from "iron-session";

export interface SessionData {
  isLoggedIn: boolean;
}

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

export const sessionOptions: SessionOptions = {
  password: process.env.IRON_SESSION_SECRET as string,
  cookieName: "auth_session",
  // MUST stay in sync with cookieOptions.maxAge below. iron-session applies
  // ttl to the SEAL (how long the encrypted token stays cryptographically
  // valid) and maxAge to the COOKIE (how long the browser keeps sending it).
  // They are not the same thing, and iron-session only derives one from the
  // other when maxAge is absent: getSessionConfig() computes
  // cookieOptions.maxAge from ttl *only* if "maxAge" is not in cookieOptions
  // (node_modules/iron-session/dist/index.js). Because maxAge IS set here,
  // that branch is skipped and ttl silently fell back to iron-session's
  // 14-day default — so the browser dropped the cookie after 7 days while
  // the sealed value kept working for 14. A copy of the cookie taken from a
  // browser profile, a shared machine or a backup stayed usable for a week
  // after the session appeared to end. Setting both to the same constant
  // closes that gap.
  ttl: SEVEN_DAYS_SECONDS,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    // Explicit, though it is also iron-session's default. Checked, not
    // assumed — this is the app's CSRF protection for every mutation route
    // (see SECURITY_VERIFICATION.md), so it should not depend on a library
    // default staying put.
    sameSite: "lax",
    maxAge: SEVEN_DAYS_SECONDS,
  },
};