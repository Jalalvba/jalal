// Complaint-handling playbook generation (Phase 1).
//
// Takes the raw text of one or more real client complaint email threads —
// collected by hand out of Gmail and uploaded through /admin/complaints — and
// asks Claude to derive a reusable playbook: what kinds of complaint actually
// occur, what clients want, how AVIS actually responded, and what worked.
//
// Phase 1 ends at "produce the playbook". Applying a playbook to a NEW
// incoming complaint is Phase 2 and is deliberately not built or scaffolded
// here.
//
// Prompt text lives in this module rather than in the route, matching how the
// sheet/Mongo modules keep logic out of src/app/api/**.

import { callClaudeWithTracking, type ClaudeCostInfo } from "@/lib/anthropic/costTracker";
import type { ComplaintPlaybook } from "@/types";

/** Pinned deliberately: a playbook is only comparable to another one built the same way. */
const MODEL = "claude-opus-5";
const MAX_TOKENS = 32_000;

/** Bumped whenever the schema below changes shape, so stored playbooks stay interpretable. */
export const PLAYBOOK_SCHEMA_VERSION = 1;

// ── Output schema ──────────────────────────────────────────────────────────
// Sent as a strict structured-output schema so the response is guaranteed
// parseable rather than best-effort JSON-in-prose. additionalProperties:false
// plus exhaustive `required` is what "strict" needs to be enforceable.
//
// Note there is no verbatim-quote field anywhere: quotes are raw client
// complaint text, and this document is persisted. Everything the model reports
// is a paraphrase or a count. See the storage note in the route.
const PLAYBOOK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sourceSummary", "categories", "crossCuttingObservations", "notEvidenced"],
  properties: {
    sourceSummary: {
      type: "object",
      additionalProperties: false,
      required: ["threadsObserved", "dateRangeObserved", "languagesObserved"],
      properties: {
        threadsObserved: { type: "integer" },
        dateRangeObserved: {
          type: ["string", "null"],
          description: "e.g. '2026-03 to 2026-08'. null if the threads carry no dates.",
        },
        languagesObserved: { type: "array", items: { type: "string" } },
      },
    },
    categories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "label",
          "description",
          "evidence",
          "avisResponsePattern",
          "effectiveness",
          "recommendedResponse",
          "confidence",
          "unknowns",
        ],
        properties: {
          id: {
            type: "string",
            description: "kebab-case slug, stable identifier, e.g. 'vehicle-mechanical'",
          },
          label: { type: "string" },
          description: { type: "string" },
          evidence: {
            type: "object",
            additionalProperties: false,
            required: ["threadCount", "clientGoalsObserved"],
            properties: {
              threadCount: { type: "integer" },
              clientGoalsObserved: {
                type: "array",
                items: { type: "string" },
                description: "What the client asked to have resolved, paraphrased.",
              },
            },
          },
          avisResponsePattern: {
            type: "object",
            additionalProperties: false,
            required: ["tone", "typicalConcessions", "typicalTimeline", "escalationPath", "channel"],
            properties: {
              tone: { type: "string" },
              typicalConcessions: { type: "array", items: { type: "string" } },
              typicalTimeline: { type: ["string", "null"] },
              escalationPath: { type: ["string", "null"] },
              channel: { type: "string" },
            },
          },
          effectiveness: {
            type: "object",
            additionalProperties: false,
            required: ["verdict", "signals"],
            properties: {
              verdict: {
                type: "string",
                enum: ["effective", "ineffective", "mixed", "not-determinable"],
              },
              signals: {
                type: "array",
                items: { type: "string" },
                description: "What in the thread supports the verdict.",
              },
            },
          },
          recommendedResponse: {
            type: "object",
            additionalProperties: false,
            required: ["openingMove", "mustInclude", "mustAvoid", "concessionLadder"],
            properties: {
              openingMove: { type: "string" },
              mustInclude: { type: "array", items: { type: "string" } },
              mustAvoid: { type: "array", items: { type: "string" } },
              concessionLadder: {
                type: "array",
                items: { type: "string" },
                description: "Ordered least-to-most costly, as evidenced by the threads.",
              },
            },
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          unknowns: { type: "array", items: { type: "string" } },
        },
      },
    },
    crossCuttingObservations: { type: "array", items: { type: "string" } },
    notEvidenced: {
      type: "array",
      items: { type: "string" },
      description: "Things a reader might expect this playbook to cover that the threads do not.",
    },
  },
} as const;

