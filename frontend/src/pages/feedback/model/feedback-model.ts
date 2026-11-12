import type { Lang } from "@/lib/i18n";
import { formatCount, type PluralWords } from "@/lib/i18n/plural";
import { actorRole, hasCapability, type Actor } from "@/lib/permissions";

import type { FeedbackFormState, PatientOption } from "./types";

/** "1 отзыв / 2 отзыва / 5 отзывов", "1 Rückmeldung / 2 Rückmeldungen" (QA E3-07). */
export const FEEDBACK_COUNT_WORDS: PluralWords = {
  ru: ["отзыв", "отзыва", "отзывов"],
  de: ["Rückmeldung", "Rückmeldungen"],
};

/** "1 оценка / 2 оценки / 5 оценок", "1 Bewertung / 2 Bewertungen". */
export const RATING_COUNT_WORDS: PluralWords = {
  ru: ["оценка", "оценки", "оценок"],
  de: ["Bewertung", "Bewertungen"],
};

export function formatFeedbackCount(lang: Lang, count: number): string {
  return formatCount(lang, count, FEEDBACK_COUNT_WORDS);
}

export function formatRatingCount(lang: Lang, count: number): string {
  return formatCount(lang, count, RATING_COUNT_WORDS);
}

/** Keeps "12,5" and "%" on one line. */
export const NO_BREAK_SPACE = String.fromCharCode(0xa0);

const FEEDBACK_DECIMAL: Record<Lang, Intl.NumberFormat> = {
  de: new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  ru: new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
};

/** One decimal with a decimal comma in RU and DE ("4,9"), the empty label without a value. */
export function formatFeedbackDecimal(value: number | null | undefined, lang: Lang, emptyLabel: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return emptyLabel;
  return FEEDBACK_DECIMAL[lang].format(value);
}

/** "12,5 %" in RU and DE. */
export function formatFeedbackPercent(value: number | null | undefined, lang: Lang, emptyLabel: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return emptyLabel;
  return [FEEDBACK_DECIMAL[lang].format(value), "%"].join(NO_BREAK_SPACE);
}

export const scoreOptions = ["1", "2", "3", "4", "5"];
export const npsOptions = Array.from({ length: 11 }, (_, index) => String(index));

/**
 * Nothing is rated until the person chooses: an untouched scale is stored as
 * empty, not as the best score (global QA 2026-11-10).
 */
export function blankFeedbackForm(): FeedbackFormState {
  return {
    appointmentId: "",
    overallScore: "",
    patientManagerScore: "",
    interpreterScore: "",
    conciergeScore: "",
    treatmentScore: "",
    doctorScore: "",
    organizationScore: "",
    serviceScore: "",
    infrastructureScore: "",
    priceValueScore: "",
    treatmentSuccess: "",
    complicationReported: false,
    npsScore: "",
    comments: "",
    improvementNotes: "",
    internalNote: "",
  };
}

/** A chosen score as a number, an untouched scale as null. */
export function feedbackScoreValue(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The two scales every survey needs (the server stores them as mandatory):
 * the overall score and the recommendation score. Returns the first one still
 * missing, or null when the form can be sent.
 */
export function missingRequiredFeedbackScore(
  form: Pick<FeedbackFormState, "overallScore" | "npsScore">,
): "overall" | "nps" | null {
  if (feedbackScoreValue(form.overallScore) === null) return "overall";
  if (feedbackScoreValue(form.npsScore) === null) return "nps";
  return null;
}

/** The scores of the form as the server takes them: empty scales as null. */
export function feedbackScoresPayload(form: FeedbackFormState, options: { withInterpreter: boolean }) {
  return {
    overall_score: feedbackScoreValue(form.overallScore),
    patient_manager_score: feedbackScoreValue(form.patientManagerScore),
    interpreter_score: options.withInterpreter ? feedbackScoreValue(form.interpreterScore) : null,
    concierge_score: feedbackScoreValue(form.conciergeScore),
    treatment_score: feedbackScoreValue(form.treatmentScore),
    doctor_score: feedbackScoreValue(form.doctorScore),
    organization_score: feedbackScoreValue(form.organizationScore),
    service_score: feedbackScoreValue(form.serviceScore),
    infrastructure_score: feedbackScoreValue(form.infrastructureScore),
    price_value_score: feedbackScoreValue(form.priceValueScore),
    treatment_success: form.treatmentSuccess || null,
    nps_score: feedbackScoreValue(form.npsScore),
  };
}

/**
 * Whether the patient's survey asks about the interpreter: only for a chosen
 * visit with an interpreter (a visit of an older server answer, without the
 * flag, keeps the question). The general survey names no interpreter, so it
 * no longer asks (owner decision 2026-11-12, QA B-05).
 */
export function portalSurveyAsksInterpreter(visit: { has_interpreter?: boolean } | null | undefined): boolean {
  return Boolean(visit) && visit?.has_interpreter !== false;
}

type RateableVisit = {
  status: string;
  date: string;
  time_start?: string | null;
  time_end?: string | null;
};

/**
 * Whether a visit can be rated: it was not cancelled and it is over. A visit
 * the team marked completed took place; otherwise its end (else its start,
 * else its day) lies behind `now` ("YYYY-MM-DDTHH:mm", Berlin wall clock).
 * Mirrors `appointment_took_place` of the server.
 */
export function isRateableVisit(visit: RateableVisit, now: string): boolean {
  if (visit.status === "cancelled") return false;
  if (visit.status === "completed") return true;
  if (!visit.date) return false;
  const time = visit.time_end || visit.time_start;
  if (time) return `${visit.date}T${time.slice(0, 5)}` <= now.slice(0, 16);
  return visit.date < now.slice(0, 10);
}

export function roleCanCaptureFeedback(actor?: Actor) {
  return hasCapability(actor, "feedback.capture");
}

export function canViewStaffFeedback(actor?: Actor) {
  return hasCapability(actor, "feedback.view");
}

/** Mirrors the server: the read-only CEO assistant cannot review or archive feedback. */
export function canReviewStaffFeedback(actor?: Actor) {
  return canViewStaffFeedback(actor) && actorRole(actor) !== "ceo_assistant";
}

/**
 * Whether saving the review needs an edited field: a new status (the preset
 * «Проверено» on a submitted entry) is itself the change and saves without a
 * note; only an unchanged status waits for an edit (QA 2026-11-12 system-D F4).
 */
export function feedbackReviewNeedsEdit(
  item: { status: string } | null | undefined,
  reviewStatus: string,
) {
  return !item || item.status === reviewStatus;
}

export function patientLabel(item: PatientOption) {
  return `${item.patient_id} - ${[item.first_name, item.last_name].filter(Boolean).join(" ")}`.trim();
}
