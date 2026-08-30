// DS History "Analyse IA": the prompt, the output contract, and the two
// code-side guards that stand between the model and the UI.
//
// Lives under src/lib/ai/prompts/ rather than in src/lib/ai/ proper because the
// module boundary matters: src/lib/ai/{types,pricing,usage,gemini,index}.ts is
// infrastructure (how to call a model), while this file is domain logic (what
// to ask, and what counts as an acceptable answer). Keeping them in one module
// but separate folders means a second feature adds a file here, not there.

export const MAX_ENTRIES = 80;

// ── Input (built client-side from data the page already holds) ─────────────

/** Who actually did the repair. "inconnu" is a real answer, not a default. */
export type RepairOrigin = "interne" | "externe" | "inconnu";

export type DsAnalysisEntry = {
  date?: string;
  km?: number;
  description?: string;
  /** designation_consommation values from the DS lines — the strongest signal. */
  parts: string[];
  origin: RepairOrigin;
  /** Canonical supplier name. Absent when externe-but-unnamed, or not externe. */
  supplier?: string;
};

// ── Internal vs external classification ───────────────────────────────────

/**
 * The literal `technicien` value AVIS uses to mean "this was done outside".
 * It is the single most common technicien value in the whole ds collection
 * (48,834 occurrences, ahead of every real human name), and 10,277 of those
 * carry NO fournisseur — so a rule based on "fournisseur is empty" alone would
 * file all 10,277 as in-house work. Verified against production 2026-08-20.
 */
export const EXTERNAL_TECHNICIAN_SENTINEL = "Fournisseur Externe";

/**
 * Classifies one DS entry.
 *
 *   externe  fournisseur named, OR technicien is the sentinel above
 *   interne  neither, but a real technicien name is present
 *   inconnu  neither — the data does not say, and we do not guess
 *
 * Measured across 102,336 DS: 40.5% externe, 50.9% interne, 8.6% inconnu.
 *
 * `entite_nom` is deliberately NOT consulted: it holds only 7 values, all AVIS
 * sites (Garage Ain Sebaa, Entité Siège, ...), so it says WHERE a DS was
 * raised, not WHO did the work — an external repair is routinely logged
 * against an AVIS garage.
 */
export function classifyRepairOrigin(
  fournisseur: unknown,
  techniciens: unknown
): { origin: RepairOrigin; supplier?: string } {
  // String()-coerced: these come from Mongo and do not honour their declared
  // types — the same footgun 77f9eef fixed in the PDF export.
  const supplier = String(fournisseur ?? "").trim();
  const techs = Array.isArray(techniciens) ? techniciens.map((t) => String(t ?? "").trim()) : [];

  if (supplier) return { origin: "externe", supplier };
  if (techs.some((t) => t.toLowerCase() === EXTERNAL_TECHNICIAN_SENTINEL.toLowerCase())) {
    return { origin: "externe" }; // external, but the supplier was never recorded
  }
  if (techs.some((t) => t.length > 0)) return { origin: "interne" };
  return { origin: "inconnu" };
}

/**
 * Collapses spelling variants of one supplier onto a single display name.
 *
 * Measured: 179 raw distinct names normalise to 178 — exactly one real
 * collision ("EQUIPEMENT MOYEN ATLAS ASSALAMA" vs "Equipement moyen atlas
 * assalama"). Nearly a no-op, and done in code precisely because it is:
 * instructing the model to treat "near-identical names" as the same supplier
 * would invite it to merge genuinely different ones, which is a worse failure
 * than the problem being solved.
 *
 * The winning spelling is the most frequent raw form, so the model quotes a
 * name that actually appears in the data (which the supplier guard then
 * enforces).
 */
