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

export type DsAnalysisEntry = {
  date?: string;
  km?: number;
  description?: string;
  /** designation_consommation values from the DS lines — the strongest signal. */
  parts: string[];
};

export type DsAnalysisReplacement = { date?: string; motif?: string };

export type DsAnalysisInput = {
  imm: string;
  /** ISO date, or null when the vehicle has no contract record. */
  contractEnd: string | null;
  vehicle: { brand?: string; model?: string; state?: string };
  replacements: DsAnalysisReplacement[];
  entries: DsAnalysisEntry[];
};

// ── Output contract ───────────────────────────────────────────────────────

export type ContractLevel = "ok" | "warn" | "expired" | "unknown";
export type FindingLevel = "info" | "warn" | "critical";

export type DsAnalysisFinding = { level: FindingLevel; title: string; detail: string };

export type DsAnalysis = {
  contractFlag: { level: ContractLevel; label: string };
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
    ...analysis.findings.flatMap((f) => [f.title, f.detail]),
  ].join(" \n ");

  const found = text.match(DATE_RE) ?? [];
  return [...new Set(found.filter((d) => !allowed.has(d)))];
}

// ── The prompt ────────────────────────────────────────────────────────────

/**
 * The seven grounding rules are the load-bearing part of this file. They exist
 * because the source data is genuinely poor in one specific way, measured
 * against production: DS `description` values are terse French shop notes and
 * are often content-free ("pb", "."), while the part designations
 * (designation_consommation, e.g. "turbo moteur") carry the real signal. A
 * model handed both without being told this will confidently narrate a story
 * out of "pb".
 */
export const DS_ANALYSIS_SYSTEM_PROMPT = [
  "Tu analyses l'historique de maintenance d'un véhicule de flotte (société AVIS Maroc).",
  "Tu réponds UNIQUEMENT en JSON valide, sans texte autour, au format demandé.",
  "",
  "RÈGLES DE FIABILITÉ — elles priment sur toute autre considération :",
  "1. Travaille EXCLUSIVEMENT à partir des interventions fournies. N'invente jamais une intervention, une date, une pièce ou une panne qui n'y figure pas.",
  "2. Pour une récurrence, NOMME la pièce ou l'organe concerné tel qu'il apparaît dans les données (ex. « turbo moteur »). N'écris jamais seulement « il y a une récurrence ».",
  "3. Toute affirmation de récurrence doit citer le NOMBRE d'occurrences et les DATES correspondantes, reprises telles quelles des données.",
  "4. Les descriptions sont des notes d'atelier très brèves, souvent vides de sens (« pb », « . »). Les désignations de pièces sont le signal le plus fiable : appuie-toi dessus en priorité et n'extrapole pas à partir d'une description pauvre.",
  "5. Le statut du contrat t'est fourni déjà calculé. Reprends-le, ne le recalcule pas et n'invente aucune date de contrat. Si la date est indisponible, dis-le.",
  "6. Si les données sont trop pauvres pour conclure, mets insufficientData à true et dis-le franchement au lieu de spéculer.",
  "7. Rédige en français, de façon concise et factuelle. Pas de recommandation commerciale, pas de ton alarmiste.",
  "",
  "Champs attendus :",
  '- contractFlag: { level: "ok"|"warn"|"expired"|"unknown", label: string } — reprends le statut fourni.',
  '- findings: [{ level: "info"|"warn"|"critical", title: string, detail: string }] — 0 à 5 éléments, les plus significatifs.',
  "- summary: un seul paragraphe court résumant l'état du véhicule.",
  "- insufficientData: true si les données ne permettent pas de conclure.",
].join("\n");

/** Builds the user turn. Truncation is applied here and stated to the model. */
export function buildDsAnalysisPrompt(
  input: DsAnalysisInput,
  contractStatus: ReturnType<typeof computeContractStatus>
): string {
  const entries = input.entries.slice(0, MAX_ENTRIES);
  const truncated = input.entries.length > MAX_ENTRIES;

  const lines: string[] = [];
  lines.push(`Véhicule: ${input.imm}${input.vehicle.brand ? ` — ${input.vehicle.brand}` : ""}${input.vehicle.model ? ` ${input.vehicle.model}` : ""}`);
  if (input.vehicle.state) lines.push(`État: ${input.vehicle.state}`);
  lines.push(`Statut du contrat (déjà calculé, à reprendre): ${contractStatus.level} — ${contractStatus.label}`);

  if (input.replacements.length > 0) {
    lines.push("", `Remplacements enregistrés (${input.replacements.length}) :`);
    for (const r of input.replacements) {
      lines.push(`- ${r.date ?? "date inconnue"} — motif: ${r.motif?.trim() || "non précisé"}`);
    }
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
        ` | pièces: ${parts || "(aucune)"}`
    );
  }
  return lines.join("\n");
}
