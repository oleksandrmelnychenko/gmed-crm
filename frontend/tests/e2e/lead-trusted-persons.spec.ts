import { expect, test, type Page } from "@playwright/test";
import type { LeadDisclosure, LeadDisclosureInput } from "../../src/pages/patient-lead/lead-request-api";

const core = { agency_processing: true, doctors_to_agency: true, data_system: true, named_recipients: false, channel_email: false, channel_threema: false, channel_whatsapp: false, channel_telegram: false };
type Person = { name: string; relation: string; contact: string | null; scope?: string; scope_codes?: string[] };
function request(id = "child-a", firstName = "Anna") {
  return {
    lead_id: id, access_kind: "guardian", minor: true,
    created_at: "2026-10-14T08:00:00Z", submitted_at: null, changed_since_submit: false,
    progress: { filled: 0, total: 12, missing_for_submit: [] }, consents: {}, documents: [], identity_documents: [],
    personal_data: { first_name: firstName, last_name: "Muster", primary_language: "en" },
    trusted_persons: [] as Person[], disclosure: null as LeadDisclosure | null, disclosure_company_name: "Example Care GmbH",
    consent_form: { version: "v1", choices: { ...core }, chosen_at: "2026-10-14T08:00:00Z", chosen_by_me: true, recipients: [] as Person[] },
  };
}
const receipt = (allow = true): LeadDisclosure => ({ allow_disclosure: allow, consent_given: allow, version: "2026-10-14", language: "en", chosen_at: "2026-10-14T10:00:00Z", chosen_by: "synthetic-guardian", chosen_by_name: "Guardian Muster", access_kind: "guardian", company_name: "Example Care GmbH" });

async function setup(page: Page, options: { requests?: ReturnType<typeof request>[]; closed?: boolean; failSave?: boolean; failLoad?: boolean; patientMode?: boolean; lang?: string; selected?: string } = {}) {
  const requests = options.requests ?? [request()];
  const calls: ({ id: string } & LeadDisclosureInput)[] = [];
  let failSave = options.failSave ?? false;
  let failLoad = options.failLoad ?? false;
  await page.addInitScript(({ lang }) => {
    localStorage.setItem("gmed_access_token", "synthetic-disclosure-token");
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_lead_cabinet_lang:synthetic-guardian", lang);
  }, { lang: options.lang ?? "en" });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") return route.fulfill({ json: {
      id: "synthetic-guardian", email: "guardian@example.com", name: "Guardian Muster", role: "patient", capabilities: [],
      created_at: "2026-10-01T00:00:00Z", preferred_language: "en", password_change_required: false,
      portal_mode: options.patientMode ? "patient" : "lead", lead_portal: { requests: requests.length },
      patients: options.patientMode ? [{ id: "patient-a", first_name: "First", last_name: "Child" }, { id: "patient-b", first_name: "Second", last_name: "Child" }] : [],
    } });
    if (path === "/me/lead-requests") {
      if (failLoad) { failLoad = false; return route.fulfill({ status: 503, json: { error: "unavailable" } }); }
      return route.fulfill({ json: { requests: options.closed ? [] : requests, own_access_closed: Boolean(options.closed) } });
    }
    const match = path.match(/^\/me\/lead-requests\/([^/]+)\/trusted-persons$/);
    if (match && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as LeadDisclosureInput;
      calls.push({ id: match[1], ...body });
      if (failSave) { failSave = false; return route.fulfill({ status: 422, json: { code: "consent_recipients_invalid" } }); }
      const item = requests.find((entry) => entry.lead_id === match[1])!;
      item.trusted_persons = body.persons;
      item.disclosure = { ...receipt(body.allow_disclosure), language: body.language };
      item.consent_form.choices.named_recipients = body.allow_disclosure;
      item.consent_form.recipients = body.persons;
      return route.fulfill({ json: item });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`/trusted-persons${options.selected ? `?lead=${options.selected}` : ""}`);
  return { calls, requests };
}

