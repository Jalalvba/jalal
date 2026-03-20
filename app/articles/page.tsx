"use client"

import { useState } from "react"

type ArticleResult = {
  "CMD Num":             string
  "Date BC":             string
  Fournisseurs:          string
  "Code article":        string
  "Description article": string
  PU:                    number
  "Qté":                 string
  "N° DS":               string
  "Cree par":            string
  Année:                 number
  Prix:                  number
  Immatriculation?:      string | null
  Marque?:               string | null
  Modele?:               string | null
  Version?:              string | null
  DateMCE?:              string | null
}

type ArticleApiResponse = {
  ok:     boolean
  count:  number
  items:  ArticleResult[]
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10)
}

function fmtNum(v?: number | null): string {
  if (v == null) return "—"
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

export default function ArticlePage() {
  const currentYear = new Date().getFullYear()

  const [article, setArticle] = useState("")
  const [brand,   setBrand]   = useState("")
  const [year,    setYear]    = useState<number | "all">(currentYear)
  const [results, setResults] = useState<ArticleResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState("")
  const [count,   setCount]   = useState<number | null>(null)

  async function search() {
    if (!article.trim()) return
    setLoading(true)
    setError("")
    setResults([])
    setCount(null)

    try {
      const params = new URLSearchParams({ article: article.trim() })
      if (brand.trim()) params.append("brand", brand.trim())
      if (year !== "all") params.append("year", String(year))

      const res  = await fetch(`/api/article?${params}`)
      const data: ArticleApiResponse = await res.json()

      if (!data.ok) { setError("Erreur API"); return }
      setResults(data.items)
      setCount(data.count)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue")
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") search()
  }

  return (
    <div className="min-h-screen bg-black text-zinc-50">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Recherche Prix Article</h1>
            <p className="mt-1 text-sm text-zinc-500">Source: bc + parc + cp</p>
          </div>
          {count != null && (
            <span className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300">
              {count} résultats
            </span>
          )}
        </div>

        {/* Search panel */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 shadow-sm mb-6">
          <div className="grid gap-3 sm:grid-cols-12 sm:items-end">

            <div className="sm:col-span-5">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Article (mots-clés)</label>
              <input
                value={article}
                onChange={e => setArticle(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="ex: vidange, boite vitesse, parebrise"
                className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-zinc-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Marque / Modèle</label>
              <input
                value={brand}
                onChange={e => setBrand(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="ex: Dacia, A4, Dokker"
                className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-zinc-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Année</label>
              <select
                value={year}
                onChange={e => setYear(e.target.value === "all" ? "all" : Number(e.target.value))}
                className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm outline-none focus:border-zinc-500"
              >
                {Array.from({ length: 6 }, (_, i) => currentYear - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
                <option value="all">Toutes les années</option>
              </select>
            </div>

            <div className="sm:col-span-3">
              <button
                onClick={search}
                disabled={loading || !article.trim()}
                className="h-11 w-full rounded-xl bg-zinc-100 px-4 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Recherche…" : "Rechercher"}
              </button>
            </div>

          </div>

          {error && (
            <div className="mt-3 rounded-xl border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Results table */}
        {results.length > 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-900 text-left text-xs font-semibold text-zinc-400 border-b border-zinc-800">
                    <th className="px-4 py-3">Fournisseur</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">PU</th>
                    <th className="px-4 py-3 text-right">Qté</th>
                    <th className="px-4 py-3">Marque</th>
                    <th className="px-4 py-3">Modèle</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3 whitespace-nowrap">Date MCE</th>
                    <th className="px-4 py-3">Créé par</th>
                    <th className="px-4 py-3 text-right">Année</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {results.map((r, i) => (
                    <tr key={i} className="hover:bg-zinc-900/50">
                      <td className="px-4 py-2 text-zinc-400">
                        {r.Fournisseurs || "—"}
                      </td>
                      <td className="px-4 py-2 text-zinc-200">
                        {r["Description article"] || "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-400 whitespace-nowrap">
                        {fmtNum(r.PU)} MAD
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-zinc-400">
                        {r["Qté"] || "—"}
                      </td>
                      <td className="px-4 py-2 text-zinc-400">
                        {r.Marque || "—"}
                      </td>
                      <td className="px-4 py-2 text-zinc-400">
                        {r.Modele || "—"}
                      </td>
                      <td className="px-4 py-2 text-zinc-400">
                        {r.Version || "—"}
                      </td>
                      <td className="px-4 py-2 tabular-nums whitespace-nowrap text-zinc-400">
                        {fmtDate(r.DateMCE)}
                      </td>
                      <td className="px-4 py-2 text-zinc-400">
                        {r["Cree par"] || "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-zinc-400">
                        {r.Année || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && results.length === 0 && count === 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-500">
            Aucun résultat trouvé.
          </div>
        )}

      </div>
    </div>
  )
}
