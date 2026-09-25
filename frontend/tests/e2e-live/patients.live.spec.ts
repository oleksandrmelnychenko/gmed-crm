import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  bootstrapFullSmokeScenario,
  chooseComboboxOption,
  expectPageHeading,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

function futureLocalDateTime(daysFromNow: number) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function optionalRequiredLabel(label: string) {
  return new RegExp(`^${escapeRegExp(label)}\\*?$`, "i");
}

/**
 * Patient tabs no longer carry their own headings: the page title (h1) is the
 * patient name and the side navigation links to `?tab=...`.
 */
async function openPatientDetailTab(
  page: Page,
  patientId: string,
  tab: string,
  patientName: string,
) {
  await page.goto(`/patients/${patientId}${tab === "profile" ? "" : `?tab=${tab}`}`);
  await expectPageHeading(page, patientName);
}

/** The clinical tab groups each record type under an h3 with its actions. */
function clinicalBlock(page: Page, heading: string) {
  return page
    .getByRole("heading", { name: heading, exact: true, level: 3 })
    .locator("xpath=ancestor::*[.//button][1]");
}

async function openClinicalAddSheet(page: Page, heading: string, sheetName: RegExp) {
  await clinicalBlock(page, heading).getByRole("button", { name: /^Hinzufügen$/ }).click();
  const sheet = page.getByRole("dialog", { name: sheetName });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function fillMuiDate(container: Locator, value: string, index = 0) {
  const [year = "", month = "", day = ""] = value.split("-");
  await container.getByRole("spinbutton", { name: "Year" }).nth(index).fill(year);
  await container.getByRole("spinbutton", { name: "Month" }).nth(index).fill(month);
  await container.getByRole("spinbutton", { name: "Day" }).nth(index).fill(day);
}

async function fillMuiDateTime(container: Locator, value: string, index = 0) {
  const [date = "", time = ""] = value.split("T");
  const [hours = "", minutes = ""] = time.split(":");
  await fillMuiDate(container, date, index);
  await container.getByRole("spinbutton", { name: "Hours" }).nth(index).fill(hours);
  await container.getByRole("spinbutton", { name: "Minutes" }).nth(index).fill(minutes);
}

async function saveOpenDialog(page: Page) {
  const dialog = page.getByRole("dialog").last();
  await dialog.getByRole("button", { name: /^Speichern$|^Save$/ }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

test.describe("patient profile live workflows", () => {
  test("ceo assistant can inspect patient registry in read-only mode without create edit or assignment controls", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "assistant");

    await page.goto("/patients");
    await expect(
      page.getByRole("heading", { level: 1, name: /Patient/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Neuer Patient" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("table").getByText(scenario.patient.name, { exact: true }),
    ).toBeVisible();

    await page.goto(`/patients?patient=${scenario.patient.id}`);
    const profileDialog = page.getByRole("dialog");
    await expect(
      profileDialog.getByRole("heading", { name: scenario.patient.name }).first(),
    ).toBeVisible();
    await expect(
      profileDialog.getByText(
        /nur Lesezugriff auf Patientendemografie|read-only access to patient demographics/i,
      ),
    ).toBeVisible();
    await expect(
      profileDialog.getByRole("button", { name: /Patient speichern|Save patient/i }),
    ).toHaveCount(0);

    await expect(
      profileDialog.getByRole("heading", { name: "Betreuer" }),
    ).toHaveCount(0);
    await expect(
      profileDialog.getByRole("button", { name: "Betreuer" }),
    ).toHaveCount(0);
  });

  test("ceo assistant can inspect patient-bound contracts and invoices without mutation controls", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "assistant");

    await openPatientDetailTab(page, scenario.patient.id, "profile", scenario.patient.name);
    await expect(page.getByTestId("read-only-banner")).toBeVisible();

    await openPatientDetailTab(
      page,
      scenario.patient.id,
      "contracts",
      scenario.patient.name,
    );
    await expect(
      page.getByRole("row").filter({ hasText: scenario.contract.contract_number }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Neuer Vertrag" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Status aktualisieren" }),
    ).toHaveCount(0);

    await openPatientDetailTab(
      page,
      scenario.patient.id,
      "invoices",
      scenario.patient.name,
    );
    await expect(
      page.getByRole("row").filter({ hasText: scenario.invoice.invoice_number }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Billing verwalten" }),
    ).toHaveCount(0);
  });

  test("patient manager can inspect patient timeline and print the patient sticker", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    await loginViaApi(
      page,
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    await openPatientDetailTab(page, scenario.patient.id, "documents", scenario.patient.name);
    await expect(
      page.getByRole("heading", { name: /erforderliche Dokument\(e\) fehlen/i }),
    ).toBeVisible();
    await expect(page.getByText("Reisepass", { exact: true }).first()).toBeVisible();
    await expect(
      // The document table lists file names.
      page.getByRole("row").filter({ hasText: /released-discharge-note/i }).first(),
    ).toBeVisible();

    const accessToken = await page.evaluate(() =>
      window.localStorage.getItem("gmed_access_token"),
    );
    const frontendOrigin = new URL(page.url()).origin;
    const labelResponse = await request.get(
      `${frontendOrigin}/api/v1/patients/${scenario.patient.id}/label?format=compact-90x48`,
      {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      },
    );
    const labelPayload = {
      ok: labelResponse.ok(),
      status: labelResponse.status(),
      body: await labelResponse
        .json()
        .catch(async () => ({ raw: await labelResponse.text() })),
    };
    expect(labelPayload.ok, JSON.stringify(labelPayload.body)).toBeTruthy();
    expect(labelPayload.body.patient_id).toBe(scenario.patient.patient_id);

    await openPatientDetailTab(page, scenario.patient.id, "timeline", scenario.patient.name);
    await expect(
      page.getByRole("button", { name: /Released discharge note/ }).first(),
    ).toBeVisible();
  });

  test("patient manager reviews appointments, adds a relation and completes a workflow item", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    await openPatientDetailTab(page, scenario.patient.id, "appointments", scenario.patient.name);
    await expect(
      page.getByRole("row").filter({ hasText: scenario.appointment.title }).first(),
    ).toBeVisible();

    // The add actions live in the table toolbars, which an empty tab does not
    // render (covered by the next test), so each list starts with one record.
    const seededRelation = await request.post(
      `${api.backendUrl}/api/v1/patients/${scenario.patient.id}/relations`,
      {
        headers: api.headers,
        data: {
          related_name: "Existing Relation Live",
          relation_type: "other",
          is_emergency_contact: false,
        },
      },
    );
    expect(seededRelation.ok(), await seededRelation.text()).toBe(true);
    const seededWorkflowItem = await request.post(
      `${api.backendUrl}/api/v1/patients/${scenario.patient.id}/workflow-checklist`,
      {
        headers: api.headers,
        data: { item_text: "Existing workflow item", priority: "normal", due_date: null },
      },
    );
    expect(seededWorkflowItem.ok(), await seededWorkflowItem.text()).toBe(true);

    await openPatientDetailTab(page, scenario.patient.id, "relations", scenario.patient.name);
    await page.getByRole("button", { name: "Neue Beziehung" }).click();

    const relationDialog = page.getByRole("dialog", {
      name: /Beziehung hinzufügen|Add relation/i,
    });
    await expect(relationDialog).toBeVisible();
    await relationDialog.getByRole("textbox", { name: "Name" }).fill("Emergency Contact Live");
    await chooseComboboxOption(
      page,
      relationDialog.getByRole("combobox", { name: /Beziehungstyp|Relation type/i }),
      /Betreuungsperson|Betreuer|Caregiver/i,
    );
    await relationDialog.getByRole("textbox", { name: /Telefon|Phone/i }).fill("+49 30 222222");
    await relationDialog.getByRole("checkbox", { name: "Notfallkontakt" }).check();
    await relationDialog
      .getByRole("textbox", { name: "Notizen" })
      .fill("Available during all clinic visits.");
    await relationDialog.getByRole("button", { name: /^Speichern$|^Save$/ }).click();
    await expect(relationDialog).toBeHidden({ timeout: 15_000 });

    const relationRow = page.getByRole("row").filter({ hasText: "Emergency Contact Live" });
    await expect(relationRow).toBeVisible();
    await expect(relationRow).toContainText("Available during all clinic visits.");

    await openPatientDetailTab(page, scenario.patient.id, "workflow", scenario.patient.name);

    const workflowItemName = "Live E2E workflow call-back";
    await page
      .getByRole("button", { name: /Element hinzufügen|Add item/i })
      .click();
    const workflowForm = page.getByRole("dialog", {
      name: /Workflow-Element hinzufügen|Add workflow item/i,
    });
    await expect(workflowForm).toBeVisible();
    await workflowForm.locator("#patient-workflow-item-text").fill(workflowItemName);
    await fillMuiDateTime(workflowForm, futureLocalDateTime(2));
    const [createdWorkflowItem] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/v1/patients/${scenario.patient.id}/workflow-checklist`),
      ),
      workflowForm.getByRole("button", { name: /^Hinzufügen$|^Add$/i }).click(),
    ]);
    expect(createdWorkflowItem.ok(), await createdWorkflowItem.text()).toBe(true);
    // The sheet stays open (and resets) for the next item.
    await expect(workflowForm.locator("#patient-workflow-item-text")).toHaveValue("");
    await workflowForm.getByRole("button", { name: /^Schließen$|^Close$/ }).click();
    await expect(workflowForm).toBeHidden({ timeout: 15_000 });

    const workflowRow = page.getByRole("row").filter({ hasText: workflowItemName });
    await expect(workflowRow).toBeVisible();
    await expect(workflowRow).toContainText(/Benutzerdefiniert|Custom/i);
    const completeWorkflowResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse
          .url()
          .includes(`/api/v1/patients/${scenario.patient.id}/workflow-checklist/`) &&
        nextResponse.url().includes("/complete") &&
        nextResponse.request().method() === "POST",
    );
    await workflowRow
      .getByRole("button", { name: /Abschließen|Complete/i })
      .first()
      .click();
    expect((await completeWorkflowResponse).ok()).toBe(true);
    await expect(
      page.getByRole("row").filter({ hasText: workflowItemName }),
    ).toContainText(/Abgeschlossen|Erledigt|completed/i);
  });

  test("patient manager can add the first relation and the first workflow item on empty tabs", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    await openPatientDetailTab(page, scenario.patient.id, "relations", scenario.patient.name);
    await expect(
      page.getByRole("button", { name: "Neue Beziehung" }),
      "an empty relations tab still offers the add action",
    ).toBeVisible();

    await openPatientDetailTab(page, scenario.patient.id, "workflow", scenario.patient.name);
    await expect(
      page.getByRole("button", { name: /Element hinzufügen|Add item/i }),
      "an empty workflow tab still offers the add action",
    ).toBeVisible();
  });

  // CAVE, vitals and risk scores are recorded on the clinical tab; the former
  // profile sections for card entries and medical orders are no longer offered.
  test("patient manager records CAVE warnings, vitals and risk scores on the clinical tab", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const caveWarning = `Latex allergy ${scenario.tag}`;
    const caveNote = "Monitor blood pressure before sedation.";
    const vitalsNote = `Vitals follow-up ${scenario.tag}`;
    const riskInterpretation = `Moderate stroke-prevention risk ${scenario.tag}.`;
    const riskSource = `Live profile review ${scenario.tag}`;

    await openPatientDetailTab(page, scenario.patient.id, "clinical", scenario.patient.name);

    const caveSheet = await openClinicalAddSheet(page, "CAVE", /Hinzufügen: CAVE/);
    await caveSheet.getByRole("textbox", { name: "CAVE" }).fill(caveWarning);
    await caveSheet.getByRole("textbox", { name: "Notiz" }).fill(caveNote);
    await saveOpenDialog(page);
    await expect(page.getByText(caveWarning).first()).toBeVisible();

    await openClinicalAddSheet(page, "Vitalwerte-Verlauf", /./);
    await page.locator("#patient-vitals-bp-systolic").fill("128");
    await page.locator("#patient-vitals-bp-diastolic").fill("84");
    await page.locator("#patient-vitals-heart-rate").fill("71");
    await page.locator("#patient-vitals-weight").fill("70");
    await page.locator("#patient-vitals-height").fill("175");
    await page.locator("#patient-vitals-notes").fill(vitalsNote);
    await saveOpenDialog(page);
    await expect(page.getByText(vitalsNote).first()).toBeVisible();

    await openClinicalAddSheet(page, "Risikoscores", /./);
    await page.locator("#patient-risk-score-value").fill("4");
    await page.locator("#patient-risk-score-scale-max").fill("9");
    await page.locator("#patient-risk-score-source").fill(riskSource);
    await page
      .locator("#patient-risk-score-interpretation")
      .fill(riskInterpretation);
    await saveOpenDialog(page);
    const riskRow = page.getByRole("row").filter({ hasText: riskInterpretation });
    await expect(riskRow).toBeVisible();
    await expect(riskRow).toContainText(/CHA₂DS₂-VASc|CHA2DS2-VASc/);
    await expect(riskRow).toContainText("4 / 9");

    await expect(async () => {
      const clinicalResponse = await request.get(
        `${api.backendUrl}/api/v1/patients/${scenario.patient.id}/clinical`,
        { headers: api.headers },
      );
      expect(clinicalResponse.ok()).toBe(true);
      const clinical = (await clinicalResponse.json()) as { cave: unknown[] };
      expect(JSON.stringify(clinical.cave)).toContain(caveWarning);
      expect(JSON.stringify(clinical.cave)).toContain(caveNote);

      const vitalsResponse = await request.get(
        `${api.backendUrl}/api/v1/patients/${scenario.patient.id}/vitals`,
        { headers: api.headers },
      );
      expect(vitalsResponse.ok()).toBe(true);
      const vitals = (await vitalsResponse.json()) as {
        items: Array<{
          bp_systolic: number | null;
          bp_diastolic: number | null;
          heart_rate: number | null;
          weight_kg: number | null;
          height_cm: number | null;
          notes: string | null;
        }>;
      };
      expect(vitals.items[0]?.bp_systolic).toBe(128);
      expect(vitals.items[0]?.bp_diastolic).toBe(84);
      expect(vitals.items[0]?.heart_rate).toBe(71);
      expect(vitals.items[0]?.weight_kg).toBe(70);
      expect(vitals.items[0]?.height_cm).toBe(175);
      expect(vitals.items[0]?.notes).toBe(vitalsNote);

      const riskScoresResponse = await request.get(
        `${api.backendUrl}/api/v1/patients/${scenario.patient.id}/risk-scores`,
        { headers: api.headers },
      );
      expect(riskScoresResponse.ok()).toBe(true);
      const riskScores = (await riskScoresResponse.json()) as {
        items: Array<{
          score_type: string;
          score_value: number;
          scale_max: number | null;
          source: string | null;
          interpretation: string | null;
        }>;
      };
      const riskScore = riskScores.items.find(
        (item) => item.interpretation === riskInterpretation,
      );
      expect(riskScore).toBeDefined();
      expect(riskScore!.score_type).toBe("cha2ds2_vasc");
      expect(riskScore!.score_value).toBe(4);
      expect(riskScore!.scale_max).toBe(9);
      expect(riskScore!.source).toBe(riskSource);
    }).toPass({ timeout: 15_000 });
  });

  test("patient manager sees existing customer re-check blockers in create-order flow", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    await loginViaApi(
      page,
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    const apiRecheckResponse = await request.get(
      `${api.backendUrl}/api/v1/patients/${scenario.patient.id}/recheck`,
      { headers: api.headers },
    );
    expect(apiRecheckResponse.ok()).toBe(true);
    const apiRecheck = (await apiRecheckResponse.json()) as {
      requires_recheck: boolean;
      can_create_order: boolean;
      blocking_reasons: string[];
      document_alerts: { missing_count: number };
    };
    expect(apiRecheck.requires_recheck).toBe(true);
    expect(apiRecheck.can_create_order).toBe(false);
    expect(apiRecheck.blocking_reasons.length).toBeGreaterThan(0);

    await page.goto(`/orders?patient=${scenario.patient.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: /Aufträge|Orders/i }),
    ).toBeVisible();
    const uiRecheckResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(`/api/v1/patients/${scenario.patient.id}/recheck`) &&
        response.request().method() === "GET" &&
        response.ok(),
    );
    await page
      .getByRole("button", { name: /Neuen Auftrag|New order/i })
      .first()
      .click();
    const createDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: /Auftrag anlegen|Создать заказ/i,
        }),
      })
      .last();
    await expect(
      createDialog.getByRole("heading", { name: /Auftrag anlegen|Создать заказ/i }),
    ).toBeVisible();
    // The order dialog preselects the patient from ?patient= and runs the check.
    await expect(createDialog.getByRole("combobox").first()).toContainText(
      scenario.patient.patient_id,
    );
    await uiRecheckResponse;
    await expect(
      createDialog.getByText(
        /Re-Check f.r Bestandskunden|Повторная проверка для существующего клиента/i,
      ),
    ).toBeVisible();
    await expect(createDialog.getByText(/Blockiert|Заблокирован/i)).toBeVisible();
    await expect(
      createDialog.getByText(
        /erforderliche Dokument\(e\) fehlen noch|обязательных документ\(ов\)/i,
      ),
    ).toBeVisible();
    await expect(
      createDialog.getByRole("button", { name: /Save|Speichern/i }),
    ).toBeDisabled();
  });

  // EPIC 1 Row 1 (c): UI create-form for a brand new patient.
  // Source: docs/backlog/01_mvp-backlog_ua.md (R1 Patient Registry — Pflichtfelder)
  //         frontend/src/pages/patients.tsx:1124 (PatientFormFields includeBirthAndGender)
  //         crates/server/src/routes/patients.rs:670 (create_patient)
  test("patient manager creates a brand-new patient via the create sheet and the persisted record carries the demographic + contact + insurance + emergency-contact fields", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    await page.goto("/patients");
    await expect(
      page.getByRole("heading", { level: 1, name: /Patient/i }),
    ).toBeVisible();

    const tag = `e2e-create-${Date.now()}`;
    const firstName = `First-${tag}`;
    const lastName = `Last-${tag}`;
    const email = `${tag}@example.test`;

    await page.getByRole("button", { name: "Neuer Patient" }).click();
    const sheet = page.getByRole("dialog").last();
    await expect(
      sheet.getByRole("heading", { name: "Patient anlegen" }),
    ).toBeVisible();

    const fillField = async (label: string, value: string) => {
      const field = sheet
        .getByText(optionalRequiredLabel(label))
        .locator("..")
        .getByRole("textbox")
        .first();
      await expect(field).toBeVisible();
      await field.fill(value);
    };
    const chooseField = async (label: string, option: RegExp) => {
      const field = sheet.getByText(optionalRequiredLabel(label)).locator("..");
      await chooseComboboxOption(page, field.getByRole("combobox"), option);
    };
    const chooseLanguage = async (option: RegExp) => {
      const field = sheet.getByText("Sprachen", { exact: true }).locator("..");
      await chooseComboboxOption(page, field.getByRole("combobox"), option);
    };
    const fillRepeatedField = async (
      label: RegExp,
      value: string,
      index = 0,
    ) => {
      const field = sheet
        .locator("label")
        .filter({ hasText: label })
        .nth(index)
        .locator("..")
        .getByRole("textbox")
        .first();
      await expect(field).toBeVisible();
      await field.fill(value);
    };

    await fillField("Anrede", "Dr.");
    await fillField("Vorname", firstName);
    await fillField("Nachname", lastName);
    await fillMuiDate(sheet, "1992-04-15");
    // Nationality lists countries.
    await chooseField("Staatsangehörigkeit", /^Ukraine$/i);
    await chooseField("Wohnsitzland", /Deutschland|Germany/i);
    // Options read "Englisch (en)"; a bare "en" would also match "Bengalisch (bn)".
    await chooseLanguage(/(Ukrainisch|Ukrainian) \(uk\)/i);
    await chooseLanguage(/(Deutsch|German) \(de\)/i);
    await chooseLanguage(/(Englisch|English) \(en\)/i);
    await fillRepeatedField(/^Telefon$/, "+49 30 9990001");
    await sheet
      .getByRole("button", { name: /Telefon.*Hinzuf|Add.*phone/i })
      .click();
    await fillRepeatedField(/^Telefon$/, "+49 30 9990002", 1);
    await fillRepeatedField(/^E-Mail$/, email);
    await fillField("Straße", "Testweg 7");
    await fillField("Stadt", "Berlin");
    await fillField("PLZ", "10117");
    await chooseField("Land", /Deutschland|Germany/i);
    await fillField("Versicherer", "TK");
    await fillField("Versicherungsnummer", `TK-${tag}`);
    // Emergency contacts are trusted-contact rows added on demand.
    await sheet.getByRole("button", { name: /^Kontakt hinzufügen$/ }).click();
    await fillField("Notfallkontakt Name", "Olena Test");
    await fillField("Notfallkontakt Telefon", "+49 30 9990099");
    await chooseField("Notfallkontakt Beziehung", /Ehepartner/i);

    await sheet
      .getByRole("button", { name: /^Anlegen$|^Create$/ })
      .click();

    await expect(sheet).toBeHidden({ timeout: 15_000 });

    await expect(async () => {
      const listResponse = await request.get(
        `${api.backendUrl}/api/v1/patients?search=${tag}`,
        { headers: api.headers },
      );
      expect(listResponse.ok()).toBe(true);
      const items = (await listResponse.json()) as Array<{
        id: string;
        first_name: string;
        last_name: string;
      }>;
      const created = items.find(
        (p) => p.first_name === firstName && p.last_name === lastName,
      );
      expect(created).toBeDefined();

      const detailResponse = await request.get(
        `${api.backendUrl}/api/v1/patients/${created!.id}`,
        { headers: api.headers },
      );
      expect(detailResponse.ok()).toBe(true);
      const detail = (await detailResponse.json()) as {
        first_name: string;
        last_name: string;
        birth_date: string;
        nationality: string | null;
        residence_country: string | null;
        languages: string[];
        phone_primary: string | null;
        phone_secondary: string | null;
        email: string | null;
        address_street: string | null;
        address_city: string | null;
        address_zip: string | null;
        address_country: string | null;
        insurance_provider: string | null;
        insurance_number: string | null;
        emergency_contact_name: string | null;
        emergency_contact_phone: string | null;
        emergency_contact_relation: string | null;
        patient_id: string;
      };

      expect(detail.first_name).toBe(firstName);
      expect(detail.last_name).toBe(lastName);
      expect(detail.birth_date).toBe("1992-04-15");
      expect(detail.nationality).toBe("UA");
      // Countries are stored as ISO codes.
      expect(detail.residence_country).toBe("DE");
      expect(detail.languages).toEqual(expect.arrayContaining(["uk", "de", "en"]));
      expect(detail.phone_primary).toBe("+49 30 9990001");
      expect(detail.phone_secondary).toBe("+49 30 9990002");
      expect(detail.email).toBe(email);
      expect(detail.address_street).toBe("Testweg 7");
      expect(detail.address_city).toBe("Berlin");
      expect(detail.address_zip).toBe("10117");
      expect(detail.address_country).toBe("DE");
      expect(detail.insurance_provider).toBe("TK");
      expect(detail.insurance_number).toBe(`TK-${tag}`);
      expect(detail.emergency_contact_name).toBe("Olena Test");
      expect(detail.emergency_contact_phone).toBe("+49 30 9990099");
      expect(detail.emergency_contact_relation).toBe("spouse");
      expect(detail.patient_id).toMatch(/^P-\d{8}-\d{4}$/);
    }).toPass({ timeout: 15_000 });
  });
});
