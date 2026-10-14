import { expect, test, type Page } from "@playwright/test";
import type { LeadDisclosure, LeadDisclosureInput } from "../../src/pages/patient-lead/lead-request-api";

const core = { agency_processing: true, doctors_to_agency: true, data_system: true, named_recipients: false, channel_email: false, channel_threema: false, channel_whatsapp: false, channel_telegram: false };
type Person = { name: string; relation: string; contact: string | null; scope?: string };
function request(id = "child-a", firstName = "Anna") {
  return {
    lead_id: id, access_kind: "guardian", minor: true,
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
    localStorage.setItem("gmed_lead_cabinet_lang", lang);
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

async function addFriend(page: Page, name = "Eva Friend") {
  await page.getByTestId("disclosure-yes").check();
  await page.getByTestId("trusted-person-add").click();
  const row = page.getByTestId("trusted-person-editor").last();
  await row.getByLabel("Last name, first name").fill(name);
  await row.getByRole("combobox").click();
  await page.getByRole("option", { name: "Friend / acquaintance", exact: true }).click();
  await row.getByLabel("Scope of information", { exact: false }).fill("Medical information");
  await page.getByTestId("disclosure-consent").check();
}

test("explicit save keeps failed drafts and retries; reload restores decision, scope and receipt", async ({ page }) => {
  const { calls } = await setup(page, { failSave: true });
  await expect(page.getByTestId("disclosure-no")).not.toBeChecked();
  await expect(page.getByTestId("disclosure-yes")).not.toBeChecked();
  await expect(page.getByTestId("trusted-persons-save")).toBeDisabled();
  await addFriend(page);
  await expect(page.getByText("I expressly consent to Example Care GmbH", { exact: false })).toBeVisible();
  expect(calls).toHaveLength(0);
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Changes not saved yet");
  await page.getByTestId("trusted-persons-save").click();
  await expect(page.getByRole("alert").last()).toContainText("Enter a name, relationship and scope");
  await expect(page.getByTestId("trusted-person-editor").getByLabel("Last name, first name")).toHaveValue("Eva Friend");
  await page.getByTestId("trusted-persons-save").click();
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Saved");
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual({ id: "child-a", persons: [{ name: "Eva Friend", relation: "friend", contact: null, scope: "Medical information" }], allow_disclosure: true, consent_given: true, version: "2026-10-14", language: "en" });
  await page.reload();
  await expect(page.getByTestId("disclosure-yes")).toBeChecked();
  await expect(page.getByTestId("disclosure-consent")).toBeChecked();
  await expect(page.getByTestId("disclosure-receipt")).toContainText("Guardian Muster");
  await expect(page.getByTestId("trusted-person-editor").getByLabel("Scope of information", { exact: false })).toHaveValue("Medical information");
});

test("Yes requires person, scope and checkbox; editing details requires fresh consent", async ({ page }) => {
  await setup(page);
  await page.getByTestId("disclosure-yes").check();
  await expect(page.getByTestId("trusted-persons-save")).toBeDisabled();
  await addFriend(page);
  await expect(page.getByTestId("trusted-persons-save")).toBeEnabled();
  await page.getByLabel("Scope of information", { exact: false }).fill("");
  await expect(page.getByTestId("disclosure-consent")).not.toBeChecked();
  await page.getByTestId("disclosure-consent").check();
  await expect(page.getByTestId("trusted-persons-save")).toBeDisabled();
  await page.getByLabel("Scope of information", { exact: false }).fill("Invoices only");
  await expect(page.getByTestId("disclosure-consent")).not.toBeChecked();
  await page.getByTestId("disclosure-consent").check();
  await expect(page.getByTestId("trusted-persons-save")).toBeEnabled();
  await page.getByTestId("disclosure-no").check();
  await page.getByTestId("disclosure-yes").check();
  await expect(page.getByTestId("disclosure-consent")).not.toBeChecked();
  await expect(page.getByLabel("Scope of information", { exact: false })).toHaveValue("Invoices only");
});

test("a guardian with multiple children retains separate drafts and saves only the selected request", async ({ page }) => {
  const { calls } = await setup(page, { requests: [request(), request("child-b", "Ben")], selected: "child-b", patientMode: true });
  await expect(page.locator("#portal-patient")).toHaveCount(0);
  await expect(page.getByText("You are deciding as a parent", { exact: false })).toContainText("Ben Muster");
  await addFriend(page, "Ben Friend");
  const selector = page.getByTestId("trusted-persons-request").getByRole("combobox");
  await selector.click();
  await page.getByRole("option", { name: "Anna Muster", exact: true }).click();
  await expect(page.getByTestId("trusted-person-editor")).toHaveCount(0);
  await addFriend(page, "Anna Friend");
  await selector.click();
  await page.getByRole("option", { name: "Ben Muster", exact: true }).click();
  await expect(page.getByTestId("trusted-person-editor").getByLabel("Last name, first name")).toHaveValue("Ben Friend");
  await page.getByTestId("trusted-persons-save").click();
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Saved");
  expect(calls.map((call) => call.id)).toEqual(["child-b"]);
  await expect(page.getByRole("link", { name: "Open request", exact: true })).toHaveAttribute("href", "/request?lead=child-b");
  await selector.click();
  await page.getByRole("option", { name: "Anna Muster", exact: true }).click();
  await expect(page.getByTestId("trusted-person-editor").getByLabel("Last name, first name")).toHaveValue("Anna Friend");
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Changes not saved yet");
});

test("No clears existing people and records an explicit refusal without changing core consents", async ({ page }) => {
  const item = request(); item.disclosure = receipt();
  item.trusted_persons = [{ name: "Eva Friend", relation: "friend", contact: null, scope: "Medical" }];
  item.consent_form.choices.named_recipients = true;
  const { calls } = await setup(page, { requests: [item] });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByTestId("trusted-persons-save")).toBeDisabled();
  await page.getByTestId("disclosure-no").check();
  await page.getByTestId("trusted-persons-save").click();
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
  await expect(page.getByLabel("Scope of information", { exact: false })).toHaveValue("");
  await expect(page.getByTestId("disclosure-consent")).not.toBeChecked();
  await expect(page.getByTestId("trusted-persons-save")).toBeDisabled();
});

test("another guardian can confirm the saved people while the original actor stays identified", async ({ page }) => {
  const item = request(); item.disclosure = { ...receipt(), chosen_by: "other-guardian", chosen_by_name: "Other Guardian" };
  item.trusted_persons = [{ name: "Eva Friend", relation: "friend", contact: null, scope: "Invoices only" }];
  const { calls } = await setup(page, { requests: [item] });
  await expect(page.getByTestId("disclosure-yes")).toBeChecked();
  await expect(page.getByTestId("disclosure-consent")).not.toBeChecked();
  await expect(page.getByTestId("disclosure-receipt")).toContainText("Other Guardian");
  await expect(page.getByTestId("trusted-persons-save")).toBeDisabled();
  await page.getByTestId("disclosure-consent").check();
  await page.getByTestId("trusted-persons-save").click();
  await expect(page.getByTestId("disclosure-receipt")).toContainText("Guardian Muster");
  expect(calls[0].persons[0].scope).toBe("Invoices only");
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
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  }
});

for (const width of [1440, 390]) {
  test(`disclosure layout stays within the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const item = request(); item.disclosure = receipt();
    item.trusted_persons = [
      { name: "Eva Muster", relation: "friend", contact: "eva@example.com", scope: "Медицинская информация" },
      { name: "Nina Muster", relation: "relative", contact: "+49 151 000000", scope: "Счета" },
    ];
    await setup(page, { requests: [item], lang: "ru" });
    await expect(page.getByTestId("trusted-persons-editor")).toBeVisible();
    await expect(page.getByTestId("trusted-person-editor")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `../.tmp/third-party-disclosure-20261014/disclosure-${width}.png`, fullPage: true });
    await page.getByTestId("trusted-persons-save").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../.tmp/third-party-disclosure-20261014/disclosure-${width}-consent.png`, fullPage: true });
  });
}
