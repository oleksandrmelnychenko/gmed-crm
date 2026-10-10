/**
 * Configuration of the lead risk assessment (trigger flow 2026-10-07):
 * country lists 1 and 2, points per trigger, the amount thresholds, the level
 * bounds, whether level 2 asks the follow-up blocks automatically, and the
 * reviewers the CEO names as deputies. `GET/PUT /compliance/risk-config`
 * (reviewers read, the CEO writes); the review queue is
 * `GET /compliance/risk-reviews`. The server validates again.
 */
import { apiFetch } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
import { riskReviewerRoleEligible, type RiskStatus } from "@/pages/leads/model/lead-risk-assessment";

/** Triggers with points; T1, T2 and T6 have a pair (list 1, list 2). */
export const RISK_POINT_TRIGGERS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13"] as const;
export const RISK_PAIR_TRIGGERS: readonly string[] = ["T1", "T2", "T6"];
export const RISK_POINTS_MAX = 20;

export type RiskPoints = Record<string, number | [number, number]>;

export type RiskConfig = {
  version: number;
  list_1: string[];
  list_2: string[];
  points: RiskPoints;
  knockout: string[];
  threshold_1_eur: number;
  threshold_2_eur: number;
  level_2_from: number;
  level_3_from: number;
  level_2_blocks_automatic: boolean;
  reviewers: string[];
};

export type RiskReviewerCandidate = { id: string; name: string; role: string };

/** Who may decide now: active CEO accounts and named deputies, counted apart. */
export type RiskReviewerCounts = { ceo: number; deputies: number };

export type RiskConfigResponse = {
  config: RiskConfig;
  /** Staff the CEO may name; null when the server does not send them (the users list is used then). */
  candidates: RiskReviewerCandidate[] | null;
  /** Null on an older server that sends only the total. */
  reviewerCounts: RiskReviewerCounts | null;
};

/** The default of the contract (2.4); the server's constant wins. */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  version: 1,
  list_1: ["AF", "AO", "BO", "CD", "CI", "CM", "DZ", "HT", "KE", "LA", "LB", "MC", "NA", "NP", "RU", "SS", "SY", "TT", "VE", "VG", "VN", "VU", "YE"],
  list_2: ["IR", "KP", "MM"],
  points: { T1: [2, 4], T2: [2, 4], T3: 1, T4: 1, T5: 2, T6: [2, 4], T7: 1, T8: 2, T9: 4, T10: 1, T11: 2, T12: 2, T13: 1 },
  knockout: ["T14", "T15", "T16"],
  threshold_1_eur: 10000,
  threshold_2_eur: 25000,
  level_2_from: 4,
  level_3_from: 9,
  level_2_blocks_automatic: true,
  reviewers: [],
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const num = (value: unknown, fallback: number) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
};
const codes = (value: unknown, fallback: string[]) =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim().toUpperCase()).filter(Boolean))]
    : fallback;

function normalizePoints(value: unknown): RiskPoints {
  const raw = record(value) ?? {};
  const points: RiskPoints = {};
  for (const key of RISK_POINT_TRIGGERS) {
    const fallback = DEFAULT_RISK_CONFIG.points[key];
    const item = raw[key];
    if (RISK_PAIR_TRIGGERS.includes(key)) {
      const pair = Array.isArray(fallback) ? fallback : [0, 0];
      points[key] = Array.isArray(item)
        ? [num(item[0], pair[0]), num(item[1], pair[1])]
        : typeof item === "number"
          ? [item, item]
          : [pair[0], pair[1]];
    } else {
      points[key] = num(item, typeof fallback === "number" ? fallback : 0);
    }
  }
  return points;
}

/** A configuration with every key present; the default for a missing or broken value. */
export function normalizeRiskConfig(value: unknown): RiskConfig {
  const raw = record(value) ?? {};
  return {
    version: num(raw.version, DEFAULT_RISK_CONFIG.version),
    list_1: codes(raw.list_1, DEFAULT_RISK_CONFIG.list_1),
    list_2: codes(raw.list_2, DEFAULT_RISK_CONFIG.list_2),
    points: normalizePoints(raw.points),
    knockout: codes(raw.knockout, DEFAULT_RISK_CONFIG.knockout),
    threshold_1_eur: num(raw.threshold_1_eur, DEFAULT_RISK_CONFIG.threshold_1_eur),
    threshold_2_eur: num(raw.threshold_2_eur, DEFAULT_RISK_CONFIG.threshold_2_eur),
    level_2_from: num(raw.level_2_from, DEFAULT_RISK_CONFIG.level_2_from),
    level_3_from: num(raw.level_3_from, DEFAULT_RISK_CONFIG.level_3_from),
    level_2_blocks_automatic:
      typeof raw.level_2_blocks_automatic === "boolean" ? raw.level_2_blocks_automatic : DEFAULT_RISK_CONFIG.level_2_blocks_automatic,
    reviewers: Array.isArray(raw.reviewers)
      ? [...new Set(raw.reviewers.filter((item): item is string => typeof item === "string" && item.trim() !== ""))]
      : [],
  };
}

function normalizeCandidates(value: unknown): RiskReviewerCandidate[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    const raw = record(item);
    const id = typeof raw?.id === "string" ? raw.id : null;
    if (!raw || !id) return [];
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
    return [{ id, name, role: typeof raw.role === "string" ? raw.role : "" }];
  });
}

