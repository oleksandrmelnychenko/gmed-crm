import { expect, test, type Page } from "@playwright/test";
import { lazyPageLoad } from "./lazy-pages";

/**
 * CEO review of possible EU sanctions list matches with a mocked API. All
 * names are invented; FiSaLis is intercepted and never contacted.
 */
const HIT_ID = "00000000-0000-0000-0000-00000000a001";
const LEAD_ID = "00000000-0000-0000-0000-00000000b001";

const hit = (status: "open" | "false_positive" | "confirmed" = "open") => ({
  id: HIT_ID,
  subject_kind: "lead_patient",
  lead_id: LEAD_ID,
  patient_id: null,
  patient_number: null,
  lead_status: "new",
  owner_name: "Testomir Korneev",
  subject_snapshot: {
    first_name: "Testomir",
    middle_name: null,
    last_name: "Korneev",
    date_of_birth: "1961-11-30",
    citizenships: ["RU"],
    residence: [],
    organisation: false,
    relation: null,
  },
  current_subject: {
    first_name: "Testomir",
    middle_name: null,
    last_name: "Korneev",
    date_of_birth: "1961-11-30",
    citizenships: ["RU"],
    residence: [],
    organisation: false,
    relation: null,
  },
  list_logical_id: "900101",
  list_entry: {
    logical_id: "900101",
    eu_reference: "EU.9001.01",
    subject_type: "person",
    names: [{ whole_name: "Testomir Ivanovich KORNEEV" }, { whole_name: "Тестомир Иванович Корнеев" }],
    birth_dates: [{ date: "1961-03-14", place: "Testgrad", country: "RU" }],
    citizenships: ["RU"],
    regulations: [
      {
        programme: "UKR",
        number_title: "2099/1 (OJ L 1)",
        publication_date: "2099-01-02",
        url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32099R0001",
      },
    ],
    remark: "Synthetic test person",
  },
  list_version_date: "2026-09-30",
  score: 0.96,
  match_details: { score: 0.96, name_score: 0.96, matched_name: "Testomir Ivanovich KORNEEV", dob: "year", citizenship: "match" },
  status,
  still_matches: true,
  last_screened_at: "2026-10-03T08:00:00Z",
  decided_at: status === "open" ? null : "2026-10-03T09:00:00Z",
  decided_by_name: status === "open" ? null : "Test CEO",
  decision_reason: status === "open" ? null : "Born in another city, passport checked",
  created_at: "2026-10-03T08:00:00Z",
});

/** A possible match of the bank a third-party payer pays through (owner decision 2026-10-11). */
const bankHit = (status: "open" | "false_positive" | "confirmed" = "open") => {
  const bank = {
    first_name: "",
    middle_name: null,
    last_name: "Testgrad Commerce Bank",
    date_of_birth: null,
    citizenships: [],
    residence: ["RU"],
    organisation: true,
    relation: "payer_bank",
  };
  return {
    ...hit(status),
    subject_kind: "lead_bank",
    subject_ref: "payer-bank",
    owner_name: "Anna Muster",
    subject_snapshot: bank,
    current_subject: { ...bank },
    list_logical_id: "900301",
    list_entry: {
      logical_id: "900301",
      eu_reference: "EU.9003.01",
      subject_type: "entity",
      names: [{ whole_name: "Testgrad Commerce Bank PJSC" }, { whole_name: "PAO Testgradkommerzbank" }],
      birth_dates: [],
      citizenships: [],
      regulations: [{ programme: "RUS", number_title: "2099/4 (OJ L 4)", publication_date: "2099-04-01" }],
      remark: "Synthetic test bank",
    },
    score: 1,
    match_details: { score: 1, name_score: 1, matched_name: "Testgrad Commerce Bank PJSC", dob: "unknown", citizenship: "unknown" },
  };
};

/**
 * A possible match of a third-party invoice recipient who does not pay (owner decision
 * 2026-10-11): a person by name and country of the address, or an organisation by its name.
 */
