import { describe, expect, it } from "vitest";

import { cabinetLocale, formatFileSize, languageName } from "./lead-request-model";
import {
  LEAD_CABINET_LANGS,
  asLeadCabinetLang,
  identificationFieldLabel,
  invoiceToLabel,
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
    expect(submitFieldLabel(de, "payer_citizenships")).toBe("Zahler: Staatsangehörigkeit(en)");
    expect(submitFieldLabel(leadRequestText("uk"), "payer_last_name")).toBe("Платник: Прізвище");
  });

  it("names a company, organisation or insurer by its kind and its seat", () => {
    const de = leadRequestText("de");
    expect(payerFieldLabel(de, "payer_type")).toBe("Wer ist der Zahler?");
    expect(payerFieldLabel(de, "payer_organisation_name", false, "company")).toBe("Name des Unternehmens");
    expect(payerFieldLabel(de, "payer_organisation_name", false, "organisation")).toBe("Name der Organisation");
    expect(payerFieldLabel(de, "payer_organisation_name", false, "insurance")).toBe("Name der Versicherung");
    // A person lives somewhere; an organisation has a seat.
    expect(payerFieldLabel(de, "payer_street", false, "person")).toBe("Straße und Hausnummer");
    expect(payerFieldLabel(de, "payer_street", false, "insurance")).toBe("Sitz (Straße und Hausnummer)");
    expect(payerFieldLabel(de, "payer_country")).toBe("Wohnsitzland");
    expect(payerFieldLabel(de, "payer_country", false, "company")).toBe("Land des Sitzes");
    expect(payerFieldLabel(de, "payer_relationship_kind")).toBe("Beziehung zur Patientin / zum Patienten");
    // The name passed on to the payer is the patient's: a parent reads it so.
    expect(payerFieldLabel(de, "payer_contact_consent")).toBe(
      "Ich bin einverstanden, dass GMED diese Person bzw. Organisation wegen der Kostenübernahme kontaktiert und ihr meinen Namen mitteilt.",
    );
    expect(payerFieldLabel(de, "payer_contact_consent", true)).toContain("den Namen der Patientin / des Patienten");
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      expect(text.payerConsentLabelGuardian).not.toBe(text.payerConsentLabel);
      // The answers of a parent's login: the usual two and, in between, "I pay".
      expect(Object.keys(text.payerOptionsGuardian)).toEqual(["self", "guardian", "third_party"]);
      expect(text.payerOptionsGuardian.third_party).toBe(text.payerOptions.third_party);
    }
    expect(de.payerOptions).toEqual({ self: "Ich selbst", third_party: "Eine andere Person oder Organisation" });
    expect(de.payerOptionsGuardian.guardian).toBe("Ich zahle (als Elternteil)");
    expect(leadRequestText("en").payerOptionsGuardian.guardian).toBe("I pay (as a parent)");
  });

  it("names what is still missing about the payer in every language", () => {
    const missing = (lang: string, payerType: string) => {
      const text = leadRequestText(lang);
      return [
        submitFieldLabel(text, "payer_organisation_name", false, payerType),
        submitFieldLabel(text, "payer_country", false, payerType),
        submitFieldLabel(text, "payer_relationship_kind", false, payerType),
        submitFieldLabel(text, "payer_relationship", false, payerType),
        submitFieldLabel(text, "payer_contact_consent", false, payerType),
      ];
    };
    expect(missing("de", "company")).toEqual([
      "Zahler: Name des Unternehmens",
      "Zahler: Land des Sitzes",
      "Zahler: Beziehung zur Patientin / zum Patienten",
      "Zahler: Beziehung zur Patientin / zum Patienten – Bitte angeben",
      "Zahler: Einverständnis zur Kontaktaufnahme",
    ]);
    expect(missing("en", "insurance")).toEqual([
      "Payer: Name of the insurer",
      "Payer: Country of the registered office",
      "Payer: Relationship to the patient",
      "Payer: Relationship to the patient – Please specify",
      "Payer: Consent to contact",
    ]);
    expect(missing("uk", "organisation")).toEqual([
      "Платник: Назва організації",
      "Платник: Країна місцезнаходження",
      "Платник: Ким доводиться пацієнту",
      "Платник: Ким доводиться пацієнту – Вкажіть, будь ласка",
      "Платник: Згода на контакт",
    ]);
    expect(missing("ru", "company")).toEqual([
      "Плательщик: Название компании",
      "Плательщик: Страна местонахождения",
      "Плательщик: Кем приходится пациенту",
      "Плательщик: Кем приходится пациенту – Укажите, пожалуйста",
      "Плательщик: Согласие на контакт",
    ]);
    // A person as payer keeps the labels of a person, also for a parent's login.
    expect(submitFieldLabel(leadRequestText("de"), "payer_country", true, "person")).toBe("Zahler: Wohnsitzland");
    expect(submitFieldLabel(leadRequestText("de"), "payer_contact_consent", true)).toBe(
      "Zahler: Einverständnis zur Kontaktaufnahme",
    );
  });

  it("names the statements of the identification in the list of what is missing", () => {
    const de = leadRequestText("de");
    // Labels that speak for themselves stand alone; the others carry their section.
    expect(submitFieldLabel(de, "birth_place")).toBe("Geburtsort");
    expect(submitFieldLabel(de, "birth_country")).toBe("Geburtsland");
    expect(submitFieldLabel(de, "id_document_type")).toBe("Ausweisdokument: Art des Dokuments");
    expect(submitFieldLabel(de, "id_valid_until")).toBe("Ausweisdokument: Gültig bis");
    expect(submitFieldLabel(de, "id_document_upload")).toBe("Ausweisdokument: Foto oder Scan des Ausweises");
    expect(submitFieldLabel(de, "payment_background")).toBe("Zahler: Warum zahlt diese Person?");
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

  it("names what is still missing about invoice and payment, with the section where a label alone would not do", () => {
    const de = leadRequestText("de");
    // The questions stand alone; "Ort" or "Land" alone would be the address's.
    expect(submitFieldLabel(de, "invoice_to")).toBe("Wohin soll die Rechnung gehen?");
    expect(submitFieldLabel(de, "invoice_name")).toBe("Rechnungsempfänger: Name auf der Rechnung");
    expect(submitFieldLabel(de, "invoice_city")).toBe("Rechnungsempfänger: Ort");
    expect(submitFieldLabel(de, "invoice_country")).toBe("Rechnungsempfänger: Land");
    expect(submitFieldLabel(de, "payment_method")).toBe("Wie werden Sie bezahlen?");
    expect(submitFieldLabel(de, "payment_method_details")).toBe("Zahlungsweg: Sonstiges – Bitte beschreiben");
    expect(submitFieldLabel(de, "account_country")).toBe("Zahlungsweg: Land des Kontos");
    expect(submitFieldLabel(de, "account_holder")).toBe("Zahlungsweg: Kontoinhaber/in");
    expect(submitFieldLabel(de, "bank_name")).toBe("Zahlungsweg: Name der Bank");
    expect(submitFieldLabel(de, "via_third_party")).toBe(
      "Erfolgt die Zahlung über eine dritte Person oder einen Zahlungsdienstleister?",
    );
    expect(submitFieldLabel(de, "via_third_party_details")).toBe("Zahlungsweg: Bitte beschreiben (wer, welcher Dienst)");
    expect(submitFieldLabel(leadRequestText("en"), "invoice_zip")).toBe("Invoice recipient: Postcode");
    expect(submitFieldLabel(leadRequestText("uk"), "account_holder")).toBe("Спосіб оплати: Власник рахунку");
    expect(submitFieldLabel(leadRequestText("ru"), "payment_method_details")).toBe("Способ оплаты: Другое – Опишите, пожалуйста");
  });

  it("names where the invoice goes per login: a parent reads 'to the patient', a paying parent 'to me (I pay)'", () => {
    const de = leadRequestText("de");
    expect(invoiceToLabel(de, "self")).toBe("An mich");
    expect(invoiceToLabel(de, "payer")).toBe("An die zahlende Person / Organisation");
    expect(invoiceToLabel(de, "other")).toBe("An eine andere Adresse");
    expect(invoiceToLabel(de, "self", true)).toBe(
      "An die Patientin / den Patienten (bei Minderjährigen an die gesetzlichen Vertreter)",
    );
    expect(invoiceToLabel(de, "payer", true, "patient")).toBe("An die zahlende Person / Organisation");
    expect(invoiceToLabel(de, "payer", true, "guardian")).toBe("An mich (ich zahle)");
    expect(invoiceToLabel(leadRequestText("en"), "payer", true, "guardian")).toBe("To me (I pay)");
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      expect(text.invoiceToOptionsGuardian.self).not.toBe(text.invoiceToOptions.self);
      expect(text.invoiceToOptionsGuardian.other).toBe(text.invoiceToOptions.other);
      expect(Object.keys(text.paymentMethodOptions)).toEqual(["bank_transfer", "card", "cash", "crypto", "other"]);
    }
  });

  it("says who consents and signs for a minor by the custody chosen", () => {
    const de = leadRequestText("de");
    expect(de.legalRepresentativesIntro).toBe("Für Minderjährige handeln die gesetzlichen Vertreter.");
    expect(de.custodySignatureNote).toEqual({
      joint: "Einwilligung und Unterschriften werden von beiden Elternteilen benötigt.",
      sole_parent: "Einwilligung und Unterschrift gibt der allein sorgeberechtigte Elternteil.",
      guardian: "Einwilligung und Unterschrift gibt der Vormund / die Pflegerin.",
    });
    // Only joint custody speaks of both parents, in every language.
    const bothParents = { de: /beiden Elternteilen/, en: /both parents/, uk: /обох батьків/, ru: /обоих родителей/ };
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      expect(text.custodySignatureNote.joint, option.value).toMatch(bothParents[option.value]);
      expect(text.custodySignatureNote.sole_parent, option.value).not.toMatch(bothParents[option.value]);
      expect(text.custodySignatureNote.guardian, option.value).not.toMatch(bothParents[option.value]);
      expect(new Set(Object.values(text.custodySignatureNote)).size, option.value).toBe(3);
    }
  });

  it("says that only GMED changes a payer who answered on the own link", () => {
    expect(leadRequestText("de").payerAnsweredByPayer).toBe(
      "Die zahlende Person hat ihre Angaben selbst gemacht. Änderungen nur über GMED.",
    );
    for (const option of LEAD_CABINET_LANGS) expect(leadRequestText(option.value).payerAnsweredByPayer).toMatch(/GMED/);
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
