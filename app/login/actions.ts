"use server";

import { cookies, headers } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/session";
import { redirect } from "next/navigation";

// Simple per-IP login rate limit. Best-effort only (in-memory, per server
// instance) — sufficient given this app gates access with a single shared
// credential rather than per-user accounts.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

declare global {
  var _loginAttempts:
    | Map<string, { count: number; firstAttempt: number; lockedUntil?: number }>
    | undefined;
}

const attempts = globalThis._loginAttempts ?? (globalThis._loginAttempts = new Map());

async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function login(formData: FormData) {
  const key = await clientKey();
  const now = Date.now();
  const record = attempts.get(key);

  if (record?.lockedUntil && record.lockedUntil > now) {
    redirect("/login?error=locked");
  }

  const username = formData.get("username") as string;
  const password = formData.get("password") as string;

  const validUsername = process.env.AUTH_USERNAME;
  const validPassword = process.env.AUTH_PASSWORD;

  if (username !== validUsername || password !== validPassword) {
    if (!record || now - record.firstAttempt > WINDOW_MS) {
      attempts.set(key, { count: 1, firstAttempt: now });
    } else {
      const count = record.count + 1;
      attempts.set(key, {
        count,
        firstAttempt: record.firstAttempt,
        lockedUntil: count >= MAX_ATTEMPTS ? now + LOCKOUT_MS : undefined,
      });
    }
    redirect("/login?error=1");
  }

  attempts.delete(key);

  const session = await getIronSession<SessionData>(
    await cookies(),
    sessionOptions
  );
  session.isLoggedIn = true;
  await session.save();

  redirect("/");
}

export async function logout() {
  const session = await getIronSession<SessionData>(
    await cookies(),
    sessionOptions
  );
  session.destroy();
  redirect("/login");
}
