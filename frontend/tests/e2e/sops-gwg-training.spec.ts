import { expect, test, type Page } from "@playwright/test";
import { lazyPageLoad } from "./lazy-pages";

/**
 * "GwG-Unterweisung (§ 6 Abs. 2 GwG)" in "SOP и обучение" with a mocked API:
 * the CEO documents an instruction, the sheet goes to the personnel file and
 * the signed scan is uploaded. Synthetic people only.
 */
const TODAY = "2026-10-07";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const INSTRUCTIONS = [
  "identify_partner",
  "identify_acting_person",
  "beneficial_owner",
  "enhanced_due_diligence",
  "suspicious_activity_report",
  "record_keeping",
];

type Json = Record<string, unknown>;

function record(id: string, employeeId: string, overrides: Json = {}): Json {
  return {
    id,
    employee_id: employeeId,
    template_id: "gwg_staff_training",
    instructed_on: "2026-03-02",
    position: "Dolmetscher/in",
    department: "Dolmetscherdienst",
    delivered_by: "internal",
    delivered_by_other: null,
    form_oral: true,
    form_material: true,
    form_other: false,
    form_other_text: null,
    instructions: INSTRUCTIONS,
    reliability: "long_standing",
    reliability_interview: false,
    reliability_certificate: false,
    reliability_other: false,
    reliability_other_text: null,
    management_name: "Ben Beispiel",
    status: "signed",
    document_id: `doc-${id}`,
    document_file_name: "GwGUnterweisung_20260302_Muster_Anna.pdf",
    document_mime_type: "application/pdf",
    signed_document_id: `signed-${id}`,
    signed_file_name: "GwGUnterweisung_20260302_Muster_Anna_V2.pdf",
    signed_mime_type: "application/pdf",
    signed_at: "2026-03-03T10:00:00Z",
    signed_by_name: "Ben Beispiel",
    created_by_name: "Ben Beispiel",
    created_at: "2026-03-02T09:00:00Z",
    ...overrides,
  };
}

function employee(id: string, first: string, records: Json[], overrides: Json = {}): Json {
  const last = records[0] as Json | undefined;
  return {
    employee_id: id,
    first_name: first,
    last_name: "Muster",
    display_name: `${first} Muster`,
    employment_start: "2019-03-01",
    user_role: "interpreter",
    default_position: "Dolmetscher/in",
    default_department: "Dolmetscherdienst",
    status: last ? last.status : "none",
    last_instructed_on: last ? last.instructed_on : null,
    next_due_on: null,
    due: !last,
    records,
    ...overrides,
  };
}

async function setup(page: Page) {
  const anna = employee("emp-anna", "Anna", [record("rec-anna", "emp-anna")], { next_due_on: "2027-03-02" });
  let miaRecords: Json[] = [];
  const mia = () =>
    employee("emp-mia", "Mia", miaRecords, {
      employment_start: "2026-09-01",
      user_role: "concierge",
      default_position: "Concierge",
      default_department: "Concierge-Service",
    });
  const calls: { method: string; path: string; payload: unknown }[] = [];
  const opened: string[] = [];

  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "gwg-training-test");
    localStorage.setItem("gmed_refresh_token", "gwg-training-refresh");
    localStorage.setItem("gmed_lang", "ru");
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    if (path.startsWith("/personnel/documents/") && path.endsWith("/file")) {
      opened.push(path);
      return route.fulfill({ contentType: "application/pdf", body: PDF });
    }
    if (method !== "GET") {
      const multipart = (request.headers()["content-type"] ?? "").startsWith("multipart/form-data");
      calls.push({ method, path, payload: multipart ? "multipart" : request.postDataJSON() });
    }
    let body: unknown = [];
    if (path === "/me") {
      body = { id: "00000000-0000-0000-0000-000000000001", name: "Ben Beispiel", role: "ceo", email: "ceo@example.com" };
    }
    if (path === "/sops/eligible-users") body = { allowed_target_roles: [], eligible_users: [] };
    if (path === "/sops/gwg-training" && method === "GET") {
      body = {
        today: TODAY,
        due_after_months: 12,
        management_name: "Ben Beispiel",
        instructions: INSTRUCTIONS,
        employees: [anna, mia()],
      };
    }
    if (path === "/sops/gwg-training" && method === "POST") {
      const payload = request.postDataJSON() as Json;
      miaRecords = [
        record("rec-mia", "emp-mia", {
          ...payload,
          status: "unsigned",
          document_file_name: "GwGUnterweisung_20261007_Muster_Mia.pdf",
          signed_document_id: null,
          signed_file_name: null,
          signed_mime_type: null,
          signed_at: null,
          signed_by_name: null,
        }),
      ];
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(miaRecords[0]) });
    }
    if (path === "/sops/gwg-training/rec-mia/signed-copy") {
      miaRecords = [
        {
          ...miaRecords[0],
          status: "signed",
          signed_document_id: "signed-rec-mia",
          signed_file_name: "GwGUnterweisung_20261007_Muster_Mia_V2.pdf",
          signed_mime_type: "application/pdf",
        },
      ];
      body = miaRecords[0];
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/sops");
  await expect(page.getByTestId("gwg-training-section")).toBeVisible(lazyPageLoad);
  return { calls, opened };
}

