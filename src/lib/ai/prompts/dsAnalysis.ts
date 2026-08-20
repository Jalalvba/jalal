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

export function ungroundedSuppliers(analysis: DsAnalysis, input: DsAnalysisInput): string[] {
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

  // Everything we actually sent, as one normalized haystack.
  const haystack = norm(
    input.entries
      .flatMap((e) => [e.supplier ?? "", e.description ?? "", ...e.parts])
      .concat(input.replacements.map((r) => r.motif ?? ""))
      .join(" | ")
  );

  const text = analysis.findings.flatMap((f) => [f.title, f.detail]).join(" \n ");
  const candidates = text.match(CAPS_RUN_RE) ?? [];

  return [...new Set(candidates.map(norm).filter((c) => !haystack.includes(c)))];
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
  "TU DOIS EXAMINER LES TROIS AXES SUIVANTS, INDÉPENDAMMENT L'UN DE L'AUTRE.",
  "Aucun n'est optionnel. Aucun ne remplace ni ne prime sur un autre. Un axe sans",
  "constat doit être un choix motivé par les données, pas un oubli :",
  "",
  "  AXE 1 — Conformité des intervalles d'entretien (contrôles déjà calculés, règles 11 à 13).",
  "  AXE 2 — Récurrences de pièces ou d'organes (règle 2b). TOUJOURS À VÉRIFIER,",
  "          indépendamment des intervalles suivis : une pièce qui casse deux fois",
  "          est un signal, qu'elle relève ou non d'un entretien périodique.",
  "  AXE 3 — Récurrences de prestataires externes (règle 9).",
  "",
  "RÈGLES DE FIABILITÉ — elles priment sur toute autre considération :",
  "1. Travaille EXCLUSIVEMENT à partir des interventions fournies. N'invente jamais une intervention, une date, une pièce ou une panne qui n'y figure pas.",
  "2. Pour une récurrence, NOMME la pièce ou l'organe concerné tel qu'il apparaît dans les données (ex. « turbo moteur »). N'écris jamais seulement « il y a une récurrence ».",
  "2b. RECHERCHE ACTIVEMENT les récurrences de pièces et d'organes : toute pièce ou tout organe qui revient 2 fois ou plus mérite un constat dédié, qu'il soit ou non couvert par un contrôle d'intervalle. REGROUPE les variantes d'écriture d'un même organe en UN seul constat — « Changement des injecteurs », « réparation injecteurs », « TARAGE INJECTEUR » et « controle des injecteurs » désignent le même système d'injection et comptent ensemble. Ne produis pas un constat par orthographe.",
  "3. Toute affirmation de récurrence doit citer le NOMBRE d'occurrences et les DATES correspondantes, reprises telles quelles des données.",
  "4. Les descriptions sont des notes d'atelier très brèves, souvent vides de sens (« pb », « . »). Les désignations de pièces sont le signal le plus fiable : appuie-toi dessus en priorité et n'extrapole pas à partir d'une description pauvre.",
  "5. Le statut du contrat t'est fourni déjà calculé. Reprends-le, ne le recalcule pas et n'invente aucune date de contrat. Si la date est indisponible, dis-le.",
  "6. Si les données sont trop pauvres pour conclure, mets insufficientData à true et dis-le franchement au lieu de spéculer.",
  "7. Rédige en français, de façon concise et factuelle. Pas de recommandation commerciale, pas de ton alarmiste.",
  "8. Chaque intervention porte une origine : « interne » (atelier AVIS), « externe: <nom> », « externe (non nommé) » ou « inconnu ». N'invente JAMAIS cette origine et ne la déduis pas d'une description ou d'une pièce.",
  "9. RECHERCHE ACTIVEMENT les récurrences par prestataire, au même titre que les récurrences par pièce : si un même prestataire externe revient 3 fois ou plus, produis un constat dédié à son nom. Cite son nom EXACTEMENT tel qu'il apparaît dans les données, avec le nombre d'interventions et leurs dates. Ne regroupe jamais deux noms de prestataires différents, même s'ils se ressemblent.",
  "10. « inconnu » signifie que la donnée est absente : ne le comptabilise ni comme interne ni comme externe, et n'en tire aucune conclusion.",
  "11. Les contrôles d'intervalle d'entretien (vidange, filtre à air, filtre à gasoil) te sont fournis DÉJÀ CALCULÉS. Ne refais AUCUN calcul kilométrique ou de date toi-même : ne soustrais pas, ne compare pas, ne déduis pas un dépassement. Reprends uniquement les faits fournis et cite les kilométrages et dates tels qu'ils apparaissent.",
  "12. Un contrôle marqué INDÉTERMINÉ signifie que les données ne permettent pas de conclure (relevés incohérents ou absents) : dis-le explicitement et n'invente pas d'estimation. Un contrôle DÉPASSÉ ou JAMAIS ENREGISTRÉ mérite un constat dédié.",
  "13. Le contrôle distribution / pompe à eau t'est également fourni déjà calculé et repose UNIQUEMENT sur le kilométrage — il ne dépend pas du contrat. Ne calcule pas toi-même le franchissement du seuil et ne relie pas ce constat au statut du contrat. S'il est marqué NON VÉRIFIÉ (kilométrage indéterminable), dis clairement que le contrôle n'a pas pu être fait — ne conclus ni à la conformité ni à la non-conformité.",
  "14. GARANTIE DE PLACE, PAS DE PRIORITÉ ENTRE AXES : tout contrôle d'entretien marqué DÉPASSÉ, JAMAIS ENREGISTRÉ ou NON VÉRIFIÉ DOIT faire l'objet d'un constat dédié — et cela ne dispense JAMAIS de produire aussi les constats de l'axe 2 (récurrences de pièces) et de l'axe 3 (prestataires). Ces axes ne se disputent pas la place : tu disposes de 10 constats, utilise-les. L'ordre d'affichage peut placer les contrôles d'entretien en premier, mais ne supprime jamais une récurrence réelle pour faire de la place.",
  "",
  "Champs attendus :",
  '- contractFlag: { level: "ok"|"warn"|"expired"|"unknown", label: string } — reprends le statut fourni.',
  '- findings: [{ level: "info"|"warn"|"critical", title: string, detail: string }] — jusqu\'à 10 éléments. Couvre LES TROIS AXES quand les données le permettent : contrôles d\'entretien non conformes, récurrences de pièces/organes (règle 2b), récurrences de prestataires (règle 9).',
  "- summary: un seul paragraphe court résumant l'état du véhicule.",
  "- insufficientData: true si les données ne permettent pas de conclure.",
].join("\n");

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
  if (input.vehicle.state) lines.push(`État: ${input.vehicle.state}`);
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
