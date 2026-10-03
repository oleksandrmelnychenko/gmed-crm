import { expect, test, type Page } from "@playwright/test";

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

async function setup(page: Page, lang = "ru") {
  let current = hit();
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
      current = hit(payload.decision);
      body = current;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/sanctions");
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
  await expect(page.getByText("Совпадение имени — не установление личности", { exact: false })).toBeVisible();
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

test("FiSaLis opens without any data in the URL and the name goes to the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5187" });
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
