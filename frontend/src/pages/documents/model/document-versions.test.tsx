import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DocumentsGrid } from "@/components/documents-grid";
import { PatientConsentChangeRowButton } from "@/pages/patients/ui/sections/patient-consent-choices";
import { buildDocumentsPath } from "./document-model";
import {
  countNotSentForSignature,
  isPatientConsentFormRow,
  isPreviousVersionRow,
  notSentCountLabel,
  parseSignatureStateFilter,
  previousVersionChip,
  previousVersionRows,
  signatureStateChip,
  withPreviousVersionRows,
} from "./document-versions";
import { DocumentVersionToggle } from "../ui/document-version-cells";

vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>();
  return { ...actual, useLang: () => ({ lang: "ru" as const, t: actual.t("ru") }) };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", role: "patient_manager" } }) }));

const signedV2 = {
  id: "v2", status: "archived", version_number: 2, signed_at: "2026-11-01T10:00:00Z",
  signature_state: "signed" as const, is_latest_version: false,
};
const draftV1 = { id: "v1", status: "archived", version_number: 1, signed_at: null, signature_state: null, is_latest_version: false };
const current = {
  id: "v3", status: "active", version_number: 3, signed_at: null, signature_state: "not_sent" as const,
  is_latest_version: true, generated_template_id: "privacy_consents", previous_versions: [signedV2, draftV1],
};

describe("document versions (fix-98)", () => {
  it("nests the earlier versions under an expanded document only", () => {
    expect(withPreviousVersionRows([current], new Set())).toEqual([current]);
    const rows = withPreviousVersionRows([current], new Set(["v3"]));
    expect(rows.map((row) => row.id)).toEqual(["v3", "v2", "v1"]);
    expect(rows.map((row) => isPreviousVersionRow(row))).toEqual([false, true, true]);
    expect(previousVersionRows(current, new Set(["v3"]))[0]).toMatchObject({ id: "v2", previous_version_of: "v3" });
  });

  it("labels the signature state of the current version and the state of an earlier one", () => {
    expect(signatureStateChip(current, "ru")).toMatchObject({ label: "Не отправлено на подпись", tone: "amber" });
    expect(signatureStateChip({ ...current, signature_state: "sent", signature_sent_at: "2026-11-16T09:00:00Z" }, "ru")?.label)
      .toBe("Отправлено на подпись 16.11.2026");
    expect(signatureStateChip(signedV2, "de")?.label).toBe("Unterschrieben 01.11.2026");
    expect(signatureStateChip({ id: "scan", signature_state: null }, "ru")).toBeNull();
    expect(previousVersionChip(signedV2, "ru").label).toBe("Подписан 01.11.2026");
    expect(previousVersionChip(draftV1, "ru").label).toBe("Заменён");
  });

  it("counts the versions waiting to be sent and filters by the state", () => {
    expect(countNotSentForSignature([current, signedV2, { id: "x", signature_state: "sent" as const }])).toBe(1);
    expect(notSentCountLabel(1, "ru")).toBe("Ждут отправки на подпись: 1");
    expect(parseSignatureStateFilter("not_sent")).toBe("not_sent");
    expect(parseSignatureStateFilter("maybe")).toBe("");
    expect(buildDocumentsPath({
      search: "", patientId: "", orderId: "", appointmentId: "", status: "", visibility: "", art: "", category: "",
      dateFrom: "", dateTo: "", klinik: "", ursprung: "", documentDirection: "", documentVariant: "", accessCategory: "",
      financialStatus: "", validity: "", signatureState: "not_sent",
    })).toBe("/documents?signature_state=not_sent");
  });

  it("offers «Изменить согласия» only on the current Einverständniserklärung of a patient", () => {
    expect(isPatientConsentFormRow(current, "p1")).toBe(true);
    expect(isPatientConsentFormRow(current, null)).toBe(false);
    expect(isPatientConsentFormRow({ ...current, lead_id: "l1" }, "p1")).toBe(false);
    expect(isPatientConsentFormRow({ ...current, generated_template_id: "single_order" }, "p1")).toBe(false);
    expect(isPatientConsentFormRow({ ...current, status: "archived" }, "p1")).toBe(false);
    const [subRow] = previousVersionRows({ ...current, previous_versions: [{ ...signedV2, generated_template_id: "privacy_consents", status: "active" }] }, new Set(["v3"]));
    expect(isPatientConsentFormRow({ ...subRow, is_latest_version: true }, "p1")).toBe(false);
  });

  it("renders the version marker with its toggle and the row action", () => {
    const toggle = renderToStaticMarkup(<DocumentVersionToggle document={current} expanded={false} onToggle={() => undefined} lang="ru" />);
    expect(toggle).toContain("v3 · 3");
    expect(toggle).toContain('aria-label="Прошлые версии: 2"');
    expect(toggle).toContain('aria-expanded="false"');
    expect(renderToStaticMarkup(<DocumentVersionToggle document={{ id: "x", version_number: 1 }} expanded={false} onToggle={() => undefined} lang="ru" />)).toBe("");
    const button = renderToStaticMarkup(<PatientConsentChangeRowButton title="EW" onOpen={() => undefined} />);
    expect(button).toContain('data-testid="document-row-change-consents"');
    expect(button).toContain('aria-label="Изменить согласия: EW"');
  });

  it("the document table shows the expanded earlier versions as read-only sub-rows", () => {
    const item = (patch: Record<string, unknown>) => ({
      auto_name: "Einverständniserklärung", original_filename: null, patient_name: "Erika Muster", patient_pid: "P-1",
      art: "privacy_consents", category: "consent", visibility: "internal", data_sensitivity: "standard", file_size: 1,
      uploaded_by_name: "PM", updated_at: "2026-11-16T10:00:00Z", needs_categorization: false, patient_id: "p1",
      ...patch,
    });
    const documents = [item({
      ...current,
      previous_versions: [item(signedV2), item(draftV1)],
    })] as unknown as Parameters<typeof DocumentsGrid>[0]["documents"];
    const html = renderToStaticMarkup(
      <DocumentsGrid
        documents={documents}
        paginated
        showSelection={false}
        initialExpandedVersions={["v3"]}
        rowActions={() => <PatientConsentChangeRowButton title="EW" onOpen={() => undefined} />}
        selectedDocumentIds={[]}
        selectedId={null}
        labels={{
          selectBulkShare: "", filename: "Файл", patient: "Пациент", category: "Тип", status: "Статус",
          visibility: "Видимость", uploadedBy: "Загрузил", unclassified: "—", current: "текущая", pidFallback: "",
          notSet: "—", unknownUploader: "—", needsCategorization: "",
        }}
        localizeCode={(value) => value}
        onSelectionChange={() => undefined}
        onToggleSelection={() => undefined}
        onOpenDocument={() => undefined}
        statusBadge={() => ""}
        visibilityBadge={() => ""}
        sensitivityBadge={() => ""}
        formatStatusLabel={(value) => value}
        formatVisibilityLabel={(value) => value}
        formatSensitivityLabel={(value) => value}
        formatDateTime={(value) => value ?? ""}
      />,
    );
    expect(html).toContain('data-testid="signature-not-sent-v3"');
    expect(html).toContain('data-testid="version-signed-v2"');
    expect(html).toContain("Подписан 01.11.2026");
    expect(html).toContain('data-testid="version-replaced-v1"');
    expect(html).toContain('aria-expanded="true"');
    // The action belongs to the current version only.
    expect(html.match(/document-row-change-consents/g)).toHaveLength(1);
    // Counted per document, not per version.
    expect(html).toMatch(/1\s*(документ|Dokument)/);
  });
});
