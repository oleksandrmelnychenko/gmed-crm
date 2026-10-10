import { describe, expect, it } from "vitest";

import { cabinetLocale, formatFileSize, languageName } from "./lead-request-model";
import {
  LEAD_CABINET_LANGS,
  asLeadCabinetLang,
  followUpFieldLabel,
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
    expect(leadRequestText("uk").steps.documents).toBe("Звернення й документи");
    expect(leadRequestText("ru").steps.documents).toBe("Обращение и документы");
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
      "Zahler: Beziehung zur Patientin / zum Patienten – In welcher Beziehung genau?",
      "Zahler: Einverständnis zur Kontaktaufnahme",
    ]);
    expect(missing("en", "insurance")).toEqual([
      "Payer: Name of the insurer",
      "Payer: Country of the registered office",
      "Payer: Relationship to the patient",
      "Payer: Relationship to the patient – How exactly related to the patient",
      "Payer: Consent to contact",
    ]);
    expect(missing("uk", "organisation")).toEqual([
      "Платник: Назва організації",
      "Платник: Країна місцезнаходження",
      "Платник: Ким доводиться пацієнту",
      "Платник: Ким доводиться пацієнту – Ким саме доводиться пацієнту",
      "Платник: Згода на контакт",
    ]);
    expect(missing("ru", "company")).toEqual([
      "Плательщик: Название компании",
      "Плательщик: Страна местонахождения",
      "Плательщик: Кем приходится пациенту",
      "Плательщик: Кем приходится пациенту – Кем именно приходится пациенту",
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
    expect(submitFieldLabel(de, "id_document_upload")).toBe("Ausweisdokument: Foto oder Scan des Ausweises");
    expect(submitFieldLabel(de, "request_reason")).toBe("Grund der Anfrage");
    expect(submitFieldLabel(de, "payer_own_account")).toBe("Handeln Sie im eigenen wirtschaftlichen Interesse?");
    expect(submitFieldLabel(de, "payer_beneficial_owner")).toBe(
      "In wessen Interesse handeln Sie? (Name, Geburtsdatum, Geburtsort, Anschrift)",
    );
    // The legal questions are long: the list names their topic.
    expect(submitFieldLabel(de, "pep_self")).toBe("Gesetzliche Fragen: Öffentliches Amt");
    expect(submitFieldLabel(de, "sanctions_links")).toBe("Gesetzliche Fragen: Sanktionen");
    expect(submitFieldLabel(leadRequestText("uk"), "pep_related")).toBe(
      "Запитання за законом: Політично значуща близька особа",
    );
    expect(submitFieldLabel(leadRequestText("en"), "id_document_upload")).toBe(
      "Identity document: Photo or scan of the document",
    );
    // The reason of the request in the owner's words (13.1).
    expect(LEAD_CABINET_LANGS.map((option) => submitFieldLabel(leadRequestText(option.value), "request_reason"))).toEqual([
      "Grund der Anfrage",
      "Reason for your request",
      "Причина звернення",
      "Причина обращения",
    ]);
    // A key of another server the cabinet has no words for is shown as it is, never empty.
    expect(submitFieldLabel(de, "id_document_type" as never)).toBe("id_document_type");
  });

  it("asks a parent about the patient, not about 'you'", () => {
    const de = leadRequestText("de");
    expect(identificationFieldLabel(de, "pep_self")).toContain("Üben Sie ein hochrangiges öffentliches Amt aus");
    expect(identificationFieldLabel(de, "pep_self", true)).toContain("Übt die Patientin / der Patient");
    // A question that does not say "you" is the same for both.
    expect(identificationFieldLabel(de, "sanctions_links", true)).toBe(identificationFieldLabel(de, "sanctions_links"));
    expect(identificationFieldLabel(de, "birth_place", true)).toBe("Geburtsort");
    expect(payerFieldLabel(de, "payer_own_account", true)).toBe(
      "Handelt die Patientin / der Patient im eigenen wirtschaftlichen Interesse?",
    );
    expect(submitFieldLabel(de, "payer_beneficial_owner", true)).toContain("handelt die Patientin / der Patient");
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      for (const field of ["pep_self", "pep_related", "residence_since"] as const) {
        expect(identificationFieldLabel(text, field, true)).not.toBe(identificationFieldLabel(text, field));
      }
      expect(text.ownAccountQuestionGuardian).not.toBe(text.ownAccountQuestion);
    }
  });

  it("names the steps and the follow-up in every language, in the owner's words, without an assessment", () => {
    expect(leadRequestText("de").steps).toEqual({
      person: "Einwilligung & Person",
      contact: "Kontakt & Wohnsitz",
      identity: "Ausweis",
      payer: "Wer zahlt",
      billing: "Versicherung & Rechnung",
      declarations: "Erklärungen",
      follow_up: "Ergänzende Angaben",
      documents: "Anliegen & Unterlagen",
      send: "Prüfen & Senden",
    });
    // After sending, one short neutral pointer to the open blocks (QA 2026-10-10: no title).
    expect(LEAD_CABINET_LANGS.map((option) => leadRequestText(option.value).followUpOpen)).toEqual([
      "Bitte ergänzen Sie noch einige Angaben.",
      "Please complete a few more details.",
      "Будь ласка, доповніть ще деякі відомості.",
      "Пожалуйста, дополните ещё некоторые сведения.",
    ]);
    // "Nothing is needed meanwhile" stands apart: it is left out while blocks are open.
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      expect(text.nextSteps.join(" "), option.value).not.toContain(text.nextNothingRequired);
      expect(text.nextAfterChange, option.value).not.toContain(text.nextNothingRequired);
    }
    // The review notice continues the sentence of the sending: one thank-you only (QA 2026-10-10).
    expect(
      LEAD_CABINET_LANGS.map((option) => {
        const text = leadRequestText(option.value);
        return `${text.sentTitle} ${text.sentBody("10.10.2026 13:09")} ${text.reviewNotice}`;
      }),
    ).toEqual([
      "Vielen Dank! Ihre Angaben wurden am 10.10.2026 13:09 gesendet. Wir prüfen sie und melden uns bei Ihnen.",
      "Thank you! Your details were sent on 10.10.2026 13:09. We are reviewing them and will get in touch with you.",
      "Дякуємо! Ваші дані надіслано 10.10.2026 13:09. Ми перевіримо їх і зв'яжемося з вами.",
      "Спасибо! Ваши данные отправлены 10.10.2026 13:09. Мы проверим их и свяжемся с вами.",
    ]);
    // No text of the follow-up speaks of points, levels, triggers, risk or a decision (P2).
    const risk = /risiko|risk|punkt|point|stufe|level|trigger|abgelehnt|reject|ризик|риск|бал/i;
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      const words = [
        text.followUpIntro,
        text.followUpOpen,
        text.followUpIncomplete,
        text.followUpAnsweredAt("07.10.2026 10:00"),
        text.reviewNotice,
        ...Object.values(text.followUpBlocks),
        ...Object.values(text.steps),
      ];
      for (const word of words) expect(word, option.value).not.toMatch(risk);
    }
  });

  it("labels what a follow-up block still misses", () => {
    const de = leadRequestText("de");
    expect(followUpFieldLabel(de, "funds_sources")).toBe("Herkunft der Mittel");
    // An older key of the same question gets the same label.
    expect(followUpFieldLabel(de, "self_funds_sources")).toBe("Herkunft der Mittel");
    expect(followUpFieldLabel(de, "enhanced_funds_proof_upload")).toBe("Nachweise zur Herkunft der Mittel");
    expect(followUpFieldLabel(de, "funds_proof_upload")).toBe("Nachweise zur Herkunft der Mittel");
    expect(followUpFieldLabel(de, "relationship_since")).toBe("Seit wann besteht die Beziehung?");
    expect(followUpFieldLabel(de, "relationship_proof_upload")).toBe("Nachweis der Beziehung");
    expect(followUpFieldLabel(de, "expected_total_eur")).toBe("Voraussichtlicher Gesamtbetrag (EUR)");
    expect(followUpFieldLabel(de, "payment_method")).toBe("Wie werden Sie bezahlen?");
    expect(followUpFieldLabel(de, "pep_wealth_origin")).toBe("Herkunft des Vermögens");
    expect(followUpFieldLabel(de, "sanctions_link_kind")).toBe("Art der Verbindung");
    expect(followUpFieldLabel(de, "id_document_upload")).toBe("Foto oder Scan des Ausweises");
    expect(followUpFieldLabel(de, "agent_last_name")).toBe("Angaben zur vertretenden Person: Nachname");
    expect(followUpFieldLabel(de, "residence_since", true)).toBe("Seit wann wohnt die Patientin / der Patient im Wohnsitzland?");
    expect(followUpFieldLabel(de, "unknown_key")).toBe("unknown_key");
  });

  it("names the organisation mask of a payer", () => {
    const de = leadRequestText("de");
    expect(submitFieldLabel(de, "payer_legal_form")).toBe("Zahler: Rechtsform");
    expect(submitFieldLabel(de, "payer_contact_name")).toBe("Zahler: Ansprechperson");
    expect(submitFieldLabel(de, "payer_email_or_phone")).toBe("Zahler: E-Mail oder Telefon");
    expect(submitFieldLabel(leadRequestText("en"), "payer_register_number")).toBe("Payer: Register number (if any)");
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

  it("asks who pays without a filler sentence and names an organisation's seat", () => {
    expect(LEAD_CABINET_LANGS.map((option) => leadRequestText(option.value).payerIntro)).toEqual([
      "Bitte nennen Sie, wer die Kosten übernimmt.",
      "Please tell us who pays for the treatment.",
      "Вкажіть, будь ласка, хто оплачує лікування.",
      "Укажите, пожалуйста, кто оплачивает лечение.",
    ]);
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      expect(text.payerSeat, option.value).not.toBe(text.payerResidence);
      // The example of a relationship proof fits family or anybody else.
      expect(text.relationshipProofHintOther, option.value).not.toBe(text.relationshipProofHint);
    }
    expect(leadRequestText("ru").payerSeat).toBe("Местонахождение");
  });

  it("asks for the consent to pass the cost estimate on in the owner's words and names it when missing", () => {
    const de = leadRequestText("de");
    expect(payerFieldLabel(de, "payer_cost_estimate_consent")).toBe(
      "Ich willige ein, dass GMED der zahlenden Person den Kostenvoranschlag mit den voraussichtlichen Kosten übermittelt – nur Leistungsarten und Beträge, ohne Diagnosen und Behandlungsnamen.",
    );
    // A parent reads the same sentence: it names no patient.
    expect(payerFieldLabel(de, "payer_cost_estimate_consent", true)).toBe(payerFieldLabel(de, "payer_cost_estimate_consent"));
    expect(
      LEAD_CABINET_LANGS.map((option) => submitFieldLabel(leadRequestText(option.value), "payer_cost_estimate_consent")),
    ).toEqual([
      "Zahler: Einwilligung zur Weitergabe des Kostenvoranschlags",
      "Payer: Consent to pass on the cost estimate",
      "Платник: Згода на передачу кошторису",
      "Плательщик: Согласие на передачу сметы",
    ]);
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      // Its own sentence, not the one about contacting the payer.
      expect(text.payerCostEstimateConsentLabel).not.toBe(text.payerConsentLabel);
      expect(text.payerCostEstimateConsentShort).not.toBe(text.payerConsentShort);
    }
  });

  it("tells the paying parent where the documents for signing stand, in the owner's words", () => {
    const de = leadRequestText("de");
    expect(de.payerSignatureSent("06.10.2026")).toBe(
      "Unterlagen zur Unterschrift: Wir haben Ihnen am 06.10.2026 vier Dokumente zur qualifizierten elektronischen Signatur gesendet. Die Einladung kommt per E-Mail von unserem Partner Skribble; dort bestätigen Sie auch Ihre Identität.",
    );
    expect(de.payerSignatureSigned("08.10.2026")).toBe(
      "Vielen Dank – die unterschriebenen Unterlagen sind am 08.10.2026 bei GMED eingegangen.",
    );
    // Without a date the sentence still reads.
    expect(de.payerSignatureSent("")).toContain("Wir haben Ihnen vier Dokumente");
    expect(de.payerSignatureSigned("")).toBe("Vielen Dank – die unterschriebenen Unterlagen sind bei GMED eingegangen.");
    for (const option of LEAD_CABINET_LANGS) {
      const text = leadRequestText(option.value);
      expect(text.payerSignatureSent("06.10.2026"), option.value).toMatch(/06\.10\.2026.*Skribble/);
      expect(text.payerSignatureSigned("08.10.2026"), option.value).toMatch(/08\.10\.2026/);
      expect(text.payerSignatureSent(""), option.value).not.toMatch(/ {2}/);
      expect(text.payerSignatureSigned(""), option.value).not.toMatch(/ {2}| \./);
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
