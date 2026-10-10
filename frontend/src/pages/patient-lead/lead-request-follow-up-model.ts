import type {
  EnhancedDetailsPatch,
  ExtraAnswers,
  ExtraQuestionAsks,
  FollowUpBlock,
  LeadRequest,
  LeadRequestFollowUp,
} from "./lead-request-api";

// "Ergänzende Angaben" (trigger flow, contract 3.1 / 3.3 / 6): the follow-up
// blocks the server opens after the request was sent — only which blocks and
// what each still misses, never why (no points, level, trigger or reason,
// P2). This module imports types only from the API, so the step model and
// the texts can use it.

/** The blocks the cabinet asks, in letter order (D and E are the payer link's). */
// Personal details and the legal questions first, then the rest in letter order.
export const FOLLOW_UP_BLOCKS = ["K", "L", "A", "B", "C", "F", "G", "H", "I", "J"] as const satisfies readonly FollowUpBlock[];

function isFollowUpBlock(value: string): value is FollowUpBlock {
  return (FOLLOW_UP_BLOCKS as readonly string[]).includes(value);
}

/** The open blocks of the cabinet, in letter order; none while nothing is required. */
export function openFollowUpBlocks(request: Pick<LeadRequest, "follow_up">): FollowUpBlock[] {
  const followUp = request.follow_up;
  if (!followUp?.required) return [];
  const open = new Set(followUp.blocks.map((block) => block.trim().toUpperCase()).filter(isFollowUpBlock));
  return FOLLOW_UP_BLOCKS.filter((block) => open.has(block));
}

/**
 * Whether the step "Ergänzende Angaben" is shown: the request was sent once
 * and the server opened at least one block of the cabinet. A staff action
 * can start the assessment before the first send (a gate call): its blocks
 * wait for the send instead of adding a step to the base form (QA
 * 2026-10-10: block I duplicated the identity step).
 */
export function followUpShown(request: Pick<LeadRequest, "follow_up" | "submitted_at">): boolean {
  return Boolean(request.submitted_at) && openFollowUpBlocks(request).length > 0;
}

/** What an open block still misses, as the server names it. */
export function followUpMissing(request: Pick<LeadRequest, "follow_up">, block: FollowUpBlock): string[] {
  if (!openFollowUpBlocks(request).includes(block)) return [];
  return request.follow_up?.missing?.[block] ?? [];
}

/** Everything the open blocks still miss, block after block. */
export function followUpMissingAll(request: Pick<LeadRequest, "follow_up">): Array<{ block: FollowUpBlock; key: string }> {
  return openFollowUpBlocks(request).flatMap((block) => followUpMissing(request, block).map((key) => ({ block, key })));
}

/** The answers were sent and nothing is missing: GMED reviews them. */
export function followUpAnswered(request: Pick<LeadRequest, "follow_up">): boolean {
  return Boolean(request.follow_up?.answered_at) && followUpMissingAll(request).length === 0;
}

/**
 * The missing map of a refusal (`422 follow_up_incomplete`): by block, the
 * keys as strings. Anything else of the body is ignored.
 */
export function missingOfRefusal(body: Record<string, unknown> | null): Record<string, string[]> | null {
  const missing = body?.missing;
  if (!missing || typeof missing !== "object" || Array.isArray(missing)) return null;
  const result: Record<string, string[]> = {};
  for (const [block, keys] of Object.entries(missing as Record<string, unknown>)) {
    if (Array.isArray(keys)) result[block] = keys.filter((key): key is string => typeof key === "string");
  }
  return result;
}

/** The relationships a marriage or birth certificate proves (block B). */
const FAMILY_RELATIONSHIPS: ReadonlySet<string> = new Set(["spouse", "parent", "child", "sibling", "grandparent", "relative"]);

/**
 * Whether the payer is family of the patient: block B's example of a proof is
 * a certificate then, otherwise any document or a short explanation (a friend
 * or an employer has no certificate, QA 2026-10-10).
 */
export function familyPayer(request: Pick<LeadRequest, "payer">): boolean {
  return FAMILY_RELATIONSHIPS.has(request.payer?.relationship_kind ?? "");
}

// ---------------------------------------------------------------------------
// Block A: the source of funds (one choice with the words, profession, sector, proofs)
// ---------------------------------------------------------------------------

/** The sources of funds the patient chooses one of (owner 2026-10-07: a single dropdown plus free text). */
export const STATED_FUNDS_SOURCES = ["income", "savings", "asset_sale", "inheritance_gift", "other"] as const;
export type StatedFundsSource = (typeof STATED_FUNDS_SOURCES)[number];

/** A missing key of block A as the form names it: `self_funds_*` and `enhanced_*` are the same questions. */
export function blockAKey(key: string): string {
  if (key.startsWith("enhanced_")) return blockAKey(key.slice("enhanced_".length));
  if (key.startsWith("self_funds_")) return blockAKey(`funds_${key.slice("self_funds_".length)}`);
  if (key === "funds_sources") return "funds_source";
  if (key === "payer_funds_sources") return "payer_funds_source";
  return key;
}

