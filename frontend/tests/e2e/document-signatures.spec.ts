import { expect, test, type Page } from "@playwright/test";

const documentId = "ea3a0c15-792b-4a3a-9a7e-006300000001";
const document = { id: documentId, auto_name: "Rahmenvertrag – Testperson", original_filename: "vertrag.pdf", art: "framework_contract", category: "administrative", status: "active", visibility: "internal", is_medical: false, mime_type: "application/pdf", has_stored_file: true, file_size: 1000, version_root_document_id: documentId, version_number: 1, version_count: 1, is_latest_version: true, patient_id: null, order_id: null, appointment_id: null, klinik: null, ursprung: null, notes: null, generated_template_id: "framework_contract", data_sensitivity: "internal", created_at: "2026-09-05T10:00:00Z", updated_at: "2026-09-05T10:00:00Z" };

async function prepare(page: Page, enabled = true) {
  await page.routeWebSocket("**/api/**", socket => socket.close());
  const submissions: unknown[] = [];
  const connections: unknown[] = [];
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
  return { submissions, connections, setStatus: (next: string) => { status = next; }, complete: () => { status = "completed"; } };
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
    ["Signiertes PDF", `/documents/${documentId}/download`, "signed.pdf"],
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
  await dialog.getByLabel("Vorname", { exact: true }).first().fill("Erika");
  await dialog.getByRole("checkbox").check();
  await picker.click();
  await page.getByRole("option", { name: /Zweites PDF/ }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByLabel("Vorname", { exact: true }).first()).toHaveValue("Erika");
  await picker.click();
  await page.getByRole("option", { name: /Zweites PDF/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Ohne Speichern schließen", exact: true }).click();
  await expect(dialog.getByLabel("Vorname", { exact: true }).first()).toHaveValue("");
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
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
  await expect(key).toHaveValue("");
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
  await expect(disconnect).toBeEnabled();
  expect(actions).toEqual([]);
  await disconnect.click();
  await expect(page.getByRole("alert")).toHaveText("Bitte zuerst offene Signaturanfragen abschließen oder zurückziehen.");
  await expect(disconnect).toBeEnabled();
  await check.click();
  await expect(page.getByRole("alert")).toHaveText("Verbindung nicht bestätigt. Bitte deutsches Konto und API-Zugang prüfen.");
  checkFails = false;
  await check.click();
  await expect(page.getByText("Verbindung erfolgreich geprüft.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  blockDisconnect = false;
  await disconnect.click();
  await expect(page.getByText("Verbindung getrennt.", { exact: true })).toBeVisible();
  await expect(disconnect).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prüfen und verbinden", exact: true })).toBeDisabled();
  expect(actions).toEqual(["disconnect", "check", "check", "disconnect"]);
});

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
  await page.getByRole("checkbox").check();
  const send = page.getByRole("button", { name: "Zur Unterschrift senden", exact: true });
  await send.click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("checkbox").check();
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
    await expect(key).toHaveValue("");
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
  await expect(dialog.getByRole("link", { name: "Skribble-Login öffnen" })).toHaveAttribute("href", "https://my.skribble.de/");
  await expect(dialog.getByRole("link", { name: "Skribble-Login öffnen" })).toHaveAttribute("target", "_blank");
  await dialog.getByLabel("API-Benutzername", { exact: true }).fill("api_demo_fixture");
  const key = dialog.getByLabel("API-Schlüssel", { exact: true });
  await expect(key).toHaveAttribute("type", "password");
  await key.fill("fixture-secret-only");
  await dialog.getByRole("button", { name: "Prüfen und verbinden", exact: true }).click();
  await expect(dialog.getByText("Verbindung geprüft und gespeichert.", { exact: true })).toBeVisible();
  await expect(key).toHaveValue("");
  expect(fixture.connections).toEqual([{ username: "api_demo_fixture", api_key: "fixture-secret-only", mode: "demo" }]);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain("fixture-secret-only");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await dialog.screenshot({ path: "../artifacts/design-qa/signature-login-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await open.click();
  await expect(dialog.getByLabel("API-Benutzername", { exact: true })).toHaveValue("api_demo_fixture");
  await expect(dialog.getByLabel("API-Schlüssel", { exact: true })).toHaveValue("");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.screenshot({ path: "../artifacts/design-qa/signature-login-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Elektronische Unterschrift", exact: true })).toHaveCount(0);
  await page.locator('a[href="/admin/signatures"]').click();
  await expect(page).toHaveURL(/\/admin\/signatures$/);
  await expect(page.getByRole("heading", { name: "Elektronische Signatur", exact: true })).toBeVisible();
  await expect(page.getByLabel("API-Benutzername", { exact: true })).toHaveValue("api_demo_fixture");
  await expect(page.getByLabel("API-Schlüssel", { exact: true })).toHaveValue("");
  await page.evaluate(() => localStorage.setItem("gmed_lang", "ru"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Электронная подпись", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Войти в Skribble", exact: true })).toHaveAttribute("href", "https://my.skribble.de/");
  await page.locator('a[href="/admin/signatures"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../artifacts/design-qa/signature-admin-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "../artifacts/design-qa/signature-admin-mobile.png" });
  expect(fixture.submissions).toHaveLength(0);
});
