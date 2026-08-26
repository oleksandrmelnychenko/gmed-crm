import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";
import type { MedicationBmpImportPreview } from "@/lib/api/medication-bmp-import";

import { PatientMedicationSection } from "./patient-clinical-entry-sections";
import {
  canConfirmMedicationBmpPreview,
  decodeMedicationBmpCarrierBytes,
  MEDICATION_BMP_MAX_BYTES,
  MedicationBmpImportPreviewContent,
  medicationBmpOperationForError,
  medicationBmpOperationMessage,
  resolveMedicationBmpIdempotencyKey,
} from "./medication-bmp-import-sheet";

function preview(
  overrides: Partial<MedicationBmpImportPreview> = {},
): MedicationBmpImportPreview {
  return {
    mode: "kbv_bmp_carrier_xml",
    generated_at: "2026-08-26T12:00:00Z",
    parser: {
      spec_version: "028",
      locale: "de-DE",
      implementation_version: "gmed-bmp-import-v1",
    },
    preview_fingerprint: "preview-1",
    plan: {
      instance_id: "plan-1",
      version: "028",
      locale: "de-DE",
      page_number: 1,
      total_pages: 1,
      printed_at: "2026-08-25",
    },
    patient: {
      given_name: "Max",
      family_name: "Mustermann",
      birth_date: "1960-01-01",
      gender: "M",
      insurance_id: null,
    },
    issuer: {
      name: "Praxis Dr. Anton",
      street: "Gallenweg 6",
      postal_code: "10115",
      city: "Berlin",
      phone: null,
      email: null,
      printed_at: "2026-08-25",
      identifier: { kind: "lanr", value: "123" },
    },
    sections: [{
      index: 0,
      code: null,
      title: null,
      category: "dauer",
      medications: [{
        index: 0,
        pzn: "01234567",
        trade_name: "Metformin Atid",
        substances: [{ name: "Metformin", strength: "500 mg" }],
        form: { kind: "code", value: "TAB" },
        dose: {
          morning: "1",
          noon: null,
          evening: "1",
          night: null,
          free_text: null,
          weekly_day: null,
        },
        unit: { kind: "code", value: "Stück" },
        instructions: "nach den Mahlzeiten",
        reason: "Blutzucker",
        additional_text: null,
        importable: true,
        blocking_reasons: [],
      }],
    }],
    summary: {
      sections_total: 1,
      medications_total: 1,
      importable_medications: 1,
      blocked_medications: 0,
      current_medications_replaced: 2,
    },
    identity_match: {
      status: "matched",
      fields: [
        {
          field: "given_name",
          carrier_value: "Max",
          patient_value: "Max",
          matches: true,
        },
        {
          field: "family_name",
          carrier_value: "Mustermann",
          patient_value: "Mustermann",
          matches: true,
        },
      ],
      blocking_reasons: [],
    },
    warnings: [],
    permissions: { can_preview: true, can_confirm: true },
    ...overrides,
  };
}

describe("MedicationBmpImportPreviewContent", () => {
  it("renders a compact localized plan preview without recommendation language", () => {
    const russian = renderToStaticMarkup(
      <MedicationBmpImportPreviewContent preview={preview()} language="ru" />,
    );
    const german = renderToStaticMarkup(
      <MedicationBmpImportPreviewContent preview={preview()} language="de" />,
    );

    expect(russian).toContain("Пациент подтверждён");
    expect(russian).toContain("Медикаменты в BMP");
    expect(russian).toContain("После подтверждения все 2 текущих записей будут заменены");
    expect(russian).toContain("Metformin Atid");
    expect(german).toContain("Patient stimmt überein");
    expect(german).toContain("Aktuellen Plan ersetzen");
    expect(german).not.toContain("Пациент подтверждён");
    expect(`${russian}${german}`).not.toMatch(/confidence|рекомендован|empfohlen|auto-apply/i);
  });

  it("shows a hard patient mismatch with both carrier and profile values", () => {
    const mismatch = preview({
      identity_match: {
        status: "mismatch",
        fields: [{
          field: "birth_date",
          carrier_value: "1960-01-01",
          patient_value: "1961-01-01",
          matches: false,
        }],
        blocking_reasons: [{
          code: "birth_date_mismatch",
          path: "patient.birth_date",
          message_ru: "Дата рождения не совпадает",
          message_de: "Geburtsdatum stimmt nicht überein",
          blocking: true,
        }],
      },
      permissions: { can_preview: true, can_confirm: false },
    });
    const html = renderToStaticMarkup(
      <MedicationBmpImportPreviewContent preview={mismatch} language="ru" />,
    );

    expect(html).toContain("Данные пациента не совпадают");
    expect(html).toContain("Импорт заблокирован");
    expect(html).toContain("1960-01-01");
    expect(html).toContain("1961-01-01");
    expect(html).toContain("Дата рождения не совпадает");
    expect(html).toContain('role="alert"');
  });

  it("does not substitute trade name or PZN for a missing Wirkstoff", () => {
    const missingSubstance = preview();
    missingSubstance.sections[0].medications[0] = {
      ...missingSubstance.sections[0].medications[0],
      substances: [],
      importable: false,
      dose: {
        morning: "1",
        noon: null,
        evening: null,
        night: null,
        free_text: null,
        weekly_day: 5,
      },
      blocking_reasons: [{
        code: "wirkstoff_missing",
        path: "sections[0].medications[0].substances",
        message_ru: "Нужно уточнить действующее вещество",
        message_de: "Wirkstoff muss geklärt werden",
        blocking: true,
      }],
    };
    missingSubstance.summary = {
      ...missingSubstance.summary,
      importable_medications: 0,
      blocked_medications: 1,
    };
    missingSubstance.permissions = { can_preview: true, can_confirm: false };
    const html = renderToStaticMarkup(
      <MedicationBmpImportPreviewContent preview={missingSubstance} language="de" />,
    );

    expect(html).toContain("Metformin Atid");
    expect(html).toContain("PZN 01234567");
    expect(html).toContain("Wirkstoff fehlt: Klärung erforderlich");
    expect(html).toContain("Wochentag: 5");
    expect(html).toContain("Blockiert");
    expect(canConfirmMedicationBmpPreview(missingSubstance)).toBe(false);
  });

  it("shows server warning chips in the active language", () => {
    const withWarning = preview({
      warnings: [{
        code: "page_metadata",
        path: "plan.total_pages",
        message_ru: "Проверьте комплектность страниц",
        message_de: "Seitenumfang prüfen",
        blocking: false,
      }],
    });
    const russian = renderToStaticMarkup(
      <MedicationBmpImportPreviewContent preview={withWarning} language="ru" />,
    );
    const german = renderToStaticMarkup(
      <MedicationBmpImportPreviewContent preview={withWarning} language="de" />,
    );

    expect(russian).toContain("Проверьте комплектность страниц");
    expect(russian).not.toContain("Seitenumfang prüfen");
    expect(german).toContain("Seitenumfang prüfen");
  });
});

