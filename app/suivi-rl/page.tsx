"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BDD_HEADERS, type BddRow } from "@/lib/types";
import { logout } from "@/app/login/actions";

// ─── Dropdown option lists — exact, given verbatim, not invented ──────────────

const ETAT_OPTIONS = ["INTERNE", "EXTERNE", "DISPONIBLE", "ANNULE", "ANNULEE"];

const FLAG_OPTIONS = ["Urgent", "Prêt", "NTR", "INST", "REP", "ESSAI"];

const FLAG_STYLE: Record<string, { border: string; badge: string }> = {
  Urgent: { border: "border-l-red-500", badge: "bg-red-500/10 text-red-400 border-red-500/20" },
  "Prêt": { border: "border-l-emerald-500", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  NTR: { border: "border-l-zinc-500", badge: "bg-zinc-500/10 text-zinc-300 border-zinc-500/20" },
  INST: { border: "border-l-amber-500", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  REP: { border: "border-l-orange-500", badge: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  ESSAI: { border: "border-l-blue-500", badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
};

const CATEGORIE_OPTIONS = [
  "Atelier chargé — en attente diagnostic",
  "En cours diagnostic par technicien",
  "En réparation atelier",
  'En réparation externe — décision validée"',
  "En attente décision Mehdi",
  "En attente PDR",
  "En attente validation pièce",
  "En attente validation devis prestataire externe",
  "Chez concessionnaire — expertise externe",
  "Chez concessionnaire — garantie constructeur",
];

const TECHNICIEN_OPTIONS = [
  "ALI ELGHORABI",
  "Said Errakkachi",
  "AMDAOUI OTHMANE",
  "Othmane Madih",
  "MALEK HAMZA",
  "BELOUARDIGHI AZIZ",
  "RIDA BOULLAH",
  "HAJJI BADRY",
  "MINYAOUI SAID",
  "ABDERRAHIM ELKONTAFI",
  "RAMZI ADIL",
  "HOUCINE CHARII",
];

const PRESTATAIRE_YELLOW = new Set([
  "amine diag", "pres injection", "simo BV", "EMAA", "nabil", "ELECTRO DIESEL",
  "FATR", "OPTIMUM", "HAMID CLIM", "nabil plaque", "My cherif Pneu", "FAP",
]);
const PRESTATAIRE_GREEN = new Set([
  "M-AUTOMOTIV", "CAC", "BUGSHAN", "STELLANTIS", "SMEIA", "BAMOTORS", "JAMEEL", "VOVLO",
]);
const PRESTATAIRE_OPTIONS = [
  "SCAL", "amine diag", "pres injection", "simo BV", "EMAA", "nabil",
  "ELECTRO DIESEL", "FATR", "OPTIMUM", "HAMID CLIM", "nabil plaque",
  "M-AUTOMOTIV", "CAC", "BUGSHAN", "STELLANTIS", "SMEIA", "BAMOTORS",
  "JAMEEL", "VOVLO", "My cherif Pneu", "FAP",
];

function prestataireDotClass(val: string): string | null {
  if (PRESTATAIRE_GREEN.has(val)) return "bg-emerald-500";
  if (PRESTATAIRE_YELLOW.has(val)) return "bg-amber-400";
  return null;
}

// ─── optimistic cache (localStorage-backed) ────────────────────────────────

const CACHE_KEY = "suivi_rl_bdd_rows_v1";
const CACHE_TS_KEY = "suivi_rl_bdd_rows_v1_ts";

function loadCachedRows(): BddRow[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BddRow[]) : null;
  } catch {
    return null;
  }
}
function saveCachedRows(rows: BddRow[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
    localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
  } catch {
    // ignore quota/availability errors
  }
}
function cacheAgeLabel(): string {
  try {
    const ts = localStorage.getItem(CACHE_TS_KEY);
    if (!ts) return "";
    const minutes = Math.round((Date.now() - Number(ts)) / 60000);
    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return `il y a ${minutes}m`;
    return `il y a ${Math.floor(minutes / 60)}h`;
  } catch {
    return "";
  }
}

// ─── Edit form ──────────────────────────────────────────────────────────────

type EditableValues = {
  ETAT: string;
  prestataire: string;
  flag: string;
  "Catégorie": string;
  commentaire: string;
  Technicien: string;
};

function editableValuesFromRow(row: BddRow): EditableValues {
  return {
    ETAT: row.ETAT ?? "",
    prestataire: row.prestataire ?? "",
    flag: row.flag ?? "",
    "Catégorie": row["Catégorie"] ?? "",
    commentaire: row.commentaire ?? "",
    Technicien: row.Technicien ?? "",
  };
}

const fieldControlClass =
  "w-full bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-100 px-2 py-1.5 outline-none focus:border-amber-500";

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[9px] uppercase font-bold text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

const DISPLAY_HEADERS = BDD_HEADERS.filter(
  (h) => h !== "IMM" && h !== "date" && h !== "prestataire" && h !== "flag" && h !== "ETAT"
);

function BddCard({
  row,
  expanded,
  onToggleExpand,
  onSaved,
}: {
  row: BddRow;
  expanded: boolean;
  onToggleExpand: () => void;
  onSaved: (updatedFields: EditableValues) => void;
}) {
  const [form, setForm] = useState<EditableValues>(() => editableValuesFromRow(row));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    setForm(editableValuesFromRow(row));
    setSaveMsg("");
  }, [row, expanded]);

  const flagStyle = FLAG_STYLE[row.flag] ?? null;
  const dot = prestataireDotClass(row.prestataire);

  async function handleSave() {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/bdd/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row: row._row, updates: form }),
      });
      const json = await res.json();
      if (!json.ok) {
        setSaveMsg(`❌ ${json.error ?? "Échec de l'enregistrement"}`);
        return;
      }
      onSaved(form);
      setSaveMsg("✓ Enregistré");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e) {
      setSaveMsg(`❌ ${e instanceof Error ? e.message : "Erreur réseau"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900 p-3 ${
        flagStyle ? `border-l-4 ${flagStyle.border}` : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold text-amber-400 text-sm">{row.IMM}</span>
          {(row.date || row.prestataire) && (
            <span className="font-mono text-xs text-zinc-500">
              {[row.date, row.prestataire].filter(Boolean).join(" · ")}
            </span>
          )}
          {row.flag && flagStyle && (
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${flagStyle.badge}`}>
              {row.flag}
            </span>
          )}
        </div>
        <span
          className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
            row.ETAT?.toUpperCase() === "EXTERNE" ? "bg-blue-500/10 text-blue-400" : "bg-amber-500/10 text-amber-400"
          }`}
        >
          {row.ETAT || "—"}
        </span>
      </div>

      <div className="flex flex-col gap-1 mb-2">
        {DISPLAY_HEADERS.map((h) => {
          const val = row[h];
          const str = val == null ? "" : String(val);
          if (!str.trim()) return null;
          return (
            <div key={h} className="text-xs text-zinc-300 leading-snug whitespace-pre-line">
              <span className="text-zinc-500 uppercase text-[9px] font-bold mr-1">{h}:</span>
              {str}
            </div>
          );
        })}
      </div>

      {row.prestataire && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-400 mb-2">
          {dot && <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${dot}`} />}
          {row.prestataire}
        </div>
      )}

      <button
        onClick={onToggleExpand}
        className="text-xs text-zinc-400 border border-zinc-700 rounded px-2 py-1 hover:bg-zinc-800"
      >
        {expanded ? "✕ Fermer" : "✎ Modifier"}
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-dashed border-zinc-800 flex flex-col gap-2">
          <EditField label="État">
            <select
              value={form.ETAT}
              onChange={(e) => setForm((f) => ({ ...f, ETAT: e.target.value }))}
              className={fieldControlClass}
            >
              <option value="">— Aucun —</option>
              {ETAT_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </EditField>

          <EditField label="Prestataire">
            <input
              list="prestataire-options"
              value={form.prestataire}
              onChange={(e) => setForm((f) => ({ ...f, prestataire: e.target.value }))}
              className={fieldControlClass}
            />
            <datalist id="prestataire-options">
              {PRESTATAIRE_OPTIONS.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </EditField>

          <EditField label="Flag">
            <select
              value={form.flag}
              onChange={(e) => setForm((f) => ({ ...f, flag: e.target.value }))}
              className={fieldControlClass}
            >
              <option value="">— Aucun —</option>
              {FLAG_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </EditField>

          <EditField label="Catégorie">
            <select
              value={form["Catégorie"]}
              onChange={(e) => setForm((f) => ({ ...f, "Catégorie": e.target.value }))}
              className={fieldControlClass}
            >
              <option value="">— Aucun —</option>
              {CATEGORIE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </EditField>

          <EditField label="Technicien">
            <select
              value={form.Technicien}
              onChange={(e) => setForm((f) => ({ ...f, Technicien: e.target.value }))}
              className={fieldControlClass}
            >
              <option value="">— Aucun —</option>
              {TECHNICIEN_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </EditField>

          <EditField label="Commentaire">
            <textarea
              value={form.commentaire}
              onChange={(e) => setForm((f) => ({ ...f, commentaire: e.target.value }))}
              className={`${fieldControlClass} min-h-[60px] resize-none`}
            />
          </EditField>

          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-amber-500 text-zinc-950 text-xs font-bold rounded px-3 py-1.5 disabled:opacity-50"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              onClick={onToggleExpand}
              className="text-xs text-zinc-400 border border-zinc-700 rounded px-3 py-1.5"
            >
              Annuler
            </button>
          </div>
          {saveMsg && <div className="text-xs mt-1">{saveMsg}</div>}
        </div>
      )}
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full border whitespace-nowrap ${
        active ? "bg-amber-500/10 border-amber-500 text-amber-400" : "bg-zinc-900 border-zinc-800 text-zinc-400"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

type Fleet = "TOUS" | "INTERNE" | "EXTERNE";

export default function SuiviRlPage() {
  const [rows, setRows] = useState<BddRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeFleet, setActiveFleet] = useState<Fleet>("INTERNE");
  const [activePrestataire, setActivePrestataire] = useState("TOUS");
  const [activeFlag, setActiveFlag] = useState("TOUS");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [updatedLabel, setUpdatedLabel] = useState("");

  async function fetchFresh(silent: boolean) {
    try {
      const res = await fetch("/api/bdd");
      const json = await res.json();
      if (!json.ok) {
        if (!silent) setError(json.error ?? "Erreur de chargement");
        return;
      }
      setRows(json.rows);
      saveCachedRows(json.rows);
      setUpdatedLabel("à l'instant");
      setError("");
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const cached = loadCachedRows();
    if (cached && cached.length > 0) {
      setRows(cached);
      setLoading(false);
      const age = cacheAgeLabel();
      setUpdatedLabel(age ? `cache · ${age}` : "");
      fetchFresh(true);
    } else {
      fetchFresh(false);
    }
  }, []);

  function toggleExpand(rowNum: number) {
    setExpandedRows((prev) => {
      const n = new Set(prev);
      if (n.has(rowNum)) n.delete(rowNum);
      else n.add(rowNum);
      return n;
    });
  }

  function handleRowSaved(rowNum: number, updatedFields: EditableValues) {
    setRows((prev) => {
      const next = prev.map((r) => (r._row === rowNum ? { ...r, ...updatedFields } : r));
      saveCachedRows(next);
      return next;
    });
  }

  const fleetFiltered = useMemo(() => {
    if (activeFleet === "TOUS") {
      return rows.filter((r) => r.ETAT?.toUpperCase() === "INTERNE" || r.ETAT?.toUpperCase() === "EXTERNE");
    }
    return rows.filter((r) => r.ETAT?.toUpperCase() === activeFleet);
  }, [rows, activeFleet]);

  const visiblePrestataires = useMemo(
    () => [...new Set(fleetFiltered.map((r) => r.prestataire).filter(Boolean))].sort(),
    [fleetFiltered]
  );

  const prestataireFiltered = useMemo(
    () => (activePrestataire === "TOUS" ? fleetFiltered : fleetFiltered.filter((r) => r.prestataire === activePrestataire)),
    [fleetFiltered, activePrestataire]
  );

  const visibleFlags = useMemo(
    () => [...new Set(prestataireFiltered.map((r) => r.flag).filter(Boolean))].sort(),
    [prestataireFiltered]
  );

  const flagFiltered = useMemo(
    () => (activeFlag === "TOUS" ? prestataireFiltered : prestataireFiltered.filter((r) => r.flag === activeFlag)),
    [prestataireFiltered, activeFlag]
  );

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flagFiltered;
    return flagFiltered.filter((r) => BDD_HEADERS.some((h) => String(r[h] ?? "").toLowerCase().includes(q)));
  }, [flagFiltered, search]);

  function selectFleet(f: Fleet) {
    setActiveFleet(f);
    setActivePrestataire("TOUS");
    setActiveFlag("TOUS");
  }
  function selectPrestataire(p: string) {
    setActivePrestataire(p);
    setActiveFlag("TOUS");
  }

  return (
    <div className="min-h-screen bg-black text-zinc-50">
      <div className="sticky top-0 z-20 bg-black/95 backdrop-blur border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Link href="/" className="text-zinc-500 hover:text-zinc-300 transition" title="Accueil">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <div className="font-mono font-semibold text-sm text-amber-400">
              AVIS <span className="text-zinc-500 font-normal text-[10px] ml-1">Suivi RL</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
              {searched.length}
            </span>
            <button
              onClick={() => {
                setLoading(true);
                fetchFresh(false);
              }}
              className="text-zinc-400 border border-zinc-700 rounded px-2 py-1 text-xs"
            >
              ⟳
            </button>
            <form action={logout}>
              <button type="submit" className="text-zinc-400 border border-zinc-700 rounded px-2 py-1 text-xs" title="Déconnexion">
                ⏻
              </button>
            </form>
          </div>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Recherche globale…"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-100 px-3 py-2 outline-none focus:border-amber-500"
        />

        <div className="flex items-center gap-1.5 mt-2 overflow-x-auto">
          <span className="text-[9px] uppercase font-bold text-zinc-500 mr-1 flex-shrink-0">Flotte</span>
          {(["TOUS", "INTERNE", "EXTERNE"] as const).map((f) => (
            <Chip key={f} label={f} active={activeFleet === f} onClick={() => selectFleet(f)} />
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto">
          <Chip label="TOUS" active={activePrestataire === "TOUS"} onClick={() => selectPrestataire("TOUS")} />
          {visiblePrestataires.map((p) => (
            <Chip key={p} label={p} active={activePrestataire === p} onClick={() => selectPrestataire(p)} />
          ))}
        </div>
        {visibleFlags.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto">
            <Chip label="TOUS" active={activeFlag === "TOUS"} onClick={() => setActiveFlag("TOUS")} />
            {visibleFlags.map((f) => (
              <Chip key={f} label={f} active={activeFlag === f} onClick={() => setActiveFlag(f)} />
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-3">
        {error && (
          <div className="rounded-lg border border-red-900/40 bg-red-950/30 text-red-300 text-sm px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {loading && rows.length === 0 && <div className="text-center text-zinc-500 text-sm py-16">Chargement…</div>}

        {!loading && searched.length === 0 && !error && (
          <div className="text-center text-zinc-500 text-sm py-16">Aucun véhicule</div>
        )}

        <div className="flex flex-col gap-2">
          {searched.map((row) => (
            <BddCard
              key={row._row}
              row={row}
              expanded={expandedRows.has(row._row)}
              onToggleExpand={() => toggleExpand(row._row)}
              onSaved={(updated) => handleRowSaved(row._row, updated)}
            />
          ))}
        </div>

        {updatedLabel && <div className="text-center text-[9px] font-mono text-zinc-600 mt-4">Sync: {updatedLabel}</div>}
      </div>
    </div>
  );
}
