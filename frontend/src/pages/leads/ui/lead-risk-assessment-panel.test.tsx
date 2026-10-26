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
    expect(html).toContain("5 (большее из: пациент 4 · плательщик 5)");
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

  it("shows the K.o. tag and the level-3 stop, and lets one reviewer decide at once", () => {
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
    // Four-eyes removed (owner 2026-10-25): no proposal wording, no second-reviewer warning.
    expect(html).toContain("lead-risk-level3-stop");
    expect(html).toContain("K.o.: Stufe 3 unabhängig von den Punkten");
    expect(html).toContain("Die Entscheidung wird sofort wirksam, auf jeder Stufe. Eine Begründung ist Pflicht (mindestens 10 Zeichen).");
    expect(html).toContain(">Freigeben<");
    expect(html).toContain(">Ablehnen<");
    expect(html).not.toContain("Vorschläge");
    expect(html).not.toContain("Zweitprüfung");
    expect(html).not.toContain("second-reviewer-missing");
  });

  it("shows an old pending proposal that any reviewer may confirm or withdraw", () => {
    const proposal = { id: "d1", decision: "release", reason: "Herkunft der Mittel belegt", decided_by_name: "Test CEO", decided_at: "2026-10-07T10:00:00Z" };
    const reviewer = render(assessment({ level: 3, status: "proposed", pending_proposal: proposal, can_confirm: true, can_withdraw: true }));
    expect(reviewer).toContain("lead-risk-proposal");
    expect(reviewer).toContain("Старое предложение: Разрешить — Test CEO, 07.10.2026 12:00");
    expect(reviewer).toContain("Herkunft der Mittel belegt");
    expect(reviewer).toContain("Ждёт подтверждения (старое предложение)");
    expect(reviewer).not.toContain("четырёх глаз");
    expect(reviewer).toContain(">Подтвердить<");
    expect(reviewer).toContain(">Отозвать<");
    // No new decision while the proposal waits.
    expect(reviewer).not.toContain("lead-risk-decide-");
    // The server may refuse one of them.
    const confirmOnly = render(assessment({ level: 3, status: "proposed", pending_proposal: proposal, can_confirm: true, can_withdraw: false }));
    expect(confirmOnly).toContain(">Подтвердить<");
    expect(confirmOnly).not.toContain(">Отозвать<");
    // The proposal in the list of decisions, with its state.
    const listed = render(
      assessment({
        decisions: [{ id: "d1", kind: "proposal", proposal_state: "withdrawn", decision: "reject", reason: "Mittelherkunft unklar", level: 3, decided_by_name: "Test CEO", decided_at: "2026-10-07T10:00:00Z" }],
      }),
    );
    // The state is a chip next to the decision since 2026-10-26 (owner).
    expect(listed).toContain(">предложение · отозвано<");
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

  it("names the parent a representative trigger concerns", () => {
    // QA 2026-10-24, B-6: the row said "представитель" only; the trigger now carries the
    // representative's id, and the one the assessment does not list comes with its name.
    const html = render(assessment({
      triggers: [
        { key: "T1", subject: "representative", variant: "list_1", points: 2, active: true, first_fired_at: "2026-10-07T08:00:00Z", blocks: ["R"], representative_id: "rep-1" },
        { key: "T14", subject: "representative", variant: null, points: 0, active: true, first_fired_at: "2026-10-07T08:00:00Z", blocks: ["R"], representative_id: "rep-2", representative_name: "Otto Muster" },
      ],
      representatives: [{ id: "rep-1", name: "Anna Muster", country_questions: true, missing: [], fields: {} }],
    }));
    expect(html).toContain("представитель: Anna Muster");
    expect(html).toContain("представитель: Otto Muster");
  });

  it("renders nothing without an assessment", () => {
    expect(renderToStaticMarkup(<LeadRiskAssessmentPanel assessment={null} controller={controller} tx={ru} />)).toBe("");
  });

  it("shows country-triggered questions before submission as draft completeness, not a completed assessment", () => {
    const value = assessment({
      started_at: null, status: null, level: null, points: null, triggers: [],
      before_submit: true,
      preview: { level: 1, points: 2, patient_points: 2, payer_points: 0, triggers: [{ key: "T1", subject: "patient", variant: "list_1", points: 2 }] },
      blocks: {
        A: { open: true, party: "cabinet", answered: false, missing: ["funds_sources"] },
        F: { open: true, party: "cabinet", answered: true, missing: [] },
        K: { open: true, party: "cabinet", answered: false, missing: ["birth_place"] },
        L: { open: true, party: "cabinet", answered: false, missing: ["pep_self", "sanctions_links"] },
      },
      requested_blocks: [], decisions: [], history: [], can_decide: false, can_restart: false,
      // A stale historical timestamp must not turn a draft preview into a sent answer.
      follow_up_answered_at: "2026-10-07T08:00:00Z",
    });
    const html = render(value);
    expect(html).toContain("Не начата");
    expect(html).toContain("Вопросы до отправки анкеты");
    expect(html).toContain("оценка риска ещё не начата");
    for (const block of ["A", "F", "K", "L"]) expect(html).toContain(`data-testid="lead-risk-block-${block}"`);
    expect(html).toContain("заполнено");
    expect(html).toContain("нужен ответ");
    expect(html).not.toContain("ответ получен");
    expect(html).not.toContain("lead-risk-follow-up-answered");
    expect(html).not.toContain("lead-risk-decide-");
    expect(html).not.toContain("lead-risk-restart");
    expect(render(value, de)).toContain("Fragen vor dem Absenden der Anfrage");
    expect(render(assessment({ ...value, before_submit: false }))).not.toContain('data-testid="lead-risk-blocks"');
    const startedHtml = render(assessment({ before_submit: true }));
    expect(startedHtml).not.toContain("lead-risk-questions-preview");
    expect(startedHtml).toContain("ответ получен");
  });
});
