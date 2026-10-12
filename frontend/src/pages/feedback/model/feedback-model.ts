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

export function blankFeedbackForm(): FeedbackFormState {
  return {
    appointmentId: "",
    overallScore: "5",
    patientManagerScore: "5",
    interpreterScore: "5",
    conciergeScore: "5",
    treatmentScore: "5",
    doctorScore: "5",
    organizationScore: "5",
    serviceScore: "5",
    infrastructureScore: "5",
    priceValueScore: "5",
    treatmentSuccess: "yes",
    complicationReported: false,
    npsScore: "10",
    comments: "",
    improvementNotes: "",
    internalNote: "",
  };
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

export function patientLabel(item: PatientOption) {
  return `${item.patient_id} - ${[item.first_name, item.last_name].filter(Boolean).join(" ")}`.trim();
}
