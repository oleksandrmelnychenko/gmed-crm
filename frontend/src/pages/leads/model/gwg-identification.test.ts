import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";
import type { DocumentItem } from "@/pages/documents/model/types";

import {
  currentGwgSheet,
  gwgRepresentativeSubject,
  gwgSheetErrorText,
  gwgSheetPlan,
  gwgSheetRequest,
  gwgSheetSubject,
  isOtherPersonUploadArt,
  isRepresentativeUploadArt,
} from "./gwg-identification";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const ANNA_ID = "11111111-1111-4111-8111-111111111111";
const BEN_ID = "22222222-2222-4222-8222-222222222222";
const ANNA = gwgRepresentativeSubject(ANNA_ID);
const BEN = gwgRepresentativeSubject(BEN_ID);

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

const sheetOf = (subject: string, overrides: Partial<DocumentItem> = {}) =>
  sheet({ generated_bindings: { gwg_identification: { subject } }, ...overrides });

describe("GwG identification sheet", () => {
  it("tells the patient's sheet from the payer's", () => {
    expect(gwgSheetSubject(sheet({}))).toBe("contract_partner");
    expect(gwgSheetSubject(sheet({ generated_bindings: { gwg_identification: { subject: "payer" } } }))).toBe("payer");
    expect(gwgSheetSubject(sheet({ generated_bindings: { gwg_identification: { subject: "contract_partner" } } }))).toBe(
      "contract_partner",
    );
  });

  it("knows the sheet of a legal representative by the binding", () => {
    expect(ANNA).toBe(`representative:${ANNA_ID}`);
    expect(gwgSheetSubject(sheetOf(ANNA))).toBe(ANNA);
    // A binding without an id is nobody's: it counts as the patient's, like other foreign documents.
    expect(gwgSheetSubject(sheetOf("representative:"))).toBe("contract_partner");
    expect(gwgSheetSubject(sheetOf("guardian"))).toBe("contract_partner");
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

  it("keeps the sheets of two parents apart", () => {
    const documents = [
      sheetOf(ANNA, { id: "anna-old", created_at: "2026-10-04T10:00:00Z" }),
      sheetOf(ANNA, { id: "anna-new", created_at: "2026-10-05T12:00:00Z" }),
      sheetOf(BEN, { id: "ben" }),
      // Made for the child before minors had sheets per representative.
      sheet({ id: "child" }),
    ];
    expect(currentGwgSheet(documents, ANNA)?.id).toBe("anna-new");
    expect(currentGwgSheet(documents, BEN)?.id).toBe("ben");
    expect(currentGwgSheet(documents, gwgRepresentativeSubject("33333333-3333-4333-8333-333333333333"))).toBeUndefined();
    expect(currentGwgSheet(documents, "contract_partner")?.id).toBe("child");
    expect(currentGwgSheet(documents, "payer")).toBeUndefined();
  });

  it("asks the server for the sheet of the lead without typing anything again", () => {
    expect(gwgSheetRequest({ leadId: "lead-1", subject: "contract_partner" })).toMatchObject({
      template_id: "gwg_identification",
      lead_id: "lead-1",
      language: "de",
      status: "active",
      bindings: { gwg_identification: { subject: "contract_partner" } },
    });
    expect(gwgSheetRequest({ leadId: "lead-1", subject: "contract_partner" }).auto_name).toBeUndefined();
    const payer = gwgSheetRequest({
      leadId: "lead-1",
      subject: "payer",
      orderId: "order-1",
      orderNumber: "A-1",
      replaceDocument: { id: "doc-9", order_id: "order-1" },
    });
    expect(payer).toMatchObject({
      order_id: "order-1",
      replace_document_id: "doc-9",
      auto_name: "Dokumentationsbogen natürliche Personen – Kostenübernehmer",
      bindings: { order_number: "A-1", gwg_identification: { subject: "payer" } },
    });
  });

  it("keeps the order context of the sheet it replaces, whoever made it", () => {
    // Made in the wizard with an order, replaced from the lead row without one.
    const fromRow = gwgSheetRequest({
      leadId: "lead-1",
      subject: "contract_partner",
      replaceDocument: { id: "doc-wizard", order_id: "order-1" },
    });
    expect(fromRow).toMatchObject({ order_id: "order-1", replace_document_id: "doc-wizard" });
    expect((fromRow.bindings as Record<string, unknown>).order_number).toBeUndefined();
    // Made from the lead row without an order, replaced in the wizard of an order.
    const fromWizard = gwgSheetRequest({
      leadId: "lead-1",
      subject: "contract_partner",
      orderId: "order-1",
      orderNumber: "A-1",
      replaceDocument: { id: "doc-row", order_id: null },
    });
    expect(fromWizard.order_id).toBeUndefined();
    expect(fromWizard.replace_document_id).toBe("doc-row");
    expect((fromWizard.bindings as Record<string, unknown>).order_number).toBeUndefined();
    // A first sheet takes the wizard's order.
    expect(gwgSheetRequest({ leadId: "lead-1", subject: "contract_partner", orderId: "order-1" }).order_id).toBe("order-1");
  });

  it("asks for the sheet of a legal representative, named after that person", () => {
    const request = gwgSheetRequest({
      leadId: "lead-1",
      subject: ANNA,
      personName: " Anna Muster ",
      replaceDocument: { id: "anna-new", order_id: null },
    });
    expect(request).toMatchObject({
      template_id: "gwg_identification",
      lead_id: "lead-1",
      replace_document_id: "anna-new",
      auto_name: "Dokumentationsbogen natürliche Personen – Anna Muster",
      bindings: { gwg_identification: { subject: `representative:${ANNA_ID}` } },
    });
    // Without a name the server names the document.
    expect(gwgSheetRequest({ leadId: "lead-1", subject: BEN }).auto_name).toBeUndefined();
    // A name never renames the patient's or the payer's sheet.
    expect(gwgSheetRequest({ leadId: "lead-1", subject: "contract_partner", personName: "Anna Muster" }).auto_name).toBeUndefined();
    expect(gwgSheetRequest({ leadId: "lead-1", subject: "payer", personName: "Anna Muster" }).auto_name).toBe(
      "Dokumentationsbogen natürliche Personen – Kostenübernehmer",
    );
  });
});

describe("uploads for a person who acts for the lead", () => {
  it("are told from the lead's own identity document by their type", () => {
    expect(isRepresentativeUploadArt("representative_identity")).toBe(true);
    expect(isRepresentativeUploadArt(" Representative_Authority ")).toBe(true);
    for (const art of ["identity", "passport", "", null, undefined]) {
      expect(isRepresentativeUploadArt(art)).toBe(false);
    }
  });

  it("are, with the payer's uploads on the payer link, another person's files, never the patient's", () => {
    for (const art of ["payer_identity", " Payer_Funds_Proof ", "representative_identity", "representative_authority"]) {
      expect(isOtherPersonUploadArt(art), art).toBe(true);
    }
    for (const art of ["identity", "passport", "aml_asset_origin_evidence", "", null, undefined]) {
      expect(isOtherPersonUploadArt(art)).toBe(false);
    }
    // The payer's files are not a representative's.
    expect(isRepresentativeUploadArt("payer_identity")).toBe(false);
  });
});

describe("which sheets the wizard offers", () => {
  const parents = [
    { id: ANNA_ID, name: "Anna Muster" },
    { id: BEN_ID, name: " Ben Muster " },
  ];
  const person = { payer_kind: "third_party", payer_type: "person" };

  it("offers an adult the own sheet and, for a private third-party payer, the payer's", () => {
    expect(gwgSheetPlan({ minor: false, representatives: [], payer: null })).toEqual({
      buttons: [{ subject: "contract_partner", personName: "" }],
      lacksRepresentative: false,
      payerIsOrganisation: false,
      payerSamePersonName: null,
    });
    expect(gwgSheetPlan({ minor: false, representatives: [], payer: { payer_kind: "self" } }).buttons).toEqual([
      { subject: "contract_partner", personName: "" },
    ]);
    // A declaration stored before the payer type existed is a private person.
    for (const payer of [person, { payer_kind: "third_party" }, { payer_kind: "third_party", payer_type: null }]) {
      expect(gwgSheetPlan({ minor: false, representatives: [], payer }).buttons).toEqual([
        { subject: "contract_partner", personName: "" },
        { subject: "payer", personName: "" },
      ]);
    }
    // An adult's representative or Betreuer is named on the lead's own sheet.
    expect(gwgSheetPlan({ minor: false, representatives: parents, payer: null }).buttons).toEqual([
      { subject: "contract_partner", personName: "" },
    ]);
  });

  it("makes no sheet for natural persons for an organisation", () => {
    const plan = gwgSheetPlan({
      minor: false,
      representatives: [],
      payer: { payer_kind: "third_party", payer_type: "company" },
    });
    expect(plan.buttons).toEqual([{ subject: "contract_partner", personName: "" }]);
    expect(plan.payerIsOrganisation).toBe(true);
    // The type of a payer that is no longer a third party does not matter.
    expect(gwgSheetPlan({ minor: false, representatives: [], payer: { payer_kind: "self", payer_type: "company" } }).payerIsOrganisation)
      .toBe(false);
  });

  it("offers a minor one sheet per legal representative and none for the child", () => {
    const plan = gwgSheetPlan({ minor: true, representatives: parents, payer: { payer_kind: "self" } });
    expect(plan.buttons).toEqual([
      { subject: ANNA, personName: "Anna Muster" },
      { subject: BEN, personName: "Ben Muster" },
    ]);
    expect(plan.lacksRepresentative).toBe(false);
  });

  it("keeps the payer's sheet for a minor whose payer is somebody else", () => {
    const plan = gwgSheetPlan({ minor: true, representatives: parents, payer: person, payerSamePersonName: null });
    expect(plan.buttons.map((button) => button.subject)).toEqual([ANNA, BEN, "payer"]);
    expect(plan.payerSamePersonName).toBeNull();
  });

  it("leaves out the payer's sheet when the payer is one of the representatives", () => {
    const plan = gwgSheetPlan({
      minor: true,
      representatives: parents,
      payer: person,
      payerSamePersonName: "Anna Muster",
    });
    expect(plan.buttons.map((button) => button.subject)).toEqual([ANNA, BEN]);
    expect(plan.payerSamePersonName).toBe("Anna Muster");
    // "The same person" exists for a private payer of a minor only.
    expect(gwgSheetPlan({ minor: false, representatives: [], payer: person, payerSamePersonName: "Anna Muster" }).buttons)
      .toEqual([
        { subject: "contract_partner", personName: "" },
        { subject: "payer", personName: "" },
      ]);
    const organisation = gwgSheetPlan({
      minor: true,
      representatives: parents,
      payer: { payer_kind: "third_party", payer_type: "insurance" },
      payerSamePersonName: "Anna Muster",
    });
    expect(organisation.payerSamePersonName).toBeNull();
    expect(organisation.payerIsOrganisation).toBe(true);
  });

  it("holds the payer's sheet of a minor back until it is known whether the payer is a representative", () => {
    const loading = gwgSheetPlan({ minor: true, representatives: parents, payer: person, payerSamePersonUnknown: true });
    expect(loading.buttons.map((button) => button.subject)).toEqual([ANNA, BEN]);
    // Nothing is claimed about the payer meanwhile.
    expect(loading.payerSamePersonName).toBeNull();
    // An adult's payer is never a representative: nothing to wait for.
    expect(
      gwgSheetPlan({ minor: false, representatives: [], payer: person, payerSamePersonUnknown: true }).buttons.map(
        (button) => button.subject,
      ),
    ).toEqual(["contract_partner", "payer"]);
  });

  it("has nothing to make for a minor without a parent or guardian", () => {
    const plan = gwgSheetPlan({ minor: true, representatives: [], payer: null });
    expect(plan.buttons).toEqual([]);
    expect(plan.lacksRepresentative).toBe(true);
    // The payer can still get a sheet.
    expect(gwgSheetPlan({ minor: true, representatives: [], payer: person }).buttons).toEqual([
      { subject: "payer", personName: "" },
    ]);
  });
});

describe("refusals of the server to make a sheet", () => {
  const refusal = (code: string) =>
    new ApiRequestError(code, { status: 422, code, body: { error: code, code } });

  it("explains each refusal in the user's language", () => {
    expect(gwgSheetErrorText(refusal("minor_sheet_per_representative"), ru)).toContain(
      "лист формируется на каждого законного представителя",
    );
    expect(gwgSheetErrorText(refusal("minor_sheet_per_representative"), de)).toContain(
      "je gesetzlicher Vertreterin / gesetzlichem Vertreter",
    );
    expect(gwgSheetErrorText(refusal("representative_sheet_not_available"), ru)).toContain(
      "не числится законным представителем несовершеннолетнего",
    );
    expect(gwgSheetErrorText(refusal("representative_sheet_not_available"), de)).toContain(
      "nicht als gesetzliche Vertretung eines Minderjährigen erfasst",
    );
    expect(gwgSheetErrorText(refusal("payer_is_not_a_natural_person"), ru)).toBe(
      "Для организации лист для физических лиц не формируется",
    );
  });

  it("reads the code from either key of the answer", () => {
    const onlyCode = new ApiRequestError("Unprocessable", { status: 422, body: { code: "minor_sheet_per_representative" } });
    expect(gwgSheetErrorText(onlyCode, ru)).not.toBeNull();
    const onlyError = new ApiRequestError("Unprocessable", { status: 422, body: { error: "representative_sheet_not_available" } });
    expect(gwgSheetErrorText(onlyError, ru)).not.toBeNull();
  });

  it("leaves other errors to the usual wording", () => {
    expect(gwgSheetErrorText(refusal("lead_converted"), ru)).toBeNull();
    expect(gwgSheetErrorText(new Error("minor_sheet_per_representative"), ru)).toBeNull();
    expect(gwgSheetErrorText(null, ru)).toBeNull();
  });
});
