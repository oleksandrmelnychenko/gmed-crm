import { describe, expect, it } from "vitest";

import { ordersUiDe, ordersUiRu } from "@/lib/i18n/catalogs/orders-ui";
import { ORDER_API_ERROR_KEYS } from "@/lib/order-api-errors";

import { currentEstimateDocument, estimateConfirmationStep } from "./estimate-confirmation";

const unsigned = { id: "kv-1", created_at: "2026-11-10T09:00:00Z", signed_at: null };
const signed = { id: "kv-2", created_at: "2026-11-11T09:00:00Z", signed_at: "2026-11-11T10:00:00Z" };

describe("estimate confirmation", () => {
  it("asks for the estimate document before anything can be signed", () => {
    expect(estimateConfirmationStep(false, null)).toBe("needs_document");
  });

  it("an unsigned estimate waits for the signature, never for a click", () => {
    expect(estimateConfirmationStep(false, unsigned)).toBe("sign");
  });

  it("a signed estimate may confirm a quote made anew for it", () => {
    expect(estimateConfirmationStep(false, signed)).toBe("confirm_signed");
  });

  it("an accepted quote needs nothing more", () => {
    expect(estimateConfirmationStep(true, unsigned)).toBe("accepted");
    expect(estimateConfirmationStep(true, null)).toBe("accepted");
  });

  it("takes the newest estimate document", () => {
    expect(currentEstimateDocument([unsigned, signed])?.id).toBe("kv-2");
    expect(currentEstimateDocument([signed, unsigned])?.id).toBe("kv-2");
    expect(currentEstimateDocument([])).toBeNull();
  });

  it("names the refusals of the server in words", () => {
    for (const [code, key] of [
      ["estimate_signature_required", "api_quotes_signature_required"],
      ["quote_expired", "api_quotes_expired"],
      ["quote_rejected", "api_quotes_rejected"],
    ] as const) {
      expect(ORDER_API_ERROR_KEYS[code]).toBe(key);
      expect(ordersUiRu[key]).toBeTruthy();
      expect(ordersUiDe[key]).toBeTruthy();
    }
  });
});