const MEDICAL = "Medical information (findings, treatment)";
const FINANCIAL = "Financial information (cost estimates, invoices, payments)";

/** Ticks or unticks scope options in the multi-select of one person, then closes it. */
async function toggleScope(page: Page, options: string[], row = page.getByTestId("trusted-person-editor").last()) {
  await row.getByLabel("Scope of information", { exact: true }).click();
  for (const option of options) await page.getByRole("option", { name: option, exact: true }).click();
  await page.keyboard.press("Escape");
}

async function addFriend(page: Page, name = "Eva Friend") {
  await page.getByTestId("disclosure-yes").check();
  await page.getByTestId("trusted-person-add").click();
  const row = page.getByTestId("trusted-person-editor").last();
  await row.getByLabel("Last name, first name").fill(name);
  await row.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Friend / acquaintance", exact: true }).click();
  await toggleScope(page, [MEDICAL], row);
  await page.getByTestId("disclosure-consent").check();
}

test("old bookmark opens the disclosure step inside Your request without a separate menu item", async ({ page }) => {
  await setup(page);
  await expect(page).toHaveURL(/\/\?step=disclosure/);
  await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "disclosure");
  await expect(page.getByTestId("lead-request-steps").locator('[data-step="disclosure"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator('a[href="/trusted-persons"]')).toHaveCount(0);
});

test("a failed save keeps the step and draft; retrying a step tab saves before navigation", async ({ page }) => {
  const { calls } = await setup(page, { failSave: true });
  await addFriend(page);
  const tabs = page.getByTestId("lead-request-steps");
  await tabs.locator('[data-step="send"]').click();
  await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "disclosure");
  await expect(page.getByTestId("lead-request-save-blocked")).toBeVisible();
  await expect(page.getByLabel("Last name, first name")).toHaveValue("Eva Friend");
  await tabs.locator('[data-step="send"]').click();
  await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "send");
  await expect(page.getByTestId("lead-request-send")).toBeVisible();
  await tabs.locator('[data-step="disclosure"]').click();
  await expect(page.getByTestId("disclosure-consent")).toBeChecked();
  await expect(page.getByLabel("Last name, first name")).toHaveValue("Eva Friend");
  expect(calls).toHaveLength(2);
});

test("an incomplete choice is not discarded when another step is selected", async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByTestId("disclosure-yes").check();
  await page.getByTestId("trusted-person-add").click();
  await page.getByLabel("Last name, first name").fill("Unfinished person");
  await page.getByTestId("lead-request-steps").locator('[data-step="identity"]').click();
  await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "disclosure");
  await expect(page.getByLabel("Last name, first name")).toHaveValue("Unfinished person");
  expect(calls).toHaveLength(0);
});

test("automatic save keeps failed drafts; Next retries and reload restores decision, scope and receipt", async ({ page }) => {
  const { calls } = await setup(page, { failSave: true });
  // Unanswered counts as "No" (owner 2026-10-22).
  await expect(page.getByTestId("disclosure-no")).toBeChecked();
  await expect(page.getByTestId("disclosure-yes")).not.toBeChecked();
  await expect(page.getByTestId("trusted-persons-save")).toHaveCount(0);
  await addFriend(page);
  await expect(page.getByText("I expressly consent to Example Care GmbH", { exact: false })).toBeVisible();
  await expect(page.getByRole("alert").last()).toContainText("Enter a name and relationship and choose the scope");
  await expect(page.getByTestId("trusted-person-editor").getByLabel("Last name, first name")).toHaveValue("Eva Friend");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "documents");
  await page.getByTestId("lead-request-steps").locator('[data-step="disclosure"]').click();
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Saved");
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual({ id: "child-a", persons: [{ name: "Eva Friend", relation: "friend", contact: null, scope_codes: ["medical"] }], allow_disclosure: true, consent_given: true, version: "2026-10-14", language: "en" });
  await page.reload();
  await expect(page.getByTestId("disclosure-yes")).toBeChecked();
  await expect(page.getByTestId("disclosure-consent")).toBeChecked();
  await expect(page.getByTestId("disclosure-receipt")).toContainText("Guardian Muster");
  await expect(page.getByTestId("trusted-person-editor").getByLabel("Scope of information", { exact: true })).toContainText("Medical information");
});

