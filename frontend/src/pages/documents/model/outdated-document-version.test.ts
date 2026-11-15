import { describe, expect, it } from "vitest";

import type { DocumentItem, DocumentTemplate } from "./types";
import { buildGenerateDocumentPayload } from "./document-model";
import {
  isOutdatedCurrentVersion,
  oneClickReplacementForm,
  outdatedDocumentIds,
  regeneratesInOneClick,
} from "./outdated-document-version";
import { previousRequestSigners } from "../ui/document-signature-panel";

const template = {
  id: "single_order",
  label: "Einzelauftrag",
  default_auto_name: "Einzelauftrag",
  default_status: "active",
  default_visibility: "patient_visible",
  supported_languages: ["de"],
  text_block_keys: [],
  art: "single_order",
  category: "contract",
} as unknown as DocumentTemplate;

const outdated = {
  id: "doc-1",
  patient_id: "patient-1",
  order_id: "order-1",
  appointment_id: null,
  status: "active",
  visibility: "patient_visible",
  is_latest_version: true,
  terms_current: false,
  generated_template_id: "single_order",
  document_language: "de",
  access_category: "patient",
  klinik: null,
  source_person: null,
  source_institution: "GMED",
  addressee_person: "Old Payer",
  addressee_institution: null,
  generated_bindings: {
    payer_name: "Old Payer",
    period_from: "2026-10-01",
    party_sign_place: "Berlin",
    order_sequence: 2,
  },
} as unknown as DocumentItem;

describe("outdated document version", () => {
  it("is outdated only as the newest, not archived version with stale terms", () => {
    expect(isOutdatedCurrentVersion(outdated)).toBe(true);
    expect(isOutdatedCurrentVersion({ ...outdated, is_latest_version: false })).toBe(false);
    expect(isOutdatedCurrentVersion({ ...outdated, status: "archived" })).toBe(false);
    expect(isOutdatedCurrentVersion({ ...outdated, terms_current: null })).toBe(false);
    // The patient card lists only latest versions and sends no flag.
    expect(isOutdatedCurrentVersion({ terms_current: false, status: "active" })).toBe(true);
    expect(outdatedDocumentIds([outdated, { ...outdated, id: "doc-2", terms_current: true }])).toEqual(["doc-1"]);
  });

  it("makes the order documents in one click", () => {
    expect(regeneratesInOneClick("single_order")).toBe(true);
    expect(regeneratesInOneClick("order_cost_estimate")).toBe(true);
    expect(regeneratesInOneClick("framework_contract")).toBe(true);
    expect(regeneratesInOneClick("free_text_document")).toBe(false);
    expect(regeneratesInOneClick(null)).toBe(false);
  });

  it("replaces the outdated version without carrying old payer or order data", () => {
    const payload = buildGenerateDocumentPayload({ template, form: oneClickReplacementForm(outdated, template) });
    expect(payload).toMatchObject({
      template_id: "single_order",
      patient_id: "patient-1",
      order_id: "order-1",
      appointment_id: null,
      replace_document_id: "doc-1",
      language: "de",
      addressee_person: null,
    });
    expect(payload.bindings).toEqual({ party_sign_place: "Berlin" });
  });

  it("suggests the recipients of the previous request without its frames", () => {
    expect(previousRequestSigners({
      requests: [
        { signers: [{ first_name: "Anna", last_name: "Test", email: "anna@example.test", role: "client", positions: [{}] }] },
        { signers: [{ first_name: "Old", last_name: "Request", email: "old@example.test", role: "client" }] },
      ],
    } as never)).toEqual([{ first_name: "Anna", last_name: "Test", email: "anna@example.test", role: "client" }]);
    expect(previousRequestSigners(null)).toEqual([]);
  });
});
