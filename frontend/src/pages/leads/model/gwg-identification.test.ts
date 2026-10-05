import { describe, expect, it } from "vitest";

import type { DocumentItem } from "@/pages/documents/model/types";

import { currentGwgSheet, gwgSheetRequest, gwgSheetSubject } from "./gwg-identification";

function sheet(overrides: Partial<DocumentItem>): DocumentItem {
  return {
    id: "doc",
    generated_template_id: "gwg_identification",
    generated_bindings: null,
    file_deleted_at: null,
    is_latest_version: true,
    created_at: "2026-10-05T10:00:00Z",
    ...overrides,
  } as DocumentItem;
}

describe("GwG identification sheet", () => {
  it("tells the patient's sheet from the payer's", () => {
    expect(gwgSheetSubject(sheet({}))).toBe("contract_partner");
    expect(gwgSheetSubject(sheet({ generated_bindings: { gwg_identification: { subject: "payer" } } }))).toBe("payer");
    expect(gwgSheetSubject(sheet({ generated_bindings: { gwg_identification: { subject: "contract_partner" } } }))).toBe(
      "contract_partner",
    );
  });

  it("finds the current sheet of one person, which a new one replaces", () => {
    const documents = [
      sheet({ id: "old", created_at: "2026-10-04T10:00:00Z" }),
      sheet({ id: "new", created_at: "2026-10-05T12:00:00Z" }),
      sheet({ id: "payer", generated_bindings: { gwg_identification: { subject: "payer" } } }),
      sheet({ id: "superseded", is_latest_version: false, created_at: "2026-10-06T10:00:00Z" }),
      sheet({ id: "deleted", file_deleted_at: "2026-10-06T11:00:00Z", created_at: "2026-10-06T10:30:00Z" }),
      sheet({ id: "other", generated_template_id: "enhanced_due_diligence", created_at: "2026-10-07T10:00:00Z" }),
    ];
    expect(currentGwgSheet(documents, "contract_partner")?.id).toBe("new");
    expect(currentGwgSheet(documents, "payer")?.id).toBe("payer");
    expect(currentGwgSheet([], "payer")).toBeUndefined();
  });

  it("asks the server for the sheet of the lead without typing anything again", () => {
    expect(gwgSheetRequest({ leadId: "lead-1", subject: "contract_partner" })).toMatchObject({
      template_id: "gwg_identification",
      lead_id: "lead-1",
      language: "de",
      status: "active",
      bindings: { gwg_identification: { subject: "contract_partner" } },
    });
    const payer = gwgSheetRequest({
      leadId: "lead-1",
      subject: "payer",
      orderId: "order-1",
      orderNumber: "A-1",
      replaceDocumentId: "doc-9",
    });
    expect(payer).toMatchObject({
      order_id: "order-1",
      replace_document_id: "doc-9",
      auto_name: "Dokumentationsbogen natürliche Personen – Kostenübernehmer",
      bindings: { order_number: "A-1", gwg_identification: { subject: "payer" } },
    });
  });
});
