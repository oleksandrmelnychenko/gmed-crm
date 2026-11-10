import { describe, expect, it } from "vitest";

import { dateRangeMessage, dateRefusalMessage } from "./lead-request-date-refusal";
import { germanZipRefused, nameCorrected, payerBornAfterPatient, type SubmitField } from "./lead-request-model";
import { draftFromPayerQuestionnaire, withRepresentativeLegalAnswers } from "./lead-request-payer-questionnaire-model";
import { LEAD_CABINET_LANGS, leadRequestText, submitFieldLabel } from "./lead-request-text";

// The checks and messages added after the browser QA of 2026-11-10 (results-A, findings 4, 8, 10, 11, 15, 16).

describe("a date the field does not take says what is wrong (finding 4)", () => {
  it("names a date that does not exist, one in the future and one before the first allowed day", () => {
    const today = "2026-11-10";
    expect(dateRefusalMessage("ru", "invalidDate", {}, today)).toBe("Такой даты нет, или дата введена не полностью. Проверьте день, месяц и год.");
    // The last allowed day is today: "in the future"; another limit is named as a date.
    expect(dateRefusalMessage("ru", "maxDate", { max: today }, today)).toBe("Дата не может быть в будущем.");
    expect(dateRefusalMessage("de", "maxDate", { max: "2030-12-31" }, today)).toBe("Das Datum darf nicht nach dem 31.12.2030 liegen.");
    expect(dateRefusalMessage("en", "minDate", { min: "1900-01-01" }, today)).toBe("The date cannot be earlier than 01.01.1900.");
    expect(dateRefusalMessage("uk", "minDate", { min: today }, today)).toBe("Дата не може бути в минулому.");
    // An unknown language reads Russian, an unknown reason reads as "no such date".
    expect(dateRefusalMessage("fr", "shouldDisableDate", {}, today)).toBe(dateRefusalMessage("ru", "invalidDate", {}, today));
  });

  it("has every sentence in the four cabinet languages", () => {
    for (const { value } of LEAD_CABINET_LANGS) {
      for (const reason of ["invalidDate", "maxDate", "minDate"]) {
        expect(dateRefusalMessage(value, reason, { min: "1900-01-01", max: "2026-11-10" }, "2026-11-10").trim(), `${value} ${reason}`).not.toBe("");
      }
    }
    expect(new Set(LEAD_CABINET_LANGS.map(({ value }) => dateRefusalMessage(value, "invalidDate"))).size).toBe(LEAD_CABINET_LANGS.length);
  });

  it("explains a stored value outside the range the same way, and nothing inside it", () => {
    const limits = { min: "1900-01-01", max: "2026-11-10" };
    expect(dateRangeMessage("ru", "2030-01-01", limits, "2026-11-10")).toBe("Дата не может быть в будущем.");
    expect(dateRangeMessage("ru", "1899-12-31", limits, "2026-11-10")).toBe("Дата не может быть раньше 01.01.1900.");
    expect(dateRangeMessage("ru", "2020-05-05", limits, "2026-11-10")).toBeUndefined();
    expect(dateRangeMessage("ru", "", limits, "2026-11-10")).toBeUndefined();
  });
});

describe("loose input checks (finding 10)", () => {
  it("takes five digits as a German postal code and leaves other countries alone", () => {
    expect(germanZipRefused({ country: "DE", zip_code: "ABCDE!!" })).toBe(true);
    expect(germanZipRefused({ country: "DE", zip_code: "1011" })).toBe(true);
    expect(germanZipRefused({ country: "DE", zip_code: " 10115 " })).toBe(false);
    // Missing is said by the list of missing fields, not as a wrong format.
    expect(germanZipRefused({ country: "DE", zip_code: "" })).toBe(false);
    expect(germanZipRefused({ country: "AT", zip_code: "1010" })).toBe(false);
    expect(germanZipRefused({ country: "", zip_code: "SW1A 1AA" })).toBe(false);
  });

  it("does not take a parent or grandparent who is not older than the patient", () => {
    const patient = "2007-03-01";
    expect(payerBornAfterPatient({ payer_kind: "third_party", relationship_kind: "parent", date_of_birth: "2015-01-01" }, patient)).toBe(true);
    expect(payerBornAfterPatient({ payer_kind: "third_party", relationship_kind: "grandparent", date_of_birth: patient }, patient)).toBe(true);
    expect(payerBornAfterPatient({ payer_kind: "third_party", relationship_kind: "parent", date_of_birth: "1975-06-01" }, patient)).toBe(false);
    // Another relationship, an unknown date on either side, or no third party: nothing to compare.
    expect(payerBornAfterPatient({ payer_kind: "third_party", relationship_kind: "child", date_of_birth: "2015-01-01" }, patient)).toBe(false);
    expect(payerBornAfterPatient({ payer_kind: "third_party", relationship_kind: "parent", date_of_birth: "" }, patient)).toBe(false);
    expect(payerBornAfterPatient({ payer_kind: "third_party", relationship_kind: "parent", date_of_birth: "2015-01-01" }, null)).toBe(false);
    expect(payerBornAfterPatient({ payer_kind: "self", relationship_kind: "parent", date_of_birth: "2015-01-01" }, patient)).toBe(false);
  });
});

