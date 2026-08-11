"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RotateCw, Trash2, Power } from "lucide-react";
import { logout } from "@/app/login/actions";
import { clearPersistedAppState } from "@/lib/clearClientState";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/fleet/ThemeToggle";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

/**
 * Shared sticky header for the list pages (Parking, Atelier, and Suivi RL's
 * top bar) — back-link, title, count badge, refresh, "Vider" (now behind an
 * AlertDialog instead of window.confirm()), logout. ~95% identical markup
 * between Parking/Atelier before this, differing only in title/accent color.
 */
export function ListPageHeader({
  title,
  subtitle,
  accentClassName,
  countClassName,
  count,
  onRefresh,
  onClearAll,
  clearAllTitle,
  clearAllDescription = "Cette action est irréversible.",
  children,
}: {
  title: string;
  subtitle: string;
  accentClassName: string;
  countClassName: string;
  count: number;
  onRefresh: () => void;
  /** Omit entirely to hide the "Vider" button — Suivi RL has no clear-all concept. */
  onClearAll?: () => void;
  clearAllTitle?: string;
  clearAllDescription?: string;
  children?: React.ReactNode;
}) {
  const queryClient = useQueryClient();

  // Plain onClick instead of <form action={logout}> — the full BDD dataset
  // (plates, client names, technician assignments, free-text comments) is
  // persisted to localStorage by hooks/queryClient.tsx, and logout() (a
  // server action) has no way to reach into this browser's localStorage.
  // Clearing it here, before the server action runs, is what actually
  // removes it — logout() alone only destroys the session cookie.
  async function handleLogout() {
    clearPersistedAppState(queryClient);
    await logout();
  }

  return (
    <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-muted-foreground transition hover:text-foreground" title="Accueil" aria-label="Accueil">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className={`font-sans text-sm font-semibold ${accentClassName}`}>
            {title} <span className="ml-1 text-micro font-normal text-muted-foreground">{subtitle}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-micro ${countClassName}`}>{count}</span>
          <ThemeToggle variant="icon" />
          <Button type="button" variant="ghost" size="icon" onClick={onRefresh} title="Actualiser" aria-label="Actualiser">
            <RotateCw className="h-4 w-4" />
          </Button>
          {onClearAll && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="hover:bg-red-500/10 hover:text-red-400" title="Vider" aria-label="Vider">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>{clearAllTitle}</AlertDialogTitle>
                <AlertDialogDescription>{clearAllDescription}</AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel />
                  <AlertDialogAction onClick={onClearAll}>Vider</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button type="button" variant="ghost" size="icon" onClick={handleLogout} title="Déconnexion" aria-label="Déconnexion">
            <Power className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
