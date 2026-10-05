import { describe, expect, it } from "vitest";

import { cabinetLocale, formatFileSize, languageName } from "./lead-request-model";
import {
  LEAD_CABINET_LANGS,
  asLeadCabinetLang,
  identificationFieldLabel,
  leadRequestText,
  payerFieldLabel,
  resolveLeadCabinetLang,
  submitFieldLabel,
} from "./lead-request-text";

describe("lead cabinet languages", () => {
  it("speaks DE, EN, UA and RU", () => {
    expect(LEAD_CABINET_LANGS.map((option) => option.value)).toEqual(["de", "en", "uk", "ru"]);
    expect(leadRequestText("de").title).toBe("Ihre Anfrage");
    expect(leadRequestText("en").title).toBe("Your request");
    expect(leadRequestText("uk").stepDocuments).toBe("Документи");
    expect(leadRequestText("ru").stepDocuments).toBe("Документы");
  });

  it("reads stored and preferred language codes", () => {
    expect(asLeadCabinetLang("uk-UA")).toBe("uk");
    expect(asLeadCabinetLang("UA")).toBe("uk");
    expect(asLeadCabinetLang("EN")).toBe("en");
    expect(asLeadCabinetLang("tr")).toBeNull();
    expect(asLeadCabinetLang(null)).toBeNull();
    // Unknown languages fall back to Russian, like the portal.
    expect(leadRequestText("tr").title).toBe("Ваша заявка");
  });

  it("keeps a UA or EN choice and lets a DE/RU cabinet follow the portal language", () => {
    // UA and EN exist only in the cabinet: the portal toggle does not undo them.
    expect(resolveLeadCabinetLang("uk", "de", "ru")).toBe("uk");
    expect(resolveLeadCabinetLang("en", null, "de")).toBe("en");
    // A DE/RU choice is the portal language: the top bar toggle switches the cabinet too.
    expect(resolveLeadCabinetLang("de", "de", "ru")).toBe("ru");
    expect(resolveLeadCabinetLang("ru", "uk", "de")).toBe("de");
    // No choice yet: a UA/EN request language applies, otherwise the portal language.
    expect(resolveLeadCabinetLang(null, "uk", "de")).toBe("uk");
    expect(resolveLeadCabinetLang(null, "de", "ru")).toBe("ru");
    expect(resolveLeadCabinetLang(null, null, "de")).toBe("de");
  });

  it("formats sizes and language names in the cabinet language", () => {
    expect(cabinetLocale("uk")).toBe("uk-UA");
    expect(formatFileSize(1536, "en")).toBe("2 KB");
    expect(languageName("de", "en")).toBe("German");
    expect(languageName("de", "uk")).toBe("Німецька");
  });

  it("names payer fields with the patient's labels and marks them in the missing list", () => {
    const de = leadRequestText("de");
    expect(payerFieldLabel(de, "payer_last_name")).toBe(de.fields.last_name);
    expect(payerFieldLabel(de, "payer_street")).toBe(de.fields.street_address);
    expect(submitFieldLabel(de, "date_of_birth")).toBe("Geburtsdatum");
    expect(submitFieldLabel(de, "payer_kind")).toBe("Wer übernimmt die Kosten der Behandlung?");
    expect(submitFieldLabel(de, "payer_citizenships")).toBe("Zahlende Person: Staatsangehörigkeit(en)");
    expect(submitFieldLabel(leadRequestText("uk"), "payer_last_name")).toBe("Платник: Прізвище");
  });

  it("names the statements of the identification in the list of what is missing", () => {
    const de = leadRequestText("de");
    // Labels that speak for themselves stand alone; the others carry their section.
    expect(submitFieldLabel(de, "birth_place")).toBe("Geburtsort");
    expect(submitFieldLabel(de, "birth_country")).toBe("Geburtsland");
    expect(submitFieldLabel(de, "id_document_type")).toBe("Ausweisdokument: Art des Dokuments");
    expect(submitFieldLabel(de, "id_valid_until")).toBe("Ausweisdokument: Gültig bis");
    expect(submitFieldLabel(de, "id_document_upload")).toBe("Ausweisdokument: Foto oder Scan des Ausweises");
    expect(submitFieldLabel(de, "payment_background")).toBe("Zahlende Person: Warum zahlt diese Person?");
    expect(submitFieldLabel(de, "payer_own_account")).toBe("Handeln Sie im eigenen wirtschaftlichen Interesse?");
    expect(submitFieldLabel(de, "payer_beneficial_owner")).toBe(
      "In wessen Interesse handeln Sie? (Name, Geburtsdatum, Geburtsort, Anschrift)",
    );
    // The legal questions are long: the list names their topic, and what a "yes" still needs.
    expect(submitFieldLabel(de, "pep_self")).toBe("Gesetzliche Fragen: Öffentliches Amt");
    expect(submitFieldLabel(de, "pep_self_details")).toBe("Gesetzliche Fragen: Öffentliches Amt – Amt, Land und Zeitraum");
    expect(submitFieldLabel(de, "high_risk_country_code")).toBe("Gesetzliche Fragen: Land mit hohem Risiko – Welches Land?");
    expect(submitFieldLabel(de, "sanctions_links")).toBe("Gesetzliche Fragen: Sanktionen");
    expect(submitFieldLabel(leadRequestText("ru"), "id_document_number")).toBe(
      "Документ, удостоверяющий личность: Номер документа",
    );
    expect(submitFieldLabel(leadRequestText("uk"), "pep_related")).toBe(
      "Запитання за законом: Політично значуща близька особа",
    );
    expect(submitFieldLabel(leadRequestText("en"), "id_document_upload")).toBe(
      "Identity document: Photo or scan of the document",
    );
  });

  it("asks a parent about the patient, not about 'you'", () => {
    const de = leadRequestText("de");
    expect(identificationFieldLabel(de, "pep_self")).toContain("Üben Sie ein hochrangiges öffentliches Amt aus");
    expect(identificationFieldLabel(de, "pep_self", true)).toContain("Übt die Patientin / der Patient");
    expect(identificationFieldLabel(de, "high_risk_country", true)).toContain("Hat die Patientin / der Patient");
    // A question that does not say "you" is the same for both.
    expect(identificationFieldLabel(de, "sanctions_links", true)).toBe(identificationFieldLabel(de, "sanctions_links"));
    expect(identificationFieldLabel(de, "birth_place", true)).toBe("Geburtsort");
    expect(payerFieldLabel(de, "payer_own_account", true)).toBe(
      "Handelt die Patientin / der Patient im eigenen wirtschaftlichen Interesse?",
    );
    expect(submitFieldLabel(de, "payer_beneficial_owner", true)).toContain("handelt die Patientin / der Patient");
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      for (const field of ["pep_self", "pep_related", "high_risk_country"] as const) {
        expect(identificationFieldLabel(text, field, true)).not.toBe(identificationFieldLabel(text, field));
      }
      expect(text.ownAccountQuestionGuardian).not.toBe(text.ownAccountQuestion);
    }
  });

  it("has every text in every language", () => {
    // Every key, also inside the groups (field labels, options), with a text behind it.
    const shape = (value: unknown, path = ""): string[] => {
      if (typeof value === "function") return [`${path}()`];
      if (Array.isArray(value)) return [`${path}[${value.length}]`];
      if (value && typeof value === "object") {
        return Object.entries(value).flatMap(([key, item]) => shape(item, path ? `${path}.${key}` : key));
      }
      expect(String(value).trim(), path).not.toBe("");
      return [path];
    };
    const keys = shape(leadRequestText("de")).sort();
    for (const option of LEAD_CABINET_LANGS) {
      expect(shape(leadRequestText(option.value)).sort()).toEqual(keys);
    }
  });
});
