import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { createInvoice, mergeQuoteOptions, updateInvoiceLineComments } from "./invoice-api";
import type { QuoteOption } from "../model/types";

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

describe("invoice line remarks", () => {
  it("posts the remarks of a draft, null clearing one", async () => {
    request.mockResolvedValueOnce({ id: "invoice-1" });
    const comments = [{ line_index: 0, comment: "2. und 3. Quartal 2026" }, { line_index: 1, comment: null }];
    await expect(updateInvoiceLineComments("invoice-1", comments)).resolves.toEqual({ id: "invoice-1" });
    expect(request).toHaveBeenCalledExactlyOnceWith("/invoices/invoice-1/line-comments", { method: "POST", body: JSON.stringify({ comments }) });
  });
});

describe("invoice quote lookups", () => {
  it("keeps open quotes that fell out of the capped recent list, once each", () => {
    const quote = (id: string) => ({ id }) as QuoteOption;
    expect(mergeQuoteOptions([quote("new"), quote("open")], [quote("open"), quote("old-open")]).map((item) => item.id))
      .toEqual(["new", "open", "old-open"]);
  });
});
