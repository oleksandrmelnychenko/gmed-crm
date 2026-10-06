import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ENHANCED_CHECK_BLACKLIST_COUNTRY_CODES,
  ENHANCED_CHECK_TRIGGER_REASONS,
  SANCTIONS_REVIEW_PENDING,
  blacklistCountries,
  enhancedCheckReasonLabel,
  enhancedCheckReasonsText,
  enhancedCheckRequired,
  enhancedCheckRiskTier,
  enhancedCheckTriggers,
  isBlacklistCountry,
  normalizeLeadEnhancedCheck,
  pepEnhancedCheckHint,
} from "./enhanced-check";

const ru = (ruText: string) => ruText;
const de = (_ru: string, deText: string) => deText;

const serverSource = () =>
  readFileSync(new URL("../../../../../crates/server/src/routes/lead_enhanced_check.rs", import.meta.url), "utf8");

describe("the enhanced check of the owner's rule (2026-10-07)", () => {
  it("mirrors the server's black list and reason keys", () => {
    const source = serverSource();
    const list = source.match(/pub const BLACK_LIST_COUNTRY_CODES: &\[&str\] = &\[([^\]]*)\];/);
    expect(list).not.toBeNull();
    const codes = [...(list?.[1] ?? "").matchAll(/"([A-Z]{2})"/g)].map((match) => match[1]);
    expect(codes).toEqual([...ENHANCED_CHECK_BLACKLIST_COUNTRY_CODES]);
    for (const reason of [...ENHANCED_CHECK_TRIGGER_REASONS, SANCTIONS_REVIEW_PENDING]) {
      expect(source).toContain(`"${reason}"`);
    }
  });

  it("is North Korea, Iran and Myanmar — not Russia or the longer high-risk list", () => {
    expect(ENHANCED_CHECK_BLACKLIST_COUNTRY_CODES).toEqual(["KP", "IR", "MM"]);
    expect(isBlacklistCountry("ir")).toBe(true);
    expect(isBlacklistCountry(" MM ")).toBe(true);
    for (const code of ["RU", "SY", "VE", "AF", "DE", "", null, undefined]) {
      expect(isBlacklistCountry(code)).toBe(false);
    }
    expect(blacklistCountries(["DE", "ir", "RU", "IR", "kp", null])).toEqual(["IR", "KP"]);
  });

  it("reads the server's answer and nothing else", () => {
    expect(normalizeLeadEnhancedCheck({ required: true, reasons: ["patient_sanctioned", 3], countries: ["ir"] })).toEqual({
      required: true,
      reasons: ["patient_sanctioned"],
      countries: ["IR"],
    });
    expect(normalizeLeadEnhancedCheck({ required: false })).toEqual({ required: false, reasons: [], countries: [] });
    // Catch-all mocks and older servers answer with something else.
    for (const value of [[], {}, null, "required", { required: "yes" }]) {
      expect(normalizeLeadEnhancedCheck(value)).toBeNull();
    }
  });

  it("is required by the server or by a black-list country not saved yet", () => {
    const pending = { required: false, reasons: [SANCTIONS_REVIEW_PENDING], countries: [] };
    expect(enhancedCheckRequired(pending)).toBe(false);
    expect(enhancedCheckTriggers(pending)).toEqual([]);
    expect(enhancedCheckRequired(null)).toBe(false);
    expect(enhancedCheckRequired(null, ["IR"])).toBe(true);
    expect(enhancedCheckRequired({ required: true, reasons: ["payer_sanctioned"], countries: [] })).toBe(true);
  });

  it("names every reason in both languages", () => {
    for (const reason of [...ENHANCED_CHECK_TRIGGER_REASONS, SANCTIONS_REVIEW_PENDING]) {
      expect(enhancedCheckReasonLabel(reason, ru)).not.toBe(reason);
      expect(enhancedCheckReasonLabel(reason, de)).not.toBe(reason);
    }
    expect(enhancedCheckReasonLabel("payer_citizenship_blacklist", de)).toBe(
      "Staatsangehörigkeit des Zahlers auf der Blacklist",
    );
    expect(enhancedCheckReasonLabel("patient_residence_blacklist", ru)).toBe("страна проживания пациента в чёрном списке");
    expect(enhancedCheckReasonsText(["patient_sanctioned", SANCTIONS_REVIEW_PENDING], de)).toBe(
      "Patient auf einer Sanktionsliste (bestätigt), möglicher Sanktionstreffer wartet auf die Entscheidung",
    );
    expect(enhancedCheckReasonLabel("unknown_key", de)).toBe("unknown_key");
    expect(pepEnhancedCheckHint(de)).toBe(
      "PEP: nach § 15 GwG ist in der Regel eine verstärkte Prüfung erforderlich – Entscheidung des Mitarbeiters",
    );
    expect(pepEnhancedCheckHint(ru)).toBe("PEP: по § 15 GwG обычно требуется усиленная проверка — решение за сотрудником");
  });

  it("prints the risk tier of what required or prompted the check", () => {
    const none = { check: null, blacklistHit: false, highRiskHint: false, pep: false };
    expect(enhancedCheckRiskTier(none)).toBe("individual");
    expect(enhancedCheckRiskTier({ ...none, pep: true })).toBe("pep");
    expect(enhancedCheckRiskTier({ ...none, pep: true, highRiskHint: true })).toBe("high_risk");
    expect(enhancedCheckRiskTier({ ...none, blacklistHit: true, pep: true })).toBe("blacklist");
    expect(
      enhancedCheckRiskTier({ ...none, check: { required: true, reasons: ["payer_residence_blacklist"], countries: ["IR"] } }),
    ).toBe("blacklist");
    expect(
      enhancedCheckRiskTier({ ...none, highRiskHint: true, check: { required: true, reasons: ["payer_sanctioned"], countries: [] } }),
    ).toBe("sanctions");
  });
});
