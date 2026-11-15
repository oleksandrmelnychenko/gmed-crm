import { describe, expect, it } from "vitest";

import {
  countValidityAttention,
  matchesValidityFilter,
  needsValidityAttention,
  parseValidityFilter,
  validUntilText,
  validityStatusText,
} from "./document-validity";

const ru = (ruText: string) => ruText;
const de = (_ru: string, deText: string) => deText;

describe("document validity", () => {
  it("shows nothing for a document without a date", () => {
    const document = { valid_until: null, validity_status: null, validity_days_left: null };
    expect(validityStatusText(document, ru)).toBeNull();
    expect(validUntilText(document, ru)).toBeNull();
    expect(needsValidityAttention(document)).toBe(false);
  });

  it("words the status in Russian and German", () => {
    const expiring = { valid_until: "2026-12-01", validity_status: "expiring" as const, validity_days_left: 16 };
    expect(validityStatusText(expiring, ru)).toBe("Истекает через 16 дн.");
    expect(validityStatusText(expiring, de)).toBe("Läuft in 16 Tagen ab");
    expect(validityStatusText({ ...expiring, validity_days_left: 0 }, ru)).toBe("Истекает сегодня");
    expect(validityStatusText({ ...expiring, validity_status: "expired", validity_days_left: -3 }, ru)).toBe("Просрочен");
    expect(validityStatusText({ ...expiring, validity_status: "valid", validity_days_left: 90 }, de)).toBe("Gültig");
    expect(validUntilText(expiring, ru)).toBe("Действует до 01.12.2026");
    expect(validUntilText(expiring, de)).toBe("Gültig bis 01.12.2026");
  });

  it("counts only current expiring or expired documents", () => {
    const documents = [
      { valid_until: "2026-11-01", validity_status: "expired" as const, validity_days_left: -14 },
      { valid_until: "2026-11-20", validity_status: "expiring" as const, validity_days_left: 5 },
      { valid_until: "2027-11-20", validity_status: "valid" as const, validity_days_left: 370 },
      { valid_until: "2026-11-01", validity_status: "expired" as const, validity_days_left: -14, is_latest_version: false },
      { valid_until: "2026-11-01", validity_status: "expired" as const, validity_days_left: -14, status: "archived" },
      { valid_until: null, validity_status: null },
    ];
    expect(countValidityAttention(documents)).toBe(2);
    expect(documents.filter((item) => matchesValidityFilter(item, "expired"))).toHaveLength(1);
    expect(documents.filter((item) => matchesValidityFilter(item, "expiring"))).toHaveLength(1);
    expect(documents.filter((item) => matchesValidityFilter(item, "attention"))).toHaveLength(2);
    expect(documents.filter((item) => matchesValidityFilter(item, ""))).toHaveLength(6);
  });

  it("parses the filter", () => {
    expect(parseValidityFilter("expired")).toBe("expired");
    expect(parseValidityFilter("soon")).toBe("");
    expect(parseValidityFilter(null)).toBe("");
  });
});