const recipientHit = (kind: "person" | "organisation") => (status: "open" | "false_positive" | "confirmed" = "open") => {
  const subject =
    kind === "person"
      ? {
          first_name: "Testomir",
          middle_name: null,
          last_name: "Korneev",
          date_of_birth: null,
          citizenships: [],
          residence: ["AT"],
          organisation: false,
          relation: "invoice_recipient",
        }
      : {
          first_name: "",
          middle_name: null,
          last_name: "Polartek Shipping LLC",
          date_of_birth: null,
          citizenships: [],
          residence: ["CY"],
          organisation: true,
          relation: "invoice_recipient",
        };
  const base = hit(status);
  return {
    ...base,
    subject_kind: "lead_recipient",
    subject_ref: "invoice-recipient",
    owner_name: "Anna Muster",
    subject_snapshot: subject,
    current_subject: { ...subject },
    ...(kind === "organisation"
      ? {
          list_logical_id: "900201",
          list_entry: {
            logical_id: "900201",
            eu_reference: "EU.9002.01",
            subject_type: "entity",
            names: [{ whole_name: "OOO Polartek Shipping" }],
            birth_dates: [],
            citizenships: [],
            regulations: [{ programme: "RUS", number_title: "2099/3 (OJ L 3)", publication_date: "2099-03-01" }],
            remark: "Synthetic test company",
          },
          match_details: { score: 0.97, name_score: 0.97, matched_name: "OOO Polartek Shipping", dob: "unknown", citizenship: "unknown" },
        }
      : {}),
  };
};

type HitFactory = (status?: "open" | "false_positive" | "confirmed") => { status: string };

async function setup(page: Page, lang = "ru", make: HitFactory = hit) {
  let current = make();
  const calls: { method: string; path: string; payload: unknown }[] = [];
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_access_token", "sanctions-ui-test");
    localStorage.setItem("gmed_refresh_token", "sanctions-ui-refresh");
    localStorage.setItem("gmed_lang", value);
  }, lang);
  await page.context().route("https://www.finanz-sanktionsliste.de/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html><body>FiSaLis stub</body></html>" }),
  );
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const method = route.request().method();
    if (method !== "GET") {
      calls.push({ method, path, payload: route.request().postData() ? route.request().postDataJSON() : null });
    }
    let body: unknown = [];
    if (path === "/me") {
      body = { id: "00000000-0000-0000-0000-000000000001", name: "Test CEO", role: "ceo", email: "ceo@example.invalid" };
    }
    if (path === "/sanctions/hits") {
      const status = url.searchParams.get("status") ?? "open";
      const hits = current.status === status ? [current] : [];
      body = {
        hits,
        counts: {
          open: current.status === "open" ? 1 : 0,
          false_positive: current.status === "false_positive" ? 1 : 0,
          confirmed: current.status === "confirmed" ? 1 : 0,
        },
      };
    }
    if (path === `/sanctions/hits/${HIT_ID}/decision`) {
      const payload = route.request().postDataJSON() as { decision: "false_positive" | "confirmed" };
      current = make(payload.decision);
      body = current;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/sanctions");
  await expect(page.getByTestId("sanctions-hit")).toBeVisible(lazyPageLoad);
  return { calls };
}

test("the CEO compares the match with the list entry and records a false positive with a reason", async ({ page }) => {
  const { calls } = await setup(page);
  const card = page.getByTestId("sanctions-hit");
  await expect(card).toContainText("Пациент (лид)");
  await expect(card).toContainText("Testomir Ivanovich KORNEEV");
  await expect(card).toContainText("14.03.1961");
  await expect(card).toContainText("30.11.1961");
  await expect(card).toContainText("EU.9001.01");
  await expect(card.getByRole("link", { name: "EUR-Lex" })).toHaveAttribute(
    "href",
    "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32099R0001",
  );
  await page.getByRole("button", { name: "Гайд", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Совпадение имени — не установление личности", { exact: false })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).first().click();
  await page.screenshot({ path: "../tmp/sanctions-review.png", fullPage: true });

  await card.getByRole("button", { name: "Ложное совпадение" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const submit = dialog.getByRole("button", { name: "Ложное совпадение" });
  await dialog.getByLabel("Причина").fill("short");
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Причина").fill("Born in another city, passport checked");
  await submit.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Совпадений нет")).toBeVisible();
  expect(calls).toEqual([
    {
      method: "POST",
      path: `/sanctions/hits/${HIT_ID}/decision`,
      payload: { decision: "false_positive", reason: "Born in another city, passport checked" },
    },
  ]);
});

for (const width of [1440, 390]) {
  test(`sanctions list settings stay readable at ${width}px without changing configuration`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls } = await setup(page);
    const version = {
      id: "list-version-test", source: "download", list_date: "2026-10-12",
      generated_at: null, global_file_id: null, sha256: "a".repeat(64), byte_size: 1200,
      entry_count: 2300, person_count: 2000, is_active: true, imported_by_name: null,
      created_at: "2026-10-12T06:00:00Z",
    };
    await page.route("**/api/v1/sanctions/list", (route) => route.fulfill({ json: {
      list: {
        active: version, versions: [version], stale: false, automatic_download: true,
        source_url: "https://example.invalid/list.xml",
        sync: { last_attempt_at: version.created_at, last_success_at: version.created_at,
          last_error_code: null, last_error_at: null, consecutive_failures: 0 },
      },
      blocked_countries: ["RU"],
    } }));
    await page.goto("/sanctions?tab=list");
    const settings = page.getByTestId("sanctions-list-settings");
    await expect(settings).toContainText("12.10.2026");
    await expect(settings.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`sanctions-list-${width}.png`), fullPage: true });
    expect(calls).toEqual([]);
  });
}

