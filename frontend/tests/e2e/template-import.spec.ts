import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Import of an agency document template (owner request 2026-11-10): the
// dialog of the documents page against a mocked API that checks variables
// the way the server does.

const KNOWN = ["patient_name", "birth_date", "today"];

type Template = Record<string, unknown> & { id: string; body: string; status: string; label: string };

function describeTemplate(template: Template): Template {
  const names = [...template.body.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map(match => match[1]);
  const unknown = [...new Set(names.filter(name => !KNOWN.includes(name)).map(name => `{{${name}}}`))];
  return {
    ...template,
    used_variables: KNOWN.filter(name => names.includes(name)),
    unknown_variables: unknown,
    unclosed_variable: false,
    can_activate: unknown.length === 0,
    preview_text: template.body
      .replaceAll("{{patient_name}}", "Max Mustermann")
      .replaceAll("{{birth_date}}", "01.02.1980"),
  };
}

test("a template is imported, corrected and activated", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "synthetic-template-import-token");
  });
  await page.routeWebSocket("**/api/**", socket => socket.close());

  const templates: Template[] = [];
  const calls: string[] = [];
  let listUnavailable = true;
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/me")) {
      return route.fulfill({ json: {
        id: "synthetic-template-user", role: "ceo", name: "Template QA", email: "qa@example.invalid",
      } });
    }
    if (path.endsWith("/documents/template-imports") && request.method() === "GET") {
      if (listUnavailable) return route.fulfill({ status: 400, body: "" });
      return route.fulfill({ json: {
        templates: templates.map(describeTemplate),
        variables: KNOWN.map(key => ({ key, sample: key })),
        max_file_bytes: 2 * 1024 * 1024,
        max_body_chars: 20_000,
      } });
    }
    if (path.endsWith("/documents/template-imports") && request.method() === "POST") {
      calls.push("import");
      const posted = request.postData() ?? "";
      expect(posted).toContain('name="language"');
      expect(posted).toContain('filename="Bescheinigung.docx"');
      const corrected = posted.includes("corrected");
      const template: Template = {
        id: `synthetic-template-${templates.length + 1}`,
        public_id: `agency_template:synthetic-template-${templates.length + 1}`,
        family_id: `synthetic-family-${templates.length + 1}`,
        version_number: 1,
        label: "Bescheinigung",
        description: null,
        language: "de",
        status: "draft",
        source_filename: "Bescheinigung.docx",
        exact_layout: true,
        created_at: "2026-11-10T10:00:00Z",
        activated_at: null,
        disabled_at: null,
        created_by_name: "Template QA",
        activated_by_name: null,
        body: corrected
          ? "Bescheinigung für {{patient_name}}, geboren am {{birth_date}}."
          : "Bescheinigung für {{patient_name}}, geboren am {{geburtsdatum}}.",
      };
      templates.push(template);
      return route.fulfill({ status: 201, json: { template: describeTemplate(template) } });
    }
    if (path.endsWith("/preview")) {
      return route.fulfill({
        contentType: "application/pdf",
        body: readFileSync("tests/e2e/fixtures/signature-preview.pdf"),
      });
    }
    const action = path.match(/template-imports\/([^/]+)\/(update|activate|disable)$/);
    if (action) {
      const template = templates.find(item => item.id === action[1])!;
      calls.push(action[2]);
      if (action[2] === "update") {
        const payload = request.postDataJSON() as { label: string };
        expect(Object.keys(payload)).toEqual(["label"]);
        template.label = payload.label;
      } else if (action[2] === "activate") {
        if (!describeTemplate(template).can_activate) {
          return route.fulfill({ status: 409, json: { error: "template_variables_invalid", message: "invalid" } });
        }
        template.status = "active";
        template.activated_at = "2026-11-10T10:05:00Z";
      } else {
        template.status = "disabled";
      }
      return route.fulfill({ json: { template: describeTemplate(template) } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/__template-import-qa", route => route.fulfill({
    contentType: "text/html",
    body: `<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      import('/tests/e2e/fixtures/template-import-dialog.tsx');
    </script></html>`,
  }));
  await page.goto("/__template-import-qa");

  const dialog = page.getByTestId("template-import-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Не удалось загрузить шаблоны.");
  await expect(dialog.getByText("Шаблонов пока нет.")).toHaveCount(0);
  listUnavailable = false;
  await dialog.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(dialog.getByText("Шаблонов пока нет.")).toBeVisible();
  // The fields for patient data are out of the way until someone opens them.
  await expect(dialog.locator("details")).not.toHaveAttribute("open", "");
  await expect(dialog.getByText("{{patient_name}}", { exact: true })).toBeHidden();

  // A file that is neither Word nor text is refused before any upload.
  await dialog.locator("#template-import-file").setInputFiles({
    name: "vertrag.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7"),
  });
  await expect(dialog.getByRole("alert")).toContainText("Word (.docx)");
  expect(calls).toEqual([]);

  // Choosing the Word file uploads it at once and shows the finished page.
  await dialog.locator("#template-import-file").setInputFiles({
    name: "Bescheinigung.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("PK synthetic word file"),
  });
  const selected = page.getByTestId("template-import-selected");
  await expect(selected).toContainText("Не сохранён");
  expect(calls).toEqual(["import"]);
  const pdf = page.getByTestId("template-import-pdf");
  await expect(pdf).toContainText("Так будет выглядеть документ");
  await expect(pdf.getByTestId("pdf-pages-preview")).toHaveAttribute("data-state", "ready");
  // Drawn by the app itself: a frame with the browser's own PDF viewer
  // stayed an empty box where that viewer is missing (owner report).
  await expect(pdf.locator("iframe")).toHaveCount(0);
  const inked = await pdf.locator("canvas").first().evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] < 600) dark += 1;
    }
    return dark;
  });
  expect(inked).toBeGreaterThan(100);

  // A file with an unknown field cannot be saved; it is corrected in Word.
  await expect(selected.getByRole("alert")).toContainText("{{geburtsdatum}}");
  await expect(dialog.getByRole("button", { name: "Сохранить шаблон" })).toBeDisabled();
  await page.screenshot({ path: "../artifacts/design-qa/template-import-unknown-variable.png" });
  await dialog.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(page.getByTestId("template-import-selected")).toHaveCount(0);
  expect(calls).toEqual(["import", "disable"]);

  // The corrected file: two buttons, name it, save.
  await dialog.locator("#template-import-file").setInputFiles({
    name: "Bescheinigung.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("PK synthetic word file, corrected"),
  });
  await expect(selected).toContainText("Не сохранён");
  await expect(selected.getByRole("alert")).toHaveCount(0);
  await expect(dialog.locator("#template-import-label")).toHaveValue("Bescheinigung");
  await dialog.locator("#template-import-label").fill("Bescheinigung Aufenthalt");
  await expect(pdf.getByTestId("pdf-pages-preview")).toHaveAttribute("data-state", "ready");
  await dialog.getByRole("button", { name: "Сохранить шаблон" }).click();
  await expect(selected).toContainText("Активен");
  await expect(selected).toContainText("Bescheinigung Aufenthalt");
  await expect(dialog.getByRole("status").filter({ hasText: "Шаблон сохранён" })).toBeVisible();
  await expect(page.getByTestId("catalog-changes")).toHaveText("1");
  expect(calls).toEqual(["import", "disable", "import", "update", "activate"]);

  // A saved template: disable it or replace its file, nothing else.
  await expect(selected.getByRole("button")).toHaveText(["Отключить", "Заменить файлом"]);
  // The discarded upload is not listed.
  await expect(dialog.getByRole("listitem").filter({ hasText: "Bescheinigung" })).toHaveCount(1);
  await page.screenshot({ path: "../artifacts/design-qa/template-import-active.png" });
});
