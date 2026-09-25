import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  setGermanLanguage,
} from "./support/live-helpers";

function leadCard(page: Page, leadName: string) {
  // Desktop lists leads as table rows, mobile as cards (list items).
  return page
    .getByRole("row")
    .or(page.getByRole("listitem"))
    .filter({ hasText: leadName })
    .first();
}

/** The "Auftragspositionen" table of the contract step (service, ..., total). */
function orderPositions(wizard: Locator) {
  return wizard
    .getByRole("table")
    .filter({ has: wizard.page().getByRole("columnheader", { name: /^Leistung\b/ }) })
    .filter({ has: wizard.page().getByRole("columnheader", { name: /^Gesamt\b/ }) })
    .first();
}

/** The lead wizard steps are tabs ("Unterlagen — erledigt", ...). */
async function openWizardStep(wizard: Locator, step: RegExp) {
  const tab = wizard.getByRole("tab", { name: step });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return tab;
}

/**
 * Conversion needs an accepted quote that matches the order services. Seeds
 * built before the quote carried line items leave "Kostenvoranschlag annehmen"
 * open; staff then recalculate the quote from the order and accept it.
 */
async function recalculateAndAcceptQuote(page: Page, wizard: Locator, leadId: string) {
  await openWizardStep(wizard, /^Vertrag & Angebot/);
  const contractStepDone = wizard.getByRole("tab", { name: /^Vertrag & Angebot — erledigt/ });
  if (await contractStepDone.count()) {
    return;
  }
  const accept = wizard.getByRole("button", { name: /^Kostenvoranschlag annehmen$/ });
  const recalculated = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/orders\/[^/]+\/quotes$/.test(new URL(response.url()).pathname),
  );
  await wizard.getByRole("button", { name: /^Neu berechnen$/ }).click();
  expect((await recalculated).ok()).toBe(true);
  await expect(accept).toBeEnabled();
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/quotes\/[^/]+\/status$/.test(new URL(response.url()).pathname),
  );
  await accept.click();
  expect((await accepted).ok()).toBe(true);
  await expect(
    wizard.getByRole("tab", { name: /^Vertrag & Angebot — erledigt/ }),
    `quote accepted for lead ${leadId}`,
  ).toBeVisible();
}

/** Confirms the review checkbox on the release step and creates the patient. */
async function confirmPatientCreation(wizard: Locator) {
  await wizard
    .getByRole("checkbox", { name: /Ich habe die Angaben geprüft/i })
    .check();
  const create = wizard.getByRole("button", { name: /^Patient anlegen$|^Создать пациента$/i });
  await expect(create).toBeEnabled();
  const [converted] = await Promise.all([
    wizard.page().waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/v1\/leads\/[^/]+\/wizard-convert$/.test(new URL(response.url()).pathname),
    ),
    create.click(),
  ]);
  expect(converted.ok(), `wizard-convert: ${converted.status()} ${await converted.text()}`).toBe(
    true,
  );
}

