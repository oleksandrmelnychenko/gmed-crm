import { describe, expect, it } from "vitest";

import { identityDocumentLabels } from "./identity-document-labels";

const dictionary = {
  patient_profile_editor_passport: "Паспорт",
  patient_profile_editor_passport_number: "Номер паспорта",
  patient_passport_expired: "Паспорт просрочен",
  patient_passport_expiring: "Паспорт скоро истекает",
};

describe("identityDocumentLabels", () => {
  it("keeps the passport wording for a passport and for a record without a type", () => {
    for (const type of ["passport", "", null, undefined]) {
      expect(identityDocumentLabels(type, "ru", dictionary)).toEqual({
        title: "Паспорт",
        number: "Номер паспорта",
        expired: "Паспорт просрочен",
        expiring: "Паспорт скоро истекает",
      });
    }
  });

  it("does not call an ID card or a residence permit a passport", () => {
    for (const type of ["id_card", "residence_permit"]) {
      const ru = identityDocumentLabels(type, "ru", dictionary);
      expect(ru.title).toBe("Документ, удостоверяющий личность");
      expect(ru.number).toBe("Номер документа");
      expect(Object.values(ru).join(" ").toLowerCase()).not.toContain("паспорт");

      const de = identityDocumentLabels(type, "de", dictionary);
      expect(de.title).toBe("Ausweisdokument");
      expect(de.number).toBe("Dokumentnummer");
      expect(Object.values(de).join(" ")).not.toContain("pass");
    }
  });
});