test("Yes requires person, scope and checkbox; editing details requires fresh consent", async ({ page }) => {
  await setup(page);
  await page.getByTestId("disclosure-yes").check();
  await expect(page.getByTestId("trusted-persons-save")).toHaveCount(0);
  await addFriend(page);
  await expect(page.getByTestId("trusted-persons-save")).toHaveCount(0);
  await toggleScope(page, [MEDICAL]);
  await expect(page.getByLabel("Scope of information", { exact: true })).toContainText("Please choose");
  await expect(page.getByTestId("disclosure-consent")).not.toBeChecked();
  await page.getByTestId("disclosure-consent").check();
  await expect(page.getByTestId("trusted-persons-save")).toHaveCount(0);
  await toggleScope(page, [FINANCIAL]);
  await expect(page.getByTestId("disclosure-consent")).not.toBeChecked();
  await page.getByTestId("disclosure-consent").check();
  await expect(page.getByTestId("trusted-persons-save")).toHaveCount(0);
  await page.getByTestId("disclosure-no").check();
  await page.getByTestId("disclosure-yes").check();
  await expect(page.getByTestId("disclosure-consent")).not.toBeChecked();
  await expect(page.getByLabel("Scope of information", { exact: true })).toContainText("Financial information");
});

test("Next names each missing entry at its field and a contact must be a phone number or an e-mail address", async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByTestId("disclosure-yes").check();
  await page.getByTestId("trusted-person-add").click();
  const row = page.getByTestId("trusted-person-editor");
  // A blank row: what is missing in it, not "add a person".
  await expect(page.getByText("Add at least one person or select No.")).toHaveCount(0);
  await row.getByLabel("Phone / email").fill("abc");
  await row.getByLabel("Last name, first name").click();
  await expect(row.getByTestId("trusted-person-contact-error")).toHaveText("Please enter a phone number (e.g. +49 30 1234567) or an email address.");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "disclosure");
  await expect(row.getByTestId("trusted-person-name-error")).toBeVisible();
  await expect(row.getByTestId("trusted-person-relation-error")).toBeVisible();
  await expect(row.getByTestId("trusted-person-scope-error")).toBeVisible();
  await expect(row.getByLabel("Last name, first name")).toHaveAttribute("aria-invalid", "true");
  await row.getByLabel("Last name, first name").fill("Eva Friend");
  await row.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Friend / acquaintance", exact: true }).click();
  await toggleScope(page, [MEDICAL], row);
  await row.getByLabel("Phone / email").fill("+49 151 000000");
  await expect(row.getByTestId("trusted-person-contact-error")).toHaveCount(0);
  await page.getByTestId("disclosure-consent").check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "documents");
  expect(calls.at(-1)?.persons).toEqual([{ name: "Eva Friend", relation: "friend", contact: "+49 151 000000", scope_codes: ["medical"] }]);
  // Five people at most: the add button gives way to a note.
  await page.getByTestId("lead-request-steps").locator('[data-step="disclosure"]').click();
  for (let count = 1; count < 5; count += 1) await page.getByTestId("trusted-person-add").click();
  await expect(page.getByTestId("trusted-person-add")).toHaveCount(0);
  await expect(page.getByTestId("trusted-person-max")).toHaveText("You can name up to 5 people.");
});

