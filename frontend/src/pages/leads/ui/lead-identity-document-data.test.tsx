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
  identityDocumentFieldErrors,
  identityDocumentInput,
  identityDocumentMissing,
  identityDocumentSourceIsStale,
  identityDocumentStatus,
  identityDocumentStatusText,
  identityFieldErrorText,
  normalizeDocumentNumber,
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

  it("renders the form with every field, one status line and the unreadable box", () => {
    const html = withPickers(
      <LeadIdentityDocumentDataForm source={stored} save={async () => undefined} tx={ru} lang="ru" testId="lead-id-data" today="2026-10-07" />,
    );
    for (const name of ["id_document_type", "id_document_number", "id_issuing_authority", "id_issued_on", "id_valid_until", "id_document_unreadable"]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain("Страна выдачи");
    expect(html).toContain("Документ нечитаем");
    // Unreadable comes first: a new scan is the next step.
    expect(html).toContain("Документ нечитаем: запросите новый скан");
    expect(html).toContain("Внесено сотрудником: Ben Muster · 07.10.2026 12:00");
    // Nothing changed yet: no save button, no "unsaved".
    expect(html).not.toContain("lead-id-data-save");
    expect(html).not.toContain("lead-id-data-unsaved");

    const readable = withPickers(
      <LeadIdentityDocumentDataForm
        source={{ ...stored, id_document_unreadable: false }}
        save={async () => undefined}
        tx={de}
        lang="de"
        testId="lead-id-data"
        today="2026-10-07"
      />,
    );
    expect(readable).toContain("lead-id-data-expired");
    expect(readable).toContain("Ausweis abgelaufen seit 30.04.2025");
    expect(readable).toContain('data-status="expired"');
  });

  it("checks each field like the server and names what is missing", () => {
    const draft = identityDocumentDraft({ ...stored, id_document_unreadable: false });
    const rules = { today: "2026-10-07", birthDate: "1990-05-01" };
    expect(identityDocumentFieldErrors(draft, rules)).toEqual({});
    expect(normalizeDocumentNumber("  fa  123 4567 ")).toBe("FA 123 4567");
    expect(identityDocumentInput({ ...draft, number: " fa 1234567 " }).id_document_number).toBe("FA 1234567");
    expect(identityDocumentFieldErrors({ ...draft, number: "AB1" }, rules).number).toBe("id_document_number_too_short");
    expect(identityDocumentFieldErrors({ ...draft, number: "AB/12345" }, rules).number).toBe("id_document_number_invalid");
    expect(identityDocumentFieldErrors({ ...draft, number: "АБ123456" }, rules).number).toBe("id_document_number_invalid");
    expect(identityDocumentFieldErrors({ ...draft, number: "A".repeat(31) }, rules).number).toBe("id_document_number_too_long");
    expect(identityDocumentFieldErrors({ ...draft, number: "P<UKR12345" }, rules)).toEqual({});
    expect(identityDocumentFieldErrors({ ...draft, issuedOn: "2026-10-08" }, rules).issuedOn).toBe("id_issued_on_future");
    expect(identityDocumentFieldErrors({ ...draft, issuedOn: "1989-01-01" }, rules).issuedOn).toBe("id_issued_on_before_birth");
    expect(identityDocumentFieldErrors({ ...draft, validUntil: draft.issuedOn }, rules).validUntil).toBe("id_valid_until_before_issue");
    expect(identityDocumentFieldErrors({ ...draft, country: "XX" }, rules).country).toBe("id_issuing_country_invalid");
    // A stored country name becomes its code.
    expect(identityDocumentDraft({ ...stored, id_issuing_country: "Ukraine" }).country).toBe("UA");
    expect(identityDocumentMissing({ ...draft, number: " ", authority: "" })).toEqual(["number", "authority"]);
    expect(identityFieldErrorText("id_document_number_too_short", ru)).toBe("Номер слишком короткий: минимум 5 букв или цифр");
  });

  it("gives one status per document: scan, unreadable, missing fields, expired or complete", () => {
    const draft = identityDocumentDraft({ ...stored, id_document_unreadable: false, id_valid_until: "2031-01-31" });
    const at = (next: typeof draft, scans: number | null = 1) =>
      identityDocumentStatus(next, { today: "2026-10-07", scans, errors: identityDocumentFieldErrors(next, { today: "2026-10-07" }) });
    expect(at(draft, 0).kind).toBe("no_scan");
    expect(identityDocumentStatusText(at({ ...draft, unreadable: true }), ru)).toBe("Документ нечитаем: запросите новый скан");
    expect(identityDocumentStatusText(at({ ...draft, number: "", country: "" }), ru)).toBe("Заполните по скану: номер, страна выдачи");
    expect(at({ ...draft, validUntil: "2026-10-06" }).kind).toBe("expired");
    // The last day still counts.
    expect(at({ ...draft, validUntil: "2026-10-07" }).kind).toBe("complete");
    expect(at({ ...draft, number: "AB" }).kind).toBe("invalid");
    expect(identityDocumentStatusText(at(draft, null), de)).toBe("Daten vollständig · gültig bis 31.01.2031");
  });

  it("knows a reload older than the last save", () => {
    expect(identityDocumentSourceIsStale("2026-10-22T12:15:50Z", "2026-10-22T12:15:53Z")).toBe(true);
    expect(identityDocumentSourceIsStale(null, "2026-10-22T12:15:53Z")).toBe(true);
    expect(identityDocumentSourceIsStale("2026-10-22T12:15:53Z", "2026-10-22T12:15:53Z")).toBe(false);
    expect(identityDocumentSourceIsStale("2026-10-22T12:16:00Z", null)).toBe(false);
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

  it("lets staff upload a parent's identity copy and a guardian's proof, naming who uploaded each file", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "lead-1",
      minor: true,
      representation: {
        custody: "guardian",
        representatives: [
          {
            id: "rep-1",
            slot: "rep1",
            role: "legal_guardian",
            first_name: "Eva",
            last_name: "Muster",
            identity_documents: [
              { id: "doc-1", file_name: "ausweis.pdf", uploaded_at: "2026-10-18T09:00:00Z", uploaded_by_staff: true },
            ],
            authority_documents: [],
          },
        ],
      },
    });
    expect(intake?.representation?.representatives[0]?.identity_documents[0]?.uploaded_by_staff).toBe(true);
    const html = withPickers(
      <LeadIdentityDocumentData leadId="lead-1" intake={intake} tx={ru} lang="ru" onSaved={() => undefined} />,
    );
    expect(html).toContain("lead-representative-upload-identity-rep-1");
    expect(html).toContain("lead-representative-upload-authority-rep-1");
    expect(html).toContain("Скан документа");
    expect(html).toContain("Подтверждение полномочий");
    expect(html).toContain('accept=".pdf,.jpg,.jpeg,.png"');
    // Without the wizard's document rows: name, date and origin of the file.
    expect(html).toContain("ausweis.pdf");
    expect(html).toContain("18.10.2026");
    expect(html).toContain("Загружено сотрудником");
    expect(html).toContain("Добавить файл");

    // A parent with joint custody: only the identity copy.
    const parent = normalizeLeadPortalIntake({
      lead_id: "lead-1",
      minor: true,
      representation: {
        custody: "joint",
        representatives: [{ id: "rep-2", slot: "rep1", role: "legal_representative", first_name: "Anna", last_name: "Muster" }],
      },
    });
    const parentHtml = withPickers(
      <LeadIdentityDocumentData
        leadId="lead-1"
        intake={parent}
        tx={de}
        lang="de"
        onSaved={() => undefined}
        representativeFiles={() => <span>rows</span>}
      />,
    );
    expect(parentHtml).toContain("lead-representative-upload-identity-rep-2");
    expect(parentHtml).not.toContain("lead-representative-upload-authority-rep-2");
    expect(parentHtml).toContain("Ausweiskopie");
    expect(parentHtml).toContain("Datei hochladen");
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
