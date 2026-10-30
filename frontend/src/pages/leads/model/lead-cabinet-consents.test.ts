import { describe, expect, it } from "vitest";

import {
  cabinetConsentsNote,
  cabinetConsentsOf,
  cabinetConsentSummaryValue,
  healthcareConsentToggleLabel,
  privacyConsentToggleLabel,
} from "./lead-cabinet-consents";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

// Owner 2026-10-30: a consent staff recorded «лично» in the client's form showed as «получено на
// бумаге» next to «Оба согласия даны в кабинете» — also in a minor's (guardian) request.
describe("consents of the client's form in the wizard", () => {
  const byStaff = cabinetConsentsOf({
    cabinet_consents: {
      privacy_practices: true,
      healthcare: true,
      privacy_practices_recorded: { how: "in_person", note: null },
      healthcare_recorded: { how: "phone", note: "Mutter am Telefon" },
    },
  });

  it("reads how the client gave a consent staff recorded", () => {
    expect(byStaff.privacyRecorded).toEqual({ how: "in_person", note: null });
    expect(byStaff.healthcareRecorded).toEqual({ how: "phone", note: "Mutter am Telefon" });
    expect(cabinetConsentsOf({ cabinet_consents: { privacy_practices: true, healthcare: false } }).privacyRecorded).toBeNull();
    expect(cabinetConsentsOf(null)).toMatchObject({ privacy: false, healthcare: false });
  });

  it("names staff's record with its way, never paper or the cabinet", () => {
    expect(privacyConsentToggleLabel(byStaff, ru)).toBe("Согласие на обработку запроса получено · Записал сотрудник · лично");
    expect(privacyConsentToggleLabel(byStaff, ru)).not.toContain("на бумаге");
    expect(healthcareConsentToggleLabel(byStaff, ru)).toContain("Записал сотрудник · по телефону · Mutter am Telefon");
    const note = cabinetConsentsNote(byStaff, ru);
    expect(note).toContain("Записал сотрудник · лично");
    expect(note).not.toContain("в кабинете");
    expect(cabinetConsentSummaryValue(byStaff.privacyRecorded, ru)).toBe("да (Записал сотрудник · лично)");
    expect(cabinetConsentsNote(byStaff, de)).toContain("Von Mitarbeitenden eingetragen · persönlich");
  });

  it("keeps the cabinet's and the paper wording for the client's own consent and the toggle", () => {
    const own = cabinetConsentsOf({ cabinet_consents: { privacy_practices: true, healthcare: true } });
    expect(cabinetConsentsNote(own, ru)).toBe("Оба согласия даны в кабинете — отдельная отметка не нужна.");
    expect(privacyConsentToggleLabel(own, ru)).toBe("Согласие на обработку запроса получено · в кабинете");
    expect(cabinetConsentSummaryValue(null, ru)).toBe("да (кабинет)");
    const none = cabinetConsentsOf({ cabinet_consents: { privacy_practices: false, healthcare: false } });
    expect(privacyConsentToggleLabel(none, ru)).toBe("Согласие на обработку запроса получено на бумаге");
    expect(cabinetConsentsNote(none, ru)).toBeNull();
    // Staff recorded it on paper: the paper way is named as such.
    const paper = cabinetConsentsOf({ cabinet_consents: { privacy_practices: true, healthcare: false, privacy_practices_recorded: { how: "paper", note: null } } });
    expect(privacyConsentToggleLabel(paper, ru)).toBe("Согласие на обработку запроса получено · Записал сотрудник · на бумаге");
    expect(cabinetConsentsNote(paper, ru)).toContain("Согласие на обработку запроса: Записал сотрудник · на бумаге.");
  });
});