test("FiSaLis opens without any data in the URL and the name goes to the clipboard", async ({ page, context, baseURL }) => {
  // The app's own origin, whatever port the dev server runs on.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL!).origin });
  await setup(page);
  const card = page.getByTestId("sanctions-hit");
  const popupPromise = context.waitForEvent("page");
  await card.getByRole("button", { name: "Проверить в FiSaLis" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://www.finanz-sanktionsliste.de/fisalis/");
  await expect(card.getByRole("status")).toContainText("Testomir Korneev");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Testomir Korneev");
});

test("a hit on the payer's bank says whose bank it is and FiSaLis gets the bank's name", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL!).origin });
  const { calls } = await setup(page, "ru", bankHit);
  const card = page.getByTestId("sanctions-hit");
  await expect(card.getByTestId("sanctions-hit-kind")).toHaveText("Банк плательщика");
  await expect(card).toContainText("Testgrad Commerce Bank PJSC");
  await expect(card).toContainText("Страна счёта");
  // A bank has no birth date or citizenship of ours.
  await expect(card).not.toContainText("Дата рождения");
  await page.screenshot({ path: "../tmp/sanctions-review-bank.png", fullPage: true });

  const popupPromise = context.waitForEvent("page");
  await card.getByRole("button", { name: "Проверить в FiSaLis" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://www.finanz-sanktionsliste.de/fisalis/");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Testgrad Commerce Bank");

  // Decided like any other hit.
  await card.getByRole("button", { name: "Ложное совпадение" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Причина").fill("Other bank, BIC and seat checked");
  await dialog.getByRole("button", { name: "Ложное совпадение" }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls).toEqual([
    {
      method: "POST",
      path: `/sanctions/hits/${HIT_ID}/decision`,
      payload: { decision: "false_positive", reason: "Other bank, BIC and seat checked" },
    },
  ]);
});

test("a hit on the patient's bank in German", async ({ page }) => {
  await setup(page, "de", (status) => ({ ...bankHit(status), subject_ref: "patient-bank" }));
  const card = page.getByTestId("sanctions-hit");
  await expect(card.getByTestId("sanctions-hit-kind")).toHaveText("Bank des Patienten");
  await expect(card).toContainText("Kontoland");
});

test("a hit on the invoice recipient names it and FiSaLis gets the recipient's name", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL!).origin });
  await setup(page, "ru", recipientHit("person"));
  const card = page.getByTestId("sanctions-hit");
  await expect(card.getByTestId("sanctions-hit-kind")).toHaveText("Получатель счёта");
  await expect(card).toContainText("Anna Muster");
  await expect(card).toContainText("Страна проживания");
  // The label says who it is; no raw relation key.
  await expect(card).not.toContainText("invoice_recipient");
  await expect(card).not.toContainText("Отношение");

  const popupPromise = context.waitForEvent("page");
  await card.getByRole("button", { name: "Проверить в FiSaLis" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://www.finanz-sanktionsliste.de/fisalis/");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Testomir Korneev");
});

test("an organisation as invoice recipient in German", async ({ page }) => {
  await setup(page, "de", recipientHit("organisation"));
  const card = page.getByTestId("sanctions-hit");
  await expect(card.getByTestId("sanctions-hit-kind")).toHaveText("Rechnungsempfänger");
  await expect(card).toContainText("Polartek Shipping LLC");
  await expect(card).toContainText("OOO Polartek Shipping");
  await expect(card).toContainText("Sitzland");
  // An organisation has no birth date or citizenship of ours.
  await expect(card).not.toContainText("Geburtsdatum");
});

