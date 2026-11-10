import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HEALTH_CONSENT, INQUIRY_CONSENT, type LeadRequest } from "./lead-request-api";
import { PAYMENT_METHODS, isRemovedPaymentMethod } from "./lead-request-billing-model";
import { ConsentCheckbox } from "./lead-request-parts";
import { CabinetStaffModeContext } from "./lead-request-staff-mode";
import { LEAD_CABINET_LANGS, leadRequestText } from "./lead-request-text";

// Owner 2026-11-10: the consent to process health data is withdrawn in the cabinet also after
// the request was sent, as its text promises — an action of its own, with what follows said first.

const text = leadRequestText("ru");

function request(consent: { given_at: string | null; withdrawn_at?: string | null }, sent: boolean): LeadRequest {
  return {
    lead_id: "lead-1",
    submitted_at: sent ? "2026-11-10T10:00:00Z" : null,
    consents: {
      [HEALTH_CONSENT]: { type: HEALTH_CONSENT, version: "1", texts: {}, ...consent },
      [INQUIRY_CONSENT]: { type: INQUIRY_CONSENT, version: "1", texts: {}, given_at: "2026-11-01T08:00:00Z" },
    },
  } as unknown as LeadRequest;
}

function render(lead: LeadRequest, purpose: string, withdrawAfterSend: boolean, staff = false) {
  return renderToStaticMarkup(
    <CabinetStaffModeContext.Provider value={staff}>
      <ConsentCheckbox
        request={lead}
        purpose={purpose}
        text={text}
        lang="ru"
        label="Согласие"
        enqueue={(task) => task()}
        onChange={() => undefined}
        testId="consent"
        withdrawAfterSend={withdrawAfterSend}
      />
    </CabinetStaffModeContext.Provider>,
  );
}

describe("withdrawing the health-data consent after the send", () => {
  const given = { given_at: "2026-11-01T08:00:00Z" };

  it("offers the withdrawal as an action of its own once the request is sent", () => {
    const html = render(request(given, true), HEALTH_CONSENT, true);
    expect(html).toContain('data-testid="consent-withdraw"');
    expect(html).toContain(text.healthConsentWithdraw);
    expect(html).toContain(text.healthConsentWithdrawHint);
    // The box itself stays locked, and nothing sends the person to GMED for it.
    expect(html).toContain(' disabled=""');
    expect(html).not.toContain('data-testid="consent-after-send"');
  });

  it("keeps the other consents with the GMED contact, and shows no extra action before the send or to staff", () => {
    const inquiry = render(request(given, true), INQUIRY_CONSENT, false);
    expect(inquiry).toContain('data-testid="consent-after-send"');
    expect(inquiry).not.toContain('data-testid="consent-withdraw"');
    // Before the send the box itself withdraws.
    const open = render(request(given, false), HEALTH_CONSENT, true);
    expect(open).not.toContain('data-testid="consent-withdraw"');
    expect(open).not.toContain(' disabled=""');
    expect(render(request(given, true), HEALTH_CONSENT, true, true)).not.toContain('data-testid="consent-withdraw"');
  });

  it("shows a withdrawn consent as withdrawn, with the time, and lets it be given again", () => {
    const html = render(request({ given_at: null, withdrawn_at: "2026-11-10T12:30:00Z" }, true), HEALTH_CONSENT, true);
    expect(html).toContain('data-testid="consent-withdrawn"');
    expect(html).toContain("10.11.2026");
    expect(html).not.toContain('data-testid="consent-withdraw"');
    expect(html).not.toContain(' disabled=""');
    // Never given: nothing about a withdrawal.
    expect(render(request({ given_at: null }, true), HEALTH_CONSENT, true)).not.toContain('data-testid="consent-withdrawn"');
  });

  it("says what follows before the withdrawal, in every cabinet language", () => {
    for (const { value } of LEAD_CABINET_LANGS) {
      const wording = leadRequestText(value);
      for (const key of ["healthConsentWithdrawHint", "healthConsentWithdraw", "healthConsentWithdrawConfirm", "consentWithdrawNotYours"] as const) {
        expect(wording[key].trim(), `${value} ${key}`).not.toBe("");
      }
      expect(wording.healthConsentWithdrawConfirm).toContain("GMED");
      expect(wording.consentWithdrawnAt("10.11.2026 13:30")).toContain("10.11.2026 13:30");
    }
  });
});

describe("the payment method \"other\" is no longer offered (owner 2026-11-10)", () => {
  it("offers transfer, card and cash; an older answer keeps its label", () => {
    expect([...PAYMENT_METHODS]).toEqual(["bank_transfer", "card", "cash"]);
    expect(isRemovedPaymentMethod("other")).toBe(true);
    expect(isRemovedPaymentMethod("crypto")).toBe(true);
    expect(isRemovedPaymentMethod("cash")).toBe(false);
    expect(isRemovedPaymentMethod("")).toBe(false);
    for (const { value } of LEAD_CABINET_LANGS) {
      const options = leadRequestText(value).paymentMethodOptions;
      expect(options.other).toContain("(");
      expect(options.other).not.toBe(options.crypto);
    }
  });
});
