import { describe, expect, it } from "vitest";

import {
  LEAD_FAILURE_REASONS,
  LEAD_FAILURE_REASON_MAX_LENGTH,
  isLeadFailureReasonCode,
  leadFailureReasonDraft,
  leadFailureReasonError,
  leadFailureReasonLabel,
  leadFailureReasonOtherLabel,
  leadFailureReasonValue,
  leadLifecycleNoteLabel,
} from "./lead-failure-reasons";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

describe("the failure reason of a lead", () => {
  it("offers the agreed codes, each with a Russian and a German label", () => {
    expect(LEAD_FAILURE_REASONS.map((reason) => reason.code)).toEqual([
      "not_our_lead",
      "no_response",
      "patient_declined",
      "other_provider",
      "costs",
      "duplicate",
    ]);
    for (const reason of LEAD_FAILURE_REASONS) {
      expect(reason.ru.trim()).not.toBe("");
      expect(reason.de.trim()).not.toBe("");
      expect(leadFailureReasonLabel(reason.code, ru)).not.toBe(reason.code);
      expect(leadFailureReasonLabel(reason.code, de)).not.toBe(reason.code);
    }
    expect(leadFailureReasonOtherLabel(ru)).toBe("Другое");
    expect(leadFailureReasonOtherLabel(de)).toBe("Andere");
  });

  it("reads a known code as its label and a free text as it is, never the raw code", () => {
    expect(leadFailureReasonLabel("not_our_lead", ru)).toBe("Запрос не соответствует нашему профилю");
    expect(leadFailureReasonLabel("not_our_lead", de)).toBe("Anfrage passt nicht zu unserem Angebot");
    expect(leadFailureReasonLabel(" duplicate ", de)).toBe("Dublette");
    expect(leadFailureReasonLabel("Пациент переехал в другую страну", ru)).toBe("Пациент переехал в другую страну");
    expect(leadFailureReasonLabel("", ru)).toBeNull();
    expect(leadFailureReasonLabel(null, ru)).toBeNull();
    expect(leadFailureReasonLabel(undefined, ru)).toBeNull();
    expect(leadFailureReasonLabel("other", ru)).toBeNull();
  });

  it("prefills the choice from the stored reason", () => {
    expect(leadFailureReasonDraft(null)).toEqual({ choice: "", text: "" });
    expect(leadFailureReasonDraft("costs")).toEqual({ choice: "costs", text: "" });
    expect(leadFailureReasonDraft("No medical fit")).toEqual({ choice: "other", text: "No medical fit" });
    expect(leadFailureReasonDraft("other")).toEqual({ choice: "other", text: "" });
    expect(isLeadFailureReasonCode("costs")).toBe(true);
    expect(isLeadFailureReasonCode("other")).toBe(false);
    expect(isLeadFailureReasonCode("No medical fit")).toBe(false);
  });

  it("sends the code, or the trimmed text of «Другое», and nothing while incomplete", () => {
    expect(leadFailureReasonValue({ choice: "no_response", text: "ignored" })).toBe("no_response");
    expect(leadFailureReasonValue({ choice: "other", text: "  Lebt nicht mehr in der EU  " })).toBe("Lebt nicht mehr in der EU");
    expect(leadFailureReasonValue({ choice: "other", text: "   " })).toBeNull();
    expect(leadFailureReasonValue({ choice: "", text: "x" })).toBeNull();
    expect(leadFailureReasonValue({ choice: "other", text: "x".repeat(LEAD_FAILURE_REASON_MAX_LENGTH + 1) })).toBeNull();
    expect(leadFailureReasonValue({ choice: "other", text: "x".repeat(LEAD_FAILURE_REASON_MAX_LENGTH) })).toHaveLength(
      LEAD_FAILURE_REASON_MAX_LENGTH,
    );
  });

  it("says what is missing", () => {
    expect(leadFailureReasonError({ choice: "", text: "" }, ru)).toBe("Выберите причину");
    expect(leadFailureReasonError({ choice: "other", text: " " }, de)).toBe("Grund beschreiben");
    expect(leadFailureReasonError({ choice: "other", text: "x".repeat(501) }, ru)).toBe("Не более 500 символов");
    expect(leadFailureReasonError({ choice: "other", text: "Umzug" }, de)).toBeNull();
    expect(leadFailureReasonError({ choice: "duplicate", text: "" }, ru)).toBeNull();
  });
});

describe("the notes of the lead history (QA 2026-10-12, A3-02)", () => {
  it("reads the reason of a status change, an archiving or a deletion as its label", () => {
    expect(leadLifecycleNoteLabel("status_change", "costs", ru)).toBe("Не устраивает стоимость");
    expect(leadLifecycleNoteLabel("deleted", "other", ru)).toBe("Другое");
    expect(leadLifecycleNoteLabel("deleted", "other", de)).toBe("Andere");
    expect(leadLifecycleNoteLabel("archived", "Umzug ins Ausland", de)).toBe("Umzug ins Ausland");
    expect(leadLifecycleNoteLabel("status_change", null, ru)).toBeNull();
    expect(leadLifecycleNoteLabel("status_change", "  ", ru)).toBeNull();
    // Other entries keep their note as it is.
    expect(leadLifecycleNoteLabel("converted", "Lead converted to patient", ru)).toBe("Lead converted to patient");
    expect(leadLifecycleNoteLabel("converted", "other", ru)).toBe("other");
  });
});
