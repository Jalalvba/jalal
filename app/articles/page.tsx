"use client"

import { useState } from "react"

type ArticleResult = {
  "N°DS": string
  "Année": number
  "Désignation Consomation ": string
  "Fournisseur"?: string
  "Prix": number
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

    setResults(data.items || [])

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

      </div>

      {/* MOBILE */}

      <div className="md:hidden space-y-3">

        {results.map((r, i) => (

          <div
            key={`${r["N°DS"]}-${i}`}
            className="border border-zinc-800 rounded-lg p-3 bg-zinc-950"
          >

            <div className="text-xs text-zinc-500">DS</div>

            <div className="font-semibold">
              {r["N°DS"]}
            </div>

            <div className="mt-1 text-sm">
              {r["Désignation Consomation "]}
            </div>

            <div className="flex justify-between mt-2 text-sm text-zinc-400">
              <span>{r["Année"]}</span>
              <span>{r["Fournisseur"] ?? "-"}</span>
            </div>

            <div className="mt-2 font-semibold text-indigo-400">
              {r["Prix"].toLocaleString()} MAD
            </div>

          </div>

        ))}

      </div>

      {/* DESKTOP */}

      <div className="hidden md:block">

        <table className="w-full text-sm border border-zinc-800 rounded overflow-hidden">

          <thead className="bg-zinc-900 border-b border-zinc-800">
            <tr>
              <th className="p-3 text-left">DS</th>
              <th className="p-3 text-left">Article</th>
              <th className="p-3 text-left">Année</th>
              <th className="p-3 text-left">Fournisseur</th>
              <th className="p-3 text-right">Prix</th>
            </tr>
          </thead>

          <tbody>

            {results.map((r, i) => (

              <tr
                key={`${r["N°DS"]}-${i}`}
                className="border-b border-zinc-900 hover:bg-zinc-900"
              >

                <td className="p-3">{r["N°DS"]}</td>

                <td className="p-3">
                  {r["Désignation Consomation "]}
                </td>

                <td className="p-3">{r["Année"]}</td>

                <td className="p-3">
                  {r["Fournisseur"] ?? "-"}
                </td>

                <td className="p-3 text-right font-semibold">
                  {r["Prix"].toLocaleString()} MAD
                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>

    </div>
  )
}