async function openLeadDetail(page: Page, leadName: string, leadId?: string) {
  await page.goto(leadId ? `/leads?lead=${leadId}` : "/leads");
  const headingMatcher = new RegExp(leadName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const card = leadCard(page, leadName);
  if (!leadId) {
    await expect(card).toBeVisible();
    await card.click();
  }
  const detailPane = page
    .locator("aside, [role='dialog']")
    .filter({
      has: page.getByRole("heading", {
        name: headingMatcher,
      }),
    })
    .last();
  await expect(detailPane).toBeVisible();
  return detailPane;
}

async function openLeadQualificationPane(
  page: Page,
  leadName: string,
  leadId: string,
) {
  const detailPane = await openLeadDetail(page, leadName, leadId);
  await detailPane
    .getByRole("button", { name: /Qualifikation|Qualification/i })
    .click();
  await expect(
    detailPane.getByRole("button", { name: /Gate-Daten speichern|Save gate data/i }),
  ).toBeVisible();
  // Every lead reload re-initialises the gate form from the server, so let the
  // detail requests settle before typing (edits made earlier would be lost).
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  return detailPane;
}

async function openLeadWizard(page: Page, leadName: string) {
  await page.goto("/leads");
  const card = leadCard(page, leadName);
  await expect(card).toBeVisible();
  await card.click();
  const wizard = page
    .getByRole("dialog")
    .filter({ hasText: leadName })
    .last();
  await expect(wizard).toBeVisible();
  return wizard;
}

async function openLeadReleaseStep(page: Page, leadName: string, leadId: string) {
  const wizard = await openLeadWizard(page, leadName);
  await recalculateAndAcceptQuote(page, wizard, leadId);
  await openWizardStep(wizard, /^Freigabe/);
  await expect(
    wizard.getByRole("heading", { name: /Patient anlegen|Создание пациента/i }),
  ).toBeVisible();
  await expect(
    wizard.getByRole("tab", { name: /^Freigabe — erledigt/ }),
    "every onboarding step is complete",
  ).toBeVisible();
  return wizard;
}

async function selectLeadGateOption(
  page: Page,
  sheet: Locator,
  label: RegExp,
  option: RegExp,
) {
  const field = sheet
    .locator("label")
    .filter({ hasText: label })
    .first()
    .locator("xpath=parent::*");
  await field.getByRole("combobox").click({ timeout: 5_000 });
  const choice = page.getByRole("option", { name: option }).first();
  await expect(choice).toBeVisible({ timeout: 5_000 });
  await choice.click({ timeout: 5_000 });
}

/**
 * Fills and saves the qualification gate (birth date, legal sex, compliance,
 * consents). Any lead realtime event reloads the open lead and re-initialises
 * the gate form, which drops unsaved input, so the whole edit is retried until
 * one save carries every value.
 */
async function saveLeadGateData(
  page: Page,
  sheet: Locator,
  leadId: string,
  dateOfBirth: string,
) {
  await expect(async () => {
    await fillLeadGateDate(sheet, dateOfBirth);
    await selectLeadGateOption(page, sheet, /Rechtliches Geschlecht|Legal sex/i, /Weiblich|female/i);
    await selectLeadGateOption(page, sheet, /Compliance-Status|Compliance status/i, /Unterzeichnet|signed/i);
    for (const consent of [
      /Medizinische Einwilligung liegt vor|Healthcare consent available/i,
      /Datenschutzpraxis akzeptiert|Privacy practices accepted/i,
    ]) {
      await sheet
        .locator("label")
        .filter({ hasText: consent })
        .locator("input")
        .check({ timeout: 5_000 });
    }
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes(`/api/v1/leads/${leadId}/update`) &&
          candidate.request().method() === "POST",
        { timeout: 10_000 },
      ),
      sheet
        .getByRole("button", { name: /Gate-Daten speichern|Save gate data/i })
        .click({ timeout: 5_000 }),
    ]);
    expect(response.ok(), await response.text()).toBe(true);
    const payload = response.request().postDataJSON() as {
      date_of_birth?: string | null;
      legal_sex?: string | null;
      compliance_status?: string | null;
      consent_healthcare?: boolean;
      consent_privacy_practices?: boolean;
    };
    expect(payload).toMatchObject({
      date_of_birth: dateOfBirth,
      legal_sex: "female",
      compliance_status: "signed",
      consent_healthcare: true,
      consent_privacy_practices: true,
    });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });
}

/**
 * The birth date is an MUI date field: its hidden input ignores programmatic
 * values, so the day/month/year sections are filled like a user would.
 */
async function fillLeadGateDate(sheet: Locator, value: string) {
  const [year, month, day] = value.split("-");
  const dayField = sheet.getByRole("spinbutton", { name: "Day" });
  const monthField = sheet.getByRole("spinbutton", { name: "Month" });
  const yearField = sheet.getByRole("spinbutton", { name: "Year" });
  await yearField.fill(year, { timeout: 5_000 });
  await monthField.fill(month, { timeout: 5_000 });
  await dayField.fill(day, { timeout: 5_000 });
  await expect(dayField).toHaveText(day, { timeout: 5_000 });
  await expect(monthField).toHaveText(month, { timeout: 5_000 });
  await expect(yearField).toHaveText(year, { timeout: 5_000 });
}

