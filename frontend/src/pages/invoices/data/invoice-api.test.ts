import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { createInvoice, grantInvoiceBillingRelease } from "./invoice-api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), apiFetchFile: vi.fn() }));
const request = vi.mocked(apiFetch);
const payload = { invoice_type: "final", line_items: [{ line_index: 0, quantity: 1 }] };

beforeEach(() => { request.mockReset(); });

describe("invoice billing preflight", () => {
  it.each(["pending", "denied"])("does not create an invoice when the current release is %s", async (status) => {
    request.mockResolvedValue({ process_gates: { billing_release_status: status, package_coverage_status: "covered" } });
    await expect(createInvoice("quote-1", payload, "order-1")).rejects.toThrow("billing release");
    expect(request).toHaveBeenCalledExactlyOnceWith("/orders/order-1", { forceFresh: true });
  });

  it("checks a fresh release before posting to the selected quote", async () => {
    request.mockResolvedValueOnce({ process_gates: { billing_release_status: "granted" } });
    request.mockResolvedValueOnce({ id: "invoice-1" });
    await expect(createInvoice("quote-1", payload, "order-1")).resolves.toEqual({ id: "invoice-1" });
    expect(request).toHaveBeenNthCalledWith(1, "/orders/order-1", { forceFresh: true });
    expect(request).toHaveBeenNthCalledWith(2, "/quotes/quote-1/invoices", { method: "POST", body: JSON.stringify(payload) });
  });

  it.each([{}, { process_gates: null }, { process_gates: { billing_release_status: "unknown" } }])("blocks creation when release data is unavailable", async (order) => {
    request.mockResolvedValue(order);
    await expect(createInvoice("quote-1", payload, "order-1")).rejects.toThrow("invoice_billing_release_unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not post an invoice when checking the order fails", async () => {
    request.mockRejectedValue(new Error("Network unavailable"));
    await expect(createInvoice("quote-1", payload, "order-1")).rejects.toThrow("Network unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("grants the order release separately and preserves the existing note", async () => {
    request.mockResolvedValue(undefined);
    await grantInvoiceBillingRelease("order-1", "Reviewed by accounting");
    expect(request).toHaveBeenCalledExactlyOnceWith("/orders/order-1/process-gates", {
      method: "POST", body: JSON.stringify({ billing_release_status: "granted", billing_release_note: "Reviewed by accounting" }),
    });
  });
});
