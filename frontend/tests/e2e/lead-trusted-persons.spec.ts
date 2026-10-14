import { expect, test, type Page } from "@playwright/test";

const core = { agency_processing: true, doctors_to_agency: true, data_system: true, named_recipients: false, channel_email: false, channel_threema: false, channel_whatsapp: false, channel_telegram: false };
type Person = { name: string; relation: string; contact: string | null };
function request(id = "child-a", firstName = "Anna") {
  return {
    lead_id: id, access_kind: "guardian", minor: true,
    personal_data: { first_name: firstName, last_name: "Muster", primary_language: "en" },
    trusted_persons: [] as Person[],
    consent_form: { version: "v1", choices: { ...core }, chosen_at: "2026-10-14T08:00:00Z", chosen_by_me: true, recipients: [] as Person[] },
  };
}

async function setup(page: Page, options: { requests?: ReturnType<typeof request>[]; closed?: boolean; failSave?: boolean; failLoad?: boolean; patientMode?: boolean; lang?: string; selected?: string } = {}) {
  const requests = options.requests ?? [request()];
  const calls: { id: string; persons: Person[] }[] = [];
  let failSave = options.failSave ?? false;
  let failLoad = options.failLoad ?? false;
  await page.addInitScript(({ lang }) => {
    localStorage.setItem("gmed_access_token", "synthetic-trusted-persons-token");
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
      const persons = route.request().postDataJSON().persons as Person[];
      calls.push({ id: match[1], persons });
      if (failSave) { failSave = false; return route.fulfill({ status: 422, json: { code: "consent_recipients_invalid" } }); }
      const item = requests.find((entry) => entry.lead_id === match[1])!;
      item.trusted_persons = persons;
      if (item.consent_form.choices.named_recipients) {
        item.consent_form.recipients = persons;
        if (persons.length === 0) item.consent_form.choices.named_recipients = false;
      }
      return route.fulfill({ json: item });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`/trusted-persons${options.selected ? `?lead=${options.selected}` : ""}`);
  return { calls, requests };
}

async function addFriend(page: Page, name = "Eva Friend") {
  await page.getByTestId("trusted-person-add").click();
  const row = page.getByTestId("trusted-person-editor").last();
  await row.locator("input").first().fill(name);
  await row.getByRole("combobox").click();
  await page.getByRole("option", { name: "Friend / acquaintance", exact: true }).click();
}

test("explicit save keeps failed drafts and retries; a reload shows the stored friend", async ({ page }) => {
  const { calls } = await setup(page, { failSave: true });
  await addFriend(page);
  expect(calls).toHaveLength(0);
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Changes not saved yet");
  await page.getByTestId("trusted-persons-save").click();
  await expect(page.getByRole("alert").last()).toContainText("Enter a name and relationship");
  await expect(page.getByTestId("trusted-person-editor").locator("input").first()).toHaveValue("Eva Friend");
  await page.getByTestId("trusted-persons-save").click();
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Saved");
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual({ id: "child-a", persons: [{ name: "Eva Friend", relation: "friend", contact: null }] });
  await page.reload();
  await expect(page.getByTestId("trusted-person-editor").locator("input").first()).toHaveValue("Eva Friend");
  await expect(page.getByTestId("trusted-persons-consent-hint")).toBeVisible();
});

test("a guardian with multiple children retains separate drafts and saves only the selected request", async ({ page }) => {
  const { calls } = await setup(page, { requests: [request(), request("child-b", "Ben")], selected: "child-b", patientMode: true });
  await expect(page.locator("#portal-patient")).toHaveCount(0);
  await addFriend(page, "Ben Friend");
  const selector = page.getByTestId("trusted-persons-request").getByRole("combobox");
  await selector.click();
  await page.getByRole("option", { name: "Anna Muster", exact: true }).click();
  await expect(page.getByTestId("trusted-person-editor")).toHaveCount(0);
  await addFriend(page, "Anna Friend");
  await selector.click();
  await page.getByRole("option", { name: "Ben Muster", exact: true }).click();
  await expect(page.getByTestId("trusted-person-editor").locator("input").first()).toHaveValue("Ben Friend");
  await page.getByTestId("trusted-persons-save").click();
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Saved");
  expect(calls.map((call) => call.id)).toEqual(["child-b"]);
  await expect(page.getByRole("link", { name: "Open request", exact: true })).toHaveAttribute("href", "/request?lead=child-b");
  await selector.click();
  await page.getByRole("option", { name: "Anna Muster", exact: true }).click();
  await expect(page.getByTestId("trusted-person-editor").locator("input").first()).toHaveValue("Anna Friend");
  await expect(page.getByTestId("trusted-persons-save-state")).toHaveText("Changes not saved yet");
});

test("clearing the final person explains and reflects the removal of named-person consent", async ({ page }) => {
  const item = request();
  item.trusted_persons = [{ name: "Eva Friend", relation: "friend", contact: null }];
  item.consent_form.choices.named_recipients = true;
  const { calls } = await setup(page, { requests: [item] });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Removing the last person and saving", { exact: false })).toBeVisible();
  await page.getByTestId("trusted-persons-save").click();
  await expect(page.getByTestId("trusted-persons-consent-hint")).toBeVisible();
  expect(calls).toEqual([{ id: "child-a", persons: [] }]);
  expect(item.consent_form.choices.agency_processing).toBe(true);
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
  await expect(page.getByTestId("trusted-persons-editor")).toBeVisible();
  for (const [radio, heading] of [["DE", "Vertrauenspersonen"], ["UA", "Довірені особи"], ["RU", "Доверенные лица"], ["EN", "Trusted persons"]]) {
    await page.getByTestId("lead-cabinet-language").getByRole("radio", { name: radio, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  }
});

for (const width of [1440, 390]) {
  test(`trusted persons layout stays within the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const item = request();
    item.trusted_persons = [
      { name: "Eva Muster", relation: "friend", contact: "eva@example.com" },
      { name: "Nina Muster", relation: "relative", contact: "+49 151 000000" },
    ];
    await setup(page, { requests: [item], lang: "ru" });
    await expect(page.getByTestId("trusted-persons-editor")).toBeVisible();
    await expect(page.getByTestId("trusted-person-editor")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `../.tmp/trusted-persons-20261014/trusted-persons-${width}.png`, fullPage: true });
  });
}
