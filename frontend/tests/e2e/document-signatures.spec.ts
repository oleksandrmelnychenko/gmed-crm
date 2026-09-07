import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const previewPdf = readFileSync(new URL("./fixtures/signature-preview.pdf", import.meta.url));

const documentId = "ea3a0c15-792b-4a3a-9a7e-006300000001";
const document = { id: documentId, auto_name: "Rahmenvertrag – Testperson", original_filename: "vertrag.pdf", art: "framework_contract", category: "administrative", status: "active", visibility: "internal", is_medical: false, mime_type: "application/pdf", has_stored_file: true, file_size: 1000, version_root_document_id: documentId, version_number: 1, version_count: 1, is_latest_version: true, patient_id: null, order_id: null, appointment_id: null, klinik: null, ursprung: null, notes: null, generated_template_id: "framework_contract", data_sensitivity: "internal", created_at: "2026-09-05T10:00:00Z", updated_at: "2026-09-05T10:00:00Z" };

async function prepare(page: Page, enabled = true) {
  await page.routeWebSocket("**/api/**", socket => socket.close());
  const submissions: unknown[] = [];
  const connections: unknown[] = [];
  let defaults: unknown[] = [];
  const defaultSaves: unknown[] = [];
  let configured = enabled;
  let connectionUsername: string | null = null;
  let connectionMode = "demo";
  let status = "";
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "signature-fixture");
    localStorage.setItem("gmed_refresh_token", "signature-fixture-refresh");
    if (!localStorage.getItem("gmed_lang")) localStorage.setItem("gmed_lang", "de");
  });
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") body = { id: documentId, email: "fixture@example.org", name: "Signaturtest", role: "ceo", created_at: document.created_at };
    if (path === "/documents") body = [document];
    if (path === `/documents/${documentId}`) body = document;
    if (path === `/documents/${documentId}/versions`) body = [document];
    if (path === "/documents/meta/categories") body = { categories: [], arts: [] };
    if (/^\/documents\/[^/]+\/download$/.test(path)) {
      await route.fulfill({ contentType: "application/pdf", body: previewPdf });
      return;
    }
    if (path === "/document-signatures/signer-defaults") {
      if (route.request().method() === "PUT") {
        defaults = route.request().postDataJSON().signers;
        defaultSaves.push(defaults);
      }
      body = { signers: defaults };
    }
    if (path === "/documents/templates") body = { templates: [], text_blocks: [] };
    if (path === `/documents/${documentId}/text-extraction`) body = null;
    if (path === "/document-signatures/connection") {
      if (route.request().method() === "POST") {
        const credentials = route.request().postDataJSON();
        connections.push(credentials); configured = true;
        connectionUsername = credentials.username; connectionMode = credentials.mode;
      }
      body = { configured, region: "DE", mode: connectionMode, username: connectionUsername, source: "database" };
    }
    if (path === `/documents/${documentId}/signature-requests`) {
      if (route.request().method() === "POST") {
        submissions.push(route.request().postDataJSON()); status = "submission_unknown"; body = { id: "signature-fixture" };
      } else body = { enabled: configured, region: "DE", test_mode: false, can_send: true, can_configure: true, ineligible_reason: status === "completed" ? "document_superseded" : null,
        requests: status ? [{ id: "signature-fixture", status, test_mode: false, signers: (submissions[0] as { signers: unknown[] }).signers, evidence: { signatures: ["erika@example.org", "max@example.org"].map(email => ({ email, status: status === "completed" ? "SIGNED" : "OPEN", signed_at: status === "completed" ? document.created_at : null })) }, has_report: status === "completed", result_document_id: status === "completed" ? documentId : null, last_error: null, created_at: document.created_at }] : [] };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return { submissions, connections, defaultSaves, setStatus: (next: string) => { status = next; }, complete: () => { status = "completed"; } };
}

