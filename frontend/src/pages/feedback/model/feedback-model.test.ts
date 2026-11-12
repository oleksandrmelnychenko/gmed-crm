import { describe, expect, it } from "vitest";

import {
  NO_BREAK_SPACE,
  blankFeedbackForm,
  feedbackScoresPayload,
  formatFeedbackCount,
  formatFeedbackDecimal,
  formatFeedbackPercent,
  formatRatingCount,
  isRateableVisit,
  missingRequiredFeedbackScore,
  portalSurveyAsksInterpreter,
} from "./feedback-model";

describe("satisfaction survey (global QA 2026-11-10)", () => {
  it("starts with no scale pre-set and stores an untouched scale as empty", () => {
    const form = blankFeedbackForm();
    expect(missingRequiredFeedbackScore(form)).toBe("overall");
    expect(feedbackScoresPayload(form, { withInterpreter: true })).toEqual({
      overall_score: null,
      patient_manager_score: null,
      interpreter_score: null,
      concierge_score: null,
      treatment_score: null,
      doctor_score: null,
      organization_score: null,
      service_score: null,
      infrastructure_score: null,
      price_value_score: null,
      treatment_success: null,
      nps_score: null,
    });
  });

  it("asks for the overall score and NPS and sends only what was chosen", () => {
    const form = { ...blankFeedbackForm(), overallScore: "2" };
    expect(missingRequiredFeedbackScore(form)).toBe("nps");
    // NPS 0 is a chosen answer, not an empty one.
    const chosen = { ...form, npsScore: "0", doctorScore: "4", interpreterScore: "5" };
    expect(missingRequiredFeedbackScore(chosen)).toBeNull();
    expect(feedbackScoresPayload(chosen, { withInterpreter: true })).toMatchObject({
      overall_score: 2,
      nps_score: 0,
      doctor_score: 4,
      interpreter_score: 5,
      concierge_score: null,
    });
    // A visit without an interpreter has nobody to rate.
    expect(feedbackScoresPayload(chosen, { withInterpreter: false }).interpreter_score).toBeNull();
  });

  it("asks about the interpreter only for a chosen visit with one (owner decision 2026-11-12)", () => {
    // The general survey names no interpreter.
    expect(portalSurveyAsksInterpreter(null)).toBe(false);
    expect(portalSurveyAsksInterpreter(undefined)).toBe(false);
    expect(portalSurveyAsksInterpreter({ has_interpreter: false })).toBe(false);
    expect(portalSurveyAsksInterpreter({ has_interpreter: true })).toBe(true);
    // A visit from an older server answer keeps the question.
    expect(portalSurveyAsksInterpreter({})).toBe(true);
  });

  it("offers only visits that took place", () => {
    const now = "2026-11-10T16:15:00";
    const visit = { status: "confirmed", date: "2026-11-10", time_start: "09:00", time_end: "10:00" };
    expect(isRateableVisit(visit, now)).toBe(true);
    // Cancelled, still ahead today, on a later day, today without a time.
    expect(isRateableVisit({ ...visit, status: "cancelled", date: "2026-11-01" }, now)).toBe(false);
    expect(isRateableVisit({ ...visit, time_start: "16:00", time_end: "17:00" }, now)).toBe(false);
    expect(isRateableVisit({ ...visit, date: "2026-12-08" }, now)).toBe(false);
    expect(isRateableVisit({ ...visit, time_start: null, time_end: null }, now)).toBe(false);
    // An earlier day without a time, a visit marked completed, a start-only visit.
    expect(isRateableVisit({ ...visit, date: "2026-11-09", time_start: null, time_end: null }, now)).toBe(true);
    expect(isRateableVisit({ ...visit, status: "completed", time_start: null, time_end: null }, now)).toBe(true);
    expect(isRateableVisit({ status: "planned", date: "2026-11-10", time_start: "15:30" }, now)).toBe(true);
  });
});

describe("feedback figures (QA E3-07)", () => {
  it("uses the right word form for counts", () => {
    expect(formatFeedbackCount("ru", 1)).toBe("1 отзыв");
    expect(formatFeedbackCount("ru", 2)).toBe("2 отзыва");
    expect(formatFeedbackCount("ru", 11)).toBe("11 отзывов");
    expect(formatRatingCount("ru", 2)).toBe("2 оценки");
    expect(formatRatingCount("ru", 21)).toBe("21 оценка");
    expect(formatFeedbackCount("de", 1)).toBe("1 Rückmeldung");
    expect(formatRatingCount("de", 3)).toBe("3 Bewertungen");
  });

  it("writes averages and rates with a decimal comma", () => {
    expect(formatFeedbackDecimal(4.94, "ru", "—")).toBe("4,9");
    expect(formatFeedbackDecimal(5, "de", "—")).toBe("5,0");
    expect(formatFeedbackDecimal(null, "ru", "Не указано")).toBe("Не указано");
    expect(formatFeedbackPercent(0, "ru", "—")).toBe(["0,0", "%"].join(NO_BREAK_SPACE));
    expect(formatFeedbackPercent(12.5, "de", "—")).toBe(["12,5", "%"].join(NO_BREAK_SPACE));
    expect(formatFeedbackPercent(undefined, "de", "—")).toBe("—");
  });
});
