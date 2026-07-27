"use client"

import { useState } from "react"
import { fmtDate, fmtNum } from "@/lib/format"
import { ThemeToggle } from "@/components/fleet/ThemeToggle"
import { Alert } from "@/components/ui/alert"

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
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Recherche Prix Article</h1>
            <p className="mt-1 text-sm text-muted-foreground">Source: bc + parc + cp</p>
          </div>
          <div className="flex items-center gap-2">
            {count != null && (
              <span className="inline-flex items-center rounded-full border border-border bg-popover px-2.5 py-1 text-xs text-foreground">
                {count} résultats
              </span>
            )}
            <ThemeToggle className="border-border bg-card text-foreground hover:bg-muted" />
          </div>
        </div>

        {/* Search panel */}
        <div className="rounded-2xl border border-border bg-popover p-4 shadow-sm mb-6">
          <div className="grid gap-3 sm:grid-cols-12 sm:items-end">

            <div className="sm:col-span-5">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Article (mots-clés)</label>
              <input
                value={article}
                onChange={e => setArticle(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="ex: vidange, boite vitesse, parebrise"
                className="h-11 w-full rounded-xl border border-border bg-input px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-zinc-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Marque / Modèle</label>
              <input
                value={brand}
                onChange={e => setBrand(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="ex: Dacia, A4, Dokker"
                className="h-11 w-full rounded-xl border border-border bg-input px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-zinc-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Année</label>
              <select
                value={year}
                onChange={e => setYear(e.target.value === "all" ? "all" : Number(e.target.value))}
                className="h-11 w-full rounded-xl border border-border bg-input px-3 text-sm outline-none focus:border-zinc-500"
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
                className="h-11 w-full rounded-xl bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Recherche…" : "Rechercher"}
              </button>
            </div>

          </div>

          {error && (
            <Alert className="mt-3">{error}</Alert>
          )}
        </div>

        {/* Results table */}
        {results.length > 0 && (
          <div className="rounded-2xl border border-border bg-popover overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-left text-xs font-semibold text-muted-foreground border-b border-border">
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
                <tbody className="divide-y divide-border">
                  {results.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/50">
                      <td className="px-4 py-2 text-muted-foreground">
                        {r.Fournisseurs || "—"}
                      </td>
                      <td className="px-4 py-2 text-foreground">
                        {r["Description article"] || "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-400 whitespace-nowrap">
                        {fmtNum(r.PU, 2)} MAD
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {r["Qté"] || "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {r.Marque || "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {r.Modele || "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {r.Version || "—"}
                      </td>
                      <td className="px-4 py-2 tabular-nums whitespace-nowrap text-muted-foreground">
                        {fmtDate(r.DateMCE)}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {r["Cree par"] || "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
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
          <div className="rounded-2xl border border-border bg-popover p-6 text-sm text-muted-foreground">
            Aucun résultat trouvé.
          </div>
        )}

      </div>
    </div>
  )
}