test("German workflow requires checked recipients and reconciles uncertain sending without duplication", async ({ page }) => {
  const fixture = await prepare(page);
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  await expect(page.getByText("Skribble · Deutschland", { exact: true })).toBeVisible();
  await expect(page.getByText("QES / eIDAS", { exact: true })).toBeVisible();
  const send = page.getByRole("button", { name: "Zur Unterschrift senden", exact: true });
  await expect(send).toBeDisabled();
  for (const [index, name, surname, email] of [[0, "Erika", "Mustermann", "erika@example.org"], [1, "Max", "Muster", "max@example.org"]] as const) {
    await page.getByLabel("Vorname", { exact: true }).nth(index).fill(name);
    await page.getByLabel("Nachname", { exact: true }).nth(index).fill(surname);
    await page.getByLabel("E-Mail", { exact: true }).nth(index).fill(email);
  }
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF/ }).check();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true }).screenshot({ path: "../artifacts/design-qa/signature-germany-mobile.png" });
  await send.click();
  await expect(page.getByText("Versand wird geprüft – bitte nicht erneut senden", { exact: true })).toBeVisible();
  await expect(send).toHaveCount(0);
  expect(fixture.submissions).toHaveLength(1);
  fixture.complete();
  await expect(page.getByText("PDF und Protokoll gespeichert", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole("button", { name: "Signiertes PDF", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Signaturprotokoll", exact: true })).toBeVisible();
  for (const [label, path, filename] of [
    ["PDF herunterladen", `/documents/${documentId}/download`, "signed.pdf"],
    ["Signaturprotokoll", "/document-signature-requests/signature-fixture/report", "signature-report.pdf"],
  ]) {
    await page.route(`**/api/v1${path}`, route => route.fulfill({ contentType: "application/pdf", body: "%PDF-1.7\nfixture result\n%%EOF" }));
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    expect((await download).suggestedFilename()).toBe(filename);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true }).screenshot({ path: "../artifacts/design-qa/signature-germany-completed.png" });
});

test("unconfigured integration does not offer sending", async ({ page }) => {
  const fixture = await prepare(page, false);
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  await expect(page.getByText(/muss das deutsche Skribble-Konto eingerichtet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Zur Unterschrift senden", exact: true })).toHaveCount(0);
  expect(fixture.submissions).toHaveLength(0);
});

test("registry action opens the selected PDF without navigating the row and also works inside its preview", async ({ page }) => {
  const fixture = await prepare(page);
  const stateReads: string[] = [];
  page.on("request", request => { if (request.url().endsWith("/signature-requests")) stateReads.push(request.url()); });
  await page.route(`**/api/v1/documents/${documentId}/download`, route => route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" }));
  await page.goto("/documents");
  const action = page.locator(`[data-document-signature-id="${documentId}"]:visible`);
  await expect(action).toBeVisible();
  expect(stateReads).toHaveLength(0);
  await action.focus();
  await action.press("Enter");
  const signing = page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true });
  await expect(signing.locator('[data-slot="dialog-description"]')).toHaveText("vertrag.pdf");
  await expect(signing.getByLabel("Vorname", { exact: true }).first()).toBeVisible();
  await signing.getByLabel("Vorname", { exact: true }).first().press("ArrowDown");
  await expect(page).toHaveURL(/\/documents$/);
  expect(stateReads.length).toBeGreaterThan(0);
  expect(new Set(stateReads).size).toBe(1);
  await page.keyboard.press("Escape");
  await expect(signing).toHaveCount(0);
  await page.locator(`[data-document-preview-id="${documentId}"]:visible`).click();
  const preview = page.getByRole("dialog").filter({ has: page.locator("iframe") });
  await expect(preview).toBeVisible();
  await preview.locator(`[data-document-signature-id="${documentId}"]`).click();
  await expect(signing.getByLabel("Vorname", { exact: true }).first()).toHaveValue("");
  await page.setViewportSize({ width: 390, height: 844 });
  await signing.screenshot({ path: "../artifacts/design-qa/signature-nested-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(signing).toHaveCount(0);
  await expect(preview).toBeVisible();
  expect(fixture.submissions).toHaveLength(0);
});

test("contract picker uses its patient context and resets recipients when the PDF changes", async ({ page }) => {
  const fixture = await prepare(page);
  const patientId = "ea3a0c15-792b-4a3a-9a7e-006300000010";
  const contractId = "ea3a0c15-792b-4a3a-9a7e-006300000011";
  const secondId = "ea3a0c15-792b-4a3a-9a7e-006300000002";
  const contract = { id: contractId, patient_id: patientId, patient_name: "Testperson", patient_pid: "P-TEST", contract_number: "RV-TEST", status: "draft", signed_at: null, valid_from: null, valid_to: null, conditions: {}, created_at: document.created_at, updated_at: document.updated_at };
  const reads: string[] = [];
  await page.route("**/api/v1/framework-contracts**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith(contractId) ? contract : [contract] }));
  await page.route("**/api/v1/documents**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/documents") {
      expect(url.searchParams.get("patient_id")).toBe(patientId);
      await route.fulfill({ json: [document, { ...document, id: secondId, auto_name: "Zweites PDF" }, { ...document, id: "image-only", mime_type: "image/png", auto_name: "Bild" }] });
    } else if (url.pathname.endsWith("/signature-requests")) {
      expect(route.request().method()).toBe("GET");
      reads.push(url.pathname);
      await route.fulfill({ json: { enabled: true, region: "DE", test_mode: false, can_send: true, can_configure: true, ineligible_reason: null, requests: [] } });
    } else await route.fallback();
  });
  await page.goto(`/contracts?contract=${contractId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: RV-TEST", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true });
  const picker = dialog.getByRole("combobox", { name: "PDF auswählen", exact: true });
  await expect(picker).toBeVisible();
  expect(reads).toHaveLength(0);
  await picker.click();
  await expect(page.getByRole("option", { name: /Bild/ })).toHaveCount(0);
  await page.getByRole("option", { name: /Rahmenvertrag – Testperson/ }).click();
  const pdf = dialog.getByRole("img", { name: "PDF, Seite 1", exact: true });
  await expect(pdf).toHaveAttribute("data-document-id", documentId);
  await dialog.getByLabel("Vorname", { exact: true }).first().fill("Erika");
  await dialog.getByRole("checkbox", { name: /^Person auswählen 2:/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ }).check();
  await picker.click();
  await page.getByRole("option", { name: /Zweites PDF/ }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByLabel("Vorname", { exact: true }).first()).toHaveValue("Erika");
  await expect(dialog.getByRole("checkbox", { name: /^Person auswählen 2:/ })).not.toBeChecked();
  await picker.click();
  await page.getByRole("option", { name: /Zweites PDF/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Ohne Speichern schließen", exact: true }).click();
  await expect(pdf).toHaveAttribute("data-document-id", secondId);
  await expect(dialog.getByLabel("Vorname", { exact: true }).first()).toHaveValue("");
  await expect(dialog.getByRole("checkbox", { name: /^Person auswählen 2:/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Zur Unterschrift senden", exact: true })).toBeDisabled();
  expect([...new Set(reads)]).toEqual([`/api/v1/documents/${documentId}/signature-requests`, `/api/v1/documents/${secondId}/signature-requests`]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.screenshot({ path: "../artifacts/design-qa/signature-contract-picker.png" });
  expect(fixture.submissions).toHaveLength(0);
});

test("connection protects edits, allows undo and closes cleanly after saving", async ({ page }) => {
  await prepare(page, false);
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  const open = page.getByRole("button", { name: "Skribble anmelden / verbinden", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Skribble verbinden", exact: true });
  const username = dialog.getByLabel("API-Benutzername", { exact: true });
  const key = dialog.getByLabel("API-Schlüssel", { exact: true });
  await username.fill("api_demo_fixture");
  await key.fill("fixture-secret-only");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(key).toHaveValue("fixture-secret-only");
  await username.fill("");
  await key.fill("");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await open.click();
  await username.fill("api_demo_fixture");
  await key.fill("fixture-secret-only");
  await dialog.getByRole("button", { name: "Prüfen und verbinden", exact: true }).click();
  await expect(key).toHaveCount(0);
  await dialog.getByRole("button", { name: "Verbindung ändern", exact: true }).click();
  await expect(key).toHaveValue("");
  await key.fill("replacement-secret");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Änderungen verwerfen", exact: true }).click();
  await expect(key).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("configured connection checks explicitly and retains setup when active signatures block disconnect", async ({ page }) => {
  await prepare(page);
  const actions: string[] = [];
  let blockDisconnect = true;
  let checkFails = true;
  await page.route("**/api/v1/document-signatures/connection/*", async route => {
    const action = new URL(route.request().url()).pathname.split("/").pop()!;
    actions.push(action);
    if (action === "disconnect" && blockDisconnect) await route.fulfill({ status: 409, json: { error: "signature_account_has_pending_requests" } });
    else if (action === "check" && checkFails) await route.fulfill({ status: 503, json: { error: "provider_login_failed" } });
    else await route.fulfill({ json: {} });
  });
  await page.goto("/admin/signatures");
  const disconnect = page.getByRole("button", { name: "Verbindung trennen", exact: true });
  const check = page.getByRole("button", { name: "Verbindung prüfen", exact: true });
  await expect(check).toBeEnabled();
  await expect(page.getByLabel("API-Schlüssel", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Verbindung ändern", exact: true }).click();
  await expect(disconnect).toBeEnabled();
  expect(actions).toEqual([]);
  await disconnect.click();
  await expect(page.getByRole("alert")).toHaveText("Bitte zuerst offene Signaturanfragen abschließen oder zurückziehen.");
  await expect(disconnect).toBeEnabled();
  await page.getByRole("button", { name: "Änderungen verwerfen", exact: true }).click();
  await check.click();
  await expect(page.getByRole("alert")).toHaveText("Verbindung nicht bestätigt. Bitte deutsches Konto und API-Zugang prüfen.");
  checkFails = false;
  await check.click();
  await expect(page.getByText("Verbindung erfolgreich geprüft.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  blockDisconnect = false;
  await page.getByRole("button", { name: "Verbindung ändern", exact: true }).click();
  await disconnect.click();
  await expect(page.getByText("Verbindung getrennt.", { exact: true })).toBeVisible();
  await expect(disconnect).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prüfen und verbinden", exact: true })).toBeDisabled();
  expect(actions).toEqual(["disconnect", "check", "check", "disconnect"]);
});

for (const [lang, mode] of [["ru", "demo"], ["de", "live"]] as const) {
  test(`connected ${mode} summary in ${lang} edits only on request and cancels without replacing credentials`, async ({ page }) => {
    const fixture = await prepare(page);
    await page.addInitScript(language => localStorage.setItem("gmed_lang", language), lang);
    const savedUsername = "api_demo_gmedagenturfrpatientenbetreuung_37a9_fixture";
    let releaseDiscovery!: () => void;
    const discovery = new Promise<void>(resolve => { releaseDiscovery = resolve; });
    await page.route("**/api/v1/document-signatures/connection", async route => {
      if (route.request().method() !== "GET") return route.fallback();
      await discovery;
      await route.fulfill({ json: { configured: true, region: "DE", mode, username: savedUsername, source: "database" } });
    });
    await page.goto("/admin/signatures");
    const key = page.getByLabel(lang === "ru" ? "API-ключ" : "API-Schlüssel", { exact: true });
    const username = page.getByLabel(lang === "ru" ? "Имя API-пользователя" : "API-Benutzername", { exact: true });
    const change = page.getByRole("button", { name: lang === "ru" ? "Изменить подключение" : "Verbindung ändern", exact: true });
    await expect(page.getByText(lang === "ru" ? "Загрузка подключения…" : "Verbindung wird geladen…", { exact: true })).toBeVisible();
    await expect(key).toHaveCount(0);
    releaseDiscovery();
    await expect(change).toBeEnabled();
    await expect(page.getByText(savedUsername, { exact: true })).toBeVisible();
    await expect(page.getByText(lang === "ru" ? "Тестовый · DEMO" : "Echtbetrieb · QES / eIDAS", { exact: true })).toBeVisible();
    await expect(key).toHaveCount(0);
    await expect(username).toHaveCount(0);
    await expect(page.getByRole("button", { name: lang === "ru" ? "Проверить и подключить" : "Prüfen und verbinden", exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
    await page.screenshot({ path: `../artifacts/design-qa/signature-connected-${lang}-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `../artifacts/design-qa/signature-connected-${lang}-desktop.png` });
    await change.click();
    await expect(username).toHaveValue(savedUsername);
    await expect(key).toHaveValue("");
    const save = page.getByRole("button", { name: lang === "ru" ? "Проверить и сохранить" : "Prüfen und speichern", exact: true });
    await expect(save).toBeDisabled();
    await username.fill("api_demo_replacement");
    await key.fill("replacement-secret");
    await expect(save).toBeEnabled();
    await page.getByRole("button", { name: lang === "ru" ? "Отменить изменения" : "Änderungen verwerfen", exact: true }).click();
    await expect(page.getByText(savedUsername, { exact: true })).toBeVisible();
    await expect(key).toHaveCount(0);
    expect(fixture.connections).toHaveLength(0);
    await change.click();
    await expect(username).toHaveValue(savedUsername);
    await expect(key).toHaveValue("");
    await key.fill("replacement-secret");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
    await page.screenshot({ path: `../artifacts/design-qa/signature-edit-${lang}-mobile.png` });
    await save.click();
    await expect(key).toHaveCount(0);
    await expect(change).toBeEnabled();
    expect(fixture.connections).toEqual([{ username: savedUsername, api_key: "replacement-secret", mode }]);
    await change.click();
    await expect(key).toHaveValue("");
  });
}

test("uncertain creation stays disabled through failed reconciliation, then allows refresh and withdrawal", async ({ page }) => {
  const fixture = await prepare(page);
  let failReads = false;
  let postAttempts = 0;
  const requestPath = `**/api/v1/documents/${documentId}/signature-requests`;
  await page.route(requestPath, async route => {
    if (route.request().method() === "POST") {
      postAttempts++;
      // The server may have accepted a request before its response was lost.
      fixture.submissions.push(route.request().postDataJSON());
      fixture.setStatus("pending");
      failReads = true;
      await route.fulfill({ status: 504, json: { error: "gateway_timeout" } });
    } else if (failReads) await route.fulfill({ status: 503, json: { error: "temporarily_unavailable" } });
    else await route.fallback();
  });
  const actions: string[] = [];
  await page.route("**/api/v1/document-signature-requests/signature-fixture/*", async route => {
    const action = new URL(route.request().url()).pathname.split("/").pop()!;
    actions.push(action);
    if (action === "withdraw") fixture.setStatus("withdrawn");
    await route.fulfill({ json: {} });
  });
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  for (const [index, name, surname, email] of [[0, "Erika", "Mustermann", "erika@example.org"], [1, "Max", "Muster", "max@example.org"]] as const) {
    await page.getByLabel("Vorname", { exact: true }).nth(index).fill(name);
    await page.getByLabel("Nachname", { exact: true }).nth(index).fill(surname);
    await page.getByLabel("E-Mail", { exact: true }).nth(index).fill(email);
  }
  await page.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ }).check();
  const send = page.getByRole("button", { name: "Zur Unterschrift senden", exact: true });
  await send.click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ }).uncheck();
  await page.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ }).check();
  await expect(send).toBeDisabled();
  expect(postAttempts).toBe(1);
  failReads = false;
  await expect(page.getByText("Unterschriften ausstehend", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Status prüfen", exact: true }).click();
  await page.getByRole("button", { name: "Anfrage zurückziehen", exact: true }).click();
  await expect(page.getByText("Anfrage zurückgezogen", { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
  expect(actions).toEqual(["refresh", "withdraw"]);
  expect(postAttempts).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("view-only permissions show history without mutation controls", async ({ page }) => {
  const fixture = await prepare(page);
  await page.route(`**/api/v1/documents/${documentId}/signature-requests`, route => route.fulfill({ json: {
    enabled: true, region: "DE", test_mode: false, can_send: false, can_configure: false, ineligible_reason: null,
    requests: [{ id: "read-only", status: "pending", test_mode: false, signers: [], evidence: {}, has_report: false, result_document_id: null, last_error: null, created_at: document.created_at }],
  } }));
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  await expect(page.getByText("Unterschriften ausstehend", { exact: true })).toBeVisible();
  for (const name of ["Zur Unterschrift senden", "Status prüfen", "Anfrage zurückziehen"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Skribble anmelden / verbinden", exact: true }).click();
  await expect(page.getByText("Die API-Anbindung von GMED richtet die Administration ein.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prüfen und verbinden", exact: true })).toHaveCount(0);
  expect(fixture.submissions).toHaveLength(0);
});

test("unavailable PDFs and denied document access cannot send invitations", async ({ page }) => {
  const fixture = await prepare(page);
  let forbidden = false;
  await page.route(`**/api/v1/documents/${documentId}/signature-requests`, route => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill(forbidden
      ? { status: 403, json: { error: "Insufficient permissions" } }
      : { json: { enabled: true, region: "DE", test_mode: false, can_send: true, can_configure: true, ineligible_reason: "pdf_required", requests: [] } });
  });
  await page.goto(`/documents/${documentId}`);
  const action = page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true });
  await action.click();
  const dialog = page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true });
  await expect(dialog.getByText(/Laden Sie zuerst die PDF-Version hoch/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zur Unterschrift senden", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  forbidden = true;
  await action.click();
  await expect(dialog.getByRole("alert")).toHaveText("Keine Berechtigung für die elektronische Signatur dieses Dokuments.");
  await expect(dialog.getByRole("button", { name: "Zur Unterschrift senden", exact: true })).toHaveCount(0);
  await page.route("**/api/v1/me", route => route.fulfill({ json: { id: documentId, email: "fixture@example.org", name: "Read only", role: "concierge", created_at: document.created_at } }));
  await page.reload();
  await expect(page.getByRole("heading", { name: document.auto_name, exact: true })).toBeVisible();
  await expect(action).toHaveCount(0);
  expect(fixture.submissions).toHaveLength(0);
});

for (const [lang, initialStatus] of [["ru", 503], ["de", 404]] as const) {
  test(`connection opens quietly after a ${initialStatus} discovery response in ${lang}`, async ({ page }) => {
    const fixture = await prepare(page, false);
    await page.addInitScript(language => localStorage.setItem("gmed_lang", language), lang);
    let rejectCredentials = true;
    let attemptedSaves = 0;
    await page.route("**/api/v1/document-signatures/connection", async route => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: initialStatus, json: { error: "connection_unavailable" } });
      } else if (rejectCredentials) {
        attemptedSaves++;
        await route.fulfill({ status: 422, json: { error: "signature_credentials_invalid" } });
      } else {
        await route.fallback();
      }
    });
    await page.goto("/admin/signatures");
    const username = page.getByLabel(lang === "ru" ? "Имя API-пользователя" : "API-Benutzername", { exact: true });
    const key = page.getByLabel(lang === "ru" ? "API-ключ" : "API-Schlüssel", { exact: true });
    const save = page.getByRole("button", { name: lang === "ru" ? "Проверить и подключить" : "Prüfen und verbinden", exact: true });
    await expect(username).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(save).toBeDisabled();
    expect(attemptedSaves).toBe(0);
    await username.fill("api_demo_fixture");
    await key.fill("fixture-secret-only");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await save.click();
    await expect(page.getByRole("alert")).toHaveText(lang === "ru"
      ? "Проверьте API-имя, ключ и выбранный режим."
      : "Bitte API-Benutzer, Schlüssel und Betriebsart prüfen.");
    expect(attemptedSaves).toBe(1);
    await expect(key).toHaveValue("fixture-secret-only");
    rejectCredentials = false;
    await save.click();
    await expect(key).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(fixture.connections).toHaveLength(1);
  });
}

