import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { ALL_STAFF_ROLES, canAccessStaffRoute, listStaffNavItems } from "@/lib/staff-route-access";

import type { LeadSanctionsStatus, SanctionsHit } from "./api";
import {
  FISALIS_URL,
  PATIENT_RELATION_ROLES,
  PAYER_BANK_REF,
  fisalisSearchText,
  formatListBirthDate,
  isSanctionsGateError,
  leadBanners,
  leadFlagBadge,
  listEntryNames,
  liveCheckInput,
  liveCheckKey,
  reasonIsValid,
  safeLegalActUrl,
  scorePercent,
  subjectChanged,
  subjectKindLabel,
} from "./model";

const ru = t("ru");
const de = t("de");

function status(overrides: Partial<LeadSanctionsStatus> = {}): LeadSanctionsStatus {
  return {
    lead_id: "lead-1",
    list_version_date: "2026-09-30",
    list_available: true,
    list_stale: false,
    screening: "clear",
    open_hits: 0,
    confirmed_hits: 0,
    sanctions_block: null,
    country: { blocked_countries: ["RU"], found: [], blocking: [], lift: null },
    can_lift_country_block: false,
    can_review: false,
    ...overrides,
  };
}

describe("live check input", () => {
  it("waits for two letters of first and last name and never sends a half date", () => {
    expect(liveCheckInput({ firstName: "I", lastName: "Korneev" })).toBeNull();
    expect(liveCheckInput({ firstName: "Testomir", lastName: " " })).toBeNull();
    const input = liveCheckInput({
      firstName: " Testomir ",
      lastName: "Korneev",
      birthDate: "1961-03",
      citizenships: ["RU"],
      leadId: "lead-1",
    });
    expect(input).toEqual({
      first_name: "Testomir",
      last_name: "Korneev",
      middle_name: null,
      date_of_birth: null,
      citizenships: ["RU"],
      lead_id: "lead-1",
    });
    expect(liveCheckInput({ firstName: "Testomir", lastName: "Korneev", birthDate: "1961-03-14" })?.date_of_birth).toBe(
      "1961-03-14",
    );
  });

  it("asks again only when the screened data change", () => {
    const base = liveCheckInput({ firstName: "Testomir", lastName: "Korneev", citizenships: ["RU", "DE"] });
    const sameOtherCase = liveCheckInput({ firstName: "TESTOMIR", lastName: "korneev", citizenships: ["DE", "RU"] });
    const otherDate = liveCheckInput({ firstName: "Testomir", lastName: "Korneev", birthDate: "1961-03-14" });
    expect(liveCheckKey(base)).toBe(liveCheckKey(sameOtherCase));
    expect(liveCheckKey(base)).not.toBe(liveCheckKey(otherDate));
    expect(liveCheckKey(null)).toBe("");
  });
});

describe("FiSaLis manual check", () => {
  it("copies only the name and opens the search page without data in the URL", () => {
    expect(fisalisSearchText({ first_name: "Testomir", middle_name: "Ivanovich", last_name: "Korneev" })).toBe(
      "Testomir Ivanovich Korneev",
    );
    expect(fisalisSearchText({ first_name: " Anna ", middle_name: null, last_name: "Beispiel" })).toBe("Anna Beispiel");
    expect(FISALIS_URL).toBe("https://www.finanz-sanktionsliste.de/fisalis/");
    expect(new URL(FISALIS_URL).search).toBe("");
  });

  it("copies a bank's name for the search like an organisation's", () => {
    expect(fisalisSearchText({ first_name: "", middle_name: null, last_name: "Testgrad Commerce Bank" })).toBe(
      "Testgrad Commerce Bank",
    );
  });
});

