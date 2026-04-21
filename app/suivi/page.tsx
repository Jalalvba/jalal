"use client";

import { useEffect, useState } from "react";
import type { SuiviDraft } from "@/lib/models/suivi";
import { SUIVI_FIELDS } from "@/lib/models/suivi";

type Row = SuiviDraft & { _id: string; _source: "draft" | "sheet" };

const ETAT_COLOR: Record<string, string> = {
  "EN COURS":   "border-l-blue-500   bg-blue-500/5",
  "EN ATTENTE": "border-l-orange-500 bg-orange-500/5",
  "PRET":       "border-l-green-500  bg-green-500/5",
  "ANNULEE":    "border-l-red-500    bg-red-500/5",
  "SORTI":      "border-l-zinc-500   bg-zinc-500/5",
};

const FLAG_COLOR: Record<string, string> = {
  "Urgent": "bg-red-500/20 text-red-400 border border-red-500/30",
  "Prêt":   "bg-green-500/20 text-green-400 border border-green-500/30",
  "NTR":    "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30",
  "INST":   "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
  "REP":    "bg-orange-500/20 text-orange-400 border border-orange-500/30",
  "ESSAI":  "bg-blue-500/20 text-blue-400 border border-blue-500/30",
};

const ETAT_BADGE: Record<string, string> = {
  "EN COURS":   "bg-blue-500/20   text-blue-400",
  "EN ATTENTE": "bg-orange-500/20 text-orange-400",
  "PRET":       "bg-green-500/20  text-green-400",
  "ANNULEE":    "bg-red-500/20    text-red-400",
  "SORTI":      "bg-zinc-500/20   text-zinc-400",
};

const emptyDraft = (): Omit<SuiviDraft, "_id"> => ({
  IMM: "", date: "", client: "", modele: "", ETAT: "EN COURS",
  prestataire: "", commentaire: "", flag: "", "Reunion N-1": "",
  date_ds: "", ds: "", mois_restant: "", date_fin_contrat: "",
  lieu_Reparation: "", Motif: "", station_depart: "",
});

