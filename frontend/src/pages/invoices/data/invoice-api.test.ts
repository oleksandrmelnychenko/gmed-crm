import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { createInvoice } from "./invoice-api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), apiFetchFile: vi.fn() }));
const request = vi.mocked(apiFetch);
const payload = { invoice_type: "final", line_items: [{ line_index: 0, quantity: 1 }] };

beforeEach(() => { request.mockReset(); });

describe("invoice creation", () => {
  it("posts to the selected quote without an accounting release check", async () => {
    request.mockResolvedValueOnce({ id: "invoice-1" });
    await expect(createInvoice("quote-1", payload)).resolves.toEqual({ id: "invoice-1" });
    expect(request).toHaveBeenCalledExactlyOnceWith("/quotes/quote-1/invoices", { method: "POST", body: JSON.stringify(payload) });
  });
});
