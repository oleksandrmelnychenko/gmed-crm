import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { normalizeLeadRiskAssessment } from "../model/lead-risk-assessment";
import type { LeadRiskController } from "../model/use-lead-risk-assessment";
import { LeadRiskAssessmentPanel } from "./lead-risk-assessment-panel";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const controller: LeadRiskController = {
  decide: async () => undefined,
  confirm: async () => undefined,
  withdraw: async () => undefined,
  restart: async () => undefined,
  reload: async () => null,
};

function assessment(patch: Record<string, unknown> = {}) {
  return normalizeLeadRiskAssessment({
    started_at: "2026-10-07T08:00:00Z",
    status: "review_required",
    level: 2,
    points: 5,
    patient_points: 4,
    payer_points: 5,
    knockout: false,
    triggers: [
      { key: "T1", subject: "patient", variant: "list_1", points: 2, active: true, first_fired_at: "2026-10-07T08:00:00Z", blocks: ["F"] },
      { key: "T2", subject: "patient", variant: "list_1", points: 2, active: false, first_fired_at: "2026-10-06T08:00:00Z", blocks: ["F"] },
      { key: "T9", subject: "payer", variant: null, points: 4, active: true, first_fired_at: "2026-10-07T08:00:00Z", blocks: ["C"] },
    ],
    blocks: {
      C: { open: true, party: "cabinet", answered: false, missing: ["payment_method"] },
      F: { open: true, party: "cabinet", answered: true, missing: [] },
    },
    requested_blocks: ["C"],
    follow_up_answered_at: null,
    review_notice: true,
    preview: null,
    decisions: [
      { id: "d0", decision: "request_more", reason: "Zahlungsweg klären", blocks: ["C"], level: 2, decided_by_name: "Test CEO", decided_at: "2026-10-07T09:00:00Z" },
    ],
    history: [{ id: "e1", at: "2026-10-07T08:00:00Z", kind: "started", level: 2, points: 5, cause: "cabinet", actor_name: null }],
    pending_proposal: null,
    config_version: 1,
    can_decide: true,
    can_confirm: false,
    four_eyes_required: false,
    reviewers_available: 2,
    ...patch,
  });
}

function render(value: ReturnType<typeof assessment>, tx = ru) {
  return renderToStaticMarkup(<LeadRiskAssessmentPanel assessment={value} controller={controller} tx={tx} />);
}

describe("LeadRiskAssessmentPanel", () => {
  it("shows level, points per subject, the triggers, the open blocks and the decisions", () => {
    const html = render(assessment());
    expect(html).toContain("Оценка риска");
    expect(html).toContain('data-level="2"');
    expect(html).toContain("Уровень 2");
    expect(html).toContain("Нужно решение");
    expect(html).toContain("5 (пациент 4 · плательщик 5)");
    expect(html).toContain("Гражданство пациента в списке стран");
    expect(html).toContain("список 1");
    // A fired trigger stays after the data changed (sticky).
    expect(html).toMatch(/data-testid="lead-risk-trigger-T2" data-active="false"/);
    expect(html).toContain("зафиксирован (данные изменились)");
    expect(html).toContain("07.10.2026");
    expect(html).toContain("Способ и путь оплаты");
    expect(html).toContain("не хватает: способ оплаты");
    expect(html).toContain("запрошено");
    for (const testId of ["lead-risk-decide-release", "lead-risk-decide-request_more", "lead-risk-decide-reject"]) {
      expect(html).toContain(testId);
    }
    expect(html).toContain("Zahlungsweg klären");
    expect(html).not.toContain("lead-risk-proposal");
    expect(html).not.toContain("K.o.</span></span>");
  });

  it("shows the K.o. tag and the four-eyes note at level 3, and warns without a second reviewer", () => {
    const html = render(
      assessment({
        level: 3,
        knockout: true,
        triggers: [{ key: "T14", subject: "patient", points: 0, active: true, first_fired_at: "2026-10-07T08:00:00Z", blocks: ["H"] }],
        reviewers_available: 1,
      }),
      de,
    );
    expect(html).toContain("Stufe 3");
    expect(html).toContain("lead-risk-knockout");
    expect(html).toContain("PEP: Antwort „ja“");
    expect(html).toContain("Stufe 3: Freigabe und Ablehnung sind Vorschläge");
    expect(html).toContain("lead-risk-second-reviewer-missing");
  });

  it("shows a pending proposal with confirm for a second reviewer and withdraw for the proposer", () => {
    const proposal = { id: "d1", decision: "release", reason: "Herkunft der Mittel belegt", decided_by_name: "Test CEO", decided_at: "2026-10-07T10:00:00Z" };
    const second = render(assessment({ level: 3, status: "proposed", pending_proposal: proposal, can_confirm: true }));
    expect(second).toContain("lead-risk-proposal");
    expect(second).toContain("Предложение: Разрешить — Test CEO, 07.10.2026 12:00");
    expect(second).toContain("Herkunft der Mittel belegt");
    expect(second).toContain("Принцип четырёх глаз");
    expect(second).toContain(">Подтвердить<");
    expect(second).not.toContain(">Отозвать<");
    // No new decision while the proposal waits.
    expect(second).not.toContain("lead-risk-decide-");
    const proposer = render(assessment({ level: 3, status: "proposed", pending_proposal: proposal, can_confirm: false }));
    expect(proposer).toContain(">Отозвать<");
    expect(proposer).not.toContain(">Подтвердить<");
    // The proposal in the list of decisions, with its state.
    const listed = render(
      assessment({
        decisions: [{ id: "d1", kind: "proposal", proposal_state: "withdrawn", decision: "reject", reason: "Mittelherkunft unklar", level: 3, decided_by_name: "Test CEO", decided_at: "2026-10-07T10:00:00Z" }],
      }),
    );
    expect(listed).toContain("(предложение · отозвано)");
  });

  it("is read-only for a non-reviewer", () => {
    const html = render(assessment({ can_decide: false }));
    expect(html).toContain("lead-risk-read-only");
    expect(html).not.toContain("lead-risk-decide-");
    expect(html).not.toContain("lead-risk-restart");
  });

  it("shows the preview before the start and offers the start to a reviewer", () => {
    const html = render(
      assessment({
        started_at: null,
        status: null,
        preview: { level: 2, points: 4, patient_points: 4, payer_points: 0, knockout: false, triggers: [{ key: "T1", subject: "patient", variant: "list_2", points: 4 }] },
      }),
    );
    expect(html).toContain("lead-risk-preview");
    expect(html).toContain("Предварительный расчёт (не сохранён)");
    expect(html).toContain("список 2");
    expect(html).toContain("Не начата");
    expect(html).toContain("lead-risk-restart");
    expect(html).not.toContain("lead-risk-decide-");
  });

  it("renders nothing without an assessment", () => {
    expect(renderToStaticMarkup(<LeadRiskAssessmentPanel assessment={null} controller={controller} tx={ru} />)).toBe("");
  });
});
