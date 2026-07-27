"use client";

import { Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
 * Generic per-row card shell shared by Parking/Atelier's ParkingCard/AtelierCard
 * (and reusable by Suivi RL's BddCard). Unifies their two slightly different
 * header layouts (Parking stacked the timestamp under the subtitle; Atelier
 * put it top-right) onto one consistent layout — a presentational
 * harmonization, not a data/behavior change. Delete now goes through an
 * AlertDialog instead of window.confirm(), and the delete button is a real
 * 40px touch target instead of a bare "✕" glyph.
 */
export function RecordCard({
  imm,
  subtitle,
  timestamp,
  onDelete,
  deleteTitle = "Supprimer cette ligne ?",
  deleteDescription = "Cette action est irréversible.",
  children,
}: {
  imm: string;
  subtitle?: string;
  timestamp?: string;
  onDelete: () => void;
  deleteTitle?: string;
  deleteDescription?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-bold tracking-wide text-card-foreground">{imm}</div>
          {subtitle && (
            <div className="mt-0.5 truncate text-micro font-medium text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {timestamp && (
            <span className="rounded-lg bg-muted px-2 py-0.5 text-micro font-semibold text-muted-foreground">
              {timestamp}
            </span>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hover:bg-red-500/10 hover:text-red-400"
                title="Supprimer"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
              <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel />
                <AlertDialogAction onClick={onDelete}>Supprimer</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {children}
    </Card>
  );
}
