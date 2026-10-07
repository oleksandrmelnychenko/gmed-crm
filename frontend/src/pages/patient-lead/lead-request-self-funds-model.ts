import type { LeadRequest, LeadRequestSelfFunds, SelfFundsPatch } from "./lead-request-api";
import { FUNDS_SOURCES, type FundsSource } from "./lead-request-payer-questionnaire-model";

// The self-payer's source of funds in the lead cabinet (owner request
// 2026-10-05, "proof of income"; owner rule 2026-10-07 on the enhanced
// check). Part of "who pays" while the patient pays himself: the sources of
// the person list, a description (required with "other") and a proof, which
// is required only while the enhanced check is. This module imports types
// only from the API, so `lead-request-model` can take the keys of
// `progress.missing_for_submit` from here.

/** The block as the patient types it: the sources in form order and the description. */
export type SelfFundsDraft = {
  sources: string[];
  description: string;
};

/** Keys of the block in `progress.missing_for_submit`, in the order of the form. */
export const SELF_FUNDS_SUBMIT_FIELDS = ["self_funds_sources", "self_funds_description", "self_funds_proof_upload"] as const;

export type SelfFundsSubmitField = (typeof SELF_FUNDS_SUBMIT_FIELDS)[number];

function isFundsSource(value: string): value is FundsSource {
  return (FUNDS_SOURCES as readonly string[]).includes(value);
}

/**
 * The sources the server offers that the cabinet has words for, in form
 * order; the person list when the server does not say.
 */
export function selfFundsSourceOptions(
  selfFunds: Pick<LeadRequestSelfFunds, "source_options"> | null | undefined,
): FundsSource[] {
  const offered = selfFunds?.source_options ?? [];
  const known = FUNDS_SOURCES.filter((source) => offered.includes(source));
  return known.length > 0 ? known : [...FUNDS_SOURCES];
}

/** The sources without duplicates, in the order of the form; an unknown one stays at the end. */
function sortedSources(sources: readonly string[]): string[] {
  const unique = Array.from(new Set(sources));
  const known = FUNDS_SOURCES.filter((source) => unique.includes(source));
  return [...known, ...unique.filter((source) => !isFundsSource(source))];
}

/**
 * Whether the block is asked: the server knows it and the stored answer is
 * "I pay myself" — the server takes the block only then, so it appears once
 * that answer is saved.
 */
export function selfFundsAsked(request: Pick<LeadRequest, "self_funds" | "payer">): boolean {
  return request.self_funds?.asked === true && request.payer?.payer_kind === "self";
}

export function draftFromSelfFunds(selfFunds: Pick<LeadRequestSelfFunds, "sources" | "description"> | null | undefined): SelfFundsDraft {
  return {
    sources: sortedSources(selfFunds?.sources ?? []),
    description: selfFunds?.description ?? "",
  };
}

/** A source switched on or off. */
export function withSelfFundsSource(draft: SelfFundsDraft, source: string, chosen: boolean): SelfFundsDraft {
  const rest = draft.sources.filter((item) => item !== source);
  return { ...draft, sources: sortedSources(chosen ? [...rest, source] : rest) };
}

/** "Other" needs the words. */
export function selfFundsDescriptionRequired(draft: Pick<SelfFundsDraft, "sources">): boolean {
  return draft.sources.includes("other");
}

/** The comparable form of a key: what would be sent, as text. */
export function selfFundsValue(field: keyof SelfFundsDraft, draft: SelfFundsDraft): string {
  return field === "sources" ? sortedSources(draft.sources).join(",") : draft.description.trim();
}

/**
 * Only the keys that differ from the last saved state: the whole list of
 * sources, the description trimmed at its ends (`""` clears it). A value the
 * server refused (`rejected`) is not sent again until it changes.
 */
export function selfFundsPatch(
  saved: SelfFundsDraft,
  draft: SelfFundsDraft,
  rejected: Partial<Record<keyof SelfFundsDraft, string>> = {},
): SelfFundsPatch {
  const patch: SelfFundsPatch = {};
  const sources = selfFundsValue("sources", draft);
  if (sources !== selfFundsValue("sources", saved) && rejected.sources !== sources) {
    patch.self_funds_sources = sortedSources(draft.sources);
  }
  const description = selfFundsValue("description", draft);
  if (description !== selfFundsValue("description", saved) && rejected.description !== description) {
    patch.self_funds_description = description;
  }
  return patch;
}

/** The draft key a key of the server names (`self_funds_sources` → `sources`); null for any other. */
export function selfFundsFieldOf(field: unknown): keyof SelfFundsDraft | null {
  if (field === "self_funds_sources") return "sources";
  if (field === "self_funds_description") return "description";
  return null;
}

/** Whether the proof is required: the enhanced check of the lead is. */
export function selfFundsProofRequired(request: Pick<LeadRequest, "self_funds">): boolean {
  return request.self_funds?.proof_required === true;
}
