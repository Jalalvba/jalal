"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { logout } from "@/app/login/actions";
import type { ParkingRow, ParkingAddResultItem } from "@/lib/types";

function stripAlnum(s: string): string {
  return s.replace(/[^A-Z0-9]/g, "");
}

function currentTokenFragment(value: string): string {
  const tokens = value.split(",");
  return tokens[tokens.length - 1].trim().toUpperCase();
}

// ─── Parking card (per row) ────────────────────────────────────────────────

function ParkingCard({
  row,
  onActionCommit,
  onDelete,
}: {
  row: ParkingRow;
  onActionCommit: (rowIndex: number, action: string) => void;
  onDelete: (rowIndex: number) => void;
}) {
  const [action, setAction] = useState(row.action);

  useEffect(() => {
    setAction(row.action); // eslint-disable-line react-hooks/set-state-in-effect
  }, [row.rowIndex, row.action, row.timestamp]);

  return (
    <div className="relative rounded-xl border border-zinc-800 bg-zinc-900 p-3.5">
      <button
        onClick={() => onDelete(row.rowIndex)}
        className="absolute right-3 top-2.5 text-sm font-bold text-zinc-500 hover:text-red-400"
        title="Supprimer"
      >
        ✕
      </button>

      <div className="space-y-1 pr-6">
        <div className="font-mono text-sm font-bold tracking-wide text-zinc-100">{row.imm}</div>
        {(row.marque || row.model || row.client) && (
          <div className="text-[10px] leading-relaxed text-zinc-400">
            {[row.marque, row.model].filter(Boolean).join(" ")}
            {row.client ? ` | ${row.client}` : ""}
          </div>
        )}
        {row.timestamp && (
          <span className="mt-0.5 inline-block rounded bg-zinc-950 px-2 py-0.5 text-[9px] font-semibold text-zinc-500">
            {row.timestamp}
          </span>
        )}
      </div>

      <div className="mt-3 w-full">
        <input
          type="text"
          value={action}
          placeholder="Décrire l'action…"
          onChange={(e) => setAction(e.target.value)}
          onBlur={() => {
            if (action !== row.action) onActionCommit(row.rowIndex, action);
          }}
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-[11px] font-medium tracking-wide text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-sky-500"
        />
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function ParkingPage() {
  const [rows, setRows] = useState<ParkingRow[]>([]);
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
      const res = await fetch("/api/parking");
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
      const res = await fetch("/api/parking/add", {
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

  async function handleActionCommit(rowIndex: number, action: string) {
    setRows((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, action } : r)));
    try {
      const res = await fetch("/api/parking/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, action }),
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
    if (!confirm("Supprimer cette ligne ?")) return;
    try {
      const res = await fetch("/api/parking/delete", {
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
    if (!confirm("Vider tout le Parking ? Cette action est irréversible.")) return;
    try {
      const res = await fetch("/api/parking/clear", { method: "POST" });
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
            <div className="font-mono text-sm font-semibold text-sky-400">
              PARKING <span className="ml-1 text-[10px] font-normal text-zinc-500">AVIS Maroc</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] text-sky-400">
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
              title="Vider tout le Parking"
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
            className="h-11 w-full rounded-xl border-2 border-sky-600/60 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500"
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
            className="mt-2 h-10 w-full rounded-xl bg-sky-600 text-sm font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="py-16 text-center text-sm text-zinc-500">Aucun véhicule en parking</div>
        )}

        <div className="flex flex-col gap-2.5">
          {searched.map((row) => (
            <ParkingCard key={row.rowIndex} row={row} onActionCommit={handleActionCommit} onDelete={handleDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}