test("separate German connection dialog validates setup and clears the secret", async ({ page }) => {
  const fixture = await prepare(page, false);
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  const open = page.getByRole("button", { name: "Skribble anmelden / verbinden", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Skribble verbinden", exact: true });
  await expect(dialog.getByRole("link", { name: "Skribble-Konto öffnen" })).toHaveAttribute("href", "https://my.skribble.de/");
  await expect(dialog.getByRole("link", { name: "Skribble-Konto öffnen" })).toHaveAttribute("target", "_blank");
  await dialog.getByLabel("API-Benutzername", { exact: true }).fill("api_demo_fixture");
  const key = dialog.getByLabel("API-Schlüssel", { exact: true });
  await expect(key).toHaveAttribute("type", "password");
  await key.fill("fixture-secret-only");
  await dialog.getByRole("button", { name: "Prüfen und verbinden", exact: true }).click();
  await expect(dialog.getByText("Verbindung geprüft und gespeichert.", { exact: true })).toBeVisible();
  await expect(key).toHaveCount(0);
  expect(fixture.connections).toEqual([{ username: "api_demo_fixture", api_key: "fixture-secret-only", mode: "demo" }]);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain("fixture-secret-only");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await dialog.screenshot({ path: "../artifacts/design-qa/signature-login-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await open.click();
  await expect(dialog.getByText("api_demo_fixture", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("API-Schlüssel", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.screenshot({ path: "../artifacts/design-qa/signature-login-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true })).toHaveCount(0);
  await page.locator('a[href="/admin/signatures"]').click();
  await expect(page).toHaveURL(/\/admin\/signatures$/);
  await expect(page.getByRole("heading", { name: "Elektronische Signatur", exact: true })).toBeVisible();
  await expect(page.getByText("api_demo_fixture", { exact: true })).toBeVisible();
  await expect(page.getByLabel("API-Schlüssel", { exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("gmed_lang", "ru"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Электронная подпись", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Кабинет Skribble", exact: true })).toHaveAttribute("href", "https://my.skribble.de/");
  await page.locator('a[href="/admin/signatures"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../artifacts/design-qa/signature-admin-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "../artifacts/design-qa/signature-admin-mobile.png" });
  expect(fixture.submissions).toHaveLength(0);
});


for (const lang of ["de", "ru"] as const) {
  test(`central agency defaults and document client form an editable preview workspace in ${lang}`, async ({ page }) => {
    const fixture = await prepare(page);
    await page.addInitScript(language => localStorage.setItem("gmed_lang", language), lang);
    const tx = (ru: string, de: string) => lang === "de" ? de : ru;
    const client = { first_name: "Erika", last_name: "Mustermann", email: "erika@example.org", role: "client" };
    const agency = { first_name: "Max", last_name: "Muster", email: "max@example.org", role: "agency" };
    await page.route(`**/api/v1/documents/${documentId}/signature-requests`, async route => {
      if (route.request().method() === "POST" || fixture.submissions.length) return route.fallback();
      await route.fulfill({ json: { enabled: true, region: "DE", test_mode: true, can_send: true, can_configure: true, ineligible_reason: null, requests: [], suggested_signers: [client, agency] } });
    });
    await page.goto("/admin/signatures");
    await page.getByRole("button", { name: tx("Настроить представителей", "Vertretungen einrichten"), exact: true }).click();
    await page.getByLabel(tx("Имя", "Vorname"), { exact: true }).fill(agency.first_name);
    await page.getByLabel(tx("Фамилия", "Nachname"), { exact: true }).fill(agency.last_name);
    await page.getByLabel("E-Mail", { exact: true }).fill(agency.email);
    await page.getByRole("button", { name: tx("Сохранить представителей", "Vertretungen speichern"), exact: true }).click();
    await expect(page.getByText("Max Muster", { exact: true })).toBeVisible();
    expect(fixture.defaultSaves).toEqual([[agency]]);
    await page.reload();
    await expect(page.getByText("Max Muster", { exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-qa/signature-defaults-${lang}-desktop.png` });
    await page.goto(`/documents/${documentId}`);
    const action = page.getByRole("button", { name: `${tx("Электронная подпись", "Elektronische Unterschrift")}: vertrag.pdf`, exact: true });
    await action.click();
    const dialog = page.getByRole("dialog", { name: tx("Электронная подпись", "Elektronische Unterschrift"), exact: true });
    const pdf = dialog.getByRole("img", { name: tx("PDF, страница 1", "PDF, Seite 1"), exact: true });
    await expect(pdf).toHaveAttribute("data-document-id", documentId);
    await expect(pdf).toHaveAccessibleDescription(/GMED.*DEMO SIGNATURE TEST/);
    await expect(dialog.getByRole("button", { name: tx("Скачать исходный документ", "Ausgangsdokument herunterladen"), exact: true })).toHaveCount(0);
    await expect(dialog.getByText("Erika Mustermann", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Max Muster", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel(tx("Имя", "Vorname"), { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await action.click();
    await expect(pdf).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect.poll(async () => {
      const left = await pdf.boundingBox();
      const right = await dialog.getByRole("region", { name: tx("Подписание документа", "Dokument unterzeichnen"), exact: true }).boundingBox();
      return !!left && !!right && left.x + left.width <= right.x;
    }).toBe(true);
    await expect(pdf).toHaveAccessibleDescription(/GMED.*DEMO SIGNATURE TEST/);
    expect(await pdf.evaluate(canvas => {
      const context = (canvas as HTMLCanvasElement).getContext("2d")!;
      const pixels = context.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data;
      return pixels.some((value, index) => index % 4 !== 3 && value < 180);
    })).toBe(true);
    await dialog.screenshot({ path: `../artifacts/design-qa/signature-workspace-${lang}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
    await expect(pdf).toHaveAccessibleDescription(/GMED.*DEMO SIGNATURE TEST/);
    await dialog.screenshot({ path: `../artifacts/design-qa/signature-workspace-${lang}-mobile-preview.png` });
    await dialog.getByText("Max Muster", { exact: true }).scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: `../artifacts/design-qa/signature-workspace-${lang}-mobile.png` });
    await dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ }).check();
    await dialog.getByRole("button", { name: `${tx("Изменить подписанта", "Person bearbeiten")} 1`, exact: true }).click();
    const firstName = dialog.getByLabel(tx("Имя", "Vorname"), { exact: true });
    await firstName.fill("Erika Maria");
    await expect(dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ })).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(firstName).toHaveValue("Erika Maria");
    await dialog.getByRole("button", { name: tx("Готово", "Fertig"), exact: true }).click();
    await dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ }).check();
    await dialog.getByRole("button", { name: tx("Отправить на подпись", "Zur Unterschrift senden"), exact: true }).click();
    await expect.poll(() => fixture.submissions.length).toBe(1);
    expect(fixture.submissions).toEqual([{ signers: [{ ...client, first_name: "Erika Maria" }, agency] }]);
    expect(fixture.defaultSaves).toEqual([[agency]]);
  });
}

test("PDF pages and zoom render without a browser PDF plugin or native iterator and binary helpers", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, "Iterator");
    Reflect.deleteProperty(Map.prototype, "getOrInsertComputed");
    Reflect.deleteProperty(Uint8Array.prototype, "toBase64");
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const multipagePdf = readFileSync(new URL("./fixtures/signature-preview-multipage.pdf", import.meta.url));
  await page.route(`**/api/v1/documents/${documentId}/download`, route => route.fulfill({ contentType: "application/pdf", body: multipagePdf }));
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true });
  const previous = dialog.getByRole("button", { name: "Vorherige Seite", exact: true });
  const next = dialog.getByRole("button", { name: "Nächste Seite", exact: true });
  const first = dialog.getByRole("img", { name: "PDF, Seite 1", exact: true });
  await expect(first).toHaveAccessibleDescription(/GMED.*DEMO SIGNATURE TEST/);
  await expect(previous).toBeDisabled();
  await expect(dialog.getByLabel("PDF zur Unterschrift", { exact: true }).getByText("1 / 2", { exact: true })).toBeVisible();
  const fittedWidth = (await first.boundingBox())!.width;
  await dialog.getByRole("button", { name: "Vergrößern", exact: true }).click();
  await expect.poll(async () => (await first.boundingBox())?.width ?? 0).toBeGreaterThan(fittedWidth * 1.2);
  await next.click();
  await expect(dialog.getByRole("img", { name: "PDF, Seite 2", exact: true })).toHaveAccessibleDescription(/GMED.*DEMO SIGNATURE TEST/);
  await expect(next).toBeDisabled();
  await expect(dialog.getByLabel("PDF zur Unterschrift", { exact: true }).getByText("2 / 2", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "125%", exact: true }).click();
  await previous.click();
  await expect(first).toHaveAccessibleDescription(/GMED.*DEMO SIGNATURE TEST/);
  await expect.poll(async () => Math.round((await first.boundingBox())?.width ?? 0)).toBe(Math.round(fittedWidth));
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("preview failures block sending until a successful retry and completed DEMO hides the new composer", async ({ page }) => {
  const fixture = await prepare(page);
  const signers = [
    { first_name: "Erika", last_name: "Mustermann", email: "erika@example.org", role: "client" },
    { first_name: "Max", last_name: "Muster", email: "max@example.org", role: "agency" },
  ];
  let completed = false;
  await page.route(`**/api/v1/documents/${documentId}/signature-requests`, route => route.fulfill({ json: {
    enabled: true, region: "DE", test_mode: true, can_send: true, can_configure: true, ineligible_reason: null, suggested_signers: signers,
    requests: completed ? [{ id: "completed-demo", status: "completed", test_mode: true, signers, evidence: {}, has_report: true, result_document_id: documentId, last_error: null, created_at: document.created_at }] : [],
  } }));
  let previewFailure: "http" | "invalid-pdf" | null = "http";
  await page.route(`**/api/v1/documents/${documentId}/download`, route => previewFailure === "http"
    ? route.fulfill({ status: 503, json: { error: "unavailable" } })
    : previewFailure === "invalid-pdf" ? route.fulfill({ contentType: "application/pdf", body: "not a PDF" }) : route.fallback());
  await page.goto(`/documents/${documentId}`);
  const action = page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true });
  await action.click();
  const dialog = page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true });
  await expect(dialog.getByText(/PDF konnte nicht geöffnet werden/)).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ }).check();
  const send = dialog.getByRole("button", { name: "Zur Unterschrift senden", exact: true });
  await expect(send).toBeDisabled();
  previewFailure = "invalid-pdf";
  await dialog.getByRole("button", { name: "Erneut laden", exact: true }).click();
  await expect(dialog.getByText(/PDF konnte nicht geöffnet werden/)).toBeVisible();
  await expect(send).toBeDisabled();
  previewFailure = null;
  await dialog.getByRole("button", { name: "Erneut laden", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "PDF, Seite 1", exact: true })).toBeVisible();
  await expect(send).toBeEnabled();
  await dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ }).uncheck();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  completed = true;
  await action.click();
  await expect(dialog.getByText("TEST · PDF und Protokoll gespeichert", { exact: true })).toBeVisible();
  await expect(send).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Neue Signaturanfrage", exact: true }).click();
  await expect(send).toBeDisabled();
  await expect(dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ })).not.toBeChecked();
  expect(fixture.submissions).toHaveLength(0);
});