/** `GET /compliance/risk-config`: the configuration itself or `{config, eligible_reviewers}`. */
export function normalizeRiskConfigResponse(value: unknown): RiskConfigResponse {
  const raw = record(value) ?? {};
  const nested = record(raw.config);
  const count = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
  const ceo = count(raw.reviewers_ceo);
  const deputies = count(raw.reviewers_deputies);
  return {
    config: normalizeRiskConfig(nested ?? raw),
    candidates: normalizeCandidates(raw.eligible_reviewers ?? raw.reviewer_candidates),
    reviewerCounts: ceo !== null && deputies !== null ? { ceo, deputies } : null,
  };
}

/** A code stands in one list only: list 2 wins. */
export function withListMove(config: RiskConfig, list: "list_1" | "list_2", next: string[]): RiskConfig {
  const normalized = [...new Set(next.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  if (list === "list_2") {
    return { ...config, list_2: normalized, list_1: config.list_1.filter((code) => !normalized.includes(code)) };
  }
  return { ...config, list_1: normalized.filter((code) => !config.list_2.includes(code)) };
}

export type RiskConfigError = "levels" | "points" | "thresholds" | "lists" | "codes";

/** What the server would refuse (contract 4.4), in the order of the form. */
export function riskConfigErrors(config: RiskConfig): RiskConfigError[] {
  const errors: RiskConfigError[] = [];
  const iso = /^[A-Z]{2}$/;
  if (![...config.list_1, ...config.list_2].every((code) => iso.test(code))) errors.push("codes");
  if (config.list_1.some((code) => config.list_2.includes(code))) errors.push("lists");
  const values = Object.values(config.points).flatMap((value) => (Array.isArray(value) ? value : [value]));
  if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= RISK_POINTS_MAX)) errors.push("points");
  if (!(config.threshold_1_eur > 0 && config.threshold_2_eur > 0)) errors.push("thresholds");
  if (
    !Number.isInteger(config.level_2_from)
    || !Number.isInteger(config.level_3_from)
    || !(config.level_2_from > 0 && config.level_2_from < config.level_3_from)
  ) {
    errors.push("levels");
  }
  return errors;
}

/** The PUT body: the configuration as stored (the server bumps the version). */
export function riskConfigPayload(config: RiskConfig): RiskConfig {
  return {
    ...config,
    list_1: [...config.list_1].sort(),
    list_2: [...config.list_2].sort(),
    reviewers: [...config.reviewers],
  };
}

/**
 * Staff the CEO may name as a deputy reviewer, from the users list when the
 * server does not send its own: active staff whose role reads leads, except
 * sales, the CEO assistant and the interpreters; the CEO reviews by role.
 */
export function eligibleReviewerCandidates(
  users: ReadonlyArray<{ id: string; name?: string | null; full_name?: string | null; email?: string | null; role: string; is_active?: boolean | null }>,
): RiskReviewerCandidate[] {
  return users
    .filter((user) => user.is_active !== false && user.role !== "ceo")
    .filter((user) => riskReviewerRoleEligible(user.role, hasCapability(user.role, "leads.view")))
    .map((user) => ({ id: user.id, name: (user.name || user.full_name || user.email || user.id).trim(), role: user.role }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export type RiskReviewRow = {
  lead_id: string;
  name: string;
  level: number;
  points: number | null;
  status: RiskStatus | null;
  since: string | null;
  pending_proposal: { decision: string; decided_by_name: string | null; decided_at: string | null } | null;
};

/** `GET /compliance/risk-reviews`: a list, or `{reviews: [...]}`; oldest first as the server sorts. */
export function normalizeRiskReviews(value: unknown): RiskReviewRow[] {
  const raw = record(value);
  const list = Array.isArray(value) ? value : Array.isArray(raw?.reviews) ? raw.reviews : Array.isArray(raw?.items) ? raw.items : [];
  return list.flatMap((item: unknown) => {
    const row = record(item);
    const leadId = typeof row?.lead_id === "string" ? row.lead_id : null;
    if (!row || !leadId) return [];
    const proposal = record(row.pending_proposal);
    return [
      {
        lead_id: leadId,
        name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : leadId,
        level: Math.min(3, Math.max(1, Math.round(num(row.level, 1)))),
        points: typeof row.points === "number" ? row.points : null,
        status: typeof row.status === "string" ? (row.status as RiskStatus) : null,
        since: typeof row.since === "string" ? row.since : null,
        pending_proposal:
          proposal && typeof proposal.decision === "string"
            ? {
                decision: proposal.decision,
                decided_by_name: typeof proposal.decided_by_name === "string" ? proposal.decided_by_name : null,
                decided_at: typeof proposal.decided_at === "string" ? proposal.decided_at : null,
              }
            : null,
      },
    ];
  });
}

export const riskConfigApi = {
  get: async () => normalizeRiskConfigResponse(await apiFetch<unknown>("/compliance/risk-config", { forceFresh: true })),
  /** The caller reads the configuration again afterwards (the server bumped the version). */
  save: async (config: RiskConfig) => {
    await apiFetch<unknown>("/compliance/risk-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(riskConfigPayload(config)),
    });
  },
  reviews: async () => normalizeRiskReviews(await apiFetch<unknown>("/compliance/risk-reviews", { forceFresh: true })),
  users: async () =>
    apiFetch<Array<{ id: string; name?: string | null; full_name?: string | null; email?: string | null; role: string; is_active?: boolean | null }>>(
      "/users?active_only=true",
      { forceFresh: true },
    ),
};
