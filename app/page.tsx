// app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Line = {
  code_art?: string;
  qte?: number;
};

type DsHistoryItem = {
  "N°DS": string;
  Site?: string;
  "Date DS"?: string; // ISO string from API
  Immatriculation?: string;
  KM?: number;
  ENTITE?: string;
  Description?: string;
  Technicien?: string | null;
  lines?: Line[];
};

type ApiResponse = {
  ok: boolean;
  imm: string;
  count: number;
  items: DsHistoryItem[];
  error?: string;
};

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}

function fmtKm(km?: number) {
  if (km == null) return "";
  return new Intl.NumberFormat("fr-FR").format(km);
}

function pickMostCommonCodes(lines?: Line[], max = 4) {
  if (!lines?.length) return [];
  const counts = new Map<string, number>();
  for (const l of lines) {
    const code = (l.code_art ?? "").trim();
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + (l.qte ?? 1));
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([code, qty]) => ({ code, qty }));
}

export default function Home() {
  const [imm, setImm] = useState("48070-B-7");
  const [year, setYear] = useState<string>(""); // optional
  const [limit, setLimit] = useState(200);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [data, setData] = useState<ApiResponse | null>(null);

  const years = useMemo(() => {
    const now = new Date().getUTCFullYear();
    return Array.from({ length: 6 }, (_, i) => String(now - i));
  }, []);

  async function fetchHistory(nextImm?: string) {
    const immVal = (nextImm ?? imm).trim();
    if (!immVal) return;

    setLoading(true);
    setError("");

    try {
      const qs = new URLSearchParams();
      qs.set("imm", immVal);
      qs.set("limit", String(limit));
      if (year) qs.set("year", year);

      const res = await fetch(`/api/ds/history?${qs.toString()}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.ok) {
        setData(null);
        setError(json?.error || `Request failed (${res.status})`);
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

  useEffect(() => {
    // First load
    fetchHistory("48070-B-7");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              DS History
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Search by Immatriculation and browse DS grouped by N°DS.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
              {data ? `${data.count} DS` : "—"}
            </span>
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
              {loading ? "Loading…" : "Ready"}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="grid gap-3 sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-5">
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Immatriculation
              </label>
              <input
                value={imm}
                onChange={(e) => setImm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") fetchHistory();
                }}
                placeholder="ex: 48070-B-7"
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Year (optional)
              </label>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600"
              >
                <option value="">All years</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Limit
              </label>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                min={1}
                max={2000}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600"
              />
            </div>

            <div className="sm:col-span-2">
              <button
                onClick={() => fetchHistory()}
                disabled={loading || !imm.trim()}
                className="h-11 w-full rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                Search
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          ) : null}
        </div>

        {/* Results */}
        <div className="mt-6">
          {!data && !loading ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              Enter an immatriculation and click Search.
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="h-5 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900"
                  />
                ))}
              </div>
            </div>
          ) : null}

          {data && !loading ? (
            <div className="space-y-3">
              {data.items.map((it) => {
                const topCodes = pickMostCommonCodes(it.lines, 4);
                const tech =
                  (it.Technicien ?? "").trim() || "Fournisseur Externe";

                return (
                  <div
                    key={`${it["N°DS"]}-${it["Date DS"]}`}
                    className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                            {it.Site ?? "—"}
                          </span>

                          <span className="text-sm font-semibold">
                            {it["N°DS"]}
                          </span>

                          <span className="text-sm text-zinc-500 dark:text-zinc-400">
                            • {fmtDate(it["Date DS"])}
                          </span>
                        </div>

                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div className="text-sm">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">
                              Entité
                            </div>
                            <div className="truncate">
                              {it.ENTITE ?? "—"}
                            </div>
                          </div>
                          <div className="text-sm">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">
                              KM
                            </div>
                            <div>{fmtKm(it.KM)}</div>
                          </div>
                          <div className="text-sm sm:col-span-2">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">
                              Description
                            </div>
                            <div className="whitespace-pre-wrap">
                              {it.Description?.trim() || "—"}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                          Tech: {tech}
                        </span>

                        {topCodes.length ? (
                          <div className="flex flex-wrap gap-2 sm:justify-end">
                            {topCodes.map((c) => (
                              <span
                                key={c.code}
                                className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                                title={`Total qty: ${c.qty}`}
                              >
                                {c.code} · {c.qty}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            No lines
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Details: show all lines */}
                    {it.lines?.length ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer select-none text-sm text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
                          Show lines ({it.lines.length})
                        </summary>

                        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                          <div className="grid grid-cols-12 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                            <div className="col-span-9">Code art</div>
                            <div className="col-span-3 text-right">Qté</div>
                          </div>

                          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                            {it.lines.map((l, idx) => (
                              <div
                                key={`${it["N°DS"]}-line-${idx}`}
                                className="grid grid-cols-12 px-3 py-2 text-sm"
                              >
                                <div className="col-span-9 truncate">
                                  {l.code_art?.trim() || "—"}
                                </div>
                                <div className="col-span-3 text-right tabular-nums">
                                  {l.qte ?? 0}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}