// ── The prompt ─────────────────────────────────────────────────────────────
// Kept as the stable cached prefix (see callClaudeWithTracking's system block):
// re-running analysis over the same file is then ~90% cheaper on input.
//
// The grounding rules are the load-bearing part. A model asked to write a
// "playbook" will happily produce a plausible generic car-rental complaints
// process — which would be worse than useless here, because it would look
// exactly like a real finding. notEvidenced exists so there is somewhere to
// put uncertainty: a model with nowhere to put "I don't know" invents an
// answer instead.
const SYSTEM_PROMPT = `You analyse real client complaint email threads for AVIS Maroc, a vehicle rental company, and derive a reusable complaint-handling playbook from them.

The input is the raw text of one or more email threads, copied out of a mailbox by hand. Formatting is inconsistent: quoting styles vary, threads may be separated only by blank lines or headers, signatures and disclaimers are included, and the text may mix French, Moroccan Darija, Arabic and English.

YOUR TASK
Identify the distinct kinds of complaint actually present, and for each one describe what clients want, how AVIS actually responded, and what the threads show about whether that worked.

GROUNDING RULES — these override everything else:
1. Work ONLY from what is in the uploaded text. Every category, concession, timeline, tone and escalation path you report must be traceable to something actually written in a thread.
2. Do NOT invent company policies, procedures, SLAs, compensation rules, org structure or escalation paths that the threads do not show. If AVIS's actual policy is not visible in the text, that is a fact to record, not a gap to fill.
3. Derive the categories from the data. Do not map the threads onto a generic taxonomy of car-rental complaints you already know.
4. If the threads only show AVIS's replies and never the outcome, say the effectiveness is "not-determinable". Do not infer success from a polite reply.
5. A category supported by one thread must be marked confidence "low". Reserve "high" for patterns you can see repeat across several threads.
6. Put everything a reader might reasonably expect but the data does not support into "notEvidenced". An empty notEvidenced array on a small sample is itself a warning sign — be honest instead of complete.
7. Never include verbatim client text, client names, email addresses, phone numbers, licence plates, contract numbers, or amounts tied to an identifiable person. Paraphrase. The output is stored; the source text is not.

WRITING THE RECOMMENDATIONS
"recommendedResponse" is the one place you may go slightly beyond pure description — it is advice for handling the NEXT complaint of that category. Base it on what the threads show working. Where the threads show something failing, say so in mustAvoid. Do not invent concessions AVIS has never been observed offering.

Write labels, descriptions and recommendations in French, matching the working language of the app. Keep "id" as a kebab-case ASCII slug.`;

/**
 * Runs the analysis. Returns the parsed playbook plus the cost of the call.
 *
 * Parse failures are surfaced as an error rather than a partial playbook: the
 * response is schema-constrained, so a parse failure means something genuinely
 * unexpected happened and a half-read playbook would be worse than none.
 */
export async function generateComplaintPlaybook(
  threadsText: string
): Promise<{ playbook: ComplaintPlaybook; costInfo: ClaudeCostInfo }> {
  const { result, costInfo } = await callClaudeWithTracking({
    action: "complaint-playbook",
    model: MODEL,
    system: SYSTEM_PROMPT,
    userContent: `Voici les fils de réclamation à analyser :\n\n${threadsText}`,
    maxTokens: MAX_TOKENS,
    jsonSchema: PLAYBOOK_JSON_SCHEMA as unknown as Record<string, unknown>,
    effort: "high",
  });

  let parsed: Omit<ComplaintPlaybook, "schemaVersion" | "generatedAt" | "model" | "source">;
  try {
    parsed = JSON.parse(result);
  } catch (e) {
    console.error("[complaint-playbook] Response was not valid JSON despite the schema:", e);
    throw new Error("La réponse du modèle n'a pas pu être lue.");
  }

  return { playbook: { ...parsed, schemaVersion: PLAYBOOK_SCHEMA_VERSION }, costInfo };
}
