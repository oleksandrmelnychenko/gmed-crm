import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";
import type { Translations } from "@/lib/i18n";

import { GWG_INSTRUCTION_CODES, type GwgTrainingEmployee, type GwgTrainingRecord } from "../model/gwg-training";
import { GwgTrainingTable } from "./gwg-training-section";

const noop = () => undefined;

function record(overrides: Partial<GwgTrainingRecord> = {}): GwgTrainingRecord {
  return {
    id: "r-1",
    employee_id: "e-anna",
    template_id: "gwg_staff_training",
    instructed_on: "2026-10-01",
    position: "Dolmetscher/in",
    department: "Dolmetscherdienst",
    delivered_by: "internal",
    delivered_by_other: null,
    form_oral: true,
    form_material: true,
    form_other: false,
    form_other_text: null,
    instructions: [...GWG_INSTRUCTION_CODES],
    reliability: "long_standing",
    reliability_interview: false,
    reliability_certificate: false,
    reliability_other: false,
    reliability_other_text: null,
    management_name: "Ben Beispiel",
    status: "unsigned",
    document_id: "d-1",
    document_file_name: "GwGUnterweisung_20261001_Muster_Anna.pdf",
    document_mime_type: "application/pdf",
    signed_document_id: null,
    signed_file_name: null,
    signed_mime_type: null,
    signed_at: null,
    signed_by_name: null,
    created_by_name: "Ben Beispiel",
    created_at: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

const anna: GwgTrainingEmployee = {
  employee_id: "e-anna",
  first_name: "Anna",
  last_name: "Muster",
  display_name: "Anna Muster",
  employment_start: "2019-03-01",
  user_role: "interpreter",
  default_position: "Dolmetscher/in",
  default_department: "Dolmetscherdienst",
  status: "unsigned",
  last_instructed_on: "2026-10-01",
  next_due_on: "2027-10-01",
  due: false,
  records: [record()],
};

const mia: GwgTrainingEmployee = {
  ...anna,
  employee_id: "e-mia",
  first_name: "Mia",
  display_name: "Mia Muster",
  employment_start: null,
  default_position: "",
  status: "none",
  last_instructed_on: null,
  next_due_on: null,
  due: true,
  records: [],
};

const ben: GwgTrainingEmployee = {
  ...anna,
  employee_id: "e-ben",
  first_name: "Ben",
  display_name: "Ben Muster",
  status: "signed",
  last_instructed_on: "2025-09-01",
  next_due_on: "2026-09-01",
  due: true,
  records: [
    record({
      id: "r-2",
      instructed_on: "2025-09-01",
      status: "signed",
      signed_document_id: "d-3",
      signed_file_name: "GwGUnterweisung_20250901_Muster_Ben_V2.pdf",
    }),
    record({ id: "r-0", instructed_on: "2024-09-01", status: "signed", signed_document_id: "d-0" }),
  ],
};

function render(t: Translations, canWrite = true, employees = [anna, mia, ben]) {
  return renderToStaticMarkup(
    <GwgTrainingTable
      employees={employees}
      t={t}
      canWrite={canWrite}
      busyRecordId={null}
      onConduct={noop}
      onOpen={noop}
      onUpload={noop}
      onHistory={noop}
    />,
  );
}

describe("GwG instruction table", () => {
  it("shows the last instruction, the status and the due warning of each employee", () => {
    const html = render(ru);
    expect(html.match(/data-testid="gwg-training-row"/g)).toHaveLength(3);
    expect(html).toContain("Anna Muster");
    expect(html).toContain("01.10.2026");
    expect(html).toContain("Следующий до 01.10.2027");
    expect(html).toContain("проведено, не подписано");
    expect(html).toContain("не проводилось");
    expect(html).toContain("подписано");
    expect(html.match(/Пора провести инструктаж/g)).toHaveLength(2);
    expect(html.match(/Провести инструктаж/g)).toHaveLength(3);
    // The unsigned record offers the upload, the signed one its scan.
    expect(html.match(/Загрузить подписанный/g)).toHaveLength(1);
    expect(html.match(/Открыть подписанный/g)).toHaveLength(1);
    expect(html.match(/Открыть PDF/g)).toHaveLength(2);
    // Only an employee with several records gets the history.
    expect(html.match(/История/g)).toHaveLength(1);
  });

  it("is read-only without the right to archive in personnel files", () => {
    const html = render(de, false);
    expect(html).toContain("Unterweisung fällig");
    expect(html).toContain("durchgeführt, nicht unterschrieben");
    expect(html).not.toContain("Unterweisung durchführen");
    expect(html).not.toContain("Unterschriebene hochladen");
    expect(html).toContain("PDF öffnen");
  });

  it("explains where employees come from when there are none", () => {
    expect(render(ru, true, [])).toContain("Личные дела");
  });
});
