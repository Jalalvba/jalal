// app/page.tsx
"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Line = {
  code_art?:          string;
  designation_conso?: string;
  qte?:               string;
  cmd_num?:           string;
  fournisseur?:       string;
  technicein?:        string;
  price_source?:      "bc" | "ds";
  bc_pu?:             number | null;
};

type DsItem = {
  "N°DS":          string;
  "Date DS"?:      string;
  Immatriculation?: string;
  KM?:             number | null;
  ENTITE?:         string;
  Description?:    string;
  Techniciens?:    string[];
  lines?:          Line[];
};

type DsApiResponse = {
  ok:     boolean;
  imm:    string;
  count:  number;
  items:  DsItem[];
  error?: string;
};

type SearchResult = { imm: string; ww: string; label: string; primary?: string; secondary?: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10);
}

function fmtNum(v?: number | null, dec = 0): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits:  dec,
    maximumFractionDigits:  dec,
  }).format(v);
}

// ─── Lines Table ──────────────────────────────────────────────────────────────

function LinesTable({ lines }: { lines: Line[] }) {
  if (!lines.length) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-zinc-50 text-left font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <th className="px-3 py-2 whitespace-nowrap">Code art</th>
            <th className="px-3 py-2">Désignation</th>
            <th className="px-3 py-2 text-right">Qté</th>
            <th className="px-3 py-2 whitespace-nowrap">CMD Num</th>
            <th className="px-3 py-2">Fournisseur</th>
            <th className="px-3 py-2">Technicien</th>
            <th className="px-3 py-2 text-right">PU BC</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {lines.map((l, idx) => (
            <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
              <td className="px-3 py-2 font-mono font-medium text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                {l.code_art || "—"}
              </td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                {l.designation_conso || "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">
                {l.qte || "—"}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="flex items-center gap-1.5">
                  {l.price_source === "bc"
                    ? <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">BC</span>
                    : <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">DS</span>
                  }
                  {l.cmd_num || "—"}
                </span>
              </td>
              <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                {l.fournisseur || "—"}
              </td>
              <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                {l.technicein || "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
                {l.bc_pu != null ? fmtNum(l.bc_pu, 2) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── DS Card ──────────────────────────────────────────────────────────────────

function DsCard({ item }: { item: DsItem }) {
  const [open, setOpen] = useState(false);
  const nds = item["N°DS"];

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">

      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold tabular-nums text-zinc-800 dark:text-zinc-100">
            {fmtDate(item["Date DS"])}
          </span>
          {item.KM != null && (
            <>
              <span className="text-zinc-400">•</span>
              <span className="text-sm font-bold tabular-nums text-zinc-800 dark:text-zinc-100">
                {fmtNum(item.KM)} km
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.ENTITE && (
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800 dark:text-zinc-300">
              {item.ENTITE}
            </span>
          )}
          <span className="text-sm font-bold tracking-tight">{nds}</span>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-3">
        {item.Description && (
          <div>
            <div className="text-xs text-zinc-400 dark:text-zinc-500">Description</div>
            <div className="mt-0.5 text-sm font-medium text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
              {item.Description}
            </div>
          </div>
        )}
        {item.Techniciens && item.Techniciens.length > 0 && (
          <div>
            <div className="text-xs text-zinc-400 dark:text-zinc-500">Techniciens</div>
            <div className="mt-0.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {item.Techniciens.join(", ")}
            </div>
          </div>
        )}
      </div>

      {/* Lines */}
      {item.lines && item.lines.length > 0 && (
        <div className="border-t border-zinc-100 px-5 pb-4 pt-3 dark:border-zinc-800">
          <button
            onClick={() => setOpen(o => !o)}
            className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              {open
                ? <path d="M4 10l4-4 4 4" strokeLinecap="round"/>
                : <path d="M4 6l4 4 4-4" strokeLinecap="round"/>
              }
            </svg>
            Lignes ({item.lines.length})
          </button>
          {open && <LinesTable lines={item.lines} />}
        </div>
      )}

    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [imm,   setImm]   = useState("48070-B-7");
  const [year,  setYear]  = useState("");
  const [limit, setLimit] = useState(200);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [data,    setData]    = useState<DsApiResponse | null>(null);

  // Smart search
  const [suggestions,    setSuggestions]    = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading,  setSearchLoading]  = useState(false);
  const searchRef   = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dark mode
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved) setDark(saved === "dark");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setShowSuggestions(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const years = useMemo(() => {
    const now = new Date().getUTCFullYear();
    return Array.from({ length: 8 }, (_, i) => String(now - i));
  }, []);

  function handleImmChange(val: string) {
    setImm(val);
    setShowSuggestions(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res  = await fetch(`/api/query/search?q=${encodeURIComponent(val.trim())}`);
        const json = await res.json();
        setSuggestions(json.results ?? []);
        setShowSuggestions((json.results ?? []).length > 0);
      } catch { setSuggestions([]); }
      finally { setSearchLoading(false); }
    }, 300);
  }

  function selectSuggestion(s: SearchResult) {
    setImm(s.imm);
    setSuggestions([]);
    setShowSuggestions(false);
    fetchDs(s.imm);
  }

  function handleImmKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    setShowSuggestions(false);
    if (suggestions.length === 1) { selectSuggestion(suggestions[0]); return; }
    if (suggestions.length === 0) { fetchDs(); return; }
  }

  async function fetchDs(nextImm?: string) {
    const raw = (nextImm ?? imm).trim();
    if (!raw) return;

    setLoading(true);
    setError("");
    setSuggestions([]);
    setShowSuggestions(false);

    try {
      let immVal = raw;

      if (raw.length < 10) {
        const res  = await fetch(`/api/query?q=${encodeURIComponent(raw)}`);
        const json = await res.json();
        if (json.ok && json.mode === "suggest") {
          setSuggestions(json.suggestions ?? []);
          setShowSuggestions(true);
          setData(null);
          return;
        }
        if (json.ok && json.mode === "data") {
          immVal = json.imm ?? raw;
          setImm(immVal);
        }
      }

      const qs = new URLSearchParams({ imm: immVal, limit: String(limit) });
      if (year) qs.set("year", year);

      const res  = await fetch(`/api/ds/history?${qs}`);
      const json = await res.json() as DsApiResponse;

      if (!res.ok || !json.ok) {
        setData(null);
        setError(json?.error || `Erreur DS (${res.status})`);
      } else {
        setData(json);
      }
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchDs("48070-B-7"); }, []); // eslint-disable-line

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">DS History</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Recherche par immatriculation / WW / VIN
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
              {data ? `${data.count} DS` : "—"}
            </span>
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950">
              {loading ? "⏳ Chargement…" : "✓ Prêt"}
            </span>

            <Link href="/articles"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-400">
              🔎 Articles
            </Link>

            <button onClick={() => setDark(d => !d)}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
              {dark
                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeLinecap="round"/></svg>
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              }
              {dark ? "Clair" : "Sombre"}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="grid gap-3 sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-5" ref={searchRef}>
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Immatriculation / WW / VIN
              </label>
              <div className="relative">
                <input
                  value={imm}
                  onChange={e => handleImmChange(e.target.value)}
                  onKeyDown={handleImmKeyDown}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  placeholder="ex: 48070-B-7"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 pr-8 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600"
                />
                {searchLoading && (
                  <div className="absolute right-3 top-3.5">
                    <svg className="h-4 w-4 animate-spin text-zinc-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  </div>
                )}
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="absolute z-50 mt-1 w-full rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    {suggestions.map(s => (
                      <li key={s.imm}
                        onMouseDown={() => selectSuggestion(s)}
                        className="cursor-pointer px-4 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-100">{s.primary ?? s.imm}</span>
                        {s.label && <span className="ml-2 text-xs text-zinc-400">{s.label}</span>}
                        {s.secondary && <span className="ml-2 text-xs text-zinc-500">{s.secondary}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Année</label>
              <select value={year} onChange={e => setYear(e.target.value)}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600">
                <option value="">Toutes les années</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Limite</label>
              <input type="number" value={limit} onChange={e => setLimit(Number(e.target.value))} min={1} max={2000}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600" />
            </div>

            <div className="sm:col-span-2">
              <button onClick={() => fetchDs()} disabled={loading || !imm.trim()}
                className="h-11 w-full rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
                Rechercher
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        <div className="mt-4 space-y-3">
          {!data && !loading && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
              Entrez une immatriculation et cliquez sur Rechercher.
            </div>
          )}

          {loading && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="h-5 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-4 space-y-3">
                {[0,1,2,3].map(i => (
                  <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
                ))}
              </div>
            </div>
          )}

          {data && !loading && data.items.map(item => (
            <DsCard key={item["N°DS"]} item={item} />
          ))}
        </div>

      </div>
    </div>
  );
}
