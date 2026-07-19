"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { logout } from "@/app/login/actions";
import type { AtelierRow, ParkingAddResultItem, AtelierEditableField } from "@/lib/types";

// ─── Option lists — exact, same values already used by app/suivi-rl/page.tsx's
// getDropdownLists() equivalent (CFG_PARKING_SHEET.CATEGORIES_LIST / TECHNICIENS_LIST) ──

const CATEGORIE_OPTIONS = [
  "Atelier chargé — en attente diagnostic",
  "En cours diagnostic par technicien",
  "En réparation atelier",
  "En réparation externe — décision validée",
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

function stripAlnum(s: string): string {
  return s.replace(/[^A-Z0-9]/g, "");
}

function currentTokenFragment(value: string): string {
  const tokens = value.split(",");
  return tokens[tokens.length - 1].trim().toUpperCase();
}

// ─── Atelier card (per row) ────────────────────────────────────────────────

function AtelierCard({
  row,
  onFieldCommit,
  onDelete,
}: {
  row: AtelierRow;
  onFieldCommit: (rowIndex: number, field: AtelierEditableField, value: string) => void;
  onDelete: (rowIndex: number) => void;
}) {
  const [categorie, setCategorie] = useState(row.categorie);
  const [technicien, setTechnicien] = useState(row.technicien);
  const [commentaire, setCommentaire] = useState(row.commentaire);
  const [besoinPiece, setBesoinPiece] = useState(row.besoinPiece);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync local edit state when the server row changes (same pattern as ParkingCard/BddCard)
    setCategorie(row.categorie);
    setTechnicien(row.technicien);
    setCommentaire(row.commentaire);
    setBesoinPiece(row.besoinPiece);
  }, [row.rowIndex, row.categorie, row.technicien, row.commentaire, row.besoinPiece, row.timestamp]);

  const fieldClass =
    "w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] font-medium text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-amber-500";

  return (
    <div className="relative space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3.5">
      <button
        onClick={() => onDelete(row.rowIndex)}
        className="absolute right-3 top-2.5 text-sm font-bold text-zinc-500 hover:text-red-400"
        title="Supprimer"
      >
        ✕
      </button>

      <div className="flex items-start justify-between pr-6">
        <div>
          <div className="font-mono text-sm font-bold tracking-wide text-zinc-100">{row.imm}</div>
          {(row.marque || row.model || row.client) && (
            <div className="mt-0.5 text-[10px] font-medium text-zinc-400">
              {[row.marque, row.model].filter(Boolean).join(" ")}
              {row.client ? ` | ${row.client}` : ""}
            </div>
          )}
        </div>
        {row.timestamp && (
          <span className="rounded bg-zinc-950 px-2 py-0.5 text-[9px] font-semibold text-zinc-500">
            {row.timestamp}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5 text-[11px] sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[9px] font-bold uppercase text-zinc-500">Catégorie</label>
          <select
            value={categorie}
            onChange={(e) => {
              setCategorie(e.target.value);
              onFieldCommit(row.rowIndex, "CATÉGORIE", e.target.value);
            }}
            className={fieldClass}
          >
            <option value="">— Sélectionner —</option>
            {CATEGORIE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[9px] font-bold uppercase text-zinc-500">Technicien</label>
          <select
            value={technicien}
            onChange={(e) => {
              setTechnicien(e.target.value);
              onFieldCommit(row.rowIndex, "TECHNICIEN", e.target.value);
            }}
            className={fieldClass}
          >
            <option value="">— Sélectionner —</option>
            {TECHNICIEN_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 text-[11px] sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[9px] font-bold uppercase text-zinc-500">Suivi (Commentaire)</label>
          <input
            type="text"
            value={commentaire}
            placeholder="Taper le suivi…"
            onChange={(e) => setCommentaire(e.target.value)}
            onBlur={() => {
              if (commentaire !== row.commentaire) onFieldCommit(row.rowIndex, "COMMENTAIRE", commentaire);
            }}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-[9px] font-bold uppercase text-zinc-500">Besoin Pièce</label>
          <input
            type="text"
            value={besoinPiece}
            placeholder="Pièce requise…"
            onChange={(e) => setBesoinPiece(e.target.value)}
            onBlur={() => {
              if (besoinPiece !== row.besoinPiece) onFieldCommit(row.rowIndex, "BESOIN PIÈCE", besoinPiece);
            }}
            className={fieldClass}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function AtelierPage() {
  const [rows, setRows] = useState<AtelierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [rawInput, setRawInput] = useState("");
  const [immList, setImmList] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [addResults, setAddResults] = useState<ParkingAddResultItem[] | null>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  async function fetchRows() {
    try {
      const res = await fetch("/api/atelier");
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Erreur de chargement");
        return;
      }
      setRows(json.rows);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRows();
    // Shares the same parc plate list as Parking — same underlying resource.
    fetch("/api/parking/imm-list")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setImmList(json.imms);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const suggestions = useMemo(() => {
    const fragment = currentTokenFragment(rawInput);
    const strippedFragment = stripAlnum(fragment);
    if (!strippedFragment) return [];
    return immList.filter((imm) => stripAlnum(imm).startsWith(strippedFragment)).slice(0, 15);
  }, [rawInput, immList]);

  function selectSuggestion(selected: string) {
    const tokens = rawInput.split(",");
    tokens.pop();
    tokens.push(" " + selected);
    setRawInput(tokens.join(",").trim() + ", ");
    setShowSuggestions(false);
  }

  async function submitIMMs() {
    const val = rawInput.trim();
    if (!val) return;
    setSubmitting(true);
    setAddResults(null);
    setShowSuggestions(false);
    try {
      const res = await fetch("/api/atelier/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: val }),
      });
      const json = await res.json();
      if (json.ok) {
        setRawInput("");
        setAddResults(json.results);
        setTimeout(() => setAddResults(null), 8000);
        await fetchRows();
      } else {
        setError(json.error ?? "Erreur lors de l'ajout");
        setTimeout(() => setError(""), 5000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFieldCommit(rowIndex: number, field: AtelierEditableField, value: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        if (field === "CATÉGORIE") return { ...r, categorie: value };
        if (field === "TECHNICIEN") return { ...r, technicien: value };
        if (field === "COMMENTAIRE") return { ...r, commentaire: value };
        return { ...r, besoinPiece: value };
      })
    );
    try {
      const res = await fetch("/api/atelier/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, field, value }),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "Échec de la mise à jour");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      fetchRows();
    }
  }

  async function handleDelete(rowIndex: number) {
    if (!confirm("Supprimer ?")) return;
    try {
      const res = await fetch("/api/atelier/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex }),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "Échec de la suppression");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      fetchRows();
    }
  }

  async function handleClearAll() {
    if (!confirm("Vider l'atelier ? Cette action est irréversible.")) return;
    try {
      const res = await fetch("/api/atelier/clear", { method: "POST" });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "Échec du vidage");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      fetchRows();
    }
  }

  const searched = useMemo(() => {
    const term = search.trim().toUpperCase();
    if (!term) return rows;
    return rows.filter((r) => r.imm.includes(term));
  }, [rows, search]);

  return (
    <div className="min-h-screen bg-black text-zinc-50">
      <div className="sticky top-0 z-20 border-b border-zinc-800 bg-black/95 px-3 py-2 backdrop-blur">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="text-zinc-500 transition hover:text-zinc-300" title="Accueil">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <div className="font-mono text-sm font-semibold text-amber-400">
              🔧 ATELIER <span className="ml-1 text-[10px] font-normal text-zinc-500">AVIS Maroc</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-400">
              {searched.length}
            </span>
            <button
              onClick={() => {
                setLoading(true);
                fetchRows();
              }}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400"
            >
              ⟳
            </button>
            <button
              onClick={handleClearAll}
              className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
              title="Vider l'atelier"
            >
              🗑 Vider
            </button>
            <form action={logout}>
              <button type="submit" className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400" title="Déconnexion">
                ⏻
              </button>
            </form>
          </div>
        </div>

        {/* Add plates */}
        <div ref={inputRef} className="relative">
          <input
            type="text"
            value={rawInput}
            onChange={(e) => {
              setRawInput(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setShowSuggestions(false);
                submitIMMs();
              }
            }}
            placeholder="Immatriculation(s), séparées par virgule — ex: 48070, 832223WW"
            className="h-11 w-full rounded-xl border-2 border-amber-600/60 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-500"
            autoComplete="off"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
              {suggestions.map((s) => (
                <li
                  key={s}
                  onMouseDown={() => selectSuggestion(s)}
                  className="cursor-pointer border-b border-zinc-800 px-4 py-2.5 font-mono text-sm font-semibold tracking-wide text-zinc-200 last:border-0 hover:bg-zinc-800"
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={submitIMMs}
            disabled={submitting || !rawInput.trim()}
            className="mt-2 h-10 w-full rounded-xl bg-amber-600 text-sm font-bold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Traitement…" : "➕ Ajouter / Actualiser"}
          </button>
        </div>

        {addResults && addResults.length > 0 && (
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs">
            {addResults.map((r, i) => (
              <div key={i} className="flex items-center justify-between border-b border-zinc-800 py-0.5 last:border-0">
                <span className="font-mono">{r.imm}</span>
                {r.status === "updated" ? (
                  <span className="font-semibold text-amber-400">⚠ Date actualisée (doublon)</span>
                ) : r.inParc ? (
                  <span className="font-semibold text-emerald-400">✓ Ajouté (Parc OK)</span>
                ) : (
                  <span className="font-semibold text-red-400">✗ Ajouté (inconnu Parc)</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="relative mt-2">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">🔍</span>
          <input
            type="text"
            inputMode="numeric"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par immatriculation…"
            className="h-11 w-full rounded-xl border border-zinc-700/60 bg-zinc-900/60 pl-10 pr-4 text-sm text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
          />
        </div>
      </div>

      <div className="px-3 py-3">
        {error && (
          <div className="mb-3 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading && rows.length === 0 && <div className="py-16 text-center text-sm text-zinc-500">Chargement…</div>}

        {!loading && searched.length === 0 && !error && (
          <div className="py-16 text-center text-sm text-zinc-500">Aucun véhicule en atelier</div>
        )}

        <div className="flex flex-col gap-2.5">
          {searched.map((row) => (
            <AtelierCard key={row.rowIndex} row={row} onFieldCommit={handleFieldCommit} onDelete={handleDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}
