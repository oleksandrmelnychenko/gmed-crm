import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DocumentItem } from "@/pages/documents/model/types";

import { normalizeLeadPortalIntake } from "../data/lead-portal-intake-api";
import {
  identityDocumentDatesInvalid,
  identityDocumentDraft,
  identityDocumentDraftChanged,
  identityDocumentEnteredLine,
  identityDocumentExpired,
  identityDocumentInput,
} from "../model/lead-identity-document-data";
import { LeadIdentityDocumentData, LeadIdentityDocumentDataForm } from "./lead-identity-document-data";
import { LeadPatientConcern, patientConcernTransferMode } from "./lead-patient-concern";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

/** The date inputs need the pickers' adapter, as in the app. */
const withPickers = (node: ReactNode) =>
  renderToStaticMarkup(<LocalizationProvider dateAdapter={AdapterDayjs}>{node}</LocalizationProvider>);

const stored = {
  id_document_type: "passport",
  id_document_number: "FA1234567",
  id_issuing_authority: "Passamt 8031",
  id_issuing_country: "ua",
  id_issued_on: "2015-05-01",
  id_valid_until: "2025-04-30",
  id_document_unreadable: true,
  id_data_entered_by_name: "Ben Muster",
  id_data_entered_at: "2026-10-07T10:00:00Z",
};

describe("identity document data entered by staff", () => {
  it("turns the stored data into form values and back into the PUT body", () => {
    const draft = identityDocumentDraft(stored);
    expect(draft).toEqual({
      type: "passport",
      number: "FA1234567",
      authority: "Passamt 8031",
      country: "UA",
      issuedOn: "2015-05-01",
      validUntil: "2025-04-30",
      unreadable: true,
    });
    expect(identityDocumentInput({ ...draft, number: "  ", authority: " Passamt " })).toEqual({
      id_document_type: "passport",
      id_document_number: null,
      id_issuing_authority: "Passamt",
      id_issuing_country: "UA",
      id_issued_on: "2015-05-01",
      id_valid_until: "2025-04-30",
      id_document_unreadable: true,
    });
    expect(identityDocumentDraftChanged(draft, identityDocumentDraft(stored))).toBe(false);
    expect(identityDocumentDraftChanged({ ...draft, unreadable: false }, draft)).toBe(true);
  });

  it("takes the old 'valid until' of the wizard while nothing is stored", () => {
    expect(identityDocumentDraft(null, "2030-01-31").validUntil).toBe("2030-01-31");
    expect(identityDocumentDraft(stored, "2030-01-31").validUntil).toBe("2025-04-30");
  });

  it("accepts a past expiry (it is a trigger) and flags dates in the wrong order", () => {
    const draft = identityDocumentDraft(stored);
    expect(identityDocumentExpired(draft, "2026-10-07")).toBe(true);
    expect(identityDocumentExpired({ ...draft, validUntil: "2031-01-01" }, "2026-10-07")).toBe(false);
    expect(identityDocumentDatesInvalid({ ...draft, issuedOn: "2026-01-01", validUntil: "2025-01-01" })).toBe(true);
    expect(identityDocumentDatesInvalid(draft)).toBe(false);
  });

  it("says who entered the data", () => {
    expect(identityDocumentEnteredLine(stored, de)).toBe("Erfasst von: Ben Muster · 07.10.2026 12:00");
    expect(identityDocumentEnteredLine({}, ru)).toBe("");
  });

  it("renders the form with every field, the expiry warning and the unreadable box", () => {
    const html = withPickers(
      <LeadIdentityDocumentDataForm source={stored} save={async () => undefined} tx={ru} lang="ru" testId="lead-id-data" today="2026-10-07" />,
    );
    for (const name of ["id_document_type", "id_document_number", "id_issuing_authority", "id_issued_on", "id_valid_until", "id_document_unreadable"]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain("Страна выдачи");
    expect(html).toContain("Документ нечитаем");
    expect(html).toContain("lead-id-data-expired");
    expect(html).toContain("Внесено сотрудником: Ben Muster · 07.10.2026 12:00");
    // Nothing changed yet: nothing to save.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="lead-id-data-save"/);
  });

  it("adds one form per representative and hides everything from a role without the GwG data", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "lead-1",
      identification: { id_valid_until: "2031-04-30" },
      representation: {
        has_representative: true,
        under_guardianship: false,
        representatives: [{ id: "rep-1", role: "authorised_representative", first_name: "Mia", last_name: "Muster", identity_documents: [] }],
      },
    });
    const html = withPickers(
      <LeadIdentityDocumentData leadId="lead-1" intake={intake} tx={de} lang="de" onSaved={() => undefined} />,
    );
    expect(html).toContain("lead-representatives-id-data");
    expect(html).toContain("Mia Muster");
    expect(html).toContain("lead-representative-id-data-rep-1");
    const hidden = normalizeLeadPortalIntake({ lead_id: "lead-1", identification_hidden: true });
    expect(
      renderToStaticMarkup(<LeadIdentityDocumentData leadId="lead-1" intake={hidden} tx={de} lang="de" onSaved={() => undefined} />),
    ).toBe("");
  });
});

describe("«Со слов пациента» in the medical step", () => {
  const reason = { text: "Schmerzen im Knie seit März", updated_at: "2026-10-07T08:00:00Z" };
  const file = {
    id: "doc-m1",
    original_filename: "mrt-befund.pdf",
    auto_name: "Befund",
    created_at: "2026-10-06T09:00:00Z",
  } as DocumentItem;

  it("fills an empty concern at once, asks before replacing, and knows when it is the same text", () => {
    expect(patientConcernTransferMode(reason, "")).toBe("fill");
    expect(patientConcernTransferMode(reason, "Knie rechts")).toBe("replace");
    expect(patientConcernTransferMode(reason, " Schmerzen im Knie seit März ")).toBe("same");
    expect(patientConcernTransferMode(null, "")).toBe("none");
  });

  it("shows the lead's text with the date, the transfer button and the lead's files", () => {
    const html = renderToStaticMarkup(
      <LeadPatientConcern
        reason={reason}
        documents={[file]}
        currentConcern=""
        onTransfer={() => undefined}
        onOpen={() => undefined}
        onDownload={() => undefined}
        tx={ru}
      />,
    );
    expect(html).toContain("Со слов пациента");
    expect(html).toContain("07.10.2026 10:00");
    expect(html).toContain("Schmerzen im Knie seit März");
    expect(html).toContain("Перенести в причину обращения");
    expect(html).toContain("mrt-befund.pdf");
    expect(html).toContain("06.10.2026");
    expect(html).toContain("Открыть: mrt-befund.pdf");
    expect(html).toContain("Скачать: mrt-befund.pdf");
  });

  it("is nothing when the lead entered nothing", () => {
    expect(
      renderToStaticMarkup(
        <LeadPatientConcern
          reason={null}
          documents={[]}
          currentConcern=""
          onTransfer={() => undefined}
          onOpen={() => undefined}
          onDownload={() => undefined}
          tx={de}
        />,
      ),
    ).toBe("");
  });
});
