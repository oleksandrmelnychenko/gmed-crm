import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  RISK_BLOCK_KEYS,
  RISK_TRIGGER_KEYS,
  normalizeLeadRiskAssessment,
  riskAssessmentStarted,
  riskAvailableDecisions,
  riskBlockLabel,
  riskCanRestart,
  riskCanWithdraw,
  riskDecisionErrorText,
  riskDecisionNeedsSecondReviewer,
  riskDisplayedScore,
  riskEventLabel,
  riskGateErrorText,
  riskLevelTone,
  riskPointsLine,
  riskReasonValid,
  riskReviewerRoleEligible,
  riskSecondReviewerMissing,
  riskShowsPreview,
  riskStatusLabel,
  riskSuggestedBlocks,
  riskTriggerLabel,
} from "./lead-risk-assessment";
import { normalizeFollowUpAnswers, normalizeRequestReason, normalizeStaffIdDataMarks } from "./lead-risk-intake";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

/** A level-2 lead: a Russian citizen living in Russia (T1 + T2 on list 1), a friend pays (T4 + T5). */
function levelTwo(patch: Record<string, unknown> = {}) {
  return {
    started_at: "2026-10-07T08:00:00Z",
    status: "review_required",
    level: 2,
    points: 4,
    patient_points: 4,
    payer_points: 3,
    knockout: false,
    triggers: [
      { key: "T1", subject: "patient", variant: "list_1", points: 2, active: true, first_fired_at: "2026-10-07T08:00:00Z", blocks: ["F"] },
      { key: "T2", subject: "patient", variant: "list_1", points: 2, active: false, first_fired_at: "2026-10-07T08:00:00Z", blocks: ["F"] },
      { key: "T4", subject: "payer", variant: null, points: 1, active: true, first_fired_at: "2026-10-07T08:00:00Z", blocks: ["A", "B", "C", "D"] },
      { key: "T5", subject: "payer", variant: null, points: 2, active: true, first_fired_at: "2026-10-07T08:00:00Z", blocks: ["A", "B"] },
    ],
    blocks: {
      A: { open: true, party: "cabinet", answered: false, missing: ["funds_sources"] },
      F: { open: true, party: "cabinet", answered: true, missing: [] },
      D: { open: false, party: "payer_link", answered: false, missing: [] },
    },
    requested_blocks: [],
    follow_up_answered_at: null,
    review_notice: true,
    preview: null,
    decisions: [],
    history: [{ id: "e1", at: "2026-10-07T08:00:00Z", kind: "started", level: 2, points: 4, cause: "cabinet", actor_name: null }],
    pending_proposal: null,
    config_version: 1,
    can_decide: true,
    can_confirm: false,
    four_eyes_required: false,
    reviewers_available: 2,
    ...patch,
  };
}