test("All information ticks every option; unticking one keeps the rest", async ({ page }) => {
  const { calls } = await setup(page);
  await addFriend(page);
  await toggleScope(page, ["All information"]);
  await expect(page.getByLabel("Scope of information", { exact: true })).toContainText("All information");
  await page.getByLabel("Scope of information", { exact: true }).click();
  for (const option of ["All information", MEDICAL, FINANCIAL]) {
    await expect(page.getByRole("option", { name: option, exact: true }).locator("svg")).toHaveCount(1);
  }
  await page.getByRole("option", { name: MEDICAL, exact: true }).click();
  await expect(page.getByRole("option", { name: "All information", exact: true }).locator("svg")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Scope of information", { exact: true })).toContainText("Organisational information, Financial information");
  await page.getByTestId("disclosure-consent").check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "documents");
  expect(calls.at(-1)?.persons[0].scope_codes).toEqual(["organisational", "financial"]);
});

test("a free-text scope from before is shown and must be chosen again", async ({ page }) => {
  const item = request(); item.disclosure = receipt();
  item.trusted_persons = [{ name: "Eva Friend", relation: "friend", contact: null, scope: "medizin" }];
  const { calls } = await setup(page, { requests: [item] });
  await expect(page.getByTestId("trusted-person-scope-legacy")).toContainText("“medizin”");
  await expect(page.getByLabel("Scope of information", { exact: true })).toContainText("Please choose");
  expect(calls).toHaveLength(0);
  await toggleScope(page, [MEDICAL]);
  await expect(page.getByTestId("trusted-person-scope-legacy")).toHaveCount(0);
  await expect(page.getByTestId("disclosure-consent")).not.toBeChecked();
  await page.getByTestId("disclosure-consent").check();
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Saved");
  expect(calls.at(-1)?.persons).toEqual([{ name: "Eva Friend", relation: "friend", contact: null, scope_codes: ["medical"] }]);
});

test("switching children saves the current decision and keeps each child's people separate", async ({ page }) => {
  const { calls } = await setup(page, { requests: [request(), request("child-b", "Ben")], selected: "child-b", patientMode: true });
  await expect(page.locator("#portal-patient")).toHaveCount(0);
  await expect(page.getByText("You are deciding as a parent", { exact: false })).toContainText("Ben Muster");
  await addFriend(page, "Ben Friend");
  await page.getByRole("tab", { name: "Anna Muster", exact: true }).click();
  await expect(page.getByTestId("trusted-person-editor")).toHaveCount(0);
  await addFriend(page, "Anna Friend");
  await page.getByRole("tab", { name: "Ben Muster", exact: true }).click();
  await expect(page.getByTestId("trusted-person-editor").getByLabel("Last name, first name")).toHaveValue("Ben Friend");
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Saved");
  expect(calls.map((call) => call.id)).toEqual(["child-b", "child-a"]);
  await page.getByRole("tab", { name: "Anna Muster", exact: true }).click();
  await expect(page.getByTestId("trusted-person-editor").getByLabel("Last name, first name")).toHaveValue("Anna Friend");
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Saved");
});

test("No clears existing people and records an explicit refusal without changing core consents", async ({ page }) => {
  const item = request(); item.disclosure = receipt();
  item.trusted_persons = [{ name: "Eva Friend", relation: "friend", contact: null, scope_codes: ["medical"] }];
  item.consent_form.choices.named_recipients = true;
  const { calls } = await setup(page, { requests: [item] });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByTestId("trusted-persons-save")).toHaveCount(0);
  await page.getByTestId("disclosure-no").check();
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Saved");
  expect(calls).toEqual([{ id: "child-a", persons: [], allow_disclosure: false, consent_given: false, version: "2026-10-14", language: "en" }]);
  expect(item.consent_form.choices.agency_processing).toBe(true);
  await page.reload();
  await expect(page.getByTestId("disclosure-no")).toBeChecked();
  await expect(page.getByTestId("trusted-persons-editor")).toHaveCount(0);
});

