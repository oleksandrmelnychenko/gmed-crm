import { describe, expect, it } from "vitest";

import type { LeadRequestBilling } from "./lead-request-api";
import { missingFieldKeys, recipientIsPayer, recipientKeyOfPayerKey, representativeQuestionId } from "./lead-request-field-target";

describe("links of missing items to their fields", () => {
  it("parses block R's keys to the input id of the representative's answer", () => {
    expect(representativeQuestionId("representative:3f2a-77:relation_to_country")).toEqual({ id: "representative-3f2a-77-relation_to_country", person: "3f2a-77" });
    // Nothing for other keys or for anything that is no id.
    expect(representativeQuestionId("funds_source")).toBeNull();
    expect(representativeQuestionId("representative:x")).toBeNull();
    expect(representativeQuestionId("representative:a:b:c")).toBeNull();
    expect(representativeQuestionId('representative:a"]:b')).toBeNull();
  });

  it("maps a payer key to the recipient's field when the recipient is the payer", () => {
    expect(recipientKeyOfPayerKey("payer_email")).toBe("recipient_email");
    expect(recipientKeyOfPayerKey("payer_country")).toBe("recipient_country");
    expect(recipientKeyOfPayerKey("payer_phone")).toBe("recipient_phone");
    // Fields the recipient has no input for stay with the payer block.
    expect(recipientKeyOfPayerKey("payer_citizenships")).toBeNull();
    expect(recipientKeyOfPayerKey("payer_email_or_phone")).toBeNull();
    expect(recipientKeyOfPayerKey("first_name")).toBeNull();
    expect([...missingFieldKeys(["payer_email", "payer_citizenships"], true)]).toEqual(["payer_email", "recipient_email", "payer_citizenships"]);
    expect([...missingFieldKeys(["payer_email"], false)]).toEqual(["payer_email"]);
  });

  it("knows a paying third-party recipient from the request", () => {
    const billing = (invoice_recipient: string, is_payer: boolean | null) =>
      ({ billing: { invoice_recipient, invoice_recipient_is_payer: is_payer, recipient: null } as unknown as LeadRequestBilling });
    expect(recipientIsPayer(billing("third_party", true))).toBe(true);
    expect(recipientIsPayer(billing("third_party", false))).toBe(false);
    expect(recipientIsPayer(billing("self", true))).toBe(false);
    expect(recipientIsPayer({ billing: null })).toBe(false);
  });
});