test("the CEO documents a GwG instruction, files the sheet and uploads the signed copy", async ({ page }) => {
  const { calls, opened } = await setup(page);
  const section = page.getByTestId("gwg-training-section");
  await expect(section).toContainText("GwG-инструктаж (§ 6 Abs. 2 GwG)");
  await expect(section).toContainText("Нужен инструктаж: 1");

  // Mia was never instructed and is listed first; Anna's instruction is signed.
  const rows = section.getByTestId("gwg-training-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Mia Muster");
  await expect(rows.nth(0)).toContainText("не проводилось");
  await expect(rows.nth(0)).toContainText("Пора провести инструктаж");
  await expect(rows.nth(1)).toContainText("Anna Muster");
  await expect(rows.nth(1)).toContainText("подписано");
  await expect(rows.nth(1)).toContainText("Следующий до 02.03.2027");

  // The sheet of Anna opens from the personnel file.
  await rows.nth(1).getByRole("button", { name: "Открыть подписанный" }).click();
  await expect(page.getByRole("dialog")).toContainText("GwGUnterweisung_20260302_Muster_Anna_V2.pdf");
  await expect.poll(() => opened).toContain("/personnel/documents/signed-rec-anna/file");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Mia joined in September: a new employee, checked by the interview by default.
  await rows.nth(0).getByRole("button", { name: "Провести инструктаж" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("GwG-инструктаж: Mia Muster");
  await expect(sheet.getByRole("checkbox", { name: "устный инструктаж" })).toBeChecked();
  await expect(sheet.getByRole("checkbox", { name: /установить бенефициара/ })).toBeChecked();
  await expect(sheet.getByRole("radio", { name: /b\) новый сотрудник/ })).toBeChecked();
  await expect(sheet.getByRole("checkbox", { name: /вопрос о судимостях/ })).toBeChecked();
  await expect(sheet.getByRole("textbox", { name: "Должность (als)" })).toHaveValue("Concierge");
  await expect(sheet).toContainText("Раздел 3 подписывает руководство: Ben Beispiel");

  // An external trainer needs a name before the sheet is generated.
  await sheet.getByRole("radio", { name: /сторонний специалист/ }).check();
  await sheet.getByRole("button", { name: "Сохранить и сформировать PDF" }).click();
  await expect(sheet).toContainText("Укажите, кто проводил инструктаж.");
  expect(calls).toEqual([]);
  await sheet.getByRole("textbox", { name: "Уточнение" }).fill("Kanzlei Beispiel GmbH");
  await sheet.getByRole("checkbox", { name: /справка о несудимости/ }).check();
  await sheet.getByRole("checkbox", { name: /хранить их 5 лет/ }).uncheck();
  await sheet.getByRole("button", { name: "Сохранить и сформировать PDF" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(section).toContainText("Инструктаж сохранён, лист добавлен в личное дело.");
  expect(calls).toEqual([
    {
      method: "POST",
      path: "/sops/gwg-training",
      payload: {
        employee_id: "emp-mia",
        instructed_on: TODAY,
        position: "Concierge",
        department: "Concierge-Service",
        delivered_by: "other",
        delivered_by_other: "Kanzlei Beispiel GmbH",
        form_oral: true,
        form_material: true,
        form_other: false,
        form_other_text: null,
        instructions: INSTRUCTIONS.filter((code) => code !== "record_keeping"),
        reliability: "new_employee",
        reliability_interview: true,
        reliability_certificate: true,
        reliability_other: false,
        reliability_other_text: null,
      },
    },
  ]);
  const miaRow = section.getByTestId("gwg-training-row").filter({ hasText: "Mia Muster" });
  await expect(miaRow).toContainText("проведено, не подписано");

  // The signed scan goes to the personnel file and the record is signed.
  const chooser = page.waitForEvent("filechooser");
  await miaRow.getByRole("button", { name: "Загрузить подписанный" }).click();
  await (await chooser).setFiles({ name: "Scan 7.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(section).toContainText("Подписанный лист сохранён в личном деле.");
  await expect(miaRow).not.toContainText("не подписано");
  await expect(miaRow).toContainText("подписано");
  await expect(miaRow.getByRole("button", { name: "Открыть подписанный" })).toBeVisible();  expect(calls[1]).toEqual({ method: "POST", path: "/sops/gwg-training/rec-mia/signed-copy", payload: "multipart" });
});
