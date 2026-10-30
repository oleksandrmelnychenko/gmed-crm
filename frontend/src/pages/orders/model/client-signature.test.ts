import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { ORDER_API_ERROR_KEYS } from "@/lib/order-api-errors";

import {
  SignedTermsChangeCancelled,
  clientSignatureNote,
  documentMatchesOrderTerms,
  isSignedTermsChange,
  signedTermsChangeConfirmText,
  withSignedTermsConfirmation,
} from "./client-signature";
import type { OrderClientSignature } from "./types";

const refusal = () => new ApiRequestError("Клиент подписал заказ …", {
  status: 409,
  code: "order_signed_terms_change",
  body: {
    error: "order_signed_terms_change",
    signed_total_label: "889,15 €",
    new_total_label: "1.002,20 €",
  },
});

const signature = (overrides: Partial<OrderClientSignature> = {}): OrderClientSignature => ({
  signed_total: "889.15",
  signed_date_from: "2026-10-25",
  signed_date_to: "2026-10-30",
  signed_at: "2026-10-12T10:00:00Z",
  signed_document_id: "doc-1",
  terms_changed_at: null,
  changes_await_signature: false,
  ...overrides,
});

describe("the client's signature covers the signed terms (QA C3-01)", () => {
  it("has a German and a Russian text for both refusals", () => {
    for (const code of ["order_signed_terms_change", "order_document_outdated"]) {
      const key = ORDER_API_ERROR_KEYS[code];
      expect(t("de").uiText[key], code).toBeTruthy();
      expect(t("ru").uiText[key], code).toBeTruthy();
    }
    expect(t("ru").uiText.api_orders_signed_terms_change).toContain("{signed_total_label}");
    expect(t("de").uiText.api_orders_signed_terms_change).toContain("{new_total_label}");
  });

  it("recognises only the refusal of a signed terms change", () => {
    expect(isSignedTermsChange(refusal())).toBe(true);
    expect(isSignedTermsChange(new ApiRequestError("x", { status: 409, code: "other" }))).toBe(false);
    expect(isSignedTermsChange(new Error("x"))).toBe(false);
  });

  it("sends the change again with the confirmation after a yes", async () => {
    const attempt = vi.fn(async (confirm: boolean) => {
      if (!confirm) throw refusal();
      return "saved";
    });
    const ask = vi.fn(() => true);
    await expect(withSignedTermsConfirmation(attempt, ask)).resolves.toBe("saved");
    expect(attempt.mock.calls).toEqual([[false], [true]]);
    expect(ask).toHaveBeenCalledOnce();
  });

  it("keeps the signature after a no and does not resend", async () => {
    const attempt = vi.fn(async () => {
      throw refusal();
    });
    await expect(withSignedTermsConfirmation(attempt, () => false)).rejects.toBeInstanceOf(
      SignedTermsChangeCancelled,
    );
    expect(attempt).toHaveBeenCalledOnce();
  });

  it("passes other errors through without asking", async () => {
    const ask = vi.fn(() => true);
    await expect(
      withSignedTermsConfirmation(async () => {
        throw new Error("network");
      }, ask),
    ).rejects.toThrow("network");
    expect(ask).not.toHaveBeenCalled();
  });

  it("names the signed total and the screen's own new total", () => {
    const text = signedTermsChangeConfirmText(refusal(), 1317.55);
    expect(text).toContain("889,15");
    expect(text).toMatch(/1\.317,55/);
    expect(signedTermsChangeConfirmText(refusal(), null)).toMatch(/1\.002,20/);
  });

  it("counts only order documents made after the last change of the terms", () => {
    expect(documentMatchesOrderTerms("2026-10-12T09:00:00Z", null)).toBe(true);
    expect(documentMatchesOrderTerms("2026-10-12T09:00:00Z", "2026-10-12T10:00:00Z")).toBe(false);
    expect(documentMatchesOrderTerms("2026-10-12T11:00:00Z", "2026-10-12T10:00:00Z")).toBe(true);
    expect(documentMatchesOrderTerms(null, "2026-10-12T10:00:00Z")).toBe(false);
    // Made at the moment of the change counts, as on the server (documents.rs sets it so).
    expect(documentMatchesOrderTerms("2026-10-12T10:00:00Z", "2026-10-12T10:00:00Z")).toBe(true);
  });

  it("says that changes wait for the client's signature after a reset", () => {
    const note = clientSignatureNote(
      signature({ terms_changed_at: "2026-10-12T11:00:00Z", changes_await_signature: true }),
      false,
      "1002.20",
      "EUR",
    );
    expect(note?.tone).toBe("warning");
    expect(note?.text).toContain("889,15");
    expect(note?.text).toContain("12.10.2026");
  });

  it("shows the signed total next to billing actuals and nothing when they match", () => {
    const actuals = clientSignatureNote(signature(), true, "1147.98", "EUR");
    expect(actuals?.tone).toBe("info");
    expect(actuals?.text).toContain("889,15");
    expect(actuals?.text).toMatch(/1\.147,98/);
    expect(clientSignatureNote(signature(), true, "889.15", "EUR")).toBeNull();
    expect(clientSignatureNote(null, true, "889.15", "EUR")).toBeNull();
  });
});
