import type { Metadata } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { AppQueryProvider } from "@/hooks/queryClient";
import { LIGHT_START_HOUR, LIGHT_END_HOUR } from "@/lib/utils/themeDefault";
import "./globals.css";

// Geist Sans/Mono (next/font/google) used to be loaded here but were never
// actually rendered — app/globals.css separately imports and applies DM
// Sans/Playfair Display/JetBrains Mono directly on body/h1-h4, which is
// what every page has always visually shown. Removed the dead Geist load
// rather than keep paying for an unused font fetch.

export const metadata: Metadata = {
  title: "AVIS Fleet Management",
  description: "Outil interne de gestion de flotte — DS History, Suivi Atelier, Parking, BDD.",
};

// Runs synchronously before hydration (same "no-flash" positioning
// next-themes' own injected script uses) so the correct class is present
// on first paint, not applied a frame late.
//
// Distinguishes "explicit user choice" (localStorage['theme-explicit'] ===
// 'true', set by components/fleet/ThemeToggle.tsx when the user actually
// clicks the toggle) from "no explicit choice yet". Only in the latter
// case does it compute the time-of-day default and write it into
// next-themes' own 'theme' key — so next-themes' hydration reads a value
// that already matches what's on screen, no mismatch, no second flash —
// and so every fresh visit re-evaluates the current hour until the user
// makes an explicit choice (at which point it's honored going forward,
// exactly like a real "explicit overrides auto-default" setting should).
const noFlashScript = `(function() {
  try {
    var explicit = localStorage.getItem('theme-explicit');
    var theme;
    if (explicit === 'true') {
      theme = localStorage.getItem('theme') || 'dark';
    } else {
      var h = new Date().getHours();
      theme = (h >= ${LIGHT_START_HOUR} && h < ${LIGHT_END_HOUR}) ? 'light' : 'dark';
      localStorage.setItem('theme', theme);
    }
    document.documentElement.classList.toggle('dark', theme === 'dark');
  } catch (e) {}
})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Set by proxy.ts on every request as the `x-nonce` request header, so the
  // inline script below carries the same nonce the CSP response header
  // allows — without it, a nonce-based script-src would block this script
  // entirely.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="antialiased">
        {/* suppressHydrationWarning: browsers intentionally blank the `nonce`
            attribute on read-back after it's set on a DOM node (so it can't
            be exfiltrated via injected script/serialization) — CSP matching
            itself already happened at parse time, before that blanking, so
            the script still executes correctly. React's hydration diff
            reads the DOM back and sees server="<real nonce>" vs
            client="" and flags a false-positive mismatch. next-themes'
            own internal script (rendered below) hits the same thing and
            already suppresses it the same way. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: noFlashScript }}
        />
        {/* next-themes renders its own inline no-flash script server-side —
            that script doesn't go through Next's automatic nonce
            propagation (only Next's own framework scripts get that), so it
            needs the nonce passed explicitly or a nonce-based CSP would
            block it. Confirmed next-themes@0.4.6 supports this prop. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          storageKey="theme"
          disableTransitionOnChange
          nonce={nonce}
        >
          <AppQueryProvider>{children}</AppQueryProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
