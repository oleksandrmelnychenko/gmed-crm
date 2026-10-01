import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import type { ClinicalDocumentImportDraft } from "../../src/pages/patients/data/clinical-document-import";
import { pickerSection } from "./helpers";

// Optional local corpus stays outside source control. The default is synthetic.
const corpus = process.env.PARSER_CORPUS_DIR;
test.use({ trace: "off", video: "off", screenshot: "off", actionTimeout: 15_000 });
if (process.env.PARSER_TEST_BASE_URL) test.use({ baseURL: process.env.PARSER_TEST_BASE_URL });
const patientId = "00000000-0000-0000-0000-000000000101";
const synthetic: ClinicalDocumentImportDraft = {
  document_type: "laboratory_report", source_language: "de", parser_version: "test", warnings: [],
  raw_text: "Laborbefund\nTest A 4.2 mmol/l\fLaborbefund\nTest A 4.6 mmol/l",
  candidates: ["2025-01-15", "2026-02-16"].map((date, i) => ({
    id: `lab-${i}`, target: "lab_result", value: `Test A ${i ? '4.6' : '4.2'} mmol/l`,
    selected: false, confidence: 0.7, source: { page: i + 1, section: "Labor", text: `Test A ${i ? '4.6' : '4.2'} mmol/l` },
    normalized: { analyte_name: "Test A", result_text: i ? "4.6" : "4.2", numeric_result: i ? 4.6 : 4.2,
      measured_on: date, unit: "mmol/l", reference_text: "3.5–5.0", source_country: "DE", auto_select: false },
  })),
};