describe("BMP import confirmation guard", () => {
  it("decodes UTF-8 XML first and falls back to single-byte BMP carrier text", () => {
    const utf8 = new TextEncoder().encode('<MP n="Grüße"/>').buffer;
    const latin1 = new Uint8Array([0x4d, 0xfc, 0x6e, 0x63, 0x68, 0x65, 0x6e]).buffer;

    expect(decodeMedicationBmpCarrierBytes(utf8)).toBe('<MP n="Grüße"/>');
    expect(decodeMedicationBmpCarrierBytes(latin1)).toBe("München");
  });

  it("uses the server-aligned file limit and a localized oversize message", () => {
    expect(MEDICATION_BMP_MAX_BYTES).toBe(128 * 1024);
    expect(medicationBmpOperationMessage("file_too_large", "ru")).toContain("128 КиБ");
    expect(medicationBmpOperationMessage("file_too_large", "de")).toContain("128 KiB");
  });

  it("requires server permission, matched identity, no blocked rows, and explicit substances", () => {
    expect(canConfirmMedicationBmpPreview(preview())).toBe(true);
    expect(canConfirmMedicationBmpPreview(preview({
      permissions: { can_preview: true, can_confirm: false },
    }))).toBe(false);
    expect(canConfirmMedicationBmpPreview(preview({
      identity_match: { status: "carrier_incomplete", fields: [], blocking_reasons: [] },
    }))).toBe(false);

    const misleading = preview();
    misleading.sections[0].medications[0] = {
      ...misleading.sections[0].medications[0],
      substances: [{ name: "", strength: null }],
      importable: true,
    };
    expect(canConfirmMedicationBmpPreview(misleading)).toBe(false);
  });

  it("keeps one idempotency key for retries and maps 409 recovery codes", () => {
    const first = resolveMedicationBmpIdempotencyKey(null, () => "attempt-1");
    const retry = resolveMedicationBmpIdempotencyKey(first, () => "attempt-2");
    expect(first).toBe("attempt-1");
    expect(retry).toBe("attempt-1");
    expect(medicationBmpOperationForError(new ApiRequestError("stale", {
      status: 409,
      body: { code: "bmp_preview_stale" },
    }))).toBe("stale");
    expect(medicationBmpOperationForError(new ApiRequestError("mismatch", {
      status: 409,
      body: { code: "bmp_patient_identity_mismatch" },
    }))).toBe("identity_mismatch");
    expect(medicationBmpOperationForError(new ApiRequestError("conflict", {
      status: 409,
      body: { code: "bmp_idempotency_conflict" },
    }))).toBe("idempotency_conflict");
  });
});

describe("patient medication section integration", () => {
  it("renders a custom BMP action in the medication-plan header", () => {
    const html = renderToStaticMarkup(
      <PatientMedicationSection
        items={[]}
        providers={[]}
        canManage
        lang="de"
        headerAction={<button type="button">BMP-XML importieren</button>}
        onSave={async () => undefined}
      />,
    );

    expect(html).toContain("Medikation");
    expect(html).toContain("BMP-XML importieren");
    expect(html).toContain("Hinzufügen");
  });
});
