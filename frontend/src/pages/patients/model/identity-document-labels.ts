/** The passport texts of the catalog; the editor passes its loose dictionary. */
type PassportDictionary = Partial<
  Record<
    | "patient_profile_editor_passport"
    | "patient_profile_editor_passport_number"
    | "patient_passport_expired"
    | "patient_passport_expiring",
    string
  >
>;

export type IdentityDocumentLabels = {
  /** Heading of the block. */
  title: string;
  /** Label of the document number. */
  number: string;
  expired: string;
  expiring: string;
};

/**
 * Labels of the identity-document block of the patient card.
 *
 * The record names its document type (`id_document_type`, read from the scan
 * at the lead). An ID card or a residence permit must not be called a
 * passport ("Паспорт / Номер паспорта", QA 2026-11-10); a passport and an
 * older record without a type keep the passport wording.
 */
export function identityDocumentLabels(
  documentType: string | null | undefined,
  lang: string,
  dictionary: PassportDictionary,
): IdentityDocumentLabels {
  const de = lang === "de";
  const type = documentType?.trim() ?? "";
  if (type === "" || type === "passport") {
    return {
      title: dictionary.patient_profile_editor_passport ?? (de ? "Reisepass" : "Паспорт"),
      number:
        dictionary.patient_profile_editor_passport_number ?? (de ? "Passnummer" : "Номер паспорта"),
      expired: dictionary.patient_passport_expired ?? (de ? "Reisepass abgelaufen" : "Паспорт просрочен"),
      expiring:
        dictionary.patient_passport_expiring ??
        (de ? "Reisepass läuft bald ab" : "Паспорт скоро истекает"),
    };
  }
  return de
    ? {
        title: "Ausweisdokument",
        number: "Dokumentnummer",
        expired: "Dokument abgelaufen",
        expiring: "Dokument läuft bald ab",
      }
    : {
        title: "Документ, удостоверяющий личность",
        number: "Номер документа",
        expired: "Документ просрочен",
        expiring: "Документ скоро истекает",
      };
}