async function mount(page: Page, draft: ClinicalDocumentImportDraft, file?: string) {
  const prepared: Array<Record<string, unknown>> = [];
  const record = { id: "import-test", patient_id: patientId, document_id: "document-test", document_name: "Review.pdf",
    mime_type: "application/pdf", status: "review_required", document_type: draft.document_type, source_language: draft.source_language,
    parser_version: draft.parser_version, draft, reviewed_draft: null, applied_counts: {}, error_message: null,
    created_at: "2026-09-05T12:00:00Z", updated_at: "2026-09-05T12:00:00Z" };
  await page.addInitScript((subject) => {
    localStorage.setItem("gmed_access_token", "clinical-test");
    Object.assign(window, { __clinicalTestIdentity: subject ? {
      firstName: subject.first_name, lastName: subject.last_name, birthDate: subject.birth_date,
    } : { firstName: "Anna", lastName: "Beispiel", birthDate: "1980-01-01" } });
  }, draft.subject ?? null);
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (url.endsWith("/me")) body = { id: "tester", name: "Manager", email: "qa@example.test", role: "ceo" };
    else if (url.endsWith("/upload")) body = { id: record.document_id };
    else if (url.endsWith("/download")) return route.fulfill({ contentType: "application/pdf", body: file ? fs.readFileSync(file) : "%PDF-1.4\n%%EOF" });
    else if (url.endsWith("/prepare")) {
      const payload = route.request().postDataJSON(); prepared.push(payload);
      body = { ok: true, id: record.id, status: "applying", idempotent: false, source_country: payload.source_country,
        patient_identity_confirmed: payload.patient_identity_confirmed };
    } else if (url.endsWith("/complete")) {
      body = { ...record, status: "applied", reviewed_draft: route.request().postDataJSON().reviewed_draft, applied_counts: { records: 1 } };
    } else if (url.includes("/clinical-document-imports")) {
      body = url.endsWith("/clinical-document-imports")
        ? route.request().method() === "GET" ? { items: [] } : { ...record, status: "queued", draft: { ...draft, candidates: [] } }
        : record;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/clinical-import-harness", route => route.fulfill({ contentType: "text/html", body: `
    <html><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import('/tests/e2e/fixtures/clinical-import-harness.tsx');
    </script></body></html>` }));
  await page.goto("/clinical-import-harness");
  const dialog = page.getByRole('dialog', { name: 'Assistent für den Import' });
  await dialog.locator('input[type="file"]').setInputFiles(file ?? { name: "Review.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
  await dialog.getByRole("button", { name: "Hochladen und Entwurf erstellen" }).click();
  await expect(dialog.locator("[data-clinical-import-candidate-card]")).toHaveCount(draft.candidates.length);
  return prepared;
}

for (const key of corpus ? ["lab", "letter", "report"] : ["synthetic"]) {
  test(`${key}: all candidates reach review and preserve their source in prepare`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1600, height: 1100 });
    const draft: ClinicalDocumentImportDraft = corpus ? JSON.parse(fs.readFileSync(path.join(corpus, `${key}.json`), "utf8")) : synthetic;
    const files = corpus ? JSON.parse(fs.readFileSync(path.join(corpus, 'files.json'), 'utf8')) : {};
    const prepared = await mount(page, draft, files[key]);
    // Use the real payload builder against every extracted laboratory entry.
    const laboratory = draft.candidates.filter(c => c.target === "lab_result");
    if (laboratory.length) {
      const result = await page.evaluate(async (rows) => {
        const modulePath = "/src/pages/patients/data/clinical-document-import-payloads.ts";
        const { buildClinicalDocumentCandidatePayloads } = await import(/* @vite-ignore */ modulePath);
        return buildClinicalDocumentCandidatePayloads(rows.map(c => ({ ...c, selected: true })), "DE", "import-test");
      }, laboratory);
      expect(result.invalidCandidate).toBeNull();
      expect(Object.keys(result.candidatePayloads)).toHaveLength(laboratory.length);
      for (const c of laboratory) expect(result.candidatePayloads[c.id]).toMatchObject({
        measured_at: c.normalized.measured_on, result_text: c.normalized.result_text,
        numeric_result: c.normalized.numeric_result, unit: c.normalized.unit, source_page: c.source.page,
      });
    }
    const chosen = draft.candidates.find(c => ["diagnosis", "examination", "lab_result"].includes(c.target))!;
    const card = page.getByRole('dialog', { name: 'Assistent für den Import' }).locator(`[data-clinical-import-candidate-id="${chosen.id}"]`);
    const translated = draft.translation?.candidate_values[chosen.id];
    if (translated && chosen.target !== "lab_result") {
      await expect(card.locator('[lang="de"]')).toHaveText(translated);
      await card.getByRole("button", { name: "Übersetzungstext verwenden" }).click();
      await expect(card.getByRole("checkbox", { name: "Eintrag importieren" })).not.toBeChecked();
    }
    await card.getByRole("checkbox", { name: "Eintrag importieren" }).check();
    const country = page.getByRole('combobox', { name: 'Ursprungsland des Dokuments' });
    if (await country.count()) {
      await country.click();
      await page.getByRole('option', { name: 'Deutschland', exact: true }).click();
    }
    const confirm = page.getByRole("checkbox", { name: /Ich habe.*bestätige den Import/ });
    if (await confirm.count()) await confirm.check();
    await page.getByRole("button", { name: "Prüfen und übernehmen", exact: true }).click();
    await expect.poll(() => prepared.length).toBe(1);
    const reviewed = prepared[0].reviewed_draft as ClinicalDocumentImportDraft;
    expect(reviewed.raw_text).toBe(draft.raw_text);
    expect(reviewed.candidates).toHaveLength(draft.candidates.length);
    const selected = reviewed.candidates.find(c => c.id === chosen.id)!;
    expect(selected.selected).toBe(true);
    expect(selected.source).toEqual(chosen.source);
    if (translated && chosen.target !== "lab_result") expect(selected.value).toBe(translated);
  });
}

const radiology: ClinicalDocumentImportDraft = {
  document_type: "radiology_report", source_language: "de", parser_version: "test", warnings: [],
  raw_text: "Rechtfertigende Indikation: PSA-Wert 12,4 ng/ml, bisher keine Stanzbiopsie.\fBeurteilung:\n1. Geringe BPH.",
  candidates: [{
    id: "dx-1", target: "diagnosis", value: "Geringe BPH.", selected: true, confidence: 0.88,
    source: { page: 2, section: "Beurteilung", text: "Geringe BPH." },
    normalized: { label: "Geringe BPH.", kind: "secondary", certainty: "bestaetigt", assertion: "confirmed", auto_select: true },
  }],
};

test("constructor builds typed blocks from selected text and by hand, then orders and groups them", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  const prepared = await mount(page, radiology);
  const dialog = page.getByRole("dialog", { name: "Assistent für den Import" });

  // Block from selected document text: the laboratory value is split into fields.
  await dialog.getByRole("tab", { name: "Volltext" }).click();
  await dialog.getByRole("button", { name: /^Seite 1/ }).click();
  const pageText = dialog.getByRole("textbox", { name: "Erkannter Text der Seite 1" });
  await pageText.evaluate((element: HTMLTextAreaElement) => {
    const start = element.value.indexOf("PSA-Wert");
    element.focus();
    element.setSelectionRange(start, element.value.indexOf(", bisher"));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  });
  const actions = dialog.locator("[data-clinical-import-selection-actions]");
  await expect(actions).toContainText("PSA-Wert 12");
  // The selection belongs to page 1 and is not offered on page 2.
  await dialog.getByRole("button", { name: /^Seite 2/ }).click();
  await expect(actions).not.toContainText("PSA-Wert");
  await dialog.getByRole("button", { name: /^Seite 1/ }).click();
  await expect(actions).toContainText("PSA-Wert 12");
  await actions.getByRole("button", { name: "Laborwerte" }).click();
  const labForm = dialog.locator('[data-clinical-import-constructor-form="lab_result"]');
  await expect(labForm.getByLabel(/^Parameter\b/)).toHaveValue("PSA");
  await expect(labForm.getByLabel(/^Wert\b/)).toHaveValue("12,4");
  await expect(labForm.getByLabel("Einheit", { exact: true })).toHaveValue("ng/ml");
  await labForm.getByRole("button", { name: "Zum Entwurf hinzufügen" }).click();
  await expect(labForm.getByRole("alert")).toHaveText("Pflichtfelder ausfüllen.");
  await labForm.getByRole("spinbutton", { name: pickerSection.day }).fill("20");
  await labForm.getByRole("spinbutton", { name: pickerSection.month }).fill("02");
  await labForm.getByRole("spinbutton", { name: pickerSection.year }).fill("2026");
  await labForm.getByRole("spinbutton", { name: pickerSection.year }).press("Tab");
  await labForm.getByRole("button", { name: "Zum Entwurf hinzufügen" }).click();
  // The full text stays open for the next selection; the block is counted.
  await expect(pageText).toBeVisible();
  await expect(dialog.getByRole("tab", { name: /^Laborwerte/ })).toContainText("1");
  await dialog.getByRole("tab", { name: /^Alle/ }).click();
  await expect(dialog.locator('[data-clinical-import-candidate-card] input[value="PSA"]')).toBeVisible();

  // Block by hand from the toolbar of the overview.
  await dialog.locator("[data-clinical-import-constructor-toolbar]").getByRole("button", { name: "Diagnosen" }).click();
  const diagnosisForm = dialog.locator('[data-clinical-import-constructor-form="diagnosis"]');
  await diagnosisForm.getByLabel(/^Diagnose \*$/).fill("Prostatakarzinom");
  await diagnosisForm.getByLabel("ICD-10").fill("c61");
  await diagnosisForm.getByLabel("Sicherheit").selectOption("verdacht");
  await diagnosisForm.getByRole("button", { name: "Zum Entwurf hinzufügen" }).click();
  const cards = dialog.locator("[data-clinical-import-candidate-card]");
  await expect(cards).toHaveCount(3);

  // Vitals without a note still get a value (the import rejects empty ones).
  await dialog.locator("[data-clinical-import-constructor-toolbar]").getByRole("button", { name: "Vitalwerte" }).click();
  const vitalForm = dialog.locator('[data-clinical-import-constructor-form="vital"]');
  await vitalForm.getByRole("spinbutton", { name: pickerSection.day }).fill("02");
  await vitalForm.getByRole("spinbutton", { name: pickerSection.month }).fill("03");
  await vitalForm.getByRole("spinbutton", { name: pickerSection.year }).fill("2026");
  await vitalForm.getByRole("spinbutton", { name: pickerSection.year }).press("Tab");
  await vitalForm.getByLabel("Gewicht, kg").fill("80");
  await vitalForm.getByRole("button", { name: "Zum Entwurf hinzufügen" }).click();
  await expect(cards).toHaveCount(4);

  // A hand-made block can be removed again; a recognized one cannot.
  await dialog.locator("[data-clinical-import-constructor-toolbar]").getByRole("button", { name: "Empfehlungen" }).click();
  await dialog.locator('[data-clinical-import-constructor-form="recommendation"]').getByLabel(/^Empfehlung \*$/).fill("Versehentlich angelegt");
  await dialog.locator('[data-clinical-import-constructor-form="recommendation"]').getByRole("button", { name: "Zum Entwurf hinzufügen" }).click();
  await expect(cards).toHaveCount(5);
  await cards.last().getByRole("button", { name: "Block entfernen" }).click();
  await expect(cards).toHaveCount(4);
  await expect(cards.first().getByRole("button", { name: "Block entfernen" })).toHaveCount(0);

  // Ordering within the type, then grouping by source page.
  const diagnosisEditors = () => dialog
    .locator("[data-clinical-import-candidate-card] textarea[data-clinical-import-candidate-editor]")
    .evaluateAll((elements) => elements.map((element) => (element as HTMLTextAreaElement).value));
  await expect.poll(diagnosisEditors).toEqual(["Geringe BPH.", "Prostatakarzinom"]);
  await cards.nth(1).getByRole("button", { name: "Nach oben" }).click();
  await expect.poll(diagnosisEditors).toEqual(["Prostatakarzinom", "Geringe BPH."]);
  await dialog.getByRole("button", { name: "Nach Seiten" }).click();
  await expect(dialog.locator("summary").filter({ hasText: "Seite 2" })).toBeVisible();
  await expect(dialog.locator("summary").filter({ hasText: "Ohne Seite (manuell)" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Nach oben" })).toHaveCount(0);

  const confirm = page.getByRole("checkbox", { name: /Ich habe.*bestätige den Import/ });
  if (await confirm.count()) await confirm.check();
  const country = page.getByRole("combobox", { name: "Ursprungsland des Dokuments" });
  if (await country.count()) {
    await country.click();
    await page.getByRole("option", { name: "Deutschland", exact: true }).click();
  }
  await page.getByRole("button", { name: "Prüfen und übernehmen", exact: true }).click();
  await expect.poll(() => prepared.length).toBe(1);
  const reviewed = prepared[0].reviewed_draft as ClinicalDocumentImportDraft;
  const manualLab = reviewed.candidates.find((candidate) => candidate.target === "lab_result")!;
  expect(manualLab.source).toMatchObject({ page: 1, text: "PSA-Wert 12,4 ng/ml" });
  expect(manualLab.normalized).toMatchObject({ analyte_name: "PSA", numeric_result: 12.4, measured_on: "2026-02-20" });
  const manualDiagnosis = reviewed.candidates.find((candidate) => candidate.value === "Prostatakarzinom")!;
  expect(manualDiagnosis.normalized).toMatchObject({ certainty: "verdacht", icd_code: "C61" });
  const manualVital = reviewed.candidates.find((candidate) => candidate.target === "vital")!;
  expect(manualVital.value).toBe("Gewicht, kg: 80");
  expect(manualVital.normalized).toMatchObject({ measured_at: "2026-03-02", weight_kg: 80 });
  expect(reviewed.candidates.map((candidate) => candidate.id).indexOf(manualDiagnosis.id))
    .toBeLessThan(reviewed.candidates.map((candidate) => candidate.id).indexOf("dx-1"));
});