for (const lang of ["de", "ru"] as const) {
  test(`recipient checkboxes select one or both without changing defaults in ${lang}`, async ({ page }) => {
    const fixture = await prepare(page);
    await page.addInitScript(language => localStorage.setItem("gmed_lang", language), lang);
    const tx = (ru: string, de: string) => lang === "de" ? de : ru;
    const client = { first_name: "Erika", last_name: "Mustermann", email: "erika@example.org", role: "client" };
    const agency = { first_name: "Max", last_name: "Muster", email: "max@example.org", role: "agency" };
    await page.route(`**/api/v1/documents/${documentId}`, route => route.fulfill({ json: { ...document, generated_template_id: "confidentiality_release", art: "confidentiality_release" } }));
    await page.route(`**/api/v1/documents/${documentId}/signature-requests`, async route => {
      if (route.request().method() === "POST" || fixture.submissions.length) return route.fallback();
      await route.fulfill({ json: { enabled: true, region: "DE", test_mode: true, can_send: true, can_configure: true, ineligible_reason: null, requests: [], suggested_signers: [client, agency] } });
    });
    await page.goto(`/documents/${documentId}`);
    const action = page.getByRole("button", { name: `${tx("Электронная подпись", "Elektronische Unterschrift")}: vertrag.pdf`, exact: true });
    await action.click();
    const dialog = page.getByRole("dialog", { name: tx("Электронная подпись", "Elektronische Unterschrift"), exact: true });
    const clientChoice = dialog.getByRole("checkbox", { name: `${tx("Выбрать подписанта", "Person auswählen")} 1: Erika Mustermann`, exact: true });
    const agencyChoice = dialog.getByRole("checkbox", { name: `${tx("Выбрать подписанта", "Person auswählen")} 2: Max Muster`, exact: true });
    const consent = dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF|Я проверил сохранённый PDF/ });
    const send = dialog.getByRole("button", { name: tx("Отправить на подпись", "Zur Unterschrift senden"), exact: true });
    await expect(clientChoice).toBeChecked();
    await expect(agencyChoice).toBeChecked();
    await expect(dialog.getByText("2 / 2", { exact: true })).toBeVisible();
    await consent.check();
    await expect(send).toBeEnabled();
    await agencyChoice.uncheck();
    await expect(consent).not.toBeChecked();
    await expect(send).toBeDisabled();
    await expect(dialog.getByText("1 / 2", { exact: true })).toBeVisible();
    await consent.check();
    await expect(send).toBeEnabled();
    await clientChoice.uncheck();
    await expect(consent).not.toBeChecked();
    await expect(dialog.getByText("0 / 2", { exact: true })).toBeVisible();
    await consent.check();
    await expect(send).toBeDisabled();
    await clientChoice.check();
    await agencyChoice.check();
    await expect(dialog.getByText("2 / 2", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await action.click();
    await clientChoice.uncheck();
    await expect(dialog.getByText("Erika Mustermann", { exact: true })).toBeVisible();
    await expect(dialog.getByText("erika@example.org", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(clientChoice).not.toBeChecked();
    await expect(agencyChoice).toBeChecked();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(dialog.getByRole("img", { name: tx("PDF, страница 1", "PDF, Seite 1"), exact: true })).toHaveAccessibleDescription(/GMED.*DEMO SIGNATURE TEST/);
    await dialog.screenshot({ path: `../artifacts/design-qa/signature-selection-${lang}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
    await agencyChoice.scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: `../artifacts/design-qa/signature-selection-${lang}-mobile.png` });
    await consent.check();
    await send.click();
    await expect.poll(() => fixture.submissions.length).toBe(1);
    expect(fixture.submissions).toEqual([{ signers: [agency] }]);
    expect(fixture.defaultSaves).toEqual([]);
    await expect(dialog.getByText(tx("Проверяем отправку — повторно не отправляйте", "Versand wird geprüft – bitte nicht erneut senden"), { exact: true })).toBeVisible();
    await expect(clientChoice).toHaveCount(0);
    await expect(send).toHaveCount(0);
  });
}

for (const lang of ["ru", "de"] as const) {
  test(`signature result is previewed automatically and registry status follows the latest request in ${lang}`, async ({ page }) => {
    await prepare(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(language => localStorage.setItem("gmed_lang", language), lang);
    const tx = (ru: string, de: string) => lang === "de" ? de : ru;
    const resultId = "ea3a0c15-792b-4a3a-9a7e-006300000099";
    const otherId = "ea3a0c15-792b-4a3a-9a7e-006300000088";
    let completed = false;
    const summaries: string[][] = [];
    const downloads: string[] = [];
    const person = { first_name: "Erika", last_name: "Mustermann", email: "erika@example.org", role: "client" };
    await page.route("**/api/v1/documents?*", route => route.fulfill({ json: [document, { ...document, id: otherId, original_filename: "second.pdf" }] }));
    await page.route("**/api/v1/documents", route => route.fulfill({ json: [document, { ...document, id: otherId, original_filename: "second.pdf" }] }));
    await page.route("**/api/v1/document-signatures/statuses?*", route => {
      const ids = new URL(route.request().url()).searchParams.get("ids")!.split(",");
      summaries.push(ids);
      return route.fulfill({ json: [{ document_id: documentId, status: completed ? "completed" : "pending", test_mode: true, result_document_id: completed ? resultId : null }] });
    });
    await page.route(`**/api/v1/documents/${documentId}/signature-requests`, route => route.fulfill({ json: {
      enabled: true, region: "DE", test_mode: true, can_send: true, can_configure: true, ineligible_reason: null,
      requests: [{ id: "current", status: completed ? "completed" : "pending", test_mode: true, signers: [person],
        evidence: { signatures: [{ email: person.email, status: completed ? "SIGNED" : "OPEN", signed_at: completed ? document.created_at : null }] },
        has_report: completed, result_document_id: completed ? resultId : null, last_error: null, created_at: "2026-09-06T11:15:29Z" }],
    } }));
    await page.route("**/api/v1/documents/*/download", route => {
      downloads.push(new URL(route.request().url()).pathname);
      return route.fulfill({ contentType: "application/pdf", body: previewPdf });
    });
    await page.goto("/documents");
    const action = page.locator(`[data-document-signature-id="${documentId}"]:visible`);
    await expect(action).toHaveAttribute("data-signature-status", "pending");
    await expect(action).toHaveAttribute("title", `TEST · ${tx("Ожидание подписей", "Unterschriften ausstehend")}`);
    expect(summaries.some(ids => ids.includes(documentId) && ids.includes(otherId))).toBe(true);
    await action.click();
    const dialog = page.getByRole("dialog", { name: tx("Электронная подпись", "Elektronische Unterschrift"), exact: true });
    await expect(dialog.getByText(tx("Ожидает подписи", "Unterschrift ausstehend"), { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: tx("Открыть PDF", "PDF öffnen"), exact: true })).toHaveCount(0);
    completed = true;
    await expect(dialog.getByRole("button", { name: tx("Открыть PDF", "PDF öffnen"), exact: true })).toBeVisible({ timeout: 12_000 });
    const versions = dialog.getByLabel(tx("Версия PDF", "PDF-Version"), { exact: true });
    const result = versions.getByRole("button", { name: `TEST · ${tx("Подписанный PDF", "Signiertes PDF")}`, exact: true });
    await expect(result).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => downloads.includes(`/api/v1/documents/${resultId}/download`)).toBe(true);
    await expect(dialog.getByRole("img", { name: tx("PDF, страница 1", "PDF, Seite 1"), exact: true })).toBeVisible();
    await versions.getByRole("button", { name: tx("Исходный PDF", "Original-PDF"), exact: true }).click();
    await expect(result).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => downloads.at(-1)).toBe(`/api/v1/documents/${documentId}/download`);
    await dialog.getByRole("button", { name: tx("Открыть PDF", "PDF öffnen"), exact: true }).click();
    await expect(result).toHaveAttribute("aria-pressed", "true");
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: tx("Скачать PDF", "PDF herunterladen"), exact: true }).click();
    expect((await download).suggestedFilename()).toBe("TEST-signed.pdf");
    await expect(dialog.getByRole("img", { name: tx("PDF, страница 1", "PDF, Seite 1"), exact: true })).toBeVisible();
    await dialog.screenshot({ path: `../artifacts/design-qa/signature-result-${lang}-desktop.png` });
    await page.keyboard.press("Escape");
    await expect(action).toHaveAttribute("data-signature-status", "completed");
    await expect(action).toHaveAttribute("title", `TEST · ${tx("Подписано", "Unterzeichnet")}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await action.click();
    await expect(dialog.getByRole("img", { name: tx("PDF, страница 1", "PDF, Seite 1"), exact: true })).toBeVisible();
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
    await dialog.screenshot({ path: `../artifacts/design-qa/signature-result-${lang}-mobile.png` });
    await page.keyboard.press("Escape");
    await expect(action).toHaveAttribute("data-signature-status", "completed");
    await expect(action).toHaveAttribute("title", `TEST · ${tx("Подписано", "Unterzeichnet")}`);
  });
}

test("an old signed PDF does not hide a newer pending request", async ({ page }) => {
  const fixture = await prepare(page);
  const oldResult = "ea3a0c15-792b-4a3a-9a7e-006300000099";
  const signer = { first_name: "Erika", last_name: "Mustermann", email: "erika@example.org", role: "client" };
  const reads: string[] = [];
  await page.route(`**/api/v1/documents/${documentId}/signature-requests`, route => route.fulfill({ json: {
    enabled: true, region: "DE", test_mode: true, can_send: true, can_configure: true, ineligible_reason: null,
    requests: [
      { id: "newer", status: "pending", test_mode: true, signers: [signer], evidence: {}, has_report: false, result_document_id: null, last_error: null, created_at: "2026-09-06T11:15:29Z" },
      { id: "older", status: "completed", test_mode: true, signers: [signer], evidence: {}, has_report: true, result_document_id: oldResult, last_error: null, created_at: document.created_at },
    ],
  } }));
  page.on("request", request => { if (request.url().endsWith("/download")) reads.push(request.url()); });
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true });
  await expect(dialog.getByRole("region", { name: "Aktuelle Signaturanfrage", exact: true }).getByText("TEST · Unterschriften ausstehend", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Frühere Signaturanfrage", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("PDF-Version", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("img", { name: "PDF, Seite 1", exact: true })).toBeVisible();
  expect(reads.some(url => url.includes(oldResult))).toBe(false);
  await dialog.getByRole("region", { name: "Frühere Signaturanfrage", exact: true }).getByRole("button", { name: "PDF öffnen", exact: true }).click();
  await expect.poll(() => reads.some(url => url.includes(oldResult))).toBe(true);
  expect(fixture.submissions).toHaveLength(0);
});

test("a signed copy opens its actual source, while a new request previews the selected copy", async ({ page }) => {
  const fixture = await prepare(page);
  const originalId = "ea3a0c15-792b-4a3a-9a7e-006300000077";
  const signer = { first_name: "Max", last_name: "Muster", email: "max@example.org", role: "agency" };
  await page.route(`**/api/v1/documents/${documentId}/signature-requests`, route => route.fulfill({ json: {
    enabled: true, region: "DE", test_mode: true, can_send: true, can_configure: true, ineligible_reason: null, suggested_signers: [signer],
    requests: [{ id: "completed", source_document_id: originalId, status: "completed", test_mode: true, signers: [signer], evidence: {}, has_report: true, result_document_id: documentId, last_error: null, created_at: document.created_at }],
  } }));
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true });
  const canvas = dialog.getByRole("img", { name: "PDF, Seite 1", exact: true });
  await expect(canvas).toHaveAttribute("data-document-id", documentId);
  await dialog.getByRole("button", { name: "Original-PDF", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-document-id", originalId);
  await dialog.getByRole("button", { name: "Neue Signaturanfrage", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-document-id", documentId);
  await dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF/ }).check();
  await expect(dialog.getByRole("button", { name: "Zur Unterschrift senden", exact: true })).toBeEnabled();
  expect(fixture.submissions).toHaveLength(0);
});

test("unchecked incomplete recipients retain their selection when another row is removed or added", async ({ page }) => {
  const fixture = await prepare(page);
  const agency = { first_name: "Max", last_name: "Muster", email: "max@example.org", role: "agency" };
  const other = { first_name: "Anna", last_name: "Beispiel", email: "anna@example.org", role: "other" };
  await page.route(`**/api/v1/documents/${documentId}/signature-requests`, async route => {
    if (route.request().method() === "POST" || fixture.submissions.length) return route.fallback();
    await route.fulfill({ json: { enabled: true, region: "DE", test_mode: true, can_send: true, can_configure: true, ineligible_reason: null, requests: [], suggested_signers: [{ first_name: "", last_name: "", email: "", role: "client" }, agency, other] } });
  });
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true });
  const choice = (index: number) => dialog.getByRole("checkbox", { name: new RegExp(`^Person auswählen ${index}:`) });
  const consent = dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF/ });
  const send = dialog.getByRole("button", { name: "Zur Unterschrift senden", exact: true });
  await choice(1).uncheck();
  await choice(3).uncheck();
  await expect(dialog.getByLabel("Vorname", { exact: true })).toHaveCount(0);
  await consent.check();
  await expect(send).toBeEnabled();
  await dialog.getByRole("button", { name: "Person entfernen 1", exact: true }).click();
  await expect(choice(1)).toBeChecked();
  await expect(choice(2)).not.toBeChecked();
  await expect(consent).not.toBeChecked();
  await dialog.getByRole("button", { name: "Person hinzufügen", exact: true }).click();
  await expect(choice(3)).toBeChecked();
  await consent.check();
  await expect(send).toBeDisabled();
  await choice(3).uncheck();
  await dialog.getByRole("button", { name: "Person entfernen 2", exact: true }).click();
  await expect(choice(1)).toBeChecked();
  await expect(choice(2)).not.toBeChecked();
  await expect(dialog.getByText("1 / 2", { exact: true })).toBeVisible();
  await consent.check();
  await send.click();
  await expect.poll(() => fixture.submissions.length).toBe(1);
  expect(fixture.submissions).toEqual([{ signers: [agency] }]);
});

