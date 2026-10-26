import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import type { PayerDeclaration } from "./lead-payer";
import {
  paymentRouteDraft,
  paymentRouteErrors,
  paymentRouteFieldShown,
  paymentRoutePatch,
  paymentRouteServerError,
  paymentRouteSourceLabel,
  withRouteMethod,
  withRouteViaThirdParty,
} from "./lead-payer-payment-route";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const transfer = {
  payment_method: "bank_transfer",
  payment_method_details: null,
  account_country: "AT",
  account_holder: "Erika Zahler",
  bank_name: "Beispielbank",
  via_third_party: false,
  via_third_party_details: null,
  payment_route_source: "payer",
} as unknown as PayerDeclaration;

describe("staff's payment route of a third-party payer (owner 2026-10-26)", () => {
  it("prefills the stored route and sends only what staff changed", () => {
    const saved = paymentRouteDraft(transfer);
    expect(saved).toMatchObject({ payment_method: "bank_transfer", account_country: "AT", via_third_party: "no" });
    expect(paymentRouteDraft(null)).toMatchObject({ payment_method: "", via_third_party: "" });
    expect(paymentRoutePatch(saved, saved)).toEqual({});
    // Whitespace as the server stores it is no change.
    expect(paymentRoutePatch({ ...saved, account_holder: "  Erika   Zahler " }, saved)).toEqual({});
    expect(paymentRoutePatch({ ...saved, bank_name: "Andere Bank", account_country: "de" }, saved)).toEqual({
      account_country: "DE",
      bank_name: "Andere Bank",
    });
  });

  it("clears what belongs to another answer, as the server does", () => {
    const saved = paymentRouteDraft(transfer);
    const cash = withRouteMethod(saved, "cash");
    expect(cash).toMatchObject({ payment_method: "cash", account_country: "", account_holder: "", bank_name: "" });
    expect(paymentRouteFieldShown("account_country", cash)).toBe(false);
    expect(paymentRouteFieldShown("payment_method_details", cash)).toBe(false);
    expect(paymentRoutePatch(cash, saved)).toEqual({
      payment_method: "cash",
      account_country: null,
      account_holder: null,
      bank_name: null,
    });
    const other = withRouteMethod(saved, "other");
    expect(paymentRouteFieldShown("payment_method_details", other)).toBe(true);
    const via = withRouteViaThirdParty({ ...saved, via_third_party_details: "Bruder" }, "yes");
    expect(paymentRouteFieldShown("via_third_party_details", via)).toBe(true);
    expect(via.via_third_party_details).toBe("Bruder");
    const no = withRouteViaThirdParty(via, "no");
    expect(no.via_third_party_details).toBe("");
    expect(paymentRoutePatch(withRouteViaThirdParty(saved, "yes"), saved)).toEqual({ via_third_party: true });
    expect(paymentRoutePatch(withRouteViaThirdParty(saved, ""), saved)).toEqual({ via_third_party: null });
  });

  it("checks what the server would refuse, field by field", () => {
    const saved = paymentRouteDraft(transfer);
    expect(paymentRouteErrors(saved, ru)).toEqual({});
    expect(paymentRouteErrors({ ...saved, payment_method: "bitcoin" }, ru)).toHaveProperty("payment_method");
    expect(paymentRouteErrors({ ...saved, account_country: "Austria" }, ru)).toHaveProperty("account_country");
    expect(paymentRouteErrors({ ...saved, account_holder: "x".repeat(201) }, de).account_holder).toBe("Höchstens 200 Zeichen");
    expect(paymentRouteErrors({ ...saved, bank_name: "Bank\u0007" }, ru)).toHaveProperty("bank_name");
    // The description may run over lines, up to 2000 characters.
    expect(paymentRouteErrors({ ...saved, via_third_party_details: "a\nb" }, ru)).toEqual({});
    expect(paymentRouteErrors({ ...saved, via_third_party_details: "x".repeat(2001) }, ru)).toHaveProperty("via_third_party_details");
    // An older crypto answer is shown and kept while staff leave it alone.
    const crypto = paymentRouteDraft({ ...transfer, payment_method: "crypto" } as PayerDeclaration);
    expect(paymentRouteErrors(crypto, ru)).toEqual({});
    expect(paymentRoutePatch(crypto, crypto)).toEqual({});
  });

  it("names the route's author and the field a refused save names", () => {
    expect(paymentRouteSourceLabel("payer", ru)).toBe("указал плательщик");
    expect(paymentRouteSourceLabel("staff", ru)).toBe("внесено сотрудником");
    expect(paymentRouteSourceLabel("staff", de)).toBe("von GMED eingetragen");
    expect(paymentRouteSourceLabel(null, ru)).toBe("");
    const refused = new ApiRequestError("Use an ISO code", {
      status: 422,
      body: { error: "invalid_field", field: "account_country", message: "Use an ISO 3166-1 alpha-2 country code" },
    });
    expect(paymentRouteServerError(refused)).toEqual({
      field: "account_country",
      message: "Use an ISO 3166-1 alpha-2 country code",
    });
    expect(paymentRouteServerError(new ApiRequestError("Forbidden", { status: 403, body: { error: "forbidden" } }))).toBeNull();
    expect(paymentRouteServerError(new Error("x"))).toBeNull();
  });
});
