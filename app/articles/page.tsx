"use client"

import { useState } from "react"

type ArticleResult = {
  "N°DS": string
  "CMD Num"?: string
  "Code art"?: string
  "Année": number
  "Désignation Consomation ": string
  "Fournisseur"?: string
  "Prix": number
  bc_prix?: number | null
  bc_cmd?: string | null
  price_source?: "bc" | "ds"
}

type ArticleApiResponse = {
  ok: boolean
  count: number
  items: ArticleResult[]
}

export default function ArticlePage() {

  const currentYear = new Date().getFullYear()

  const [article, setArticle] = useState("")
  const [model, setModel] = useState("")
  const [year, setYear] = useState<number | "all">(currentYear)
  const [results, setResults] = useState<ArticleResult[]>([])
  const [loading, setLoading] = useState(false)
  const [bcOnly, setBcOnly] = useState(false)

  async function search() {

    if (!article || !model) {
      alert("Please enter article and model")
      return
    }

    setLoading(true)

    const params = new URLSearchParams({
      article,
      model,
    })

    if (year !== "all") {
      params.append("year", String(year))
    }

    const res = await fetch(`/api/article?${params.toString()}`)

    const data: ArticleApiResponse = await res.json()
    const items = data.items || []

    // Enrich each result with BC price using CMD Num + Code art
    const enriched = await Promise.all(
      items.map(async (r) => {
        const cmdNum = r["CMD Num"]
        const codeArt = r["Code art"]
        if (cmdNum && codeArt) {
          try {
            const bcRes = await fetch(`/api/bc?cmd=${encodeURIComponent(cmdNum)}&code=${encodeURIComponent(codeArt)}`)
            const bcData = await bcRes.json()
            if (bcData.ok && bcData.item) {
              return { ...r, bc_prix: bcData.item.PU, bc_cmd: cmdNum, price_source: "bc" as const }
            }
          } catch { /* ignore */ }
        }
        return { ...r, price_source: "ds" as const }
      })
    )

    setResults(enriched)
    setLoading(false)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">

      <h1 className="text-2xl font-semibold mb-6">
        Recherche Prix Article
      </h1>

      {/* SEARCH PANEL */}

      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 mb-6">

        <div className="grid md:grid-cols-4 gap-3">

          <input
            placeholder="Article (ex: boite)"
            value={article}
            onChange={(e) => setArticle(e.target.value)}
            className="border border-zinc-700 bg-zinc-900 p-2 rounded"
          />

          <input
            placeholder="Modèle (ex: dokker)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="border border-zinc-700 bg-zinc-900 p-2 rounded"
          />

          <select
            value={year}
            onChange={(e) =>
              setYear(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            className="border border-zinc-700 bg-zinc-900 p-2 rounded"
          >
            <option value={currentYear}>{currentYear}</option>
            <option value="all">Toutes les années</option>
          </select>

          <button
            onClick={search}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-4"
          >
            {loading ? "Recherche..." : "Rechercher"}
          </button>

        </div>

        {/* BC only toggle */}
        {results.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setBcOnly(b => !b)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                bcOnly
                  ? "border-emerald-500 bg-emerald-950/40 text-emerald-400"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${bcOnly ? "bg-emerald-400" : "bg-zinc-600"}`} />
              {bcOnly ? "BC uniquement" : "Toutes les sources"}
            </button>
            <span className="text-xs text-zinc-500">
              {bcOnly
                ? `${results.filter(r => r.price_source === "bc").length} résultats BC`
                : `${results.length} résultats`}
            </span>
          </div>
        )}

      </div>

      {/* MOBILE */}

      <div className="md:hidden space-y-3">

        {(bcOnly ? results.filter(r => r.price_source === "bc") : results).map((r, i) => (

          <div
            key={`${r["N°DS"]}-${i}`}
            className="border border-zinc-800 rounded-lg p-3 bg-zinc-950"
          >

            <div className="flex items-center gap-1.5">
              {r.price_source === "bc"
                ? <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">BC</span>
                : <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">DS</span>
              }
              <span className="font-semibold font-mono text-sm">
                {r.price_source === "bc" ? r.bc_cmd : r["N°DS"]}
              </span>
            </div>

            <div className="mt-1 text-sm">
              {r["Désignation Consomation "]}
            </div>

            <div className="flex justify-between mt-2 text-sm text-zinc-400">
              <span>{r["Année"]}</span>
              <span>{r["Fournisseur"] ?? "-"}</span>
            </div>

            <div className="mt-2 flex items-center gap-2">
              {r.price_source === "bc"
                ? <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">BC</span>
                : <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">DS</span>
              }
              <span className="font-semibold text-indigo-400">
                {(r.bc_prix ?? r["Prix"]).toLocaleString()} MAD
              </span>
            </div>

          </div>

        ))}

      </div>

      {/* DESKTOP */}

      <div className="hidden md:block">

        <table className="w-full text-sm border border-zinc-800 rounded overflow-hidden">

          <thead className="bg-zinc-900 border-b border-zinc-800">
            <tr>
              <th className="p-3 text-left">N° Commande</th>
              <th className="p-3 text-left">Article</th>
              <th className="p-3 text-left">Année</th>
              <th className="p-3 text-left">Fournisseur</th>
              <th className="p-3 text-right">Prix</th>
            </tr>
          </thead>

          <tbody>

            {(bcOnly ? results.filter(r => r.price_source === "bc") : results).map((r, i) => (

              <tr
                key={`${r["N°DS"]}-${i}`}
                className="border-b border-zinc-900 hover:bg-zinc-900"
              >

                <td className="p-3">
                  <span className="flex items-center gap-1.5">
                    {r.price_source === "bc"
                      ? <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">BC</span>
                      : <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">DS</span>
                    }
                    <span className="font-mono">{r.price_source === "bc" ? r.bc_cmd : r["N°DS"]}</span>
                  </span>
                </td>

                <td className="p-3">
                  {r["Désignation Consomation "]}
                </td>

                <td className="p-3">{r["Année"]}</td>

                <td className="p-3">
                  {r["Fournisseur"] ?? "-"}
                </td>

                <td className="p-3 text-right font-semibold">
                  <span className="flex items-center justify-end gap-1.5">
                    {r.price_source === "bc"
                      ? <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">BC</span>
                      : <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">DS</span>
                    }
                    {(r.bc_prix ?? r["Prix"]).toLocaleString()} MAD
                  </span>
                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>

    </div>
  )
}