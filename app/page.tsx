// app/page.tsx
"use client";

import Link from "next/link";
import { logout } from "@/app/login/actions";
import { ThemeToggle } from "@/components/fleet/ThemeToggle";
import { ZONE_COLORS } from "@/lib/constants/zones";

function HomeIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {children}
    </div>
  );
}

function NavCard({
  href, title, subtitle, icon, accent, disabled,
}: {
  href: string; title: string; subtitle: string; icon: React.ReactNode;
  accent: string; disabled?: boolean;
}) {
  const content = (
    <div
      className={`group relative flex flex-col gap-4 rounded-2xl border p-6 shadow-sm transition ${
        disabled
          ? "cursor-not-allowed border-zinc-200 bg-zinc-50 opacity-60 dark:border-zinc-800 dark:bg-zinc-950"
          : "border-zinc-200 bg-white hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950"
      }`}
    >
      <HomeIcon>{icon}</HomeIcon>
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>
          {disabled && (
            <span className="rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500">
              Bientôt
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
      </div>
      <div className={`mt-auto h-1 w-8 rounded-full ${accent}`} />
    </div>
  );

  if (disabled) return content;
  return (
    <Link href={href} className="block">
      {content}
    </Link>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Atelier</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Choisissez un espace de travail</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle className="border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800" />
            <form action={logout}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                title="Se déconnecter"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Déconnexion
              </button>
            </form>
          </div>
        </div>

        {/* Nav cards */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <NavCard
            href="/atelier"
            title="Suivi Atelier"
            subtitle="Suivi des interventions atelier"
            accent={ZONE_COLORS.atelier.navDot}
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="1" y="8" width="22" height="10" rx="2"/>
                <path d="M5 8V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/>
                <circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>
              </svg>
            }
          />
          <NavCard
            href="/ds-history"
            title="DS History"
            subtitle="Recherche par immatriculation / WW"
            accent="bg-blue-500"
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35" strokeLinecap="round"/>
              </svg>
            }
          />
          <NavCard
            href="/parking"
            title="Parking"
            subtitle="Suivi des véhicules en parking"
            accent={ZONE_COLORS.parking.navDot}
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 11v10" strokeLinecap="round"/>
              </svg>
            }
          />
          <NavCard
            href="/suivi-rl"
            title="BDD (Suivi RL)"
            subtitle="Véhicules de remplacement — Suivi RL"
            accent={ZONE_COLORS.bdd.navDot}
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            }
          />
          <NavCard
            href="/depot"
            title="Dépôt"
            subtitle="Suivi des véhicules au dépôt"
            accent={ZONE_COLORS.depot.navDot}
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 21V9l9-6 9 6v12" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 21v-8h6v8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            }
          />
        </div>
      </div>
    </div>
  );
}
