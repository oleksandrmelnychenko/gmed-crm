import { beforeEach, describe, expect, it, vi } from "vitest";

import { post } from "./client";
import {
  confirmMedicationBmpImport,
  MedicationBmpContractError,
  normalizeConfirmMedicationBmpImportResult,
  normalizeMedicationBmpImportPreview,
  previewMedicationBmpImport,
} from "./medication-bmp-import";

vi.mock("./client", () => ({ post: vi.fn() }));

describe("medication BMP import API", () => {
  beforeEach(() => {
    vi.mocked(post).mockReset();
  });

  it("normalizes the frozen preview including identity blockers and medication issues", () => {
    const result = normalizeMedicationBmpImportPreview({
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
        total_pages: 2,
        printed_at: "2026-08-25",
      },
      patient: {
        given_name: "Max",
        family_name: "Mustermann",
        birth_date: "1960-01-01",
      },
      issuer: {
        name: "Praxis A",
        city: "Berlin",
        identifier: { kind: "lanr", value: "123" },
      },
      sections: [{
        index: 0,
        category: "dauer",
        medications: [{
          index: 0,
          pzn: "01234567",
          trade_name: "Brand",
          substances: [],
          dose: { morning: "1" },
          form: { kind: "code", value: "TAB" },
          importable: false,
          blocking_reasons: [{
            code: "wirkstoff_missing",
            path: "sections[0].medications[0].substances",
            message_ru: "Не указано действующее вещество",
            message_de: "Wirkstoff fehlt",
            blocking: true,
          }],
        }],
      }],
      summary: {
        sections_total: 1,
        medications_total: 1,
        importable_medications: 0,
        blocked_medications: 1,
        current_medications_replaced: 3,
      },
      identity_match: {
        status: "mismatch",
        fields: [{
          field: "birth_date",
          carrier_value: "1960-01-01",
          patient_value: "1961-01-01",
          matches: false,
        }],
        blocking_reasons: [{ code: "patient_mismatch", blocking: true }],
      },
      warnings: [{ code: "source_note", message_de: "Hinweis", blocking: false }],
      permissions: { can_preview: true, can_confirm: false },
    });

    expect(result.mode).toBe("kbv_bmp_carrier_xml");
    expect(result.parser).toEqual({
      spec_version: "028",
      locale: "de-DE",
      implementation_version: "gmed-bmp-import-v1",
    });
    expect(result.sections[0].medications[0]).toMatchObject({
      trade_name: "Brand",
      substances: [],
      importable: false,
      dose: { morning: "1", weekly_day: null },
    });
    expect(result.sections[0].medications[0].blocking_reasons[0].code)
      .toBe("wirkstoff_missing");
    expect(result.identity_match.status).toBe("mismatch");
    expect(result.permissions.can_confirm).toBe(false);
  });

  it("defaults unknown and missing arrays without making rows importable", () => {
    const result = normalizeMedicationBmpImportPreview({
      mode: "kbv_bmp_carrier_xml",
      parser: {
        spec_version: "028",
        locale: "de-DE",
        implementation_version: "gmed-bmp-import-v1",
      },
      plan: { version: "028", locale: "de-DE" },
      identity_match: { status: "unknown" },
      sections: [{ category: "unsupported", medications: [{}] }],
    });

    expect(result.identity_match.status).toBe("carrier_incomplete");
    expect(result.warnings).toEqual([]);
    expect(result.sections[0].category).toBeNull();
    expect(result.sections[0].medications[0]).toMatchObject({
      importable: false,
      substances: [],
      blocking_reasons: [],
    });
    expect(result.permissions).toEqual({ can_preview: false, can_confirm: false });
  });

  it("uses the frozen preview and confirm endpoints with exact request bodies", async () => {
    vi.mocked(post)
      .mockResolvedValueOnce({
        mode: "kbv_bmp_carrier_xml",
        parser: {
          spec_version: "028",
          locale: "de-DE",
          implementation_version: "gmed-bmp-import-v1",
        },
        plan: { version: "028", locale: "de-DE" },
        preview_fingerprint: "preview-1",
      })
      .mockResolvedValueOnce({
        mode: "kbv_bmp_carrier_xml",
        status: "confirmed",
        strategy: "replace_current",
        import_id: "import-1",
        medication_ids: ["med-1"],
      });

    await previewMedicationBmpImport("patient/1", "<MP/>");
    await confirmMedicationBmpImport("patient/1", {
      carrier_xml: "<MP/>",
      preview_fingerprint: "preview-1",
      idempotency_key: "attempt-1",
      staff_acknowledged: true,
    });

    const base = "/patients/patient%2F1/bmp-imports";
    expect(post).toHaveBeenNthCalledWith(1, `${base}/preview`, {
      carrier_xml: "<MP/>",
    });
    expect(post).toHaveBeenNthCalledWith(2, `${base}/confirm`, {
      carrier_xml: "<MP/>",
      preview_fingerprint: "preview-1",
      idempotency_key: "attempt-1",
      staff_acknowledged: true,
    });
  });

  it("normalizes all-or-nothing confirmation metadata", () => {
    expect(normalizeConfirmMedicationBmpImportResult({
      mode: "kbv_bmp_carrier_xml",
      import_id: "import-1",
      status: "confirmed",
      strategy: "replace_current",
      plan_instance_id: "plan-1",
      preview_fingerprint: "preview-1",
      medication_ids: ["med-1", 42],
      imported_medications: 2,
      superseded_medications: 4,
      idempotent_replay: true,
      confirmed_at: "2026-08-26T12:01:00Z",
      permissions: { can_preview: true, can_confirm: true },
    })).toMatchObject({
      status: "confirmed",
      strategy: "replace_current",
      medication_ids: ["med-1"],
      imported_medications: 2,
      superseded_medications: 4,
      idempotent_replay: true,
    });
  });

  it("rejects contract drift instead of falsely labelling the response as BMP v028", () => {
    const base = {
      mode: "kbv_bmp_carrier_xml",
      parser: {
        spec_version: "028",
        locale: "de-DE",
        implementation_version: "gmed-bmp-import-v1",
      },
      plan: { version: "028", locale: "de-DE" },
    };

    expect(() => normalizeMedicationBmpImportPreview({
      ...base,
      parser: { ...base.parser, spec_version: "027" },
    })).toThrowError(MedicationBmpContractError);
    expect(() => normalizeMedicationBmpImportPreview({
      ...base,
      plan: { ...base.plan, locale: "en-US" },
    })).toThrowError(/plan\.locale/);
    expect(() => normalizeConfirmMedicationBmpImportResult({
      mode: "kbv_bmp_carrier_xml",
      status: "confirmed",
      strategy: "append",
    })).toThrowError(/strategy/);
  });

  it("only accepts ISO weekday values from 1 through 7", () => {
    const base = {
      mode: "kbv_bmp_carrier_xml",
      parser: {
        spec_version: "028",
        locale: "de-DE",
        implementation_version: "gmed-bmp-import-v1",
      },
      plan: { version: "028", locale: "de-DE" },
      sections: [{
        medications: [
          { dose: { weekly_day: 0 } },
          { dose: { weekly_day: 2.5 } },
          { dose: { weekly_day: 7 } },
        ],
      }],
    };
    const result = normalizeMedicationBmpImportPreview(base);
    expect(result.sections[0].medications.map((item) => item.dose.weekly_day))
      .toEqual([null, null, 7]);
  });
});
