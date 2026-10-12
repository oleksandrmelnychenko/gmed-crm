import { describe, expect, it } from "vitest";

import {
  NO_BREAK_SPACE,
  formatFeedbackCount,
  formatFeedbackDecimal,
  formatFeedbackPercent,
  formatRatingCount,
} from "./feedback-model";

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
