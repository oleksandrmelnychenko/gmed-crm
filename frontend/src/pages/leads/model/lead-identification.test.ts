import { describe, expect, it } from "vitest";

import {
  identificationPersons,
  normalizeLeadIdentificationStatus,
  ownAccountPaymentLabel,
  qualifiedSignatureLabel,
  type PersonIdentification,
} from "./lead-identification";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const NOTHING: PersonIdentification = { qes: null, own_account_payment: null };

describe("normalizeLeadIdentificationStatus", () => {
  it("reads the patient and, when a third party pays, the payer", () => {
    expect(
      normalizeLeadIdentificationStatus({
        contract_partner: {
          qes: { signed_at: "2026-10-05T09:20:00Z", test_mode: false },
          own_account_payment: null,
        },
        payer: {
          qes: null,
          own_account_payment: {
            confirmed_at: "2026-10-05T10:00:00Z",
            confirmed_by_name: "Petra Manager",
            note: "  ",
          },
        },
      }),
    ).toEqual({
      contract_partner: {
        qes: { signed_at: "2026-10-05T09:20:00Z", test_mode: false },
        own_account_payment: null,
      },
      payer: {
        qes: null,
        own_account_payment: {
          confirmed_at: "2026-10-05T10:00:00Z",
          confirmed_by_name: "Petra Manager",
          note: null,
        },
      },
    });
    expect(normalizeLeadIdentificationStatus({ contract_partner: {}, payer: null })).toEqual({
      contract_partner: NOTHING,
      payer: null,
    });
  });

  it("drops a signature or a confirmation without its time", () => {
    const status = normalizeLeadIdentificationStatus({
      contract_partner: { qes: { test_mode: true }, own_account_payment: { confirmed_by_name: "Petra Manager" } },
    });
    expect(status).toEqual({ contract_partner: NOTHING, payer: null });
  });

  it("knows nothing about a reply that is not a status", () => {
    for (const reply of [null, undefined, [], "ok", {}, { payer: null }, { contract_partner: [] }]) {
      expect(normalizeLeadIdentificationStatus(reply)).toBeNull();
    }
  });
});

describe("qualifiedSignatureLabel", () => {
  it("says that there is no qualified signature yet", () => {
    expect(qualifiedSignatureLabel(NOTHING, ru)).toEqual({
      tone: "neutral",
      text: "Квалифицированной подписи ещё нет",
    });
    expect(qualifiedSignatureLabel(NOTHING, de).text).toBe("Noch keine qualifizierte Signatur");
  });

  it("dates the signature on the Berlin day", () => {
    // 22:30 UTC is already the next day in Berlin.
    const person = { ...NOTHING, qes: { signed_at: "2026-10-04T22:30:00Z", test_mode: false } };
    expect(qualifiedSignatureLabel(person, ru)).toEqual({
      tone: "success",
      text: "Квалифицированная подпись · 05.10.2026",
    });
    expect(qualifiedSignatureLabel(person, de).text).toBe("Qualifizierte Signatur · 05.10.2026");
  });

  it("marks a signature of the demo account as a test, without the success tone", () => {
    const person = { ...NOTHING, qes: { signed_at: "2026-10-05T09:20:00Z", test_mode: true } };
    expect(qualifiedSignatureLabel(person, ru)).toEqual({
      tone: "info",
      text: "Квалифицированная подпись · 05.10.2026 · тест",
    });
    expect(qualifiedSignatureLabel(person, de).text).toBe("Qualifizierte Signatur · 05.10.2026 · Test");
  });
});

describe("ownAccountPaymentLabel", () => {
  it("awaits the payment until staff confirm it", () => {
    expect(ownAccountPaymentLabel(NOTHING, ru)).toEqual({
      tone: "warning",
      text: "Ожидается платёж с собственного счёта",
    });
    expect(ownAccountPaymentLabel(NOTHING, de).text).toBe("Zahlung vom eigenen Konto ausstehend");
  });

  it("names the day and who confirmed the payment", () => {
    const person = {
      ...NOTHING,
      own_account_payment: { confirmed_at: "2026-10-05T10:00:00Z", confirmed_by_name: "Petra Manager", note: null },
    };
    expect(ownAccountPaymentLabel(person, ru)).toEqual({
      tone: "success",
      text: "Платёж с собственного счёта подтверждён · 05.10.2026 · Petra Manager",
    });
    expect(ownAccountPaymentLabel(person, de).text).toBe(
      "Zahlung vom eigenen Konto bestätigt · 05.10.2026 · Petra Manager",
    );
  });

  it("leaves out the name of a user who no longer exists", () => {
    const person = {
      ...NOTHING,
      own_account_payment: { confirmed_at: "2026-10-05T10:00:00Z", confirmed_by_name: null, note: null },
    };
    expect(ownAccountPaymentLabel(person, ru).text).toBe("Платёж с собственного счёта подтверждён · 05.10.2026");
  });
});

describe("identificationPersons", () => {
  it("lists the patient alone while the patient pays", () => {
    expect(identificationPersons({ contract_partner: NOTHING, payer: null }, ru)).toEqual([
      { subject: "contract_partner", role: "Пациент", person: NOTHING },
    ]);
  });

  it("adds the payer when a third party pays", () => {
    const payer = { ...NOTHING, qes: { signed_at: "2026-10-05T09:20:00Z", test_mode: false } };
    expect(identificationPersons({ contract_partner: NOTHING, payer }, de)).toEqual([
      { subject: "contract_partner", role: "Patient/in", person: NOTHING },
      { subject: "payer", role: "Kostenübernehmer", person: payer },
    ]);
  });
});