describe("hit subject labels", () => {
  it("says whose bank a bank hit is about", () => {
    expect(subjectKindLabel("lead_bank", ru, "payer-bank")).toBe("Банк плательщика");
    expect(subjectKindLabel("lead_bank", de, "payer-bank")).toBe("Bank des Zahlers");
    expect(subjectKindLabel("lead_bank", ru, "patient-bank")).toBe("Банк пациента");
    expect(subjectKindLabel("lead_bank", de, "patient-bank")).toBe("Bank des Patienten");
    // An unknown or missing reference is the patient's own bank.
    expect(subjectKindLabel("lead_bank", ru)).toBe("Банк пациента");
    expect(PAYER_BANK_REF).toBe("payer-bank");
  });

  it("names the invoice recipient (owner decision 2026-10-11)", () => {
    expect(subjectKindLabel("lead_recipient", ru, "invoice-recipient")).toBe("Получатель счёта");
    expect(subjectKindLabel("lead_recipient", de, "invoice-recipient")).toBe("Rechnungsempfänger");
    expect(subjectKindLabel("lead_recipient", de)).toBe("Rechnungsempfänger");
  });

  it("says why a patient's relation is screened (QA 2026-10-11 B-25)", () => {
    const ref = "5d0c1f0e-0000-4000-8000-000000000001";
    expect(subjectKindLabel("patient_relation", ru, ref, "default_payer")).toBe("Плательщик пациента по умолчанию");
    expect(subjectKindLabel("patient_relation", de, ref, "default_payer")).toBe("Standardzahler des Patienten");
    expect(subjectKindLabel("patient_relation", ru, ref, "invoice_payer")).toBe(
      "Плательщик в заказе или счёте пациента",
    );
    expect(subjectKindLabel("patient_relation", de, ref, "legal_representative")).toBe(
      "Elternteil / Vormund des Patienten",
    );
    // An unknown role still names a relation of the patient.
    expect(subjectKindLabel("patient_relation", ru, ref, null)).toBe("Связь пациента");
    expect(subjectKindLabel("patient_relation", de)).toBe("Bezugsperson des Patienten");
    expect([...PATIENT_RELATION_ROLES]).toEqual(["default_payer", "invoice_payer", "legal_representative"]);
  });

  it("keeps the labels of persons and payers", () => {
    expect(subjectKindLabel("lead_payer", ru)).toBe(ru.sanctions_kind_lead_payer);
    expect(subjectKindLabel("lead_patient", de, "")).toBe(de.sanctions_kind_lead_patient);
    expect(subjectKindLabel("lead_guardian", ru, "contact-1")).toBe(ru.sanctions_kind_lead_guardian);
    expect(subjectKindLabel("patient", de)).toBe(de.sanctions_kind_patient);
  });
});

describe("list entry display", () => {
  it("shows names, dates in DD.MM.YYYY and only EUR-Lex links", () => {
    expect(
      listEntryNames({
        logical_id: "1",
        subject_type: "person",
        names: [
          { whole_name: "Testomir KORNEEV" },
          { whole_name: "", first_name: "Testomir", last_name: "Kornejew" },
          { whole_name: "Testomir KORNEEV" },
        ],
        birth_dates: [],
        citizenships: [],
        regulations: [],
      }),
    ).toEqual(["Testomir KORNEEV", "Testomir Kornejew"]);
    expect(formatListBirthDate({ date: "1961-03-14", place: "Testgrad" }, ru)).toBe("14.03.1961 (Testgrad)");
    expect(formatListBirthDate({ year: 1978, circa: true }, de)).toBe("ca. 1978");
    expect(safeLegalActUrl("https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32099R0001")).toContain(
      "eur-lex.europa.eu",
    );
    expect(safeLegalActUrl("javascript:alert(1)")).toBeNull();
    expect(safeLegalActUrl("https://example.com/x")).toBeNull();
    expect(scorePercent(0.9612)).toBe("96 %");
  });

  it("notices when our data changed after the match", () => {
    const subject = {
      first_name: "Testomir",
      middle_name: null,
      last_name: "Korneev",
      date_of_birth: "1961-11-30",
      citizenships: ["RU"],
      organisation: false,
      relation: null,
    };
    const hit = { subject_snapshot: subject, current_subject: { ...subject } } as unknown as SanctionsHit;
    expect(subjectChanged(hit)).toBe(false);
    expect(
      subjectChanged({ ...hit, current_subject: { ...subject, date_of_birth: "1961-03-14" } } as SanctionsHit),
    ).toBe(true);
    expect(subjectChanged({ ...hit, current_subject: null } as SanctionsHit)).toBe(false);
  });
});

