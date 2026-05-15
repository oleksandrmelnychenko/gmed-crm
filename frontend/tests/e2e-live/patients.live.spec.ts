import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  bootstrapFullSmokeScenario,
  chooseComboboxOption,
  ensureDetailsOpen,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

function futureLocalDateTime(daysFromNow: number) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

async function openPatientDetailTab(
  page: Page,
  patientId: string,
  tab: string,
  expected: RegExp | string,
) {
  await page.goto(`/patients/${patientId}${tab === "profile" ? "" : `?tab=${tab}`}`);
  await expect(page.getByRole("heading", { name: expected }).first()).toBeVisible();
}

function sectionWithHeading(page: Page, heading: RegExp | string) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading }) })
    .first();
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
    await expect(page.getByText(scenario.patient.name, { exact: true })).toBeVisible();

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

    await openPatientDetailTab(
      page,
      scenario.patient.id,
      "contracts",
      "Verträge dieses Patienten",
    );
    await expect(
      page.getByRole("heading", { name: "Verträge dieses Patienten" }),
    ).toBeVisible();
    await expect(page.getByText(scenario.contract.contract_number)).toBeVisible();
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
      /Rechnungen und Zahlungs-Follow-up|Rechnungen und Zahlungsnachverfolgung/i,
    );
    await expect(
      page.getByRole("heading", {
        name: /Rechnungen und Zahlungs-Follow-up|Rechnungen und Zahlungsnachverfolgung/i,
      }),
    ).toBeVisible();
    await expect(page.getByText(scenario.invoice.invoice_number).first()).toBeVisible();
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

    await openPatientDetailTab(page, scenario.patient.id, "documents", /Dokumenten-Cockpit/i);
    await expect(
      page.getByRole("heading", { name: "Dokumente zu diesem Patienten" }),
    ).toBeVisible();
    await expect(page.getByText("Reisepass")).toBeVisible();

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

    await openPatientDetailTab(page, scenario.patient.id, "timeline", /Timeline-Cockpit/i);
    await expect(page.getByText("Ereignisse gesamt")).toBeVisible();
    await expect(page.getByText("Released discharge note").first()).toBeVisible();
  });

  test("patient manager can manage relations, review appointments and complete patient workflow items", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    await openPatientDetailTab(page, scenario.patient.id, "appointments", /Termine/i);

    await expect(page.getByText(scenario.appointment.title)).toBeVisible();

    await openPatientDetailTab(
      page,
      scenario.patient.id,
      "relations",
      "Beziehungen und Notfallkontakte",
    );
    await page.getByRole("button", { name: "Neue Beziehung" }).click();

    const relationDialog = page.getByRole("dialog");
    await expect(
      relationDialog.getByRole("heading", {
        name: /Beziehung hinzufügen|Beziehung hinzufugen|Add relation/i,
      }),
    ).toBeVisible();
    await relationDialog.getByLabel("Name").fill("Emergency Contact Live");
    await chooseComboboxOption(
      page,
      relationDialog.getByRole("combobox", { name: /Beziehungstyp|Relation type/i }),
      /Betreuungsperson|Betreuer|Caregiver/i,
    );
    await relationDialog.getByLabel(/Telefon|Phone/i).fill("+49 30 222222");
    await relationDialog
      .locator("label")
      .filter({ hasText: "Notfallkontakt" })
      .locator("input")
      .check();
    await relationDialog
      .getByLabel("Notizen")
      .fill("Available during all clinic visits.");
    await relationDialog.getByRole("button", { name: /Save|Speichern/i }).click();

    await expect(page.getByText("Emergency Contact Live")).toBeVisible();
    await expect(page.getByText("Available during all clinic visits.")).toBeVisible();

    await openPatientDetailTab(page, scenario.patient.id, "workflow", "Workflow-Cockpit");

    const workflowItemName = "Live E2E workflow call-back";
    await page
      .getByRole("button", { name: /Element hinzufügen|Add item/i })
      .click();
    const workflowForm = page.getByRole("dialog").filter({
      has: page.getByRole("heading", {
        name: /Workflow-Element hinzufügen|Add workflow item/i,
      }),
    });
    await workflowForm.locator("#patient-workflow-item-text").fill(workflowItemName);
    await fillMuiDateTime(workflowForm, futureLocalDateTime(2));
    await workflowForm
      .getByRole("button", {
        name: /^Hinzufügen$|^Add$/i,
      })
      .click();
    await expect(workflowForm).toBeHidden({ timeout: 15_000 });

    const customWorkflowGroup = page
      .locator("details")
      .filter({ has: page.getByText(/Benutzerdefiniert|Custom/i) })
      .first();
    await ensureDetailsOpen(customWorkflowGroup);

    const workflowCard = customWorkflowGroup
      .locator("article")
      .filter({
        has: page.getByText(workflowItemName, { exact: true }),
      })
      .first();
    await expect(workflowCard).toBeVisible();
    const completeWorkflowResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse
          .url()
          .includes(`/api/v1/patients/${scenario.patient.id}/workflow-checklist/`) &&
        nextResponse.url().includes("/complete") &&
        nextResponse.request().method() === "POST",
    );
    await workflowCard
      .getByRole("button", { name: /Abschließen|Complete/i })
      .first()
      .click();
    expect((await completeWorkflowResponse).ok()).toBe(true);
    await ensureDetailsOpen(customWorkflowGroup);
    const completedWorkflowCard = customWorkflowGroup
      .locator("article")
      .filter({
        has: page.getByText(workflowItemName, { exact: true }),
      })
      .first();
    await expect(
      completedWorkflowCard.getByText(/Abgeschlossen|completed/i).first(),
    ).toBeVisible();
  });

  test("patient manager can maintain cave notes, vitals, card entries, medical orders and risk scores from the patient profile", async ({
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

    const caveNotes = `Latex allergy ${scenario.tag}\nMonitor blood pressure before sedation.`;
    const vitalsNote = `Vitals follow-up ${scenario.tag}`;
    const cardEntryContent = `Patient reports improved breathing after morning adjustment ${scenario.tag}.`;
    const medicalOrderTitle = `Physiotherapy 2x weekly ${scenario.tag}`;
    const medicalOrderInstructions = `Continue supervised physiotherapy for six weeks ${scenario.tag}.`;
    const riskInterpretation = `Moderate stroke-prevention risk ${scenario.tag}.`;
    const riskSource = `Live profile review ${scenario.tag}`;

    await openPatientDetailTab(page, scenario.patient.id, "profile", scenario.patient.name);

    await sectionWithHeading(page, "CAVE-Hinweise")
      .getByRole("button", { name: /Aktualisieren|Update/i })
      .click();
    await page.locator("#patient-cave-notes").fill(caveNotes);
    await saveOpenDialog(page);
    await expect(page.getByText(`Latex allergy ${scenario.tag}`)).toBeVisible();

    await sectionWithHeading(page, "Vitalwerte-Verlauf")
      .getByRole("button", { name: /Hinzufügen|Add/i })
      .click();
    await page.locator("#patient-vitals-bp-systolic").fill("128");
    await page.locator("#patient-vitals-bp-diastolic").fill("84");
    await page.locator("#patient-vitals-heart-rate").fill("71");
    await page.locator("#patient-vitals-weight").fill("70");
    await page.locator("#patient-vitals-height").fill("175");
    await page.locator("#patient-vitals-notes").fill(vitalsNote);
    await saveOpenDialog(page);
    await expect(page.getByText(vitalsNote).first()).toBeVisible();

    await sectionWithHeading(page, "Klinisches Kartenprotokoll")
      .getByRole("button", { name: /Hinzufügen|Add/i })
      .click();
    await page.locator("#patient-card-entry-source").fill("Patient portal follow-up");
    await page.locator("#patient-card-entry-content").fill(cardEntryContent);
    await saveOpenDialog(page);
    await expect(page.getByText(cardEntryContent)).toBeVisible();

    await sectionWithHeading(page, "Medizinische Anordnungen")
      .getByRole("button", { name: /Hinzufügen|Add/i })
      .click();
    await page.locator("#patient-medical-order-title").fill(medicalOrderTitle);
    await page.locator("#patient-medical-order-source").fill("Discharge note");
    await fillMuiDate(page.getByRole("dialog").last(), "2026-05-01", 1);
    await page
      .locator("#patient-medical-order-instructions")
      .fill(medicalOrderInstructions);
    await saveOpenDialog(page);

    const medicalOrderCard = page
      .locator("div")
      .filter({
        has: page.getByText(medicalOrderTitle, { exact: true }),
      })
      .first();
    await expect(medicalOrderCard).toBeVisible();
    await medicalOrderCard
      .getByRole("button", { name: /Abschließen|Complete/i })
      .click();
    await expect(
      medicalOrderCard
        .locator('[data-slot="badge"]')
        .filter({ hasText: "Abgeschlossen" })
        .first(),
    ).toBeVisible();

    await sectionWithHeading(page, "Risikoscores")
      .getByRole("button", { name: /Hinzufügen|Add/i })
      .click();
    await page.locator("#patient-risk-score-value").fill("4");
    await page.locator("#patient-risk-score-scale-max").fill("9");
    await page.locator("#patient-risk-score-source").fill(riskSource);
    await page
      .locator("#patient-risk-score-interpretation")
      .fill(riskInterpretation);
    await page
      .locator("#patient-risk-score-inputs")
      .fill('{"age":68,"hypertension":true,"prior_stroke":false}');
    await saveOpenDialog(page);
    await expect(page.getByText("CHA2DS2-VASc")).toBeVisible();
    await expect(page.getByText(riskInterpretation)).toBeVisible();

    await expect(async () => {
      const detailResponse = await request.get(
        `${api.backendUrl}/api/v1/patients/${scenario.patient.id}`,
        { headers: api.headers },
      );
      expect(detailResponse.ok()).toBe(true);
      const detail = (await detailResponse.json()) as {
        clinical_warnings: string | null;
      };
      expect(detail.clinical_warnings).toBe(caveNotes);

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
          bmi: number | null;
          notes: string | null;
        }>;
      };
      expect(vitals.items[0]?.bp_systolic).toBe(128);
      expect(vitals.items[0]?.bp_diastolic).toBe(84);
      expect(vitals.items[0]?.heart_rate).toBe(71);
      expect(vitals.items[0]?.weight_kg).toBe(70);
      expect(vitals.items[0]?.height_cm).toBe(175);
      expect(vitals.items[0]?.notes).toBe(vitalsNote);

      const cardEntriesResponse = await request.get(
        `${api.backendUrl}/api/v1/patients/${scenario.patient.id}/card-entries`,
        { headers: api.headers },
      );
      expect(cardEntriesResponse.ok()).toBe(true);
      const cardEntries = (await cardEntriesResponse.json()) as {
        items: Array<{
          category: string;
          source: string | null;
          content: string;
        }>;
      };
      const cardEntry = cardEntries.items.find(
        (item) => item.content === cardEntryContent,
      );
      expect(cardEntry).toBeDefined();
      expect(cardEntry!.category).toBe("medical_update");
      expect(cardEntry!.source).toBe("Patient portal follow-up");

      const medicalOrdersResponse = await request.get(
        `${api.backendUrl}/api/v1/patients/${scenario.patient.id}/medical-orders`,
        { headers: api.headers },
      );
      expect(medicalOrdersResponse.ok()).toBe(true);
      const medicalOrders = (await medicalOrdersResponse.json()) as {
        items: Array<{
          title: string;
          instructions: string;
          status: string;
          source: string | null;
        }>;
      };
      const medicalOrder = medicalOrders.items.find(
        (item) => item.title === medicalOrderTitle,
      );
      expect(medicalOrder).toBeDefined();
      expect(medicalOrder!.instructions).toBe(medicalOrderInstructions);
      expect(medicalOrder!.status).toBe("completed");
      expect(medicalOrder!.source).toBe("Discharge note");

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
          inputs: Record<string, unknown> | null;
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
      expect(riskScore!.inputs).toMatchObject({
        age: 68,
        hypertension: true,
        prior_stroke: false,
      });
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

    await page.goto(`/orders?patient=${scenario.patient.id}&create=1`);
    const createDialog = page.getByRole("dialog");
    await expect(
      createDialog.getByRole("heading", { name: /Auftrag anlegen|Создать заказ/i }),
    ).toBeVisible();
    await expect(
      createDialog.getByText(
        /Re-Check fur Bestandskunden|Повторная проверка для существующего клиента/i,
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
        .getByText(label, { exact: true })
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
    await fillField("Staatsangehörigkeit", "Ukraine");
    await fillField("Wohnsitzland", "Germany");
    await fillField("Sprachen", "uk, de, en");
    await fillField("Haupttelefon", "+49 30 9990001");
    await fillField("Zweittelefon", "+49 30 9990002");
    await fillField("E-Mail", email);
    await fillField("Straße", "Testweg 7");
    await fillField("Stadt", "Berlin");
    await fillField("PLZ", "10117");
    await fillField("Land", "Germany");
    await fillField("Versicherer", "TK");
    await fillField("Versicherungsnummer", `TK-${tag}`);
    await fillField("Notfallkontakt Name", "Olena Test");
    await fillField("Notfallkontakt Telefon", "+49 30 9990099");
    await fillField("Notfallkontakt Beziehung", "spouse");

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
      expect(detail.nationality).toBe("Ukraine");
      expect(detail.residence_country).toBe("Germany");
      expect(detail.languages).toEqual(expect.arrayContaining(["uk", "de", "en"]));
      expect(detail.phone_primary).toBe("+49 30 9990001");
      expect(detail.phone_secondary).toBe("+49 30 9990002");
      expect(detail.email).toBe(email);
      expect(detail.address_street).toBe("Testweg 7");
      expect(detail.address_city).toBe("Berlin");
      expect(detail.address_zip).toBe("10117");
      expect(detail.address_country).toBe("Germany");
      expect(detail.insurance_provider).toBe("TK");
      expect(detail.insurance_number).toBe(`TK-${tag}`);
      expect(detail.emergency_contact_name).toBe("Olena Test");
      expect(detail.emergency_contact_phone).toBe("+49 30 9990099");
      expect(detail.emergency_contact_relation).toBe("spouse");
      expect(detail.patient_id).toMatch(/^P-\d{8}-\d{4}$/);
    }).toPass({ timeout: 15_000 });
  });
});
