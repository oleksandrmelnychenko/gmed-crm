import { describe, expect, it } from "vitest";

import { sanctionsDe, sanctionsRu } from "@/lib/i18n/catalogs/sanctions";

import {
  DEFAULT_RISK_CONFIG,
  eligibleReviewerCandidates,
  normalizeRiskConfig,
  normalizeRiskConfigResponse,
  normalizeRiskReviews,
  riskConfigErrors,
  riskConfigPayload,
  withListMove,
} from "./risk-config";

describe("risk assessment configuration", () => {
  it("falls back to the contract's default for a missing or broken value", () => {
    expect(normalizeRiskConfig(null)).toEqual(DEFAULT_RISK_CONFIG);
    expect(DEFAULT_RISK_CONFIG.list_2).toEqual(["IR", "KP", "MM"]);
    expect(DEFAULT_RISK_CONFIG.list_1).toContain("RU");
    expect(DEFAULT_RISK_CONFIG.list_1).not.toContain("MM");
    const config = normalizeRiskConfig({ version: 4, list_1: ["ru", "ru", "sy"], points: { T1: 3, T9: "5" }, level_3_from: 10 });
    expect(config.version).toBe(4);
    expect(config.list_1).toEqual(["RU", "SY"]);
    // A single number for a list trigger counts for both lists.
    expect(config.points.T1).toEqual([3, 3]);
    expect(config.points.T9).toBe(5);
    expect(config.points.T2).toEqual([2, 4]);
    expect(config.level_3_from).toBe(10);
  });

  it("reads the configuration alone or with the eligible reviewers", () => {
    const plain = normalizeRiskConfigResponse({ ...DEFAULT_RISK_CONFIG, reviewers: ["u-1"] });
    expect(plain.config.reviewers).toEqual(["u-1"]);
    expect(plain.candidates).toBeNull();
    const wrapped = normalizeRiskConfigResponse({
      config: { ...DEFAULT_RISK_CONFIG, version: 2 },
      eligible_reviewers: [{ id: "u-2", name: "Ben Muster", role: "patient_manager" }, { name: "no id" }],
    });
    expect(wrapped.config.version).toBe(2);
    expect(wrapped.candidates).toEqual([{ id: "u-2", name: "Ben Muster", role: "patient_manager" }]);
  });

  it("reads CEO accounts and named deputies apart; an older server sends neither", () => {
    expect(normalizeRiskConfigResponse({ ...DEFAULT_RISK_CONFIG, reviewers_available: 5 }).reviewerCounts).toBeNull();
    expect(normalizeRiskConfigResponse({
      ...DEFAULT_RISK_CONFIG,
      reviewers_available: 5,
      reviewers_ceo: 5,
      reviewers_deputies: 0,
    }).reviewerCounts).toEqual({ ceo: 5, deputies: 0 });
  });

  it("keeps a country in one list only: list 2 wins", () => {
    const moved = withListMove(DEFAULT_RISK_CONFIG, "list_2", [...DEFAULT_RISK_CONFIG.list_2, "ru"]);
    expect(moved.list_2).toContain("RU");
    expect(moved.list_1).not.toContain("RU");
    const back = withListMove(moved, "list_1", [...moved.list_1, "RU"]);
    expect(back.list_1).not.toContain("RU");
  });

  it("refuses what the server would refuse", () => {
    expect(riskConfigErrors(DEFAULT_RISK_CONFIG)).toEqual([]);
    expect(riskConfigErrors({ ...DEFAULT_RISK_CONFIG, level_2_from: 9, level_3_from: 9 })).toEqual(["levels"]);
    expect(riskConfigErrors({ ...DEFAULT_RISK_CONFIG, level_2_from: 0 })).toEqual(["levels"]);
    expect(riskConfigErrors({ ...DEFAULT_RISK_CONFIG, points: { ...DEFAULT_RISK_CONFIG.points, T9: 21 } })).toEqual(["points"]);
    expect(riskConfigErrors({ ...DEFAULT_RISK_CONFIG, points: { ...DEFAULT_RISK_CONFIG.points, T1: [2, Number.NaN] } })).toEqual(["points"]);
    expect(riskConfigErrors({ ...DEFAULT_RISK_CONFIG, threshold_1_eur: 0 })).toEqual(["thresholds"]);
    expect(riskConfigErrors({ ...DEFAULT_RISK_CONFIG, list_1: ["RUS"] })).toEqual(["codes"]);
    expect(riskConfigErrors({ ...DEFAULT_RISK_CONFIG, list_1: ["IR"] })).toEqual(["lists"]);
  });

  it("sends the lists sorted", () => {
    const payload = riskConfigPayload({ ...DEFAULT_RISK_CONFIG, list_2: ["MM", "IR", "KP"] });
    expect(payload.list_2).toEqual(["IR", "KP", "MM"]);
    expect(payload.points).toEqual(DEFAULT_RISK_CONFIG.points);
  });

  it("offers active staff who read leads, not sales, the CEO assistant, interpreters, billing or the CEO", () => {
    const candidates = eligibleReviewerCandidates([
      { id: "1", name: "Viktor Zahler", role: "patient_manager" },
      { id: "2", name: "Anna Muster", role: "sales" },
      { id: "3", name: "Ben Muster", role: "concierge" },
      { id: "8", name: "Bea Billing", role: "billing" },
      { id: "4", name: "Mia Muster", role: "ceo_assistant" },
      { id: "5", name: "Test CEO", role: "ceo" },
      { id: "6", name: "Old Account", role: "patient_manager", is_active: false },
      { id: "7", name: "Ivan Interpreter", role: "interpreter" },
    ]);
    expect(candidates.map((candidate) => candidate.id)).toEqual(["3", "1"]);
  });

  it("reads the review queue in either shape", () => {
    const rows = normalizeRiskReviews({
      reviews: [
        {
          lead_id: "lead-1",
          name: "Anna Muster",
          level: 3,
          status: "proposed",
          since: "2026-10-06T08:00:00Z",
          pending_proposal: { decision: "release", decided_by_name: "Test CEO", decided_at: "2026-10-07T08:00:00Z" },
        },
        { name: "no lead" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lead_id: "lead-1", level: 3, status: "proposed" });
    expect(rows[0].pending_proposal?.decided_by_name).toBe("Test CEO");
    expect(normalizeRiskReviews([{ lead_id: "lead-2", level: 7 }])[0].level).toBe(3);
    expect(normalizeRiskReviews(null)).toEqual([]);
  });

  it("has every text of the tab in both languages", () => {
    const keys = Object.keys(sanctionsRu).filter((key) => key.startsWith("risk_") || key === "sanctions_tab_risk");
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect((sanctionsDe as Record<string, string>)[key]).toBeTruthy();
      expect((sanctionsRu as Record<string, string>)[key]).not.toBe((sanctionsDe as Record<string, string>)[key]);
    }
  });
});