describe("the risk assessment of a lead (staff)", () => {
  it("reads the server's answer with every key present", () => {
    const assessment = normalizeLeadRiskAssessment(levelTwo())!;
    expect(assessment.level).toBe(2);
    expect(assessment.points).toBe(4);
    expect(assessment.triggers.map((trigger) => trigger.key)).toEqual(["T1", "T2", "T4", "T5"]);
    expect(assessment.triggers[1]).toMatchObject({ active: false, variant: "list_1", blocks: ["F"] });
    // The blocks in letter order, unknown letters dropped.
    expect(assessment.blocks.map((block) => block.key)).toEqual(["A", "D", "F"]);
    expect(assessment.blocks[1]).toMatchObject({ party: "payer_link", open: false });
    expect(assessment.history[0]).toMatchObject({ kind: "started", cause: "cabinet" });
    expect(riskPointsLine(assessment, ru)).toBe("4 (пациент 4 · плательщик 3)");
  });

  it("is nothing for an answer that is not one", () => {
    for (const value of [null, [], "x", {}, { level: 2 }]) {
      expect(normalizeLeadRiskAssessment(value)).toBeNull();
    }
  });

  it("puts any K.o. trigger on level 3, whatever the points", () => {
    const assessment = normalizeLeadRiskAssessment(
      levelTwo({
        level: 1,
        points: 0,
        triggers: [{ key: "T14", subject: "patient", points: 0, active: true, first_fired_at: null, blocks: ["H"] }],
      }),
    )!;
    expect(assessment.knockout).toBe(true);
    expect(assessment.level).toBe(3);
    expect(assessment.four_eyes_required).toBe(true);
    expect(riskLevelTone(assessment.level)).toBe("error");
    expect(riskLevelTone(2)).toBe("warning");
    expect(riskLevelTone(1)).toBe("success");
  });

  it("shows the live preview before the start and for a grandfathered lead", () => {
    const preview = { level: 2, points: 4, patient_points: 4, payer_points: 0, knockout: false, triggers: [{ key: "T1", subject: "patient", variant: "list_1", points: 2 }] };
    const notStarted = normalizeLeadRiskAssessment({ started_at: null, status: null, preview, can_decide: true })!;
    expect(riskAssessmentStarted(notStarted)).toBe(false);
    expect(riskShowsPreview(notStarted)).toBe(true);
    expect(riskDisplayedScore(notStarted).level).toBe(2);
    expect(riskCanRestart(notStarted)).toBe(true);
    expect(riskAvailableDecisions(notStarted)).toEqual([]);
    const grandfathered = normalizeLeadRiskAssessment({ ...levelTwo({ status: "grandfathered", level: 1, points: 0, triggers: [] }), preview })!;
    expect(riskAssessmentStarted(grandfathered)).toBe(false);
    expect(riskDisplayedScore(grandfathered).points).toBe(4);
    expect(riskCanRestart(grandfathered)).toBe(true);
    expect(riskCanRestart(normalizeLeadRiskAssessment(levelTwo())!)).toBe(false);
    expect(riskCanRestart({ ...grandfathered, can_decide: false })).toBe(false);
  });

  it("offers the decisions by level and status", () => {
    const two = normalizeLeadRiskAssessment(levelTwo())!;
    expect(riskAvailableDecisions(two)).toEqual(["release", "request_more", "reject"]);
    // Level 1 needs no release, but staff may still ask or reject.
    const one = normalizeLeadRiskAssessment(levelTwo({ level: 1, points: 2, status: "clear" }))!;
    expect(riskAvailableDecisions(one)).toEqual(["request_more", "reject"]);
    // A release may follow a reject.
    expect(riskAvailableDecisions({ ...one, status: "rejected" })).toEqual(["release", "request_more"]);
    expect(riskAvailableDecisions({ ...two, status: "released" })).toEqual(["request_more", "reject"]);
    // Nothing for a non-reviewer or while a proposal waits.
    expect(riskAvailableDecisions({ ...two, can_decide: false })).toEqual([]);
    const proposed = normalizeLeadRiskAssessment(
      levelTwo({ level: 3, status: "proposed", pending_proposal: { id: "d1", decision: "release", reason: "Herkunft geprüft", decided_by_name: "Test CEO", decided_at: "2026-10-07T09:00:00Z" } }),
    )!;
    expect(riskAvailableDecisions(proposed)).toEqual([]);
  });

  it("needs a second reviewer for a release or a reject at level 3", () => {
    const three = normalizeLeadRiskAssessment(levelTwo({ level: 3, points: 9, reviewers_available: 1 }))!;
    expect(riskDecisionNeedsSecondReviewer(three, "release")).toBe(true);
    expect(riskDecisionNeedsSecondReviewer(three, "reject")).toBe(true);
    expect(riskDecisionNeedsSecondReviewer(three, "request_more")).toBe(false);
    expect(riskDecisionNeedsSecondReviewer(normalizeLeadRiskAssessment(levelTwo())!, "release")).toBe(false);
    expect(riskSecondReviewerMissing(three)).toBe(true);
    expect(riskSecondReviewerMissing({ ...three, reviewers_available: 2 })).toBe(false);
  });

  it("lets only the proposer withdraw", () => {
    const proposal = { id: "d1", decision: "reject", reason: "Mittelherkunft unklar", decided_by: "user-1", decided_by_name: "Test CEO", decided_at: null };
    const mine = normalizeLeadRiskAssessment(levelTwo({ level: 3, pending_proposal: proposal, can_confirm: false }))!;
    expect(riskCanWithdraw(mine)).toBe(true);
    expect(riskCanWithdraw(mine, "user-2")).toBe(false);
    expect(riskCanWithdraw(mine, "user-1")).toBe(true);
    const other = { ...mine, can_confirm: true };
    expect(riskCanWithdraw(other)).toBe(false);
    expect(riskCanWithdraw({ ...other, can_withdraw: true })).toBe(true);
    expect(riskCanWithdraw(normalizeLeadRiskAssessment(levelTwo())!)).toBe(false);
  });

  it("suggests the blocks of the triggers neither requested nor answered yet", () => {
    const assessment = normalizeLeadRiskAssessment(levelTwo({ requested_blocks: ["b"] }))!;
    expect(assessment.requested_blocks).toEqual(["B"]);
    // F is answered already: not pre-ticked (asking it again re-opens it for the lead).
    expect(riskSuggestedBlocks(assessment)).toEqual(["A", "C", "D"]);
  });

  it("requires a reason of at least 10 characters", () => {
    expect(riskReasonValid("kurz")).toBe(false);
    expect(riskReasonValid("   zehn Zeichen   ")).toBe(true);
  });

  it("names every trigger, block and status in both languages", () => {
    for (const key of RISK_TRIGGER_KEYS) {
      expect(riskTriggerLabel(key, ru)).not.toBe(key);
      expect(riskTriggerLabel(key, de)).not.toBe(key);
    }
    for (const key of RISK_BLOCK_KEYS) {
      expect(riskBlockLabel(key, de)).not.toBe(key);
    }
    expect(riskStatusLabel("proposed", de)).toBe("Wartet auf Zweitprüfung");
    expect(riskStatusLabel(null, ru)).toBe("Не начата");
  });

  it("says why a trigger was withdrawn: a false positive or a valid identity document", () => {
    const event = (cause: string) => ({
      id: "e1",
      at: null,
      kind: "trigger_withdrawn",
      level: 1,
      points: 2,
      cause,
      actor_name: null,
      status: null,
    });
    expect(riskEventLabel(event("hit_decision"), de)).toBe("Auslöser zurückgenommen (falsch positiv)");
    expect(riskEventLabel(event("cabinet"), de)).toBe("Auslöser zurückgenommen (gültiges Ausweisdokument)");
    expect(riskEventLabel(event("staff"), ru)).toBe("Триггер снят (действительный документ личности)");
  });

  it("explains the server's decision errors", () => {
    const error = (code: string, status = 409) => new ApiRequestError(code, { status, code, body: { error: code } });
    expect(riskDecisionErrorText(error("four_eyes_same_user"), de)).toContain("Vier-Augen-Prinzip");
    expect(riskDecisionErrorText(error("assessment_changed"), ru)).toContain("Оценка изменилась");
    expect(riskDecisionErrorText(error("reason_required", 422), ru)).toContain("минимум 10 символов");
    expect(riskDecisionErrorText(error("forbidden", 403), de)).toContain("CEO");
    expect(riskDecisionErrorText(error("something_else", 500), de)).toBeNull();
    expect(riskDecisionErrorText(new Error("x"), de)).toBeNull();
    expect(riskGateErrorText(error("risk_review_required"), de)).toContain("Risikobewertung");
    expect(riskGateErrorText(error("payer_gate_blocked"), de)).toBeNull();
  });

  it("names deputies only from eligible roles", () => {
    expect(riskReviewerRoleEligible("patient_manager", true)).toBe(true);
    expect(riskReviewerRoleEligible("billing", true)).toBe(true);
    for (const role of ["sales", "ceo_assistant", "interpreter", "teamlead_interpreter"]) {
      expect(riskReviewerRoleEligible(role, true)).toBe(false);
    }
    expect(riskReviewerRoleEligible("it_admin", false)).toBe(false);
  });
});

