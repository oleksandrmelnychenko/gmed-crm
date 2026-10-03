import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { normalizeLeadPortalIntake, type LeadPortalIntake } from "../data/lead-portal-intake-api";
import { PATIENT_FILLED_KEYS, PORTAL_FIELD_BY_DRAFT_KEY } from "../model/lead-portal-intake";
import {
  PatientUploadMark,
  PortalInquiryConsentLine,
  PortalUploadsProvider,
  Step1FillModeSwitch,
  Step1PortalFieldNote,
  Step1PortalProvider,
} from "./lead-wizard-portal-intake";

const tx = (ru: string) => ru;

const intake = normalizeLeadPortalIntake({
  lead_id: "lead-1",
  fill_mode: "patient",
  patient_fields: { date_of_birth: { at: "2026-10-03T08:15:00Z", access_kind: "self" } },
  progress: { filled: 5, total: 11, documents: 1, submitted_at: null },
  consents: [
    { id: "c1", type: "lead_inquiry_processing", given_at: "2026-10-03T09:00:00Z", revoked_at: null, version: "2026-10-03", access_kind: "self" },
  ],
  uploads: [
    {
      document_id: "doc-1",
      uploaded_at: "2026-10-03T09:10:00Z",
      access_kind: "self",
      reviewed_at: null,
      consent_given_at: "2026-10-03T09:05:00Z",
      consent_revoked_at: null,
      consent_version: "2026-10-03",
    },
  ],
  guardians: { links: [], candidates: [] },
}) as LeadPortalIntake;

const errorIds = { birthDate: "birth-error", city: "city-error", firstName: "first-error" };

function note(mode: "staff" | "patient", props: { errorId?: string; portalField?: string }) {
  return renderToStaticMarkup(
    <Step1PortalProvider
      mode={mode}
      intake={intake}
      errorIdByDraftKey={errorIds}
      patientFilledKeys={PATIENT_FILLED_KEYS}
      portalFieldByDraftKey={PORTAL_FIELD_BY_DRAFT_KEY}
      tx={tx}
    >
      <Step1PortalFieldNote {...props} />
    </Step1PortalProvider>,
  );
}

describe("wizard step 1 and the patient portal", () => {
  it("marks fields the patient entered and hints the ones the patient still fills in", () => {
    expect(note("patient", { errorId: "birth-error" })).toContain("от пациента");
    expect(note("patient", { errorId: "city-error" })).toContain("заполнит пациент в портале");
    expect(note("patient", { portalField: "country" })).toContain("заполнит пациент в портале");
    // Names stay with staff; in "I fill it in" mode there is no hint.
    expect(note("patient", { errorId: "first-error" })).toBe("");
    expect(note("staff", { errorId: "city-error" })).toBe("");
    // The marker shows in both modes.
    expect(note("staff", { errorId: "birth-error" })).toContain("от пациента");
  });

  it("offers the two fill modes", () => {
    const html = renderToStaticMarkup(<Step1FillModeSwitch mode="patient" onChange={() => {}} tx={tx} />);
    expect(html).toContain("Заполняю сам");
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Заполнит пациент");
  });

  it("labels patient uploads with the consent mark and the portal consent of the request", () => {
    const html = renderToStaticMarkup(
      <PortalUploadsProvider intake={intake} canReview onReviewed={() => {}}>
        <PatientUploadMark documentId="doc-1" lang="ru" />
        <PatientUploadMark documentId="other" lang="ru" />
      </PortalUploadsProvider>,
    );
    expect(html).toContain("Загружено пациентом");
    expect(html).toContain("Согласие ст. 9 ✓");
    expect(html).toContain("Отметить просмотренным");
    expect(html.match(/patient-upload-mark/g)).toHaveLength(1);

    const consent = renderToStaticMarkup(<PortalInquiryConsentLine intake={intake} tx={tx} />);
    expect(consent).toContain("Согласие на обработку данных обращения (портал) ✓");
  });

  it("ignores an answer that is not a portal state", () => {
    expect(normalizeLeadPortalIntake([])).toBeNull();
    expect(normalizeLeadPortalIntake({ lead_id: "x" })?.uploads).toEqual([]);
  });
});
