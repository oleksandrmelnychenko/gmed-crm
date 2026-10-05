import { expect, test, type Locator, type Page } from "@playwright/test";

// Lead cabinet (owner decision 2026-10-03): a patient login that reaches only
// requests sees the request page, the account and the legal notice. Mocked
// API, synthetic data.

type Mode = "lead" | "patient";

const CONSENT_VERSION = "2026-10-03";

function leadRequest() {
  return {
    lead_id: "lead-1",
    access_kind: "self",
    created_at: "2026-10-03T08:00:00Z",
    personal_data: {
      first_name: "Anna",
      middle_name: null,
      last_name: "Muster",
      date_of_birth: null,
      legal_sex: null,
      citizenships: [] as string[],
      street_address: null,
      zip_code: null,
      city: null,
      country: null,
      phone: null,
      primary_language: null,
      has_insurance: null,
      insurance_type: null,
      insurance_provider: null,
      insurance_number: null,
      insurance_covers_germany: null,
    } as Record<string, unknown>,
    progress: {
      filled: 2,
      total: 12,
      missing_for_submit: ["date_of_birth", "legal_sex", "citizenships", "street_address", "zip_code", "city", "country"],
    },
    minor: false,
    documents: [] as Record<string, unknown>[],
    max_documents: 30,
    consents: {
      health_data_processing: {
        type: "health_data_processing",
        version: CONSENT_VERSION,
        texts: { de: "Ich willige ein … (Art. 9 Abs. 2 lit. a DSGVO) …", ru: "Я даю согласие … (ст. 9) …" },
        given_at: null as string | null,
      },
      lead_inquiry_processing: {
        type: "lead_inquiry_processing",
        version: CONSENT_VERSION,
        texts: {
          de: "Ich bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage verarbeitet werden.",
          ru: "Я согласен(на), что мои данные обрабатываются для рассмотрения моего обращения.",
        },
        given_at: null as string | null,
      },
    } as Record<string, { type: string; version: string; texts: Record<string, string>; given_at: string | null }>,
    submitted_at: null as string | null,
    changed_since_submit: false,
    retention_deadline_at: "2026-10-17T08:00:00Z",
  };
}

async function setDatePickerValue(input: Locator, value: string) {
  const displayValue = value.split("-").reverse().join(".");
  await input.evaluate((node, nextValue) => {
    const nativeInput = node as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(nativeInput, nextValue);
    nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
    nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
  }, displayValue);
  await expect(input).toHaveValue(displayValue);
}

const SUBMIT_FIELDS = ["date_of_birth", "legal_sex", "citizenships", "street_address", "zip_code", "city", "country"];

function recompute(request: ReturnType<typeof leadRequest>) {
  const data = request.personal_data;
  const filled = (field: string) => {
    const value = data[field];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  };
  request.progress.missing_for_submit = SUBMIT_FIELDS.filter((field) => !filled(field));
  request.progress.filled = [
    "first_name", "last_name", ...SUBMIT_FIELDS, "phone", "primary_language",
  ].filter(filled).length + (data.has_insurance == null ? 0 : 1);
}