export function canonicalizeSuppliers(entries: DsAnalysisEntry[]): DsAnalysisEntry[] {
  const counts = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!e.supplier) continue;
    const key = e.supplier.toUpperCase().replace(/\s+/g, " ").trim();
    const forms = counts.get(key) ?? new Map<string, number>();
    forms.set(e.supplier, (forms.get(e.supplier) ?? 0) + 1);
    counts.set(key, forms);
  }
  const winner = new Map<string, string>();
  for (const [key, forms] of counts) {
    winner.set(key, [...forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  }
  return entries.map((e) =>
    e.supplier
      ? { ...e, supplier: winner.get(e.supplier.toUpperCase().replace(/\s+/g, " ").trim()) ?? e.supplier }
      : e
  );
}

export type DsAnalysisReplacement = { date?: string; motif?: string };

export type DsAnalysisInput = {
  imm: string;
  /** ISO date, or null when the vehicle has no contract record. */
  contractEnd: string | null;
  vehicle: {
    brand?: string;
    model?: string;
    /** The tab's own ETAT VÉHICULE — LLD, ATV, Remplacement, En stock, LCD. */
    state?: string;
    /** cp's contract `statut` — "Livré", "Arret facturation", "Restitué". */
    cpStatus?: string;
    /** Client, or the parc tab's Société when there is no client. */
    owner?: string;
    /** True for AVIS's own fleet (short-term rental). See googleSheetsParc.ts. */
    isAvis?: boolean;
    zoning?: string;
    prestataire?: string;
    bdd?: string;
  };
  replacements: DsAnalysisReplacement[];
  entries: DsAnalysisEntry[];
  /**
   * Odometer entered by hand on the Parking tab's KM column, when one exists.
   * Absent for every other zone — Atelier/Depot/DS History have no such column
   * and keep the DS-derived reading. Resolution and precedence live in
   * resolveVehicleKm() (prompts/maintenanceIntervals.ts), never here.
   */
  manualKm?: number;
};

// ── Output contract ───────────────────────────────────────────────────────

export type ContractLevel = "ok" | "warn" | "expired" | "unknown";
export type FindingLevel = "info" | "warn" | "critical";

export type DsAnalysisFinding = { level: FindingLevel; title: string; detail: string };

export type DsAnalysis = {
  contractFlag: { level: ContractLevel; label: string };
  /**
   * The work order: imperative one-liners a service advisor copies straight
   * into an ordre de réparation ("Remplacer le filtre à gasoil (jamais
   * enregistré, 144 878 km)"). This is what the reader acts on; `findings` is
   * the evidence behind it and `summary` is one sentence of context.
   *
   * Optional at runtime, not by design: an analysis stored before this field
   * existed has none, and the browser can hold newer client JS than the
   * deploy that answered it. Read it as possibly-absent everywhere.
   */
  actions?: string[];
  findings: DsAnalysisFinding[];
  summary: string;
  /** True when the data is too thin to conclude anything — see rule 6. */
  insufficientData: boolean;
};

// ── Contract status: computed in code, never asked of the model ───────────

const DAY_MS = 86_400_000;
const WARN_DAYS = 90;

/**
 * Date arithmetic is deterministic and models are unreliable at it, so this is
 * computed here and handed TO the model as a fact to explain — not asked of it.
 * That also makes the contract flag testable, which a model-generated one
 * would not be.
 */
export function computeContractStatus(
  contractEnd: string | null,
  now: Date = new Date()
): { level: ContractLevel; label: string; daysRemaining: number | null } {
  if (!contractEnd) {
    return { level: "unknown", label: "Date de fin de contrat indisponible", daysRemaining: null };
  }
  const end = new Date(contractEnd);
  if (Number.isNaN(end.getTime())) {
    return { level: "unknown", label: "Date de fin de contrat illisible", daysRemaining: null };
  }
  const days = Math.round((end.getTime() - now.getTime()) / DAY_MS);
  const fr = end.toLocaleDateString("fr-FR");
  if (days < 0) return { level: "expired", label: `Contrat terminé depuis le ${fr}`, daysRemaining: days };
  if (days <= WARN_DAYS) return { level: "warn", label: `Contrat se termine le ${fr} (${days} j)`, daysRemaining: days };
  return { level: "ok", label: `Contrat valide jusqu'au ${fr}`, daysRemaining: days };
}

// ── Guard 1: shape validation ─────────────────────────────────────────────

const CONTRACT_LEVELS: ContractLevel[] = ["ok", "warn", "expired", "unknown"];
const FINDING_LEVELS: FindingLevel[] = ["info", "warn", "critical"];

/**
 * Gemini's responseSchema steers generation; it does not constrain the decoder,
 * so a wrong-shaped response is possible and must be caught before anything
 * reaches Mongo or the UI. Every field is checked — a partially-valid analysis
 * rendered as complete is worse than an error.
 */
export function dsAnalysisShapeError(v: unknown): string | null {
  if (typeof v !== "object" || v === null) return "not an object";
  const o = v as Record<string, unknown>;

  const cf = o.contractFlag as Record<string, unknown> | undefined;
  if (!cf || typeof cf !== "object") return "contractFlag missing";
  if (!CONTRACT_LEVELS.includes(cf.level as ContractLevel)) return `contractFlag.level=${JSON.stringify(cf.level)}`;
  if (typeof cf.label !== "string" || !cf.label.trim()) return "contractFlag.label empty";

  if (!Array.isArray(o.findings)) return "findings not an array";
  for (let i = 0; i < o.findings.length; i++) {
    const f = o.findings[i];
    if (typeof f !== "object" || f === null) return `findings[${i}] not an object`;
    const fo = f as Record<string, unknown>;
    if (!FINDING_LEVELS.includes(fo.level as FindingLevel)) return `findings[${i}].level=${JSON.stringify(fo.level)}`;
    if (typeof fo.title !== "string" || !fo.title.trim()) return `findings[${i}].title empty`;
    if (typeof fo.detail !== "string") return `findings[${i}].detail not a string`;
  }

  // Absent is tolerated (older stored analyses predate the field); present but
  // wrong-shaped is not.
  if (o.actions !== undefined) {
    if (!Array.isArray(o.actions)) return "actions not an array";
    for (let i = 0; i < o.actions.length; i++) {
      if (typeof o.actions[i] !== "string" || !(o.actions[i] as string).trim()) {
        return `actions[${i}] not a non-empty string`;
      }
    }
  }

  if (typeof o.summary !== "string" || !o.summary.trim()) return "summary empty";
  if (typeof o.insufficientData !== "boolean") return `insufficientData=${JSON.stringify(o.insufficientData)}`;
  return null;
}

export function isDsAnalysisShape(v: unknown): v is DsAnalysis {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;

  const cf = o.contractFlag as Record<string, unknown> | undefined;
  if (!cf || typeof cf !== "object") return false;
  if (!CONTRACT_LEVELS.includes(cf.level as ContractLevel)) return false;
  if (typeof cf.label !== "string" || !cf.label.trim()) return false;

  if (!Array.isArray(o.findings)) return false;
  for (const f of o.findings) {
    if (typeof f !== "object" || f === null) return false;
    const fo = f as Record<string, unknown>;
    if (!FINDING_LEVELS.includes(fo.level as FindingLevel)) return false;
    if (typeof fo.title !== "string" || !fo.title.trim()) return false;
    if (typeof fo.detail !== "string") return false;
  }

  if (o.actions !== undefined) {
    if (!Array.isArray(o.actions)) return false;
    if (o.actions.some((a) => typeof a !== "string" || !a.trim())) return false;
  }

  if (typeof o.summary !== "string" || !o.summary.trim()) return false;
  if (typeof o.insufficientData !== "boolean") return false;
  return true;
}

// ── Guard 2: date grounding ───────────────────────────────────────────────

// DD/MM/YYYY, D/M/YYYY, MM/YYYY, and YYYY-MM-DD. Deliberately does NOT match a
// bare year: "2024" appears constantly in ordinary prose ("depuis 2024") and
// flagging it would reject sound analyses.
const DATE_RE = /\b(\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/g;

/** Every way a source date might legitimately be written back by the model. */
function dateVariants(iso: string): string[] {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return [];
  const dd = String(d.getDate()).padStart(2, "0");
  const m = String(d.getMonth() + 1);
  const mm = m.padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return [
    `${dd}/${mm}/${yyyy}`, `${d.getDate()}/${m}/${yyyy}`, `${dd}/${m}/${yyyy}`, `${d.getDate()}/${mm}/${yyyy}`,
    `${mm}/${yyyy}`, `${m}/${yyyy}`,
    `${yyyy}-${mm}-${dd}`,
  ];
}

/**
 * Rejects any date the model wrote that does not appear in the source data.
 *
 * A fabricated date is the highest-risk hallucination here: it looks
 * authoritative, and a reader deciding whether to replace a vehicle would act
 * on it. Same defence-in-depth reasoning as the removed complaint-handler's
 * containsDateLiteral() guard (ed8172d) — the prompt already forbids this, and
 * the guard assumes the prompt will sometimes fail anyway.
 *
 * Returns the offending literals; empty means every date is grounded.
 */
export function ungroundedDates(analysis: DsAnalysis, input: DsAnalysisInput): string[] {
  const allowed = new Set<string>();
  for (const iso of [
    ...input.entries.map((e) => e.date),
    ...input.replacements.map((r) => r.date),
    input.contractEnd,
  ]) {
    if (iso) for (const v of dateVariants(iso)) allowed.add(v);
  }

  const text = [
    analysis.summary,
    analysis.contractFlag.label,
    ...(analysis.actions ?? []),
    ...analysis.findings.flatMap((f) => [f.title, f.detail]),
  ].join(" \n ");

  const found = text.match(DATE_RE) ?? [];
  return [...new Set(found.filter((d) => !allowed.has(d)))];
}

/**
 * Rejects supplier-like names the model wrote that appear nowhere in the source.
 *
 * The sibling of ungroundedDates(), on the same principle: not "does this look
 * plausible" but "is this literal actually present in the data we sent". An
 * invented supplier attached to a recurrence claim reads as authoritative, and
 * someone deciding whether to stop using a garage would act on it.
 *
 * Supplier names in this data are consistently multi-word and upper-case
 * ("STAR PNEUMATIQUE", "AUTO MECANIQUE IBN ROCHD"), so candidates are runs of
 * two or more upper-case words. The check then compares against the ENTIRE
 * source text — supplier names, descriptions and part designations — not just
 * the supplier list. That matters: descriptions are themselves upper-case
 * ("PB MOTEUR", "4 PNEUS"), so a model quoting one verbatim would otherwise be
 * accused of fabricating a supplier.
 *
 * Returns the offending literals; empty means nothing was invented.
 */
const CAPS_RUN_RE = /\b[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9'().-]{2,}(?:\s+[A-ZÀ-ÖØ-Þ0-9'().-]{2,})+\b/g;

export function ungroundedSuppliers(
  analysis: DsAnalysis,
  input: DsAnalysisInput,
  /**
   * The computed check lines that were put in the prompt — formatIntervalChecks()
   * & co. They are SOURCE TEXT: the prompt orders the model to reproduce them
   * (rules 11-15 say "reprends", rule 15 says VERBATIM), so a phrase quoted out
   * of them is grounded by definition.
   *
   * Omitting them was a live defect, not a nicety. Those lines contain
   * upper-case runs — "JAMAIS ENREGISTRÉ", "DÉPASSÉ", "NON VÉRIFIÉ" — that the
   * caps-run heuristic reads as supplier-like names. And because `\b` in this
   * regex is ASCII-only, "ENREGISTRÉ" truncates to the fragment "JAMAIS
   * ENREGISTR", which matches nothing in the entries either. The route then
   * dropped every finding containing that fragment: measured over three full
   * 100-vehicle audit runs, **19% of vehicles silently lost at least one
   * finding**, and they were the load-bearing ones — "filtre à gasoil jamais
   * enregistré", "distribution / pompe à eau jamais enregistré".
   */
  checkLines: readonly string[] = []
): string[] {
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

  // Everything we actually sent, as one normalized haystack.
  const haystack = norm(
    input.entries
      .flatMap((e) => [e.supplier ?? "", e.description ?? "", ...e.parts])
      .concat(input.replacements.map((r) => r.motif ?? ""))
      .concat(checkLines)
      .join(" | ")
  );

  // Scanned FIELD BY FIELD, never on a joined string. Joining title and detail
  // let the caps-run regex straddle the boundary: a title ending
  // "... : REGENERATION FAP" followed by a detail opening "L'opération ..."
  // produced the candidate "REGENERATION FAP L'", which is in no source data
  // because it is not a name at all. The route then dropped every finding
  // whose text contained it — i.e. the sound finding this fabricated
  // "supplier" was spliced out of. Observed live on 23625-T-6.
  const candidates = [
    ...(analysis.actions ?? []).flatMap((a) => a.match(CAPS_RUN_RE) ?? []),
    ...analysis.findings.flatMap((f) => [
      ...(f.title.match(CAPS_RUN_RE) ?? []),
      ...(f.detail.match(CAPS_RUN_RE) ?? []),
    ]),
  ];

  return [...new Set(candidates.map(norm).filter((c) => !haystack.includes(c)))];
}

// ── The prompt ────────────────────────────────────────────────────────────

// DS_ANALYSIS_SYSTEM_PROMPT now lives in ../dsAnalysis/prompt.ts — plain
// instructional text, readable as a document. Re-exported here so every existing
// import site keeps working unchanged.
export { DS_ANALYSIS_SYSTEM_PROMPT } from "@/lib/ai/dsAnalysis/prompt";

/** The origin marker rule 8 refers to, rendered per entry. */
function originLabel(e: DsAnalysisEntry): string {
  if (e.origin === "interne") return "interne";
  if (e.origin === "inconnu") return "inconnu";
  return e.supplier ? `externe: ${e.supplier}` : "externe (non nommé)";
}

/** Builds the user turn. Truncation is applied here and stated to the model. */
export function buildDsAnalysisPrompt(
  input: DsAnalysisInput,
  contractStatus: ReturnType<typeof computeContractStatus>,
  intervalLines: readonly string[] = []
): string {
  const entries = input.entries.slice(0, MAX_ENTRIES);
  const truncated = input.entries.length > MAX_ENTRIES;

  const lines: string[] = [];
  lines.push(`Véhicule: ${input.imm}${input.vehicle.brand ? ` — ${input.vehicle.brand}` : ""}${input.vehicle.model ? ` ${input.vehicle.model}` : ""}`);
  // Both statuses are printed whenever known: they decide whether work should
  // be done on this vehicle AT ALL, which outranks anything the history says.
  if (input.vehicle.state) lines.push(`ETAT VÉHICULE (onglet): ${input.vehicle.state}`);
  if (input.vehicle.cpStatus) lines.push(`Statut du contrat (cp): ${input.vehicle.cpStatus}`);
  // The owner is a fact about the vehicle, and for AVIS's own fleet it changes
  // what happens to it — hence the explicit marker rather than leaving the
  // model to infer ownership from a company name it has never seen.
  if (input.vehicle.owner) lines.push(`Propriétaire: ${input.vehicle.owner}`);
  if (input.vehicle.isAvis) lines.push("Propriétaire : AVIS (parc propre / location courte durée)");
  if (input.vehicle.zoning) lines.push(`ZONING (onglet) : ${input.vehicle.zoning}`);
  if (input.vehicle.bdd) lines.push(`BDD (onglet) : ${input.vehicle.bdd}`);
  // The provider name, authoritative from its own column — A0.0's
  // PRESTATAIRE-EXTERNE branch reads this rather than deducing a name out of
  // BDD's free text, and a "Scal" value there means the work is INTERNAL.
  if (input.vehicle.prestataire) lines.push(`PRESTATAIRE (onglet) : ${input.vehicle.prestataire}`);
  lines.push(`Statut du contrat (déjà calculé, à reprendre): ${contractStatus.level} — ${contractStatus.label}`);

  if (input.replacements.length > 0) {
    lines.push("", `Remplacements enregistrés (${input.replacements.length}) :`);
    for (const r of input.replacements) {
      lines.push(`- ${r.date ?? "date inconnue"} — motif: ${r.motif?.trim() || "non précisé"}`);
    }
  }

  if (intervalLines.length > 0) {
    lines.push("", "Contrôles d'intervalle d'entretien (DÉJÀ CALCULÉS — à reprendre, pas à recalculer) :");
    lines.push(...intervalLines);
  }

  lines.push("", `Interventions (${entries.length}${truncated ? ` sur ${input.entries.length}, les plus récentes` : ""}) :`);
  if (truncated) {
    lines.push(`ATTENTION: seules les ${MAX_ENTRIES} interventions les plus récentes sont fournies. Ne conclus rien sur la période antérieure.`);
  }
  for (const e of entries) {
    const parts = e.parts.filter((p) => p.trim()).join(", ");
    lines.push(
      `- ${e.date ?? "date inconnue"}` +
        (e.km != null ? ` | ${e.km} km` : "") +
        ` | desc: ${e.description?.trim() || "(vide)"}` +
        ` | pièces: ${parts || "(aucune)"}` +
        ` | ${originLabel(e)}`
    );
  }
  return lines.join("\n");
}


// ── Follow-up / challenge ─────────────────────────────────────────────────
//
// Single-shot with the context re-supplied, not a multi-turn conversation:
// callAI takes `prompt: string` and gemini.ts builds `contents` from it alone.
// Adding a messages[] array to the provider-agnostic interface to serve one
// two-turn use case is exactly the speculative abstraction that module was
// deliberately built without — and the model is stateless either way, so
// re-supplying the payload gives an identical result.

export const MAX_FOLLOW_UP_LENGTH = 500;

// DS_FOLLOWUP_SYSTEM_PROMPT now lives in ../dsAnalysis/followUpPrompt.ts — plain
// instructional text, readable as a document. Re-exported here so every existing
// import site keeps working unchanged.
export { DS_FOLLOWUP_SYSTEM_PROMPT } from "@/lib/ai/dsAnalysis/followUpPrompt";

/**
 * Dates in a free-text answer that appear nowhere in the source.
 *
 * The follow-up path returns prose, so a bad finding cannot simply be dropped
 * the way ungroundedDates() drops one from an analysis. This exists because a
 * live test caught exactly that failure: the model cited "2025-01-04" for an
 * entry actually dated 2025-02-04 — right part, right km, wrong month. The
 * caller appends a visible caveat rather than silently serving it.
 */
export function ungroundedDatesInText(text: string, input: DsAnalysisInput): string[] {
  const allowed = new Set<string>();
  for (const iso of [
    ...input.entries.map((e) => e.date),
    ...input.replacements.map((r) => r.date),
    input.contractEnd,
  ]) {
    if (iso) for (const v of dateVariants(iso)) allowed.add(v);
  }
  const found = text.match(DATE_RE) ?? [];
  return [...new Set(found.filter((d) => !allowed.has(d)))];
}

/** Builds the follow-up turn: original data + what was answered + the question. */
export function buildFollowUpPrompt(params: {
  input: DsAnalysisInput;
  contractStatus: ReturnType<typeof computeContractStatus>;
  intervalLines: readonly string[];
  /**
   * Every tracked rule with its threshold and this vehicle's computed status —
   * including rules that did NOT fire, which intervalLines deliberately omits.
   * Built by formatRulesReference() from the same check objects, never
   * recomputed, so the two turns cannot disagree about a number.
   */
  rulesLines: readonly string[];
  previousAnalysis: DsAnalysis;
  question: string;
}): string {
  const { input, contractStatus, intervalLines, rulesLines, previousAnalysis, question } = params;

  const prior = [
    `Statut du contrat : ${previousAnalysis.contractFlag.label}`,
    ...previousAnalysis.findings.map((f) => `- [${f.level}] ${f.title} : ${f.detail}`),
    `Résumé : ${previousAnalysis.summary}`,
  ].join("\n");

  return [
    "=== DONNÉES SOURCES (identiques à celles de l'analyse) ===",
    buildDsAnalysisPrompt(input, contractStatus, intervalLines),
    "",
    "=== RÈGLES DE CONTRÔLE ET STATUT CALCULÉ POUR CE VÉHICULE ===",
    "Seuils et statuts déjà calculés en code. Une règle « NON APPLICABLE » n'a pas",
    "été signalée dans l'analyse par construction, et non par oubli.",
    ...rulesLines,
    "",
    "=== ANALYSE QUE TU AS PRODUITE ===",
    prior,
    "",
    "=== QUESTION DE L'UTILISATEUR ===",
    question,
  ].join("\n");
}