test("confirming warns that the stop is final (German, phone width)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { calls } = await setup(page, "de");
  const card = page.getByTestId("sanctions-hit");
  await card.getByRole("button", { name: "Treffer bestätigen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("kann nicht zurückgenommen werden");
  await page.screenshot({ path: "../tmp/sanctions-confirm-mobile-de.png", fullPage: true });
  await dialog.getByLabel("Begründung").fill("Name, Geburtsdatum und Staatsangehörigkeit stimmen überein");
  await dialog.getByRole("button", { name: "Treffer bestätigen" }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls[0]?.payload).toEqual({
    decision: "confirmed",
    reason: "Name, Geburtsdatum und Staatsangehörigkeit stimmen überein",
  });
  await page.getByRole("button", { name: "Entschieden" }).click();
  await expect(page.getByTestId("sanctions-hit")).toContainText("Bestätigt");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

/**
 * The «Страны» tab lists patients as well (2026-10-12): a patient whose default payer lives in a
 * blocked country, lifted by the CEO for the patient.
 */
test("the CEO lifts a patient's country block from the countries tab", async ({ page }) => {
  const PATIENT_ID = "00000000-0000-0000-0000-00000000c001";
  let lifted = false;
  const calls: { method: string; path: string; payload: unknown }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "sanctions-ui-test");
    localStorage.setItem("gmed_refresh_token", "sanctions-ui-refresh");
    localStorage.setItem("gmed_lang", "ru");
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const method = route.request().method();
    if (method !== "GET") {
      calls.push({ method, path, payload: route.request().postData() ? route.request().postDataJSON() : null });
    }
    let body: unknown = [];
    if (path === "/me") {
      body = { id: "00000000-0000-0000-0000-000000000001", name: "Test CEO", role: "ceo", email: "ceo@example.invalid" };
    }
    if (path === "/sanctions/hits") {
      body = { hits: [], counts: { open: 0, false_positive: 0, confirmed: 0 } };
    }
    if (path === `/sanctions/patients/${PATIENT_ID}/country-override`) {
      lifted = true;
      body = { id: "lift-1", lead_id: null, patient_id: PATIENT_ID, countries: ["RU"] };
    }
    if (path === "/sanctions/country-blocks") {
      body = {
        leads: [],
        patients: [
          {
            patient_id: PATIENT_ID,
            patient_number: "P-0042",
            name: "Anna Muster",
            flag: lifted ? "country_lifted" : "blocked_country",
            found: ["RU"],
            blocking: lifted ? [] : ["RU"],
            // Who triggers the block (QA 2026-10-12 B2-11).
            subjects: [
              {
                kind: "patient_relation",
                name: "Beispiel GmbH",
                role: "default_payer",
                organisation: true,
                countries: ["RU"],
              },
            ],
            lift: lifted
              ? {
                  id: "lift-1",
                  lead_id: null,
                  patient_id: PATIENT_ID,
                  countries: ["RU"],
                  reason: "Payer lives in Germany since 2001, checked",
                  lifted_by: "00000000-0000-0000-0000-000000000001",
                  lifted_by_name: "Test CEO",
                  lifted_at: "2026-10-12T08:00:00Z",
                }
              : null,
          },
        ],
      };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/sanctions?tab=countries");
  const item = page.getByTestId("sanctions-country-patient");
  await expect(item).toBeVisible(lazyPageLoad);
  await expect(page.getByRole("heading", { name: "Пациенты" })).toBeVisible();
  await expect(item).toContainText("Anna Muster");
  await expect(item).toContainText("P-0042");
  await expect(item).toContainText("Страна");
  // The entry names the paying organisation that carries the country.
  await expect(page.getByTestId("sanctions-country-patient-subjects")).toContainText(
    "Beispiel GmbH (организация) — Россия",
  );
  await expect(item.getByRole("link", { name: "Anna Muster" })).toHaveAttribute(
    "href",
    `/patients?patient=${PATIENT_ID}`,
  );

  await item.getByRole("button", { name: "Снять блокировку для пациента" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Снять блокировку по стране для этого пациента");
  // The dialog names the patient and who carries the country (QA 2026-10-12 B3-13).
  const subject = dialog.getByTestId("sanctions-country-lift-subject");
  await expect(subject).toContainText("Пациент: P-0042 · Anna Muster");
  await expect(subject).toContainText("Блокировку вызывает");
  await expect(subject).toContainText("Beispiel GmbH (организация) — Россия");
  await dialog.getByLabel("Причина").fill("Payer lives in Germany since 2001, checked");
  await dialog.getByRole("button", { name: "Снять блокировку для пациента" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(item).toContainText("Страна: снято");
  await expect(item).toContainText("Payer lives in Germany since 2001, checked");
  await expect(item.getByRole("button", { name: "Вернуть блокировку" })).toBeVisible();
  expect(calls).toEqual([
    {
      method: "POST",
      path: `/sanctions/patients/${PATIENT_ID}/country-override`,
      payload: { reason: "Payer lives in Germany since 2001, checked" },
    },
  ]);
});