test("a legacy list is retained without preselecting the new decision or consent", async ({ page }) => {
  const item = request(); item.consent_form.choices.named_recipients = true;
  item.trusted_persons = [{ name: "Legacy Friend", relation: "friend", contact: null }];
  await setup(page, { requests: [item] });
  await expect(page.getByTestId("disclosure-yes")).not.toBeChecked();
  await expect(page.getByTestId("disclosure-no")).not.toBeChecked();
  await page.getByTestId("disclosure-yes").check();
  await expect(page.getByLabel("Last name, first name")).toHaveValue("Legacy Friend");
  await expect(page.getByLabel("Scope of information", { exact: true })).toContainText("Please choose");
  await expect(page.getByTestId("disclosure-consent")).not.toBeChecked();
  await expect(page.getByTestId("trusted-persons-save")).toHaveCount(0);
});

test("another guardian can confirm the saved people while the original actor stays identified", async ({ page }) => {
  const item = request(); item.disclosure = { ...receipt(), chosen_by: "other-guardian", chosen_by_name: "Other Guardian" };
  item.trusted_persons = [{ name: "Eva Friend", relation: "friend", contact: null, scope_codes: ["financial"] }];
  const { calls } = await setup(page, { requests: [item] });
  await expect(page.getByTestId("disclosure-yes")).toBeChecked();
  await expect(page.getByTestId("disclosure-consent")).not.toBeChecked();
  await expect(page.getByTestId("disclosure-receipt")).toContainText("Other Guardian");
  await expect(page.getByTestId("trusted-persons-save")).toHaveCount(0);
  await page.getByTestId("disclosure-consent").check();
  await expect(page.getByTestId("disclosure-receipt")).toContainText("Guardian Muster");
  expect(calls[0].persons[0].scope_codes).toEqual(["financial"]);
});

test("an adult representative sees whose data is covered", async ({ page }) => {
  const item = request(); item.minor = false;
  await setup(page, { requests: [item] });
  await expect(page.getByText("You are deciding as a representative for Anna Muster.", { exact: false })).toBeVisible();
});

for (const closed of [true, false]) {
  test(`minor's own login has no editor (closed payload: ${closed})`, async ({ page }) => {
    const item = request(); item.access_kind = "self";
    await setup(page, { closed, requests: [item] });
    await expect(page.getByTestId("lead-request-guardian-only")).toBeVisible();
    await expect(page.getByTestId("trusted-persons-editor")).toHaveCount(0);
  });
}

test("loading can be retried, and all four cabinet languages remain selectable", async ({ page }) => {
  await setup(page, { failLoad: true });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: /try again|retry/i }).click();
  await expect(page.getByTestId("disclosure-yes")).toBeVisible();
  for (const [radio, heading] of [["DE", "Auskunft an Dritte"], ["UA", "Надання інформації третім особам"], ["RU", "Предоставление информации третьим лицам"], ["EN", "Information for third parties"]]) {
    await page.getByTestId("lead-cabinet-language").getByRole("radio", { name: radio, exact: true }).click();
    await expect(page.getByRole("heading", { level: 3, name: heading, exact: true })).toBeVisible();
  }
});

for (const width of [1440, 390]) {
  test(`disclosure layout stays within the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const item = request(); item.disclosure = receipt();
    item.trusted_persons = [
      { name: "Eva Muster", relation: "friend", contact: "eva@example.com", scope_codes: ["medical", "organisational"] },
      { name: "Nina Muster", relation: "relative", contact: "+49 151 000000", scope_codes: ["all"] },
    ];
    await setup(page, { requests: [item], lang: "ru" });
    await expect(page.getByTestId("trusted-persons-editor")).toBeVisible();
    await expect(page.getByTestId("trusted-person-editor")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `../.tmp/third-party-disclosure-20261014/disclosure-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Далее", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../.tmp/third-party-disclosure-20261014/disclosure-${width}-consent.png`, fullPage: true });
  });
}
