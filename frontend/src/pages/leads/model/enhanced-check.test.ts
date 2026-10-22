import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  EMPTY_RISK_COUNTRY_LISTS,
  ENHANCED_CHECK_TRIGGER_REASONS,
  RISK_ASSESSMENT_REASON,
  SANCTIONS_REVIEW_PENDING,
  blacklistCountries,
  enhancedCheckReasonLabel,
  enhancedCheckReasonsText,
  enhancedCheckRequired,
  enhancedCheckRequirementLabel,
  enhancedCheckRiskTier,
  enhancedCheckTitle,
  enhancedCheckTriggers,
  isBlacklistCountry,
  isRiskCountry,
  highRiskCountryHint,
  normalizeLeadEnhancedCheck,
  normalizeRiskCountryLists,
  pepEnhancedCheckHint,
} from "./enhanced-check";

const ru = (ruText: string) => ruText;
const de = (_ru: string, deText: string) => deText;

const serverSource = () =>
  readFileSync(new URL("../../../../../crates/server/src/routes/lead_enhanced_check.rs", import.meta.url), "utf8");

describe("the enhanced check of the owner's rule (2026-10-07)", () => {
  it("knows the server's reason keys", () => {
    const source = serverSource();
    for (const reason of [...ENHANCED_CHECK_TRIGGER_REASONS, SANCTIONS_REVIEW_PENDING]) {
      expect(source).toContain(`"${reason}"`);
    }
  });

  it("hardcodes no country list: the server's configured lists decide", () => {
    const wizard = readFileSync(new URL("../ui/lead-wizard.tsx", import.meta.url), "utf8");
    const model = readFileSync(new URL("./enhanced-check.ts", import.meta.url), "utf8");
    for (const source of [wizard, model]) {
      expect(source).not.toMatch(/\[\s*"KP",\s*"IR"/);
      expect(source).not.toContain("AML_HIGH_RISK_COUNTRY_CODES");
    }
    expect(EMPTY_RISK_COUNTRY_LISTS).toEqual({ highRisk: [], blacklist: [] });
    expect(isBlacklistCountry("IR", EMPTY_RISK_COUNTRY_LISTS)).toBe(false);
  });

  it("reads the configured lists of `GET /compliance/risk-countries`", () => {
    expect(normalizeRiskCountryLists({
      version: 3,
      high_risk: ["ru", "SY", "MM", 7, "Russia", "SY"],
      blacklist: ["KP", " ir ", "MM"],
    })).toEqual({ highRisk: ["RU", "SY"], blacklist: ["KP", "IR", "MM"] });
    for (const value of [[], {}, null, "lists", { blacklist: ["IR"] }]) {
      expect(normalizeRiskCountryLists(value)).toBeNull();
    }
  });

  it("follows the configured black list — Russia stays on the longer list", () => {
    const lists = normalizeRiskCountryLists({ high_risk: ["RU", "SY", "VE", "AF"], blacklist: ["KP", "IR", "MM"] })!;
    expect(isBlacklistCountry("ir", lists)).toBe(true);
    expect(isBlacklistCountry(" MM ", lists)).toBe(true);
    for (const code of ["RU", "SY", "VE", "AF", "DE", "", null, undefined]) {
      expect(isBlacklistCountry(code, lists)).toBe(false);
    }
    expect(isRiskCountry("ru", lists)).toBe(true);
    expect(isRiskCountry("DE", lists)).toBe(false);
    expect(blacklistCountries(["DE", "ir", "RU", "IR", "kp", null], lists)).toEqual(["IR", "KP"]);
    // The CEO moved Syria onto the black list.
    const moved = normalizeRiskCountryLists({ high_risk: ["RU", "SY"], blacklist: ["SY", "KP"] })!;
    expect(moved.highRisk).toEqual(["RU"]);
    expect(isBlacklistCountry("SY", moved)).toBe(true);
    expect(isBlacklistCountry("IR", moved)).toBe(false);
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
      "Patient oder seine Bank auf einer Sanktionsliste (bestätigt), möglicher Sanktionstreffer wartet auf die Entscheidung",
    );
    // The non-paying invoice recipient is named as such, not as the payer (QA 2026-10-11 N-08).
    expect(enhancedCheckReasonLabel("recipient_sanctioned", ru)).toBe("получатель счёта в санкционном списке (подтверждено)");
    expect(enhancedCheckReasonLabel("unknown_key", de)).toBe("unknown_key");
    // The risk level is not named as a level (owner 2026-10-19), only pointed to.
    expect(enhancedCheckReasonLabel(RISK_ASSESSMENT_REASON, ru)).toBe("по результатам оценки риска (см. «Оценка риска»)");
    expect(enhancedCheckReasonLabel(RISK_ASSESSMENT_REASON, de)).not.toContain("Stufe");
    expect(pepEnhancedCheckHint(de)).toBe(
      "PEP: nach GMED-Regel (Orientierung § 15 GwG) ist in der Regel eine verstärkte Prüfung erforderlich – Entscheidung des Mitarbeiters",
    );
    expect(pepEnhancedCheckHint(ru)).toBe("PEP: по правилу GMED (ориентир § 15 GwG) обычно требуется усиленная проверка — решение за сотрудником");
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

  it("distinguishes additional country questions from the enhanced-check requirement", () => {
    expect(highRiskCountryHint("Россия", ru)).toContain("дополнительных вопросах анкеты");
    expect(highRiskCountryHint("Россия", ru)).toContain("определяется отдельно по оценке риска");
    expect(highRiskCountryHint("Russland", de)).toContain("ergänzenden Fragen");
    expect(highRiskCountryHint("Россия", ru, false)).toContain("учитывается в оценке риска");
    expect(enhancedCheckRequired({ required: false, reasons: [], countries: [] })).toBe(false);
  });

  it("names the check as GMED's own rule, never as a legal duty (owner 2026-10-22)", () => {
    expect(enhancedCheckTitle(ru)).toBe("Усиленная AML-проверка (ориентир § 15 GwG)");
    expect(enhancedCheckTitle(de)).toBe("Verstärkte AML-Prüfung (Orientierung § 15 GwG)");
    expect(enhancedCheckRequirementLabel(true, ru)).toBe("Требуется по правилу GMED");
    expect(enhancedCheckRequirementLabel(true, de)).toBe("Nach GMED-Regel erforderlich");
    expect(enhancedCheckRequirementLabel(false, ru)).toBe("Добровольная проверка");
    expect(enhancedCheckRequirementLabel(false, de)).toBe("Freiwillige Prüfung");
  });
});