export default function SuiviPage() {
  const [rows,        setRows]        = useState<Row[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [etatFilter,        setEtatFilter]        = useState("INTERNE");
  const [prestataireFilter, setPrestataireFilter] = useState("TOUS");
  const [showForm,    setShowForm]    = useState(false);
  const [formData,    setFormData]    = useState(emptyDraft());
  const [saving,      setSaving]      = useState(false);
  const [editingCell,       setEditingCell]       = useState<{ id: string; field: string } | null>(null);
  const [editValue,         setEditValue]         = useState("");
  const [sheetEtats,        setSheetEtats]        = useState<string[]>([]);
  const [sheetPrestataires, setSheetPrestataires] = useState<string[]>([]);
  const [flagFilter,        setFlagFilter]        = useState("TOUS");
  const [showDraftsOnly,    setShowDraftsOnly]    = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [draftRes, sheetRes] = await Promise.all([
        fetch("/api/suivi"),
        fetch("/api/sheet?sheet=bdd"),
      ]);
      const draftJson = await draftRes.json();
      const sheetJson = await sheetRes.json();

      const drafts: Row[] = (draftJson.items ?? []).map((d: SuiviDraft & { _id: string }) => ({
        ...d, _source: "draft",
      }));

      const sheets: Row[] = (sheetJson.items ?? []).map((s: Record<string, string>, i: number) => ({
        _id:              `sheet-${i}`,
        _source:          "sheet",
        IMM:              s["IMM"]           ?? "",
        date:             s["date"]          ?? "",
        client:           s["client"]        ?? "",
        modele:           s["modele"]        ?? "",
        ETAT:             s["ETAT"]          ?? "",
        prestataire:      s["prestataire"]   ?? "",
        commentaire:      s["commentaire"]   ?? "",
        flag:             s["flag"]          ?? "",
        "Reunion N-1":    s["Reunion N-1"]   ?? "",
        date_ds:          "",
        ds:               "",
        mois_restant:     "",
        date_fin_contrat: "",
        lieu_Reparation:  "",
        Motif:            "",
        station_depart:   "",
      }));

      setRows([...drafts, ...sheets]);
      const uniqueEtats = [...new Set(sheets.map(r => r.ETAT).filter(Boolean))].sort();
      const uniquePrestataires = [...new Set(sheets.map(r => r.prestataire).filter(Boolean))].sort();
      setSheetEtats(uniqueEtats);
      setSheetPrestataires(uniquePrestataires);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = rows.filter(r => {
    const matchSearch = !search ||
      r.IMM.toLowerCase().includes(search.toLowerCase()) ||
      r.client.toLowerCase().includes(search.toLowerCase());
    const matchEtat        = etatFilter === "TOUS" || r.ETAT === etatFilter;
    const matchPrestataire = prestataireFilter === "TOUS" || r.prestataire === prestataireFilter;
    const matchFlag        = flagFilter === "TOUS" || r.flag === flagFilter;
    const matchDrafts      = !showDraftsOnly || r._source === "draft";
    return matchSearch && matchEtat && matchPrestataire && matchFlag && matchDrafts;
  });

  const draftCount = rows.filter(r => r._source === "draft").length;

  const sheetOnly = rows.filter(r => r._source === "sheet");

  const visiblePrestataires = [...new Set(
    sheetOnly
      .filter(r => etatFilter === "TOUS" || r.ETAT === etatFilter)
      .map(r => r.prestataire)
      .filter(Boolean)
  )].sort();

  const visibleFlags = [...new Set(
    sheetOnly
      .filter(r =>
        (etatFilter === "TOUS" || r.ETAT === etatFilter) &&
        (prestataireFilter === "TOUS" || r.prestataire === prestataireFilter)
      )
      .map(r => r.flag)
      .filter(Boolean)
  )].sort();

  function handleEtatFilter(val: string) {
    setEtatFilter(val);
    setPrestataireFilter("TOUS");
    setFlagFilter("TOUS");
  }

  function handlePrestataireFilter(val: string) {
    setPrestataireFilter(val);
    setFlagFilter("TOUS");
  }

  function resetFilters() {
    setEtatFilter("INTERNE");
    setPrestataireFilter("TOUS");
    setFlagFilter("TOUS");
    setSearch("");
    setShowDraftsOnly(false);
  }

  function startEdit(id: string, field: string, current: string) {
    setEditingCell({ id, field });
    setEditValue(current);
  }

  async function commitEdit(row: Row) {
    if (!editingCell) return;
    if (editValue === (row as unknown as Record<string, string>)[editingCell.field]) {
      setEditingCell(null);
      return;
    }
    await fetch(`/api/suivi/${editingCell.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [editingCell.field]: editValue }),
    });
    setRows(prev => prev.map(r =>
      r._id === editingCell.id ? { ...r, [editingCell.field]: editValue } : r
    ));
    setEditingCell(null);
  }

  function openSheetEdit(row: Row) {
    setFormData({
      IMM: row.IMM, date: row.date, client: row.client, modele: row.modele,
      ETAT: row.ETAT, prestataire: row.prestataire, commentaire: row.commentaire,
      flag: row.flag, "Reunion N-1": row["Reunion N-1"], date_ds: row.date_ds,
      ds: row.ds, mois_restant: row.mois_restant, date_fin_contrat: row.date_fin_contrat,
      lieu_Reparation: row.lieu_Reparation, Motif: row.Motif, station_depart: row.station_depart,
    });
    setShowForm(true);
  }

  async function deleteDraft(id: string) {
    await fetch(`/api/suivi/${id}`, { method: "DELETE" });
    setRows(prev => prev.filter(r => r._id !== id));
  }

  function exportPdf() {
    const today = new Date().toLocaleDateString("fr-FR");
    const cols: { key: string; label: string }[] = [
      { key: "IMM",          label: "IMM" },
      { key: "date",         label: "Date" },
      { key: "client",       label: "Client" },
      { key: "modele",       label: "Modèle" },
      { key: "ETAT",         label: "État" },
      { key: "prestataire",  label: "Prestataire" },
      { key: "commentaire",  label: "Commentaire" },
      { key: "flag",         label: "Flag" },
      { key: "Reunion N-1",  label: "Réunion N-1" },
    ];

    const filterLine = [
      `État: ${etatFilter}`,
      `Prestataire: ${prestataireFilter}`,
      `Flag: ${flagFilter}`,
      showDraftsOnly ? "Brouillons uniquement" : null,
    ].filter(Boolean).join(" · ");

    const rows = filtered.map(r => {
      const cells = cols.map(({ key }) => {
        const val = (r as unknown as Record<string, string>)[key] ?? "";
        if (key === "IMM" && r._source === "draft") {
          return `<td>${val} <span style="font-size:9px;background:#e2a813;color:#000;padding:1px 4px;border-radius:3px;font-weight:bold;">DRAFT</span></td>`;
        }
        return `<td>${val}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");

    const headers = cols.map(c => `<th>${c.label}</th>`).join("");

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Suivi BDD — ${today}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 20px; }
  h1 { font-size: 16px; margin-bottom: 4px; }
  .filters { font-size: 10px; color: #555; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #2C3E50; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
  tr:nth-child(even) td { background: #f5f7fa; }
  @media print { body { margin: 10px; } }
</style>
</head>
<body>
<h1>Suivi BDD — ${today}</h1>
<div class="filters">${filterLine}</div>
<table>
  <thead><tr>${headers}</tr></thead>
  <tbody>${rows}</tbody>
</table>
<script>window.onload = () => window.print();<\/script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  }

  async function clearAllDrafts() {
    if (!window.confirm("Supprimer tous les brouillons ?")) return;
    const drafts = rows.filter(r => r._source === "draft");
    await Promise.all(drafts.map(d => fetch(`/api/suivi/${d._id}`, { method: "DELETE" })));
    setRows(prev => prev.filter(r => r._source !== "draft"));
  }

  async function submitForm() {
    if (!formData.IMM.trim()) return;
    setSaving(true);
    try {
      const res  = await fetch("/api/suivi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const json = await res.json();
      if (json.ok) {
        const newRow: Row = {
          ...formData,
          _id: json._id,
          _source: "draft",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setRows(prev => [newRow, ...prev]);
        setFormData(emptyDraft());
        setShowForm(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1114] text-[#e4e7ec] font-sans">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0f1114]/90 backdrop-blur border-b border-[#2e333d] px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="font-mono font-bold text-[#e2a813] tracking-widest text-sm uppercase">
              Suivi BDD
            </span>
            {draftCount > 0 && (
              <span className="ml-2 text-xs font-mono bg-[#e2a813]/15 text-[#e2a813] px-2 py-0.5 rounded-full">
                {draftCount} brouillon{draftCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportPdf}
              className="text-xs font-medium px-3 py-1.5 rounded-full border border-red-800/50 bg-red-950/30 text-red-400 transition-all hover:bg-red-950/60"
            >
              ⬇ PDF
            </button>
            <button
              onClick={() => setShowDraftsOnly(v => !v)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                showDraftsOnly
                  ? "border-[#e2a813] bg-[#e2a813]/15 text-[#e2a813]"
                  : "border-[#2e333d] bg-[#1a1d23] text-[#8b95a5]"
              }`}
            >
              📋 {showDraftsOnly ? "Brouillons uniquement" : "Tous"}
            </button>
            {showDraftsOnly && draftCount > 0 && (
              <button
                onClick={clearAllDrafts}
                className="text-xs font-medium px-3 py-1.5 rounded-full border border-red-800/50 bg-red-950/30 text-red-400 transition-all hover:bg-red-950/60"
              >
                🗑 Vider les brouillons
              </button>
            )}
          </div>
        </div>

        <input
          type="text"
          placeholder="Rechercher IMM ou client…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-[#1a1d23] border border-[#2e333d] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#e2a813] placeholder:text-[#8b95a5]"
        />

        <div className="flex gap-2 overflow-x-auto mt-2 pb-1 scrollbar-none">
          {["TOUS", ...sheetEtats].map(e => (
            <button
              key={e}
              onClick={() => handleEtatFilter(e)}
              className={`flex-shrink-0 text-xs font-medium px-3 py-1 rounded-full border transition-all ${
                etatFilter === e
                  ? "border-[#e2a813] bg-[#e2a813]/15 text-[#e2a813]"
                  : "border-[#2e333d] bg-[#1a1d23] text-[#8b95a5]"
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto mt-1 pb-1 scrollbar-none">
          {["TOUS", ...visiblePrestataires].map(p => (
            <button
              key={p}
              onClick={() => handlePrestataireFilter(p)}
              className={`flex-shrink-0 text-xs font-medium px-3 py-1 rounded-full border transition-all ${
                prestataireFilter === p
                  ? "border-sky-500 bg-sky-500/15 text-sky-400"
                  : "border-[#2e333d] bg-[#1a1d23] text-[#8b95a5]"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto mt-1 pb-1 scrollbar-none">
          {["TOUS", ...visibleFlags].map(f => (
            <button
              key={f}
              onClick={() => setFlagFilter(f)}
              className={`flex-shrink-0 text-xs font-medium px-3 py-1 rounded-full border transition-all ${
                flagFilter === f && f !== "TOUS"
                  ? FLAG_COLOR[f] ?? "border-violet-500 bg-violet-500/15 text-violet-400"
                  : flagFilter === f
                  ? "border-[#e2a813] bg-[#e2a813]/15 text-[#e2a813]"
                  : "border-[#2e333d] bg-[#1a1d23] text-[#8b95a5]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="flex justify-end mt-1">
          <button
            onClick={resetFilters}
            className="text-[10px] text-[#8b95a5] hover:text-[#e4e7ec] transition-colors px-2 py-0.5"
          >
            ↺ Réinitialiser
          </button>
        </div>
      </div>

      {/* Card list */}
      <div className="px-3 py-3 flex flex-col gap-3 pb-24">
        {loading && (
          <div className="text-center text-[#8b95a5] text-sm mt-10">Chargement…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-[#8b95a5] text-sm mt-10">Aucun résultat</div>
        )}

        {filtered.map(row => {
          const isDraft   = row._source === "draft";
          const etatClass = ETAT_COLOR[row.ETAT] ?? "border-l-zinc-500";
          const badgeClass = ETAT_BADGE[row.ETAT] ?? "bg-zinc-500/20 text-zinc-400";

          return (
            <div
              key={row._id}
              className={`rounded-xl border-l-4 border border-[#2e333d] p-4 ${etatClass}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="font-mono font-bold text-base text-[#e4e7ec]">
                    {row.IMM}
                  </span>
                  {isDraft && (
                    <span className="ml-2 text-[10px] font-mono bg-[#e2a813]/15 text-[#e2a813] px-1.5 py-0.5 rounded">
                      DRAFT
                    </span>
                  )}
                  <div className="text-xs text-[#8b95a5] mt-0.5">
                    {row.client} — {row.modele}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {row.flag && (
                    <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded-full ${FLAG_COLOR[row.flag] ?? "bg-zinc-500/20 text-zinc-400"}`}>
                      {row.flag}
                    </span>
                  )}
                  <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded-full ${badgeClass}`}>
                    {row.ETAT}
                  </span>
                  {isDraft ? (
                    <button
                      onClick={() => deleteDraft(row._id)}
                      className="text-[#8b95a5] hover:text-red-400 text-lg leading-none"
                    >
                      ×
                    </button>
                  ) : (
                    <button
                      onClick={() => openSheetEdit(row)}
                      className="text-[#8b95a5] hover:text-[#e2a813] text-sm leading-none transition-colors"
                      title="Modifier en brouillon"
                    >
                      ✏️
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {SUIVI_FIELDS.filter(f =>
                  !["IMM", "client", "modele", "ETAT", "date_ds", "ds", "mois_restant", "date_fin_contrat", "lieu_Reparation", "Motif", "station_depart"].includes(f.key as string)
                ).map(({ key, label }) => {
                  const val       = (row as unknown as Record<string, string>)[key as string] ?? "";
                  const isEditing = isDraft &&
                    editingCell?.id === row._id &&
                    editingCell?.field === (key as string);

                  return (
                    <div key={key as string}>
                      <div className="text-[10px] text-[#8b95a5] uppercase tracking-wide mb-0.5">
                        {label}
                      </div>
                      {isEditing ? (
                        (key as string) === "ETAT" ? (
                          <select
                            autoFocus
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(row)}
                            className="w-full bg-[#22262e] border border-[#e2a813] rounded px-1.5 py-1 text-xs text-[#e4e7ec] outline-none"
                          >
                            {sheetEtats.map(o => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (key as string) === "prestataire" ? (
                          <select
                            autoFocus
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(row)}
                            className="w-full bg-[#22262e] border border-[#e2a813] rounded px-1.5 py-1 text-xs text-[#e4e7ec] outline-none"
                          >
                            <option value=""></option>
                            {sheetPrestataires.map(o => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (key as string) === "flag" ? (
                          <select
                            autoFocus
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(row)}
                            className="w-full bg-[#22262e] border border-[#e2a813] rounded px-1.5 py-1 text-xs text-[#e4e7ec] outline-none"
                          >
                            <option value="">—</option>
                            <option value="Urgent">Urgent</option>
                            <option value="Prêt">Prêt</option>
                            <option value="NTR">NTR</option>
                            <option value="INST">INST</option>
                            <option value="REP">REP</option>
                            <option value="ESSAI">ESSAI</option>
                          </select>
                        ) : (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(row)}
                            onKeyDown={e => {
                              if (e.key === "Enter") commitEdit(row);
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                            className="w-full bg-[#22262e] border border-[#e2a813] rounded px-1.5 py-1 text-xs text-[#e4e7ec] outline-none"
                          />
                        )
                      ) : (
                        <div
                          onClick={() => isDraft && startEdit(row._id, key as string, val)}
                          className={`text-xs text-[#e4e7ec] min-h-[20px] ${
                            isDraft ? "cursor-pointer hover:text-[#e2a813] transition-colors" : ""
                          }`}
                        >
                          {val || <span className="text-[#8b95a5]">—</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* New record modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end">
          <div className="w-full bg-[#1a1d23] border-t border-[#2e333d] rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono font-bold text-[#e2a813] tracking-widest text-sm">
                Modifier — {formData.IMM}
              </span>
              <button
                onClick={() => { setShowForm(false); setFormData(emptyDraft()); }}
                className="text-[#8b95a5] hover:text-[#e4e7ec] text-2xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Read-only vehicle context */}
            <div className="mb-4 px-3 py-2 rounded-lg bg-[#22262e] border border-[#2e333d]">
              <div className="font-mono font-bold text-base text-[#e4e7ec]">{formData.IMM}</div>
              <div className="text-xs text-[#8b95a5] mt-0.5">{formData.client} — {formData.modele}</div>
            </div>

            <div className="flex flex-col gap-3">
              {/* ETAT */}
              <div>
                <label className="text-[10px] text-[#8b95a5] uppercase tracking-wide block mb-1">État</label>
                <select
                  value={formData.ETAT}
                  onChange={e => setFormData(p => ({ ...p, ETAT: e.target.value }))}
                  className="w-full bg-[#22262e] border border-[#2e333d] rounded-lg px-2 py-2 text-sm text-[#e4e7ec] outline-none focus:border-[#e2a813]"
                >
                  {sheetEtats.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              {/* Prestataire */}
              <div>
                <label className="text-[10px] text-[#8b95a5] uppercase tracking-wide block mb-1">Prestataire</label>
                <select
                  value={formData.prestataire}
                  onChange={e => setFormData(p => ({ ...p, prestataire: e.target.value }))}
                  className="w-full bg-[#22262e] border border-[#2e333d] rounded-lg px-2 py-2 text-sm text-[#e4e7ec] outline-none focus:border-[#e2a813]"
                >
                  <option value=""></option>
                  {sheetPrestataires.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              {/* Flag */}
              <div>
                <label className="text-[10px] text-[#8b95a5] uppercase tracking-wide block mb-1">Flag</label>
                <select
                  value={formData.flag}
                  onChange={e => setFormData(p => ({ ...p, flag: e.target.value }))}
                  className="w-full bg-[#22262e] border border-[#2e333d] rounded-lg px-2 py-2 text-sm text-[#e4e7ec] outline-none focus:border-[#e2a813]"
                >
                  <option value="">—</option>
                  <option value="Urgent">Urgent</option>
                  <option value="Prêt">Prêt</option>
                  <option value="NTR">NTR</option>
                  <option value="INST">INST</option>
                  <option value="REP">REP</option>
                  <option value="ESSAI">ESSAI</option>
                </select>
              </div>
              {/* Commentaire */}
              <div>
                <label className="text-[10px] text-[#8b95a5] uppercase tracking-wide block mb-1">Commentaire</label>
                <input
                  value={formData.commentaire}
                  onChange={e => setFormData(p => ({ ...p, commentaire: e.target.value }))}
                  className="w-full bg-[#22262e] border border-[#2e333d] rounded-lg px-2 py-2 text-sm text-[#e4e7ec] outline-none focus:border-[#e2a813]"
                />
              </div>
            </div>

            <button
              onClick={submitForm}
              disabled={saving || !formData.IMM.trim()}
              className="w-full mt-4 bg-[#e2a813] disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm"
            >
              {saving ? "Enregistrement…" : "Enregistrer en brouillon"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