test("contract recipient validation retains the selection and permits correcting it", async ({ page }) => {
  const fixture = await prepare(page);
  const client = { first_name: "Erika", last_name: "Mustermann", email: "erika@example.org", role: "client" };
  const agency = { first_name: "Max", last_name: "Muster", email: "max@example.org", role: "agency" };
  const rejected: unknown[] = [];
  await page.route(`**/api/v1/documents/${documentId}/signature-requests`, async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.signers.length === 1) {
        rejected.push(body);
        return route.fulfill({ status: 422, json: { error: "both_contract_parties_required" } });
      }
      return route.fallback();
    }
    if (fixture.submissions.length) return route.fallback();
    await route.fulfill({ json: { enabled: true, region: "DE", test_mode: true, can_send: true, can_configure: true, ineligible_reason: null, requests: [], suggested_signers: [client, agency] } });
  });
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true });
  const agencyChoice = dialog.getByRole("checkbox", { name: "Person auswählen 2: Max Muster", exact: true });
  const consent = dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF/ });
  const send = dialog.getByRole("button", { name: "Zur Unterschrift senden", exact: true });
  await agencyChoice.uncheck();
  await consent.check();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(dialog.getByRole("alert")).toHaveText("Verträge benötigen Kunde und Agenturvertretung.");
  await expect(agencyChoice).not.toBeChecked();
  expect(rejected).toEqual([{ signers: [client] }]);
  expect(fixture.submissions).toEqual([]);
  await agencyChoice.check();
  await expect(consent).not.toBeChecked();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await consent.check();
  await send.click();
  await expect.poll(() => fixture.submissions.length).toBe(1);
  expect(fixture.submissions).toEqual([{ signers: [client, agency] }]);
});