const NO_ASKS: ExtraQuestionAsks = {
  payer_funds: false,
  funds: false,
  occupation: false,
  sector: false,
  funds_proof: false,
  payer_states_funds: false,
};

/**
 * Which questions of block A this login is asked, as the server decides
 * them (`follow_up.missing.A`): a self-payer states the own source with a
 * proof, profession and sector; a patient whose payer is another person or
 * organisation says what is known of that party's funds unless the payer
 * already stated them on the own link; a parent who pays answers the funds
 * and the profession in the own payer section, the sector here.
 */
export function blockAAsks(request: Pick<LeadRequest, "follow_up" | "payer" | "payer_questionnaire">): ExtraQuestionAsks {
  if (request.payer_questionnaire) return { ...NO_ASKS, sector: true, payer_states_funds: true };
  if (request.payer?.payer_kind === "third_party") {
    const missing = request.follow_up?.missing?.A ?? [];
    const answers = request.follow_up?.answers;
    const payerFunds =
      missing.some((key) => blockAKey(key).startsWith("payer_funds_")) ||
      Boolean(answers?.payer_funds_source || answers?.payer_funds_description);
    return { ...NO_ASKS, payer_funds: payerFunds, occupation: true, sector: true, payer_states_funds: true };
  }
  return { ...NO_ASKS, funds: true, occupation: true, sector: true, funds_proof: true };
}

/** The keys of block A, in the order of the form. */
export type ExtraTextField = keyof ExtraAnswers;
export type ExtraSourceField = "funds_source" | "payer_funds_source";

/** Block A as the patient types it: every answer as text (`""` for none). */
export type ExtraDraft = Record<keyof ExtraAnswers, string>;

export const EXTRA_FIELDS: Array<keyof ExtraAnswers> = [
  "payer_funds_source",
  "payer_funds_description",
  "funds_source",
  "funds_description",
  "occupation",
  "sector",
];

/** Free texts that may run over several lines: only the ends are trimmed. */
const MULTILINE: ReadonlySet<keyof ExtraAnswers> = new Set(["funds_description", "payer_funds_description"]);

/** The sources the server offers that the cabinet has words for; the whole list when it does not say. */
export function fundsSourceOptions(followUp: Pick<LeadRequestFollowUp, "funds_source_options"> | null | undefined): StatedFundsSource[] {
  const offered = followUp?.funds_source_options ?? [];
  const known = STATED_FUNDS_SOURCES.filter((source) => offered.includes(source));
  return known.length > 0 ? known : [...STATED_FUNDS_SOURCES];
}

export function draftFromExtra(followUp: Pick<LeadRequestFollowUp, "answers"> | null | undefined): ExtraDraft {
  const answers = followUp?.answers;
  return {
    funds_source: answers?.funds_source ?? "",
    funds_description: answers?.funds_description ?? "",
    payer_funds_source: answers?.payer_funds_source ?? "",
    payer_funds_description: answers?.payer_funds_description ?? "",
    occupation: answers?.occupation ?? "",
    sector: answers?.sector ?? "",
  };
}

/** The comparable form of a key: what would be sent, as text. */
export function extraValue(field: keyof ExtraAnswers, draft: ExtraDraft): string {
  const value = draft[field].trim();
  return MULTILINE.has(field) ? value : value.replace(/\s+/g, " ");
}

/** The keys of block A this login writes, from what it is asked. */
export function askedExtraFields(asks: ExtraQuestionAsks): Set<keyof ExtraAnswers> {
  const fields = new Set<keyof ExtraAnswers>();
  if (asks.payer_funds) {
    fields.add("payer_funds_source");
    fields.add("payer_funds_description");
  }
  if (asks.funds) {
    fields.add("funds_source");
    fields.add("funds_description");
  }
  if (asks.occupation) fields.add("occupation");
  if (asks.sector) fields.add("sector");
  return fields;
}

/**
 * Only the keys that differ from the last saved state and that this login
 * is asked (`asked`), trimmed (`""` clears one). A value the server refused
 * (`rejected`) is not sent again until it changes.
 */
export function extraPatch(
  saved: ExtraDraft,
  draft: ExtraDraft,
  asked: ReadonlySet<keyof ExtraAnswers>,
  rejected: Partial<Record<keyof ExtraAnswers, string>> = {},
): EnhancedDetailsPatch {
  const patch: EnhancedDetailsPatch = {};
  for (const field of EXTRA_FIELDS) {
    if (!asked.has(field)) continue;
    const next = extraValue(field, draft);
    if (next === extraValue(field, saved) || rejected[field] === next) continue;
    patch[field] = next;
  }
  return patch;
}

/** The draft key a key of the server names (also `self_funds_source`, `enhanced_sector`); null for any other. */
export function extraFieldOf(field: unknown): keyof ExtraAnswers | null {
  if (typeof field !== "string") return null;
  const key = blockAKey(field);
  return (EXTRA_FIELDS as readonly string[]).includes(key) ? (key as keyof ExtraAnswers) : null;
}
