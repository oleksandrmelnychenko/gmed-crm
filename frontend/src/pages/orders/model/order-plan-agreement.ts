import type { TreatmentPlanStatus } from "./types";

/**
 * Agreeing the plan with the patient stays manual (owner decision 2026-11-02,
 * question 4): staff record each step. The steps follow the plan's status:
 * sent to the patient, the patient's answer (agreed or a correction), then the
 * finalisation. Every step goes through the audited planning update.
 */
export type PlanAgreementStep = {
  status: TreatmentPlanStatus;
  ru: string;
  de: string;
  primary: boolean;
};

const SENT: PlanAgreementStep = {
  status: "sent",
  ru: "Отметить: отправлен пациенту",
  de: "Als an Patienten gesendet markieren",
  primary: true,
};
const AGREED: PlanAgreementStep = {
  status: "agreed",
  ru: "Пациент согласовал",
  de: "Patient hat zugestimmt",
  primary: true,
};
const CORRECTION: PlanAgreementStep = {
  status: "correction_requested",
  ru: "Нужна корректировка",
  de: "Korrektur nötig",
  primary: false,
};
const FINALIZED: PlanAgreementStep = {
  status: "finalized",
  ru: "Зафиксировать план",
  de: "Plan finalisieren",
  primary: true,
};

export function planAgreementSteps(status: string): PlanAgreementStep[] {
  switch (status) {
    case "draft":
    case "correction_requested":
      return [SENT];
    case "sent":
      return [AGREED, CORRECTION];
    case "agreed":
      return [FINALIZED, CORRECTION];
    case "finalized":
      return [CORRECTION];
    default:
      return [SENT];
  }
}

export const PLAN_AGREEMENT_STATUS: Record<
  TreatmentPlanStatus,
  { ru: string; de: string; tone: "neutral" | "info" | "warning" | "success" }
> = {
  draft: { ru: "Черновик", de: "Entwurf", tone: "neutral" },
  sent: { ru: "Отправлен пациенту", de: "An Patienten gesendet", tone: "info" },
  agreed: { ru: "Согласовано", de: "Abgestimmt", tone: "info" },
  correction_requested: { ru: "Запрошена корректировка", de: "Korrektur angefragt", tone: "warning" },
  finalized: { ru: "Финализировано", de: "Finalisiert", tone: "success" },
};

function time(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether appointments were added to the plan after its PDF was made and
 * after its agreement status was set (QA round 13): the status and the PDF
 * stay as they are, staff only see that they may be out of date.
 */
export function planChangedSince({
  status,
  statusUpdatedAt,
  pdfCreatedAt,
  appointmentsLastAddedAt,
}: {
  status: TreatmentPlanStatus;
  statusUpdatedAt: string | null | undefined;
  pdfCreatedAt: string | null | undefined;
  appointmentsLastAddedAt: string | null | undefined;
}) {
  const added = time(appointmentsLastAddedAt);
  if (added === null) return { pdfStale: false, statusStale: false };
  const pdf = time(pdfCreatedAt);
  const statusAt = time(statusUpdatedAt);
  return {
    pdfStale: pdf !== null && added > pdf,
    // A draft or a requested correction is still being changed on purpose.
    statusStale:
      (status === "sent" || status === "agreed" || status === "finalized") &&
      statusAt !== null &&
      added > statusAt,
  };
}

/**
 * The note to send with a step: the edited text when it changed (an empty
 * text clears the note), otherwise nothing so the stored note stays.
 */
export function planNotePayload(draft: string, stored: string | null | undefined) {
  const next = draft.trim();
  return next === (stored ?? "").trim() ? undefined : next;
}