test("a rate-limited creation explains the refusal and permits an explicit retry", async ({ page }) => {
  await prepare(page);
  const client = { first_name: "Erika", last_name: "Mustermann", email: "erika@example.org", role: "client" };
  let attempts = 0;
  await page.route(`**/api/v1/documents/${documentId}/signature-requests`, async route => {
    if (route.request().method() === "POST") {
      attempts++;
      return route.fulfill({ status: 202, json: { id: `attempt-${attempts}` } });
    }
    return route.fulfill({ json: {
      enabled: true, region: "DE", test_mode: true, can_send: true, can_configure: true,
      ineligible_reason: null, suggested_signers: [client],
      requests: attempts ? [{ id: `attempt-${attempts}`, status: attempts === 1 ? "error" : "pending",
        test_mode: true, signers: [client], evidence: {}, result_document_id: null, has_report: false,
        last_error: attempts === 1 ? "provider_rate_limited" : null, created_at: document.created_at }] : [],
    } });
  });
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Elektronische Unterschrift: vertrag.pdf", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true });
  const consent = dialog.getByRole("checkbox", { name: /Ich habe die gespeicherte PDF/ });
  const send = dialog.getByRole("button", { name: "Zur Unterschrift senden", exact: true });
  await consent.check();
  await send.click();
  await expect(dialog.getByRole("alert")).toContainText("Es wurden keine Einladungen versendet");
  await expect(consent).not.toBeChecked();
  await expect(send).toBeDisabled();
  expect(attempts).toBe(1);
  await consent.check();
  await send.click();
  await expect(dialog.getByText("TEST · Unterschriften ausstehend", { exact: true })).toBeVisible();
  await expect(send).toHaveCount(0);
  expect(attempts).toBe(2);
});