async function setup(
  page: Page,
  mode: Mode,
  options: { leadRequests?: number; primaryLanguage?: string; accountLanguage?: "de" | "ru" | null } = {},
) {
  const request = leadRequest();
  request.personal_data.primary_language = options.primaryLanguage ?? null;
  // The language saved on the account; a new lead login has none.
  const accountLanguage = options.accountLanguage === undefined ? "de" : options.accountLanguage;
  const calls = { personalData: [] as Record<string, unknown>[], consents: [] as string[], uploads: 0, submits: 0, blocked: [] as string[] };

  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "de");
    localStorage.setItem("gmed_access_token", "lead-cabinet-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    const method = req.method();

    if (path === "/me") {
      return route.fulfill({
        json: {
          id: "lead-user",
          email: "anna.muster@example.com",
          name: "Anna Muster",
          role: "patient",
          capabilities: [],
          created_at: "2026-10-03T08:00:00Z",
          preferred_language: accountLanguage,
          password_change_required: false,
          portal_mode: mode,
          lead_portal: options.leadRequests ? { requests: options.leadRequests } : mode === "lead" ? { requests: 1 } : null,
        },
      });
    }
    if (path === "/me/lead-requests") return route.fulfill({ json: { requests: [request] } });
    if (path === "/me/lead-requests/lead-1/personal-data" && method === "POST") {
      const patch = req.postDataJSON() as Record<string, unknown>;
      calls.personalData.push(patch);
      Object.assign(request.personal_data, patch);
      // Like the server: the answer is stored as a boolean, "no" is the self-payer.
      if ("has_insurance" in patch) {
        request.personal_data.has_insurance = patch.has_insurance === "yes" ? true : patch.has_insurance === "no" ? false : null;
      }
      if (request.submitted_at) request.changed_since_submit = true;
      recompute(request);
      return route.fulfill({ json: request });
    }
    if (path === "/me/lead-requests/lead-1/consent" && method === "POST") {
      const body = req.postDataJSON() as { purpose: string; version: string };
      calls.consents.push(body.purpose);
      request.consents[body.purpose].given_at = "2026-10-03T09:15:00Z";
      return route.fulfill({ status: 201, json: { purpose: body.purpose, given_at: "2026-10-03T09:15:00Z", version: body.version } });
    }
    if (path === "/me/lead-requests/lead-1/documents" && method === "POST") {
      calls.uploads += 1;
      request.documents.push({
        id: `doc-${calls.uploads}`,
        file_name: "befund.pdf",
        size_bytes: 2048,
        mime_type: "application/pdf",
        uploaded_at: "2026-10-03T09:20:00Z",
        uploaded_by_me: true,
        reviewed: false,
        can_delete: true,
      });
      return route.fulfill({ status: 201, json: request });
    }
    if (path === "/me/lead-requests/lead-1/submit" && method === "POST") {
      calls.submits += 1;
      request.submitted_at = "2026-10-03T09:30:00Z";
      request.changed_since_submit = false;
      return route.fulfill({ json: request });
    }
    if (path === "/me/profile") {
      return route.fulfill({ json: { id: "lead-user", email: "anna.muster@example.com", name: "Anna Muster", role: "patient", phone: null, preferred_language: accountLanguage } });
    }
    if (mode === "lead" && (path.startsWith("/me/") || path.startsWith("/notifications"))) {
      // The server closes the rest of the portal to a lead login.
      calls.blocked.push(path);
      return route.fulfill({ status: 403, json: { error: "Forbidden", code: "lead_portal_only", message: "Lead portal only" } });
    }
    if (path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    return route.fulfill({ json: [] });
  });
  return { request, calls };
}

