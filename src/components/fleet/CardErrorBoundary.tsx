"use client";

// One card crashing must not take the page down with it.
//
// ── The failure this exists for ──────────────────────────────────────────
//
// This app had NO error boundary of any kind — no `error.tsx`, no
// `global-error.tsx`, no class boundary. In React 19 a render error that
// nothing catches unmounts the whole tree, so a single bad property access in
// ONE card blanks every card on the page.
//
// Measured, not theorised. Simulating a DS History analysis response that is
// missing one newly-added field (the shape you get from an older serverless
// function while the browser runs newer client JS — i.e. mid-deploy skew):
//
//   before:  21 cards rendered, VehicleCard present
//   after:   0 cards, whole document body down to 70 characters
//   console: TypeError: Cannot read properties of undefined (reading 'status')
//
// The vehicle card, the sheet cards and all 18 DS entries disappeared because
// an unrelated card touched `undefined.status`. That is exactly the
// "cards not rendering" report this was built in response to, and the reason
// it only started after the AI card shipped: it is the first card on this page
// that reads deeply into a server response shape which changes between
// deploys.
//
// A boundary per card converts "the page is blank" into "one card says it
// failed", which is both survivable and diagnosable.

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  /** Shown in the fallback so the user knows WHICH card failed. */
  label: string;
  children: ReactNode;
};

type State = { error: Error | null };

export class CardErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept as console.error rather than routed through lib/http/logger, which
    // is server-side. This surfaces in the browser console and in Vercel's
    // client-error reporting, which is where a render crash is actually read.
    console.error(`[card:${this.props.label}] render failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-2xl border border-red-400 bg-red-50 px-5 py-4 dark:border-red-700 dark:bg-red-950/20">
        <div className="text-xs font-semibold uppercase tracking-widest text-red-600 dark:text-red-400">
          ⚠ {this.props.label} — affichage impossible
        </div>
        <p className="mt-1 text-sm text-card-foreground">
          Cette carte n&apos;a pas pu s&apos;afficher. Le reste de la page est
          intact. Rechargez la page ; si le problème persiste, signalez-le.
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {this.state.error.message}
        </p>
      </div>
    );
  }
}