describe("lead banners and badges", () => {
  it("shows the confirmed stop as permanent and the review as pending", () => {
    const confirmed = leadBanners(
      status({
        screening: "confirmed",
        sanctions_block: { code: "sanctions_confirmed", message: "", permanent: true, countries: [] },
      }),
      ru,
      "ru",
    );
    expect(confirmed.map((banner) => banner.kind)).toEqual(["confirmed"]);
    expect(confirmed[0].text).toContain("окончательно");
    const review = leadBanners(
      status({ sanctions_block: { code: "sanctions_review_pending", message: "", permanent: false, countries: [] } }),
      de,
      "de",
    );
    expect(review[0].kind).toBe("review");
    expect(leadBanners(status(), ru, "ru")).toEqual([]);
    expect(leadBanners(null, ru, "ru")).toEqual([]);
  });

  it("names the blocked country and who lifted it with the reason", () => {
    const blocked = leadBanners(
      status({ country: { blocked_countries: ["RU"], found: ["RU"], blocking: ["RU"], lift: null } }),
      de,
      "de",
    );
    expect(blocked[0].kind).toBe("country");
    expect(blocked[0].text).toContain("Russland");
    const lifted = leadBanners(
      status({
        country: {
          blocked_countries: ["RU"],
          found: ["RU"],
          blocking: [],
          lift: {
            id: "o-1",
            lead_id: "lead-1",
            patient_id: null,
            countries: ["RU"],
            reason: "Lebt seit Jahren in Deutschland",
            lifted_by: "u-1",
            lifted_by_name: "Clara Chefin",
            lifted_at: "2026-10-03T08:00:00Z",
          },
        },
      }),
      de,
      "de",
    );
    expect(lifted[0].kind).toBe("country_lifted");
    expect(lifted[0].text).toContain("Clara Chefin");
    expect(lifted[0].text).toContain("03.10.2026");
    expect(lifted[0].text).toContain("Lebt seit Jahren in Deutschland");
  });

  it("maps list flags to badges", () => {
    expect(leadFlagBadge("confirmed", ru).tone).toBe("error");
    expect(leadFlagBadge("review_pending", ru).label).toBe(ru.sanctions_badge_review_pending);
    expect(leadFlagBadge("blocked_country", de).label).toBe(de.sanctions_badge_blocked_country);
  });

  it("recognises gate errors and reasons", () => {
    expect(isSanctionsGateError({ code: "sanctions_confirmed" })).toBe(true);
    expect(isSanctionsGateError({ code: "blocked_country" })).toBe(true);
    expect(isSanctionsGateError({ code: "http_error" })).toBe(false);
    expect(isSanctionsGateError(null)).toBe(false);
    expect(reasonIsValid("  too short ")).toBe(false);
    expect(reasonIsValid("Passport checked, other person")).toBe(true);
  });
});

describe("sanctions review route", () => {
  it("is the CEO's alone and sits after the compliance entry", () => {
    for (const role of ALL_STAFF_ROLES) {
      expect(canAccessStaffRoute(role, "/sanctions"), role).toBe(role === "ceo");
    }
    const ceo = listStaffNavItems("ceo").map((item) => item.to);
    expect(ceo.indexOf("/sanctions")).toBe(ceo.indexOf("/admin/compliance") + 1);
  });
});