describe("a corrected name is the same payer (finding 11)", () => {
  it("keeps the entries for a typo, not for another person", () => {
    expect(nameCorrected("Paul Testzahler", "Paul Testzahler")).toBe(true);
    expect(nameCorrected("Paul Testzahler", "Pawl Testzahler")).toBe(true);
    expect(nameCorrected("Paul Testzahler", " paul  testzahler ")).toBe(true);
    expect(nameCorrected("Paul Testzahler", "Paula Testzahlerin")).toBe(true);
    expect(nameCorrected("Anna Meier", "Anne Meyer")).toBe(true);
    // Another person, or no name yet.
    expect(nameCorrected("Old Payer", "Another Recipient")).toBe(false);
    expect(nameCorrected("Old Payer", "A")).toBe(false);
    expect(nameCorrected("Paul Testzahler", "Maria Testzahler")).toBe(false);
    expect(nameCorrected("", "Paul")).toBe(false);
    expect(nameCorrected("Paul", "")).toBe(false);
    // A short name allows one letter only.
    expect(nameCorrected("Li Wu", "Li Wo")).toBe(true);
    expect(nameCorrected("Li Wu", "Lo Wo")).toBe(false);
  });
});

describe("the paying parent's three legal answers start from the same person's answers as representative (finding 15)", () => {
  it("fills only what the payer's set leaves open", () => {
    const empty = draftFromPayerQuestionnaire(null);
    const filled = withRepresentativeLegalAnswers(empty, { pep_self: false, pep_related: true, sanctions_links: null });
    expect(filled.pep_self).toBe("no");
    expect(filled.pep_related).toBe("yes");
    // Not answered there: still open here; the words to a "yes" are typed here.
    expect(filled.sanctions_links).toBe("");
    expect(filled.pep_related_details).toBe("");
    // An answer the payer already gave is never replaced.
    const own = { ...empty, pep_self: "yes", pep_self_details: "Minister 2010–2014" };
    const kept = withRepresentativeLegalAnswers(own, { pep_self: false, pep_related: false, sanctions_links: false });
    expect(kept.pep_self).toBe("yes");
    expect(kept.pep_self_details).toBe("Minister 2010–2014");
    expect(kept.pep_related).toBe("no");
    // Nothing to take over: the same draft, so nothing looks changed.
    expect(withRepresentativeLegalAnswers(empty, undefined)).toBe(empty);
    expect(withRepresentativeLegalAnswers(empty, {})).toBe(empty);
  });
});

describe("the lists of what is missing name the field and address the right person (findings 8, 16)", () => {
  const ru = leadRequestText("ru");

  it("names the passport spelling as a field, not as the hint of the field", () => {
    expect(submitFieldLabel(ru, "name_latin")).toBe("Имя и фамилия латинскими буквами, как в загранпаспорте");
    expect(submitFieldLabel(ru, "name_latin")).not.toBe(ru.namePassportCorrection);
    for (const { value } of LEAD_CABINET_LANGS) {
      const text = leadRequestText(value);
      expect(text.nameLatinMissing.trim()).not.toBe("");
      expect(text.nameLatinMissing.endsWith(".")).toBe(false);
    }
  });

  it("asks \"do you hold …\" only the person who reads the list", () => {
    const who = { mineSlot: "rep1" as const, custody: "joint" as const };
    const own = submitFieldLabel(ru, "rep1_pep_self" as SubmitField, true, null, true, who);
    const other = submitFieldLabel(ru, "rep2_pep_self" as SubmitField, true, null, true, who);
    expect(own).toContain(ru.payerLegalFields.pep_self);
    // About the other parent the topic is named: no "you" under "Other parent".
    expect(other).toContain(ru.legalTopics.pep_self);
    expect(other).not.toContain(ru.payerLegalFields.pep_self);
    expect(other.toLocaleLowerCase()).not.toContain(" вы ");
    // A login that is none of the persons reads the topic for everybody.
    expect(submitFieldLabel(ru, "rep1_sanctions_links" as SubmitField, false, null, false, {})).toContain(ru.legalTopics.sanctions_links);
  });

  it("has the new sentences in every cabinet language", () => {
    const keys = [
      "sentChangeRefused", "consentWithdrawAfterSend", "invalidGermanZip", "payerBornAfterPatient", "payerConsentAskedAgain",
      "payerRenamedHint", "stepInvalidTitle", "payerLegalPrefilled",
    ] as const;
    for (const { value } of LEAD_CABINET_LANGS) {
      const text = leadRequestText(value);
      for (const key of keys) expect(text[key].trim(), `${value} ${key}`).not.toBe("");
      expect(text.fileEmpty("scan.pdf")).toContain("scan.pdf");
      const confirm = text.recipient.parentChangeConfirm("Anna Muster", "Ben Muster", true);
      expect(confirm).toContain("Anna Muster");
      expect(confirm).toContain("Ben Muster");
      // Without "and pays" when somebody else is the payer.
      expect(text.recipient.parentChangeConfirm("Anna Muster", "Ben Muster", false).length).toBeLessThan(confirm.length);
    }
  });
});
