"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, FileText, Download, X } from "lucide-react";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { estimateThreadCount } from "@/lib/anthropic/threadCount";
import { cn } from "@/lib/utils/cn";
import type {
  ClaudeCostInfo,
  ComplaintCategory,
  GeneratePlaybookResponse,
  PlaybookConfidence,
  StoredComplaintPlaybook,
} from "@/types";

// ─── /admin/complaints — Phase 1 of the complaint handler.
//
// Upload a .txt of real complaint threads, get back a reusable playbook.
// Phase 2 (applying a playbook to a new incoming complaint) is a separate,
// later feature — nothing here anticipates it.
//
// Sits under /admin rather than at /complaints because generating the playbook
// is a setup activity done occasionally, not the daily-driver screen.

const CONFIDENCE_STYLE: Record<PlaybookConfidence, string> = {
  high: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  medium: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  low: "border-red-500/20 bg-red-500/10 text-red-400",
};

const VERDICT_LABEL: Record<ComplaintCategory["effectiveness"]["verdict"], string> = {
  effective: "Efficace",
  ineffective: "Inefficace",
  mixed: "Mitigé",
  "not-determinable": "Indéterminable",
};

export default function ComplaintsPlaybookPage() {
  const [filename, setFilename] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbook, setPlaybook] = useState<StoredComplaintPlaybook | null>(null);
  const [costInfo, setCostInfo] = useState<ClaudeCostInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback((file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".txt")) {
      setError("Seuls les fichiers .txt sont acceptés.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result ?? ""));
      setFilename(file.name);
      setPlaybook(null);
      setCostInfo(null);
    };
    reader.onerror = () => setError("Le fichier n'a pas pu être lu.");
    reader.readAsText(file);
  }, []);

  function reset() {
    setFilename(null);
    setContent("");
    setPlaybook(null);
    setCostInfo(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/complaints/generate-playbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content }),
      });
      const data: GeneratePlaybookResponse = await res.json();
      if (!data.ok) {
        setError(data.error);
        return;
      }
      setPlaybook(data.playbook);
      setCostInfo(data.costInfo);
    } catch {
      setError("La requête a échoué. Vérifiez votre connexion et réessayez.");
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!playbook) return;
    const blob = new Blob([JSON.stringify(playbook, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playbook-${playbook.generatedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const threadEstimate = content ? estimateThreadCount(content) : 0;

  return (
    <div className="min-h-screen bg-background">
      <ListPageHeader
        title="📮 RÉCLAMATIONS"
        subtitle="Génération du playbook de réponse"
        accentClassName="text-violet-400"
        countClassName="border-violet-500/20 bg-violet-500/10 text-violet-400"
        count={playbook?.categories.length ?? 0}
        onRefresh={() => Promise.resolve()}
      />

      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4">
        <p className="text-micro text-muted-foreground">
          Déposez un fichier <code className="font-mono">.txt</code> contenant de vrais fils de
          réclamation (copiés depuis Gmail). L&apos;analyse en extrait les types de réclamation
          réellement présents et la façon dont AVIS y a répondu. Le texte source n&apos;est pas
          conservé — seule l&apos;analyse est enregistrée.
        </p>

        {/* ── Dropzone ── */}
        <div
          onDragOver={e => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) readFile(file);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center transition-colors",
            dragging && "border-violet-500/50 bg-violet-500/5"
          )}
        >
          <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-foreground">Glissez un fichier .txt ici</p>
          <p className="text-micro text-muted-foreground">ou</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
            }}
          />
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>
            Choisir un fichier
          </Button>
        </div>

        {error && <Alert>{error}</Alert>}

        {/* ── Preview + submit ── */}
        {filename && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <p className="font-mono text-sm text-foreground">{filename}</p>
                  <p className="text-micro text-muted-foreground">
                    {content.length.toLocaleString("fr-FR")} caractères · ~{threadEstimate} fil
                    {threadEstimate > 1 ? "s" : ""} détecté{threadEstimate > 1 ? "s" : ""}{" "}
                    <span className="opacity-70">(estimation)</span>
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={reset} aria-label="Retirer le fichier">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <Button variant="default" onClick={submit} disabled={loading}>
              {loading ? "Analyse en cours…" : "Analyser et générer le playbook"}
            </Button>

            {loading && (
              <p className="text-micro text-muted-foreground">
                L&apos;analyse peut prendre plusieurs minutes. Ne fermez pas cette page.
              </p>
            )}
          </div>
        )}

        {/* ── Result ── */}
        {playbook && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Playbook généré</h2>
              <Button size="sm" onClick={download}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Télécharger (JSON)
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-micro text-muted-foreground">
              {playbook.sourceSummary.threadsObserved} fil
              {playbook.sourceSummary.threadsObserved > 1 ? "s" : ""} analysé
              {playbook.sourceSummary.threadsObserved > 1 ? "s" : ""}
              {playbook.sourceSummary.dateRangeObserved &&
                ` · ${playbook.sourceSummary.dateRangeObserved}`}
              {playbook.sourceSummary.languagesObserved.length > 0 &&
                ` · ${playbook.sourceSummary.languagesObserved.join(", ")}`}
              {costInfo && (
                <>
                  {" · "}
                  {costInfo.costMad.toFixed(2)} MAD
                </>
              )}
            </div>

            {playbook.categories.map(cat => (
              <article key={cat.id} className="rounded-lg border border-border bg-card p-4">
                <header className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{cat.label}</h3>
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-micro",
                      CONFIDENCE_STYLE[cat.confidence]
                    )}
                  >
                    confiance {cat.confidence}
                  </span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-micro text-muted-foreground">
                    {cat.evidence.threadCount} fil{cat.evidence.threadCount > 1 ? "s" : ""}
                  </span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-micro text-muted-foreground">
                    {VERDICT_LABEL[cat.effectiveness.verdict]}
                  </span>
                </header>

                <p className="mb-3 text-sm text-muted-foreground">{cat.description}</p>

                <Section title="Ce que le client demande" items={cat.evidence.clientGoalsObserved} />
                <Section
                  title="Réponse AVIS observée"
                  items={[
                    `Ton : ${cat.avisResponsePattern.tone}`,
                    ...(cat.avisResponsePattern.typicalTimeline
                      ? [`Délai : ${cat.avisResponsePattern.typicalTimeline}`]
                      : []),
                    ...(cat.avisResponsePattern.escalationPath
                      ? [`Escalade : ${cat.avisResponsePattern.escalationPath}`]
                      : []),
                    ...cat.avisResponsePattern.typicalConcessions.map(c => `Geste : ${c}`),
                  ]}
                />
                <Section title="À faire" items={cat.recommendedResponse.mustInclude} />
                <Section title="À éviter" items={cat.recommendedResponse.mustAvoid} />
                <Section title="Non établi par les fils" items={cat.unknowns} />
              </article>
            ))}

            {playbook.crossCuttingObservations.length > 0 && (
              <article className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">
                  Observations transversales
                </h3>
                <Section title="" items={playbook.crossCuttingObservations} />
              </article>
            )}

            {/* Deliberately given equal visual weight to the findings: what the
                data does NOT establish is the part most likely to be misread as
                a gap in the playbook rather than a gap in the evidence. */}
            {playbook.notEvidenced.length > 0 && (
              <article className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                <h3 className="mb-3 text-sm font-semibold text-amber-400">
                  Non documenté par les fils fournis
                </h3>
                <Section title="" items={playbook.notEvidenced} />
              </article>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-3 last:mb-0">
      {title && (
        <p className="mb-1 text-micro font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-1.5 text-sm text-foreground">
            <span className="text-muted-foreground">·</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
