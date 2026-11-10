import { expect, test } from "@playwright/test";

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
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/me")) {
      return route.fulfill({ json: {
        id: "synthetic-template-user", role: "ceo", name: "Template QA", email: "qa@example.invalid",
      } });
    }
    if (path.endsWith("/documents/template-imports") && request.method() === "GET") {
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
      expect(posted).toContain('filename="Bescheinigung.txt"');
      const template: Template = {
        id: "synthetic-template-1",
        public_id: "agency_template:synthetic-template-1",
        family_id: "synthetic-family-1",
        version_number: 1,
        label: "Bescheinigung",
        description: null,
        language: "de",
        status: "draft",
        source_filename: "Bescheinigung.txt",
        created_at: "2026-11-10T10:00:00Z",
        activated_at: null,
        disabled_at: null,
        created_by_name: "Template QA",
        activated_by_name: null,
        body: "Bescheinigung für {{patient_name}}, geboren am {{geburtsdatum}}.",
      };
      templates.push(template);
      return route.fulfill({ status: 201, json: { template: describeTemplate(template) } });
    }
    const action = path.match(/template-imports\/([^/]+)\/(update|activate|disable)$/);
    if (action) {
      const template = templates.find(item => item.id === action[1])!;
      calls.push(action[2]);
      if (action[2] === "update") {
        const payload = request.postDataJSON() as { body: string; label: string };
        template.body = payload.body;
        template.label = payload.label;
      } else if (action[2] === "activate") {
        if (!describeTemplate(template).can_activate) {
          return route.fulfill({ status: 409, json: { error: "template_variables_invalid", message: "invalid" } });
        }
        template.status = "active";
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
  await expect(dialog.getByText("Импортированных шаблонов пока нет.")).toBeVisible();

  // A file that is neither Word nor text is refused before any upload.
  await dialog.locator("#template-import-file").setInputFiles({
    name: "vertrag.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7"),
  });
  await expect(dialog.getByRole("alert")).toContainText("Word (.docx)");
  expect(calls).toEqual([]);

  await dialog.locator("#template-import-file").setInputFiles({
    name: "Bescheinigung.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Bescheinigung für {{patient_name}}, geboren am {{geburtsdatum}}."),
  });
  await expect(dialog.locator("#template-import-label")).toHaveValue("Bescheinigung");
  await dialog.getByRole("button", { name: "Импортировать" }).click();

  // The draft shows the unknown variable and cannot be activated.
  const selected = page.getByTestId("template-import-selected");
  await expect(selected).toContainText("Черновик");
  await expect(selected.getByRole("alert")).toContainText("{{geburtsdatum}}");
  await expect(selected.getByRole("button", { name: "Активировать" })).toBeDisabled();
  await page.screenshot({ path: "../artifacts/design-qa/template-import-unknown-variable.png" });

  // Corrected in place, saved, checked again.
  await selected.locator("#template-import-body").fill(
    "Bescheinigung für {{patient_name}}, geboren am {{birth_date}}.",
  );
  await selected.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(selected.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("template-import-sample")).toHaveText(
    "Bescheinigung für Max Mustermann, geboren am 01.02.1980.",
  );

  await selected.getByRole("button", { name: "Активировать" }).click();
  await expect(selected).toContainText("Активен");
  await expect(page.getByTestId("catalog-changes")).toHaveText("1");
  // The text of an active version is read-only.
  await expect(selected.locator("#template-import-body")).not.toBeEditable();
  expect(calls).toEqual(["import", "update", "activate"]);
  await page.screenshot({ path: "../artifacts/design-qa/template-import-active.png" });
});