for (const lang of ["ru", "de"] as const) {
  test(`protected signature evidence shows a localized deletion error and keeps the file in ${lang}`, async ({ page }) => {
    await prepare(page);
    await page.addInitScript(value => localStorage.setItem("gmed_lang", value), lang);
    let deleteAttempts = 0;
    await page.route(`**/api/v1/documents/${documentId}/delete`, route => {
      deleteAttempts++;
      return route.fulfill({ status: 409, json: { error: "document_signature_file_protected", message: "Document belongs to signature evidence" } });
    });
    await page.goto(`/documents/${documentId}`);
    await page.getByRole("button", { name: lang === "de" ? "Datei löschen" : "Удалить файл", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: lang === "de" ? "Datei löschen" : "Удалить файл", exact: true });
    await dialog.getByRole("textbox").fill("Fixture cleanup");
    await dialog.getByRole("button", { name: lang === "de" ? "Datei endgültig löschen" : "Удалить файл окончательно", exact: true }).click();
    await expect(dialog.getByText(lang === "de"
      ? "Diese Datei gehört zu einer laufenden Signaturanfrage oder zu gespeicherten Signaturnachweisen und kann nicht gelöscht werden."
      : "Этот файл относится к текущему запросу подписи или сохранённым доказательствам подписания и не может быть удалён.", { exact: true })).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(deleteAttempts).toBe(1);
  });
}