test.describe("lead cabinet", () => {
  test("a lead login sees only its request, the account and the legal notice", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.getByTestId("lead-request-deadline")).toContainText("Bitte bis 17.10.2026 ausfüllen.");
    const nav = page.locator("nav");
    await expect(nav.getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Konto" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Meine Dokumente" })).toHaveCount(0);
    await expect(page.getByTitle("Benachrichtigungen")).toHaveCount(0);

    // Other portal pages lead back to the request page.
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    expect(calls.blocked).toEqual([]);
  });

  test("the patient enters the data, agrees, uploads and sends", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");

    await page.locator("#lead-request-city").fill("Berlin");
    await page.locator("#lead-request-zip_code").fill("10115");
    await page.locator("#lead-request-street_address").fill("Musterstraße 1");
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");
    expect(calls.personalData.at(-1)).toMatchObject({ city: "Berlin", zip_code: "10115", street_address: "Musterstraße 1" });
    expect(Object.keys(calls.personalData.at(-1) ?? {})).not.toContain("first_name");

    await page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox").click();
    await expect(page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox")).toBeChecked();
    await expect(page.getByTestId("lead-request-inquiry-consent")).toContainText("Zugestimmt am 03.10.2026");
    expect(calls.consents).toEqual(["lead_inquiry_processing"]);

    await page.getByRole("button", { name: "Weiter" }).click();
    const upload = page.getByRole("button", { name: "Dateien auswählen" });
    await expect(upload).toBeDisabled();
    await page.getByTestId("lead-request-health-consent").getByRole("checkbox").click();
    await expect(page.getByTestId("lead-request-health-consent").getByRole("checkbox")).toBeChecked();
    await expect(upload).toBeEnabled();
    await page.locator("#lead-request-files").setInputFiles({
      name: "befund.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    });
    await expect(page.getByTestId("lead-request-document-list")).toContainText("befund.pdf");

    await page.getByRole("button", { name: "Weiter" }).click();
    const send = page.getByTestId("lead-request-submit");
    // Date of birth, sex, citizenship and country are still missing.
    await expect(send).toBeDisabled();
    await expect(page.getByTestId("lead-request-send")).toContainText("Geburtsdatum");

    await page.getByRole("button", { name: "Angaben ändern" }).click();
    await setDatePickerValue(page.locator("#lead-request-date_of_birth"), "1988-05-01");
    await expect.poll(() => calls.personalData.some((patch) => patch.date_of_birth === "1988-05-01")).toBe(true);
    await page.getByRole("combobox", { name: "Geschlecht laut Ausweis" }).click();
    await page.getByRole("option", { name: "Weiblich" }).click();
    await expect.poll(() => calls.personalData.some((patch) => patch.legal_sex === "female")).toBe(true);
    await page.getByRole("combobox", { name: "Wohnsitzland" }).click();
    await page.getByRole("option", { name: "Deutschland" }).first().click();
    await page.locator("#lead-request-citizenships").click();
    await page.getByRole("option", { name: "Deutschland" }).first().click();
    await expect.poll(() => calls.personalData.some((patch) => Array.isArray(patch.citizenships))).toBe(true);

    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByRole("button", { name: "Weiter" }).click();
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByTestId("lead-request-sent")).toContainText("03.10.2026");
    expect(calls.submits).toBe(1);

    // Sent: the page says what happens next and offers nothing to send.
    await expect(page.getByTestId("lead-request-next-steps")).toContainText("Ihre Ansprechperson prüft");
    await expect(page.getByRole("heading", { name: "Das haben wir erhalten" })).toBeVisible();
    await expect(send).toHaveCount(0);
    await expect(page.getByTestId("lead-request-changed")).toHaveCount(0);

    // The insurance block of the staff wizard is the patient's to fill in. A
    // change after sending is what "send again" is for.
    await page.getByRole("button", { name: "Angaben ändern" }).click();
    const insurance = page.getByTestId("lead-request-insurance");
    await expect(insurance.getByRole("textbox", { name: "Versicherer" })).toHaveCount(0);
    await insurance.getByRole("combobox", { name: "Krankenversicherung vorhanden?" }).click();
    await page.getByRole("option", { name: "Ja", exact: true }).click();
    await insurance.getByRole("textbox", { name: "Versicherer" }).fill("Allianz Care");
    await expect
      .poll(() => calls.personalData.some((patch) => patch.has_insurance === "yes" && patch.insurance_provider === "Allianz Care"))
      .toBe(true);

    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-changed")).toContainText("nach dem Senden geändert");
    await expect(send).toHaveText("Erneut senden");
    await send.click();
    await expect.poll(() => calls.submits).toBe(2);
    await expect(send).toHaveCount(0);
    await expect(page.getByTestId("lead-request-changed")).toHaveCount(0);
  });

  test("no insurance means self-payer and hides the details", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    const insurance = page.getByTestId("lead-request-insurance");
    await insurance.getByRole("combobox", { name: "Krankenversicherung vorhanden?" }).click();
    await page.getByRole("option", { name: "Nein, ich zahle selbst" }).click();
    await expect.poll(() => calls.personalData.at(-1)).toMatchObject({ has_insurance: "no", insurance_type: "self_pay" });
    await expect(insurance.getByRole("combobox", { name: "Versicherungsart" })).toHaveCount(0);
    await expect(insurance.getByRole("textbox", { name: "Versicherungsnummer" })).toHaveCount(0);
  });

  test("the account of a lead offers no password change", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/account");
    await expect(page.getByTestId("account-page")).toBeVisible();
    // The lead keeps the password the manager issued (owner decision 2026-10-05).
    await expect(page.getByText("Passwort ändern")).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("the legal notice opens inside the cabinet, not on the page that leads back to the login", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const menu = page.locator("nav");
    await menu.getByRole("link", { name: /Impressum/ }).click();
    await expect(page).toHaveURL(/\/legal$/);
    await expect(page.getByTestId("legal-notice")).toBeVisible();
    await expect(page.getByTestId("legal-privacy")).toBeVisible();
    await expect(menu.getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.getByText("Zurück zur Anmeldung")).toHaveCount(0);
  });

  test("the lead switches the cabinet to Ukrainian or English and keeps the choice", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const languages = page.getByTestId("lead-cabinet-language");
    await expect(languages.getByRole("radio", { name: "DE" })).toHaveAttribute("aria-checked", "true");

    await languages.getByRole("radio", { name: "UA" }).click();
    await expect(page.getByRole("heading", { name: "Ваша заявка" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Документи/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Прізвище" })).toBeVisible();

    await languages.getByRole("radio", { name: "EN" }).click();
    await expect(page.getByRole("heading", { name: "Your request" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Your request" })).toBeVisible();
  });

  test("the language button of the top bar and the cabinet switch agree", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const languages = page.getByTestId("lead-cabinet-language");
    const portalLanguage = page.locator("header button:has(svg.lucide-globe)");
    const menu = page.locator("nav");

    // German and Russian are the portal's languages: both controls switch the menu and the cabinet.
    await portalLanguage.click();
    await expect(page.getByRole("heading", { name: "Ваша заявка" })).toBeVisible();
    await expect(languages.getByRole("radio", { name: "RU" })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("link", { name: "Ваша заявка" })).toBeVisible();
    await languages.getByRole("radio", { name: "DE" }).click();
    await expect(menu.getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();

    // Ukrainian exists only in the cabinet: the top bar button changes the menu, the cabinet stays.
    await languages.getByRole("radio", { name: "UA" }).click();
    await portalLanguage.click();
    await expect(menu.getByRole("link", { name: "Ваша заявка" })).toBeVisible();
    await expect(languages.getByRole("radio", { name: "UA" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("textbox", { name: "Прізвище" })).toBeVisible();
  });

  test("a Russian request opens the whole portal in Russian once, then the person's choice counts", async ({ page }) => {
    await setup(page, "lead", { primaryLanguage: "ru", accountLanguage: null });
    await page.goto("/");
    const languages = page.getByTestId("lead-cabinet-language");
    await expect(page.getByRole("heading", { name: "Ваша заявка" })).toBeVisible();
    await expect(page.locator("nav").getByRole("link", { name: "Ваша заявка" })).toBeVisible();
    await expect(languages.getByRole("radio", { name: "RU" })).toHaveAttribute("aria-checked", "true");

    await page.locator("header button:has(svg.lucide-globe)").click();
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.locator("nav").getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
  });

  test("a language saved on the account is not replaced by the language of the request", async ({ page }) => {
    await setup(page, "lead", { primaryLanguage: "ru", accountLanguage: "de" });
    await page.goto("/");
    await expect(page.getByTestId("lead-request")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.locator("nav").getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.getByTestId("lead-cabinet-language").getByRole("radio", { name: "DE" })).toHaveAttribute("aria-checked", "true");
  });

  test("the calendar of the date of birth speaks the cabinet language", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const languages = page.getByTestId("lead-cabinet-language");
    const openCalendar = page.getByTestId("lead-request-data").locator("[data-picker-anchor] button").first();
    const month = (locale: string) =>
      new RegExp(new Intl.DateTimeFormat(locale, { month: "long", timeZone: "Europe/Berlin" }).format(new Date()), "i");

    await languages.getByRole("radio", { name: "UA" }).click();
    await openCalendar.click();
    await expect(page.locator(".MuiPickersCalendarHeader-label")).toHaveText(month("uk"));
    await expect(page.locator(".MuiDayCalendar-weekDayLabel").first()).toHaveText("П");
    await page.keyboard.press("Escape");

    await languages.getByRole("radio", { name: "EN" }).click();
    await openCalendar.click();
    await expect(page.locator(".MuiPickersCalendarHeader-label")).toHaveText(month("en-GB"));
    // English weeks start on Monday here, as everywhere in the app.
    await expect(page.locator(".MuiDayCalendar-weekDayLabel").first()).toHaveText("M");
  });

  test("the step footer stays on screen while the form scrolls", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const next = page.getByTestId("lead-request-data").getByRole("button", { name: "Weiter" });
    // The form is longer than the screen; "Weiter" must not need scrolling.
    await expect(page.locator("#lead-request-first_name")).toBeInViewport();
    await expect(next).toBeInViewport();
    await next.click();
    await expect(page.getByTestId("lead-request-documents")).toBeVisible();
  });

  test("the lead cabinet fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, "lead");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("patient portal after conversion", () => {
  test("a patient login keeps the full portal and gets the request page when it fills one in", async ({ page }) => {
    await setup(page, "patient", { leadRequests: 1 });
    await page.goto("/");
    const nav = page.locator("nav");
    await expect(nav.getByRole("link", { name: "Meine Dokumente" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await nav.getByRole("link", { name: "Ihre Anfrage" }).click();
    await expect(page).toHaveURL(/\/request$/);
    await expect(page.getByTestId("lead-request")).toBeVisible();
  });
});