test.describe("lead live workflows", () => {
  test("patient manager sees the centered onboarding document workflow on desktop", async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    const trustedContactsResponse = await request.post(
      `${api.backendUrl}/api/v1/leads/${scenario.leads.ready.id}/update`,
      {
        headers: api.headers,
        data: {
          trusted_contacts: [
            {
              id: "00000000-0000-0000-0000-000000000201",
              name: "Alex Beispiel",
              email: "alex@example.test",
              phone: "+49 30 200001",
              relation: "Partner",
              birth_date: "1989-02-03",
              address: "Hauptstr. 2, Berlin",
            },
            {
              id: "00000000-0000-0000-0000-000000000202",
              name: "Maria Beispiel",
              email: "maria@example.test",
              phone: "+49 30 200002",
              relation: "Schwester",
              birth_date: "1992-04-05",
              address: "Nebenstr. 4, Berlin",
            },
          ],
        },
      },
    );
    expect(trustedContactsResponse.ok()).toBe(true);
    const documentsResponse = await request.get(
      `${api.backendUrl}/api/v1/documents?lead_id=${scenario.leads.ready.id}`,
      { headers: api.headers },
    );
    expect(documentsResponse.ok()).toBe(true);
    const leadDocuments = (await documentsResponse.json()) as Array<{ id: string }>;
    // 3 signed compliance documents + 4 generated commercial documents.
    expect(leadDocuments).toHaveLength(7);

    const pageDocumentsResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/v1/documents?lead_id=${scenario.leads.ready.id}`) &&
        response.request().method() === "GET",
    );
    const wizard = await openLeadWizard(page, scenario.leads.ready.name);
    const loadedDocumentsResponse = await pageDocumentsResponse;
    expect(loadedDocumentsResponse.ok()).toBe(true);
    expect((await loadedDocumentsResponse.json()) as unknown[]).toHaveLength(7);
    await expect(wizard.getByText("Versicherung", { exact: true })).toBeVisible();

    const desktopBox = await wizard.boundingBox();
    expect(desktopBox).not.toBeNull();
    expect(desktopBox!.width).toBeGreaterThan(1_100);
    expect(Math.abs(desktopBox!.x + desktopBox!.width / 2 - 720)).toBeLessThan(3);

    await openWizardStep(wizard, /^Unterlagen/);
    await expect(
      wizard.getByRole("heading", { name: "Schweigepflichtsentbindung" }),
    ).toBeVisible();
    await expect(
      wizard.getByText("Vertrauenskontakt / zusätzlicher Empfänger", { exact: true }),
    ).toBeVisible();
    const trustedContacts = wizard.getByRole("list", { name: "Vertrauenskontakte" });
    await expect(trustedContacts.getByText("Alex Beispiel", { exact: true })).toBeVisible();
    await expect(trustedContacts.getByText("Maria Beispiel", { exact: true })).toBeVisible();

    await wizard.getByRole("button", { name: "Kontakt hinzufügen" }).click();
    const contactSheet = page.getByRole("dialog", { name: "Vertrauenskontakt hinzufügen" });
    await expect(contactSheet).toBeVisible();
    await contactSheet.getByRole("textbox", { name: "Vor- und Nachname" }).fill("Petra Beispiel");
    await contactSheet.getByRole("textbox", { name: "E-Mail" }).fill("petra@example.test");
    await contactSheet.getByRole("textbox", { name: "Telefon" }).fill("+49 30 200003");
    const contactsSaved = page.waitForResponse(async (response) => {
      if (
        response.request().method() !== "POST"
        || !response.url().includes(`/api/v1/leads/${scenario.leads.ready.id}/update`)
      ) return false;
      const payload = response.request().postDataJSON() as { trusted_contacts?: unknown[] };
      return payload.trusted_contacts?.length === 3;
    });
    await contactSheet.getByRole("button", { name: "Hinzufügen" }).click();
    expect((await contactsSaved).ok()).toBe(true);
    await expect(trustedContacts.getByText("Petra Beispiel", { exact: true })).toBeVisible();
    await expect(
      wizard.getByRole("heading", { name: "Einverständniserklärung zur Datenübermittlung" }),
    ).toBeVisible();
    await expect(
      wizard.getByRole("heading", { name: "Ausweisdokument" }),
    ).toBeVisible();

    // The preview is the in-app PDF viewer sheet, titled by the file name.
    await wizard.getByRole("button", { name: "Vorschau" }).first().click();
    const documentPreview = page
      .getByRole("dialog")
      .filter({ hasText: "Dokumentvorschau und Dokumentaktionen" })
      .last();
    await expect(documentPreview).toBeVisible();
    await expect(
      documentPreview.getByRole("heading", { name: /\.pdf$/ }),
    ).toBeVisible();
    await expect(
      documentPreview.getByRole("button", { name: "Datei herunterladen" }),
    ).toBeVisible();
    // The viewer sheet is wide and centred like the wizard (its own max width).
    await expect.poll(async () => {
      const previewBox = await documentPreview.boundingBox();
      return previewBox
        ? Math.abs(previewBox.x + previewBox.width / 2 - 720)
        : Number.POSITIVE_INFINITY;
    }).toBeLessThan(3);
    expect((await documentPreview.boundingBox())!.width).toBeGreaterThan(1_000);
    await documentPreview.getByRole("button", { name: /Schließen/i }).click();

    await openWizardStep(wizard, /^Vertrag & Angebot/);
    // Document headings carry their signature state, e.g. "Rahmenvertrag Unterzeichnet".
    await expect(
      wizard.getByRole("heading", { name: /^Rahmenvertrag\b/ }),
    ).toBeVisible();
    await expect(
      wizard.getByRole("heading", { name: /^Einzelauftrag\b/ }),
    ).toBeVisible();
    await expect(
      wizard.getByRole("heading", { name: /^Kostenvoranschlag und Vorauszahlung$/ }),
    ).toBeVisible();
    await expect(
      wizard.getByRole("heading", { name: /^Kostenvoranschlag zum Einzelauftrag$/ }),
    ).toBeVisible();
    const orderPositionsTable = orderPositions(wizard);
    await expect(orderPositionsTable).toBeVisible();
    await expect(orderPositionsTable.getByRole("columnheader", { name: /^Leistung\b/ })).toBeVisible();
    await expect(orderPositionsTable.getByRole("columnheader", { name: /^Gesamt\b/ })).toBeVisible();
    await expect(orderPositionsTable.getByText("Initial cardiology coordination")).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("lead-wizard-desktop.png"),
    });
  });

  test("lead onboarding modal stays contained on a mobile viewport", async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    const wizard = await openLeadWizard(page, scenario.leads.ready.name);
    await expect(wizard.getByText("Versicherung", { exact: true })).toBeVisible();
    await openWizardStep(wizard, /^Unterlagen/);
    await expect(
      wizard.getByRole("heading", { name: "Schweigepflichtsentbindung" }),
    ).toBeVisible();
    await openWizardStep(wizard, /^Vertrag & Angebot/);
    // On a phone the order positions are cards instead of a table.
    await expect(wizard.getByRole("heading", { name: "Auftragspositionen" })).toBeVisible();
    await expect(
      wizard.getByRole("listitem").filter({ hasText: "Initial cardiology coordination" }),
    ).toBeVisible();
    await expect(
      wizard.getByRole("heading", { name: /^Kostenvoranschlag und Vorauszahlung$/ }),
    ).toBeVisible();

    const mobileBox = await wizard.boundingBox();
    expect(mobileBox).not.toBeNull();
    expect(mobileBox!.x).toBeGreaterThanOrEqual(0);
    expect(mobileBox!.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("lead-wizard-mobile.png"),
    });
  });

  test("an incomplete lead can open order intake without breaking the wizard layout", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    const wizard = await openLeadWizard(page, scenario.leads.blocked.name);
    const initialBox = await wizard.boundingBox();
    expect(initialBox).not.toBeNull();

    await openWizardStep(wizard, /^Auftragserfassung/);
    await expect(
      wizard.getByRole("combobox", { name: /Fachrichtung hinzufügen/i }),
    ).toBeVisible();
    const orderBox = await wizard.boundingBox();
    expect(orderBox).not.toBeNull();
    expect(Math.abs(orderBox!.width - initialBox!.width)).toBeLessThan(3);
    const horizontalLayout = await wizard.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
    }));
    expect(horizontalLayout.scrollWidth).toBeLessThanOrEqual(horizontalLayout.clientWidth + 1);
  });

  test("patient manager can complete blocked lead gate data and convert it into a patient", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    const detailSheet = await openLeadQualificationPane(
      page,
      scenario.leads.blocked.name,
      scenario.leads.blocked.id,
    );

    await saveLeadGateData(page, detailSheet, scenario.leads.blocked.id, "1991-01-01");
    const wizard = await openLeadReleaseStep(
      page,
      scenario.leads.blocked.name,
      scenario.leads.blocked.id,
    );
    await confirmPatientCreation(wizard);

    await page.waitForURL(/\/patients\/[^/]+$/);
    await expect(
      page.getByRole("heading", { name: new RegExp(scenario.leads.blocked.name, "i") }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Arbeitsablauf|Workflow/i }),
    ).toBeVisible();

    const patientId = new URL(page.url()).pathname.split("/").pop()!;
    expect(patientId).toBeTruthy();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const patientResponse = await request.get(
      `${api.backendUrl}/api/v1/patients/${patientId}`,
      { headers: api.headers },
    );
    expect(patientResponse.ok()).toBe(true);
    const patient = (await patientResponse.json()) as {
      first_name: string;
      gender: string;
      birth_date: string;
    };
    expect(patient.first_name).toBe("Blocked");
    expect(patient.gender).toBe("female");
    expect(patient.birth_date).toBe("1991-01-01");

    const leadResponse = await request.get(
      `${api.backendUrl}/api/v1/leads/${scenario.leads.blocked.id}`,
      { headers: api.headers },
    );
    expect(leadResponse.ok()).toBe(true);
    const leadRecord = (await leadResponse.json()) as {
      converted_patient_id: string | null;
      compliance_status: string;
      consent_healthcare: boolean;
      consent_privacy_practices: boolean;
    };
    expect(leadRecord.converted_patient_id).toBe(patientId);
    expect(leadRecord.compliance_status).toBe("signed");
    expect(leadRecord.consent_healthcare).toBe(true);
    expect(leadRecord.consent_privacy_practices).toBe(true);

    const assignmentsResponse = await request.get(
      `${api.backendUrl}/api/v1/patients/${patientId}/assignments`,
      { headers: api.headers },
    );
    expect(assignmentsResponse.ok()).toBe(true);
    const assignments = (await assignmentsResponse.json()) as Array<{
      user_id: string;
      user_role: string;
      revoked_at: string | null;
    }>;
    const pmAssignment = assignments.find(
      (assignment) =>
        assignment.user_id === scenario.credentials.pm.user_id &&
        assignment.revoked_at === null,
    );
    expect(pmAssignment).toBeDefined();
    expect(pmAssignment!.user_role).toBe("patient_manager");
  });

  test("patient manager can archive a failed lead through the controlled failed-flow", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    const detailSheet = await openLeadQualificationPane(
      page,
      scenario.leads.ready.name,
      scenario.leads.ready.id,
    );

    await detailSheet.getByLabel(/Fehlergrund|Failure reason/i).fill("No medical fit for current program");
    await detailSheet.getByLabel(/Interne Notiz|Internal note/i).fill(
      "Archived after PM review in live E2E flow.",
    );
    const failedFlowResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/leads/${scenario.leads.ready.id}/failed-flow`) &&
        nextResponse.request().method() === "POST",
    );
    await detailSheet.getByRole("button", { name: /Bearbeitung nicht erfolgreicher Leads speichern|Save failed-lead resolution/i }).click();
    expect((await failedFlowResponse).ok()).toBe(true);

    await expect(detailSheet.getByText(/^Archiviert$|^Archived$/i).first()).toBeVisible();
    await expect(detailSheet.getByText(/^Qualifiziert$|^Qualified$/i).first()).toBeVisible();
    await expect(
      detailSheet.getByText("No medical fit for current program").first(),
    ).toBeVisible();
    await expect(
      detailSheet.getByRole("button", { name: /Failed-Lead-Bearbeitung speichern|Save failed-lead resolution/i }),
    ).toHaveCount(0);

    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    const leadResponse = await request.get(
      `${api.backendUrl}/api/v1/leads/${scenario.leads.ready.id}`,
      { headers: api.headers },
    );
    expect(leadResponse.ok()).toBe(true);
    const leadRecord = (await leadResponse.json()) as {
      qualification_status: string;
      converted_patient_id: string | null;
      failed_outcome: {
        status: string;
        from_status: string | null;
        reason: string | null;
        note: string | null;
        processed_at: string | null;
        processed_by: string | null;
      };
    };
    expect(leadRecord.qualification_status).toBe("archived");
    expect(leadRecord.converted_patient_id).toBeNull();
    expect(leadRecord.failed_outcome.status).toBe("archived");
    expect(leadRecord.failed_outcome.from_status).toBe("qualified");
    expect(leadRecord.failed_outcome.reason).toBe(
      "No medical fit for current program",
    );
    expect(leadRecord.failed_outcome.note).toBe(
      "Archived after PM review in live E2E flow.",
    );
    expect(leadRecord.failed_outcome.processed_by).toBe(
      scenario.credentials.pm.user_id,
    );
    expect(leadRecord.failed_outcome.processed_at).not.toBeNull();
  });

  test("patient manager can directly convert an already-ready lead and the new patient carries the lead's demographics", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    const wizard = await openLeadReleaseStep(
      page,
      scenario.leads.ready.name,
      scenario.leads.ready.id,
    );
    await confirmPatientCreation(wizard);

    await page.waitForURL(/\/patients\/[^/]+$/);
    const patientId = new URL(page.url()).pathname.split("/").pop()!;
    expect(patientId).toBeTruthy();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const patientResponse = await request.get(
      `${api.backendUrl}/api/v1/patients/${patientId}`,
      { headers: api.headers },
    );
    expect(patientResponse.ok()).toBe(true);
    const patient = (await patientResponse.json()) as {
      first_name: string;
      gender: string;
      birth_date: string;
    };
    expect(patient.first_name).toBe("Ready");
    expect(patient.gender).toBe("female");
    expect(patient.birth_date).toBe("1991-01-01");

    const leadResponse = await request.get(
      `${api.backendUrl}/api/v1/leads/${scenario.leads.ready.id}`,
      { headers: api.headers },
    );
    expect(leadResponse.ok()).toBe(true);
    const leadRecord = (await leadResponse.json()) as {
      converted_patient_id: string | null;
    };
    expect(leadRecord.converted_patient_id).toBe(patientId);
  });

  test("sales can create and qualify a lead but cannot convert it into a patient", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "sales");
    const salesApi = await authenticateApiClient(
      request,
      scenario.credentials.sales.email,
      scenario.credentials.password,
    );
    const leadName = `Sales Boundary ${scenario.tag}`;

    await page.goto("/leads");
    await expect(
      page.getByRole("button", { name: /Neuer Lead|New lead/i }),
    ).toBeVisible();

    const createLeadResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes("/api/v1/leads") &&
        nextResponse.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Neuer Lead|New lead/i }).click();
    const createDialog = page.getByRole("dialog");
    await expect(
      createDialog.getByRole("heading", { name: /Neuer Lead|Create lead/i }),
    ).toBeVisible();
    const createInputs = createDialog.locator("input");
    await createInputs.nth(0).fill("Sales");
    await createInputs.nth(1).fill(`Boundary ${scenario.tag}`);
    await createInputs
      .nth(2)
      .fill(`+49 30 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
    await createInputs
      .nth(3)
      .fill(`sales-boundary-${scenario.tag}@example.com`);
    await createDialog.getByRole("button", { name: /Save|Speichern|Сохранить/i }).click();

    const createdLeadResponse = await createLeadResponse;
    expect(createdLeadResponse.ok()).toBe(true);
    const createdLead = (await createdLeadResponse.json()) as { id: string };

    const createdLeadCard = leadCard(page, leadName);
    await expect(createdLeadCard).toBeVisible();

    const detailSheet = await openLeadQualificationPane(
      page,
      leadName,
      createdLead.id,
    );

    await saveLeadGateData(page, detailSheet, createdLead.id, "1992-02-02");
    await detailSheet
      .getByRole("button", { name: /Prozess|Process/i })
      .click();
    await expect(detailSheet.getByText(/Qualifikation bereit|Qualification ready/i)).toBeVisible();
    await expect(detailSheet.getByText(/Konvertierung blockiert|Conversion blocked/i)).toBeVisible();

    const qualifyResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/leads/${createdLead.id}/qualify`) &&
        nextResponse.request().method() === "POST",
    );
    await detailSheet
      .getByRole("button", { name: /Als qualified markieren|Отметить квалифицированным/i })
      .click();
    const qualifiedLeadResponse = await qualifyResponse;
    expect(qualifiedLeadResponse.ok()).toBe(true);

    await expect(detailSheet.getByText(/^Qualifiziert$|^Qualified$/i).first()).toBeVisible();
    await expect(
      detailSheet.getByRole("button", { name: /Konvertieren|Convert/i }),
    ).toBeDisabled();

    const leadResponse = await request.get(
      `${salesApi.backendUrl}/api/v1/leads/${createdLead.id}`,
      { headers: salesApi.headers },
    );
    expect(leadResponse.ok()).toBe(true);
    const leadRecord = (await leadResponse.json()) as {
      qualification_status: string;
      converted_patient_id: string | null;
      compliance_status: string;
      consent_healthcare: boolean;
      consent_privacy_practices: boolean;
      date_of_birth: string;
      legal_sex: string;
    };
    expect(leadRecord.qualification_status).toBe("qualified");
    expect(leadRecord.converted_patient_id).toBeNull();
    expect(leadRecord.compliance_status).toBe("signed");
    expect(leadRecord.consent_healthcare).toBe(true);
    expect(leadRecord.consent_privacy_practices).toBe(true);
    expect(leadRecord.date_of_birth).toBe("1992-02-02");
    expect(leadRecord.legal_sex).toBe("female");
  });

  test("interpreter deep-linking /leads is redirected by the staff route guard and cannot convert a ready lead via the API", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "interpreter");

    // Phase F: ROLES_LEADS now matches list_leads (patient_manager, sales).
    // The AppLayoutInner staff route guard redirects interpreter to "/" on
    // deep-link to /leads instead of rendering the page placeholder.
    await page.goto("/leads");
    await page.waitForURL((current) => current.pathname === "/", {
      timeout: 10_000,
    });
    await expect(
      page.getByRole("heading", { name: "Leads workspace" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: scenario.leads.ready.name, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Konvertieren|Convert/i }),
    ).toHaveCount(0);

    const interpreterApi = await authenticateApiClient(
      request,
      scenario.credentials.interpreter.email,
      scenario.credentials.password,
    );
    const forbiddenResponse = await request.post(
      `${interpreterApi.backendUrl}/api/v1/leads/${scenario.leads.ready.id}/convert`,
      { headers: interpreterApi.headers },
    );
    expect(forbiddenResponse.status()).toBe(403);

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    const leadResponse = await request.get(
      `${pmApi.backendUrl}/api/v1/leads/${scenario.leads.ready.id}`,
      { headers: pmApi.headers },
    );
    expect(leadResponse.ok()).toBe(true);
    const leadRecord = (await leadResponse.json()) as {
      converted_patient_id: string | null;
    };
    expect(leadRecord.converted_patient_id).toBeNull();
  });
});
