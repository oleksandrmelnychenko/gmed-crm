import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  chooseComboboxOption,
  setGermanLanguage,
} from "./support/live-helpers";

function leadCard(page: Page, leadName: string) {
  return page
    .getByRole("row")
    .filter({ hasText: leadName })
    .first();
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
  return detailPane;
}

function leadConvertButton(page: Page, leadName: string) {
  return leadCard(page, leadName).getByRole("button", { name: /Konvertieren|Convert/i });
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
  await chooseComboboxOption(page, field.getByRole("combobox"), option);
}

async function fillLeadGateDate(sheet: Locator, value: string) {
  const dateInput = sheet.locator("#lead-gate-date-of-birth");
  if (await dateInput.count()) {
    await dateInput.evaluate((node, nextValue) => {
      const input = node as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    return;
  }

  const [year, month, day] = value.split("-");
  await sheet.getByRole("spinbutton", { name: "Year" }).fill(year);
  await sheet.getByRole("spinbutton", { name: "Month" }).fill(month);
  await sheet.getByRole("spinbutton", { name: "Day" }).fill(day);
}

test.describe("lead live workflows", () => {
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

    await fillLeadGateDate(detailSheet, "1991-01-01");
    await selectLeadGateOption(page, detailSheet, /Rechtliches Geschlecht|Legal sex/i, /Weiblich|female/i);
    await selectLeadGateOption(page, detailSheet, /Compliance-Status|Compliance status/i, /Unterzeichnet|signed/i);
    await detailSheet
      .locator("label")
      .filter({ hasText: /Medizinische Einwilligung liegt vor|Healthcare consent available/i })
      .locator("input")
      .check();
    await detailSheet
      .locator("label")
      .filter({ hasText: /Datenschutzpraxis akzeptiert|Privacy practices accepted/i })
      .locator("input")
      .check();
    const saveGateResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/leads/${scenario.leads.blocked.id}/update`) &&
        nextResponse.request().method() === "POST",
    );
    await detailSheet.getByRole("button", { name: /Gate-Daten speichern|Save gate data/i }).click();
    expect((await saveGateResponse).ok()).toBe(true);
    await page.goto("/leads");

    const convertButton = leadConvertButton(page, scenario.leads.blocked.name);
    await expect(convertButton).toBeEnabled();
    await convertButton.click();

    const convertDialog = page.getByRole("dialog");
    await expect(
      convertDialog.getByRole("heading", {
        name: /Lead in Patienten umwandeln\?|Convert lead to patient\?/i,
      }),
    ).toBeVisible();
    await convertDialog
      .getByRole("button", { name: /Patient anlegen|Create patient/i })
      .click();

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
    await detailSheet.getByRole("button", { name: /Failed-Lead-Bearbeitung speichern|Save failed-lead resolution/i }).click();
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

    await page.goto("/leads");
    const convertButton = leadConvertButton(page, scenario.leads.ready.name);
    await expect(convertButton).toBeEnabled();
    await convertButton.click();

    const convertDialog = page.getByRole("dialog");
    await expect(
      convertDialog.getByRole("heading", {
        name: /Lead in Patienten umwandeln\?|Convert lead to patient\?/i,
      }),
    ).toBeVisible();
    await convertDialog
      .getByRole("button", { name: /Patient anlegen|Create patient/i })
      .click();

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
    await createInputs.nth(2).fill("+49 30 555 010");
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

    await fillLeadGateDate(detailSheet, "1992-02-02");
    await selectLeadGateOption(page, detailSheet, /Rechtliches Geschlecht|Legal sex/i, /Weiblich|female/i);
    await selectLeadGateOption(page, detailSheet, /Compliance-Status|Compliance status/i, /Unterzeichnet|signed/i);
    await detailSheet
      .locator("label")
      .filter({ hasText: /Medizinische Einwilligung liegt vor|Healthcare consent available/i })
      .locator("input")
      .check();
    await detailSheet
      .locator("label")
      .filter({ hasText: /Datenschutzpraxis akzeptiert|Privacy practices accepted/i })
      .locator("input")
      .check();
    const saveSalesGateResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/leads/${createdLead.id}/update`) &&
        nextResponse.request().method() === "POST",
    );
    await detailSheet.getByRole("button", { name: /Gate-Daten speichern|Save gate data/i }).click();
    expect((await saveSalesGateResponse).ok()).toBe(true);
    await detailSheet
      .getByRole("button", { name: /Prozess|Process/i })
      .click();
    await expect(detailSheet.getByText(/Qualifikation bereit|Qualification ready/i)).toBeVisible();
    await expect(detailSheet.getByText(/Konvertierung blockiert|Conversion blocked/i)).toBeVisible();

    await page.goto("/leads");
    const refreshedLeadCard = leadCard(page, leadName);
    await expect(
      refreshedLeadCard.getByRole("button", { name: /Qualifizieren|Qualify/i }),
    ).toBeVisible();

    const qualifyResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/leads/${createdLead.id}/qualify`) &&
        nextResponse.request().method() === "POST",
    );
    await refreshedLeadCard.getByRole("button", { name: /Qualifizieren|Qualify/i }).click();
    const qualifiedLeadResponse = await qualifyResponse;
    expect(qualifiedLeadResponse.ok()).toBe(true);

    await expect(refreshedLeadCard.getByText(/Qualifiziert|Qualified/i)).toBeVisible();
    await expect(
      refreshedLeadCard.getByRole("button", { name: /Konvertieren|Convert/i }),
    ).toHaveCount(0);

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