describe("trigger-flow additions to the portal state", () => {
  it("reads the staff marks of the identity document data", () => {
    expect(normalizeStaffIdDataMarks({ id_document_unreadable: true, id_data_entered_by_name: " Ben Muster ", id_data_entered_at: "2026-10-07T10:00:00Z" })).toEqual({
      id_document_unreadable: true,
      id_data_entered_by_name: "Ben Muster",
      id_data_entered_at: "2026-10-07T10:00:00Z",
    });
    // An unset flag is no answer of anybody.
    expect(normalizeStaffIdDataMarks({ id_document_unreadable: false })).not.toHaveProperty("id_document_unreadable");
  });

  it("reads the follow-up answers with ISO codes upper-cased", () => {
    const answers = normalizeFollowUpAnswers({ former_citizenships: ["ru", "", 3], pep_country: "at", stay_reason: "work" });
    expect(answers.former_citizenships).toEqual(["RU"]);
    expect(answers.pep_country).toBe("AT");
    expect(answers.stay_reason).toBe("work");
    expect(answers.sanctions_link_name).toBeNull();
  });

  it("reads the lead's reason for the request in either shape", () => {
    expect(normalizeRequestReason({ request_reason: { text: " Rückenschmerzen ", updated_at: "2026-10-07T08:00:00Z" } })).toEqual({
      text: "Rückenschmerzen",
      updated_at: "2026-10-07T08:00:00Z",
    });
    expect(normalizeRequestReason({ request_reason: "Knie", request_reason_updated_at: "2026-10-06T08:00:00Z" })).toEqual({
      text: "Knie",
      updated_at: "2026-10-06T08:00:00Z",
    });
    expect(normalizeRequestReason({ portal_concern: { text: "Kopf" } })).toEqual({ text: "Kopf", updated_at: null });
    expect(normalizeRequestReason({ request_reason: "  " })).toBeNull();
    expect(normalizeRequestReason({})).toBeNull();
  });
});
