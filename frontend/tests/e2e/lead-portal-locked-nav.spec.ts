import { expect, test, type Page } from "@playwright/test";

// Synthetic API mocks only. The locked menu records interest in current
// catalogue packages; it must never load a patient module or activate access.
const PACKAGES = [
  { id: "package-one", package_key: "gmed-one", name: "GMED One", description: null, kind: "gmed_one" },
  { id: "package-reserve-junior", package_key: "reserve-junior", name: "GMED Reserve Junior", description: "Synthetic catalogue description", kind: "gmed_reserve" },
  { id: "package-reserve-adult", package_key: "reserve-adult", name: "GMED Reserve Adult", description: null, kind: "gmed_reserve" },
  { id: "package-treatment", package_key: "treatment", name: "Organisation der Behandlung", description: null, kind: "treatment" },
];
const MODULES = ["dashboard", "notifications", "chat", "appointments", "recommendations", "documents", "subscriptions", "invoices", "feedback", "privacy"];
type Options = {
  lang?: "ru" | "de";
  mode?: "lead" | "patient";
  singleRequest?: boolean;
  pending?: boolean;
  empty?: boolean;
  failLoad?: boolean;
  failSubmit?: boolean;
  delaySecondChild?: boolean;
};

async function setup(page: Page, options: Options = {}) {
  const lang = options.lang ?? "ru";
  const mode = options.mode ?? "lead";
  const requests = [
    { lead_id: "child-anna", personal_data: { first_name: "Anna", middle_name: null, last_name: "Synthetic" }, access_kind: "guardian" },
    { lead_id: "child-ben", personal_data: { first_name: "Ben", middle_name: null, last_name: "Synthetic" }, access_kind: "guardian" },
  ].slice(0, options.singleRequest ? 1 : 2);
  const reads: string[] = [];
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const unexpected: string[] = [];
  let failLoad = options.failLoad;
  let failSubmit = options.failSubmit;
  let releaseSecond: (() => void) | undefined;
  const receipt = {
    id: "interest-1", package_id: PACKAGES[1].id, subscription_kind: "gmed_reserve",
    module_id: "invoices", requested_at: "2026-10-15T10:00:00Z", status: "pending",
  };
  await page.addInitScript((lang) => {
    localStorage.setItem("gmed_lang", lang);
    localStorage.setItem("gmed_nav_collapsed", "false");
    localStorage.setItem("gmed_access_token", "synthetic-locked-portal-token");
  }, lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    if (path === "/me") return route.fulfill({ json: {
      id: "parent-user", email: "parent@example.com", name: "Synthetic Parent", role: "patient",
      capabilities: [], preferred_language: lang, password_change_required: false,
      portal_mode: mode, lead_portal: mode === "lead" ? { requests: requests.length } : null,
      created_at: "2026-10-15T08:00:00Z",
    } });
    if (path === "/me/lead-requests") {
      reads.push(path);
      return route.fulfill({ json: { requests } });
    }
    if (/^\/me\/lead-requests\/child-(anna|ben)\/plan-requests$/.test(path)) {
      if (req.method() === "GET") {
        reads.push(path);
        if (failLoad) {
          failLoad = false;
          return route.fulfill({ status: 503, json: { code: "synthetic_catalogue_error" } });
        }
        if (options.delaySecondChild && path.includes("child-ben")) {
          await new Promise<void>((resolve) => { releaseSecond = resolve; });
        }
        return route.fulfill({ json: {
          packages: options.empty ? [] : path.includes("child-ben") ? PACKAGES.map((plan) => ({ ...plan, name: `${plan.name} · Ben` })) : PACKAGES,
          requests: options.pending ? [receipt] : [],
        } });
      }
      posts.push({ path, body: req.postDataJSON() as Record<string, unknown> });
      if (failSubmit) {
        failSubmit = false;
        return route.fulfill({ status: 503, json: { code: "no_active_staff_recipient" } });
      }
      return route.fulfill({ status: 201, json: {
        request: { ...receipt, package_id: posts.at(-1)?.body.package_id, module_id: posts.at(-1)?.body.module_id }, created: true,
      } });
    }
    if (path === "/me/profile") return route.fulfill({ json: { id: "parent-user", email: "parent@example.com", name: "Synthetic Parent", role: "patient", preferred_language: lang } });
    if (/\/me\/(appointments|invoices|subscriptions|documents|dashboard|services)|\/patients/.test(path)) unexpected.push(path);
    return route.fulfill({ json: [] });
  });
  await page.goto("/legal");
  await expect(page.locator("nav").getByRole("button", { name: /Выход|Abmelden/ })).toBeAttached();
  return { reads, posts, unexpected, releaseSecond: () => releaseSecond?.() };
}

async function chooseRequest(page: Page, name: string) {
  await page.locator("#lead-portal-plan-request").click();
  await page.getByRole("option", { name, exact: true }).click();
}

for (const lang of ["ru", "de"] as const) {
  test(`an existing patient opens the complete form notice from their child's inquiry (${lang})`, async ({ page }) => {
    await setup(page, { lang, mode: "patient" });
    await page.goto(`/legal?notice=form&lang=${lang}#privacy`);
    const notice = page.getByTestId("form-privacy-notice");
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("heading", { level: 3 })).toHaveCount(14);
    await expect(notice).toContainText(lang === "ru"
      ? "Настоящая политика конфиденциальности касается нашего опроса клиентов"
      : "Diese Datenschutzerklärung gilt für unsere Kundenbefragung");
    await expect(notice).toContainText("12.10.2026");
    await expect(notice).toContainText("FiSaLis");
  });
}

test.describe("Lead portal locked menu and package interest", () => {
  for (const lang of ["ru", "de"] as const) {
    test(`lead menu has active request/utilities, visible locks and no service catalogue (${lang})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const { reads, posts, unexpected } = await setup(page, { lang });
      const nav = page.locator("nav");
      await expect(nav).toContainText(lang === "de" ? "Anfrageportal" : "Кабинет заявки");
      for (const path of ["/", "/trusted-persons", "/account", "/legal"]) await expect(nav.locator(`a[href="${path}"]`)).toBeVisible();
      for (const module of MODULES) {
        const control = nav.getByTestId(`lead-portal-locked-${module}`);
        await expect(control).toBeVisible();
        await expect(control).toHaveAttribute("aria-haspopup", "dialog");
        await expect(control).not.toHaveAttribute("href");
      }
      await expect(nav.locator('a[href="/services"]')).toHaveCount(0);
      await expect(nav.getByTestId("lead-portal-locked-services")).toHaveCount(0);
      expect(reads).toEqual([]);
      await nav.getByTestId("lead-portal-locked-dashboard").click();
      const dialog = page.getByTestId("lead-portal-plan-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(lang === "de" ? "Die Anfrage aktiviert kein Paket" : "Запрос не активирует пакет");
      await expect(dialog.getByRole("radio")).toHaveCount(0);
      await expect(page.getByTestId("lead-portal-plan-submit")).toBeDisabled();
      // React StrictMode may replay the opening read in development; no
      // child's catalogue is requested before the explicit choice.
      expect([...new Set(reads)]).toEqual(["/me/lead-requests"]);
      await chooseRequest(page, "Anna Synthetic");
      await expect(dialog.getByRole("radio")).toHaveCount(4);
      await dialog.getByRole("radio", { name: "GMED Reserve Junior", exact: true }).check();
      const overlay = page.locator('[data-slot="dialog-overlay"]').last();
      await expect(overlay).toBeVisible();
      expect(await overlay.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toMatch(/^(?:rgba\(0, 0, 0, 0\.4\)|oklab\(0 0 0 \/ 0\.4\))$/);
      if (lang === "ru") await page.screenshot({ path: "../.tmp/parent-completion-20261014/locked-plan-1440.png", animations: "disabled" });
      await expect(page).toHaveURL(/\/legal$/);
      expect(posts).toEqual([]);
      expect(unexpected).toEqual([]);
      await dialog.getByRole("button", { name: lang === "de" ? "Schließen" : "Закрыть", exact: true }).first().click();
      await expect(dialog).toHaveCount(0);
      expect(posts).toEqual([]);
    });
  }

  test("full patient menu retains actual links and individual services", async ({ page }) => {
    const { reads, posts } = await setup(page, { mode: "patient" });
    const nav = page.locator("nav");
    for (const path of ["/", "/appointments", "/invoices", "/services", "/subscriptions"]) await expect(nav.locator(`a[href="${path}"]`)).toBeVisible();
    await expect(nav.locator('[data-testid^="lead-portal-locked-"]')).toHaveCount(0);
    await expect(page.getByTestId("lead-portal-plan-dialog")).toHaveCount(0);
    expect(reads).toEqual([]);
    expect(posts).toEqual([]);
  });

  test("uses exact catalogue variants and submits only chosen child's package interest", async ({ page }) => {
    const { posts, unexpected } = await setup(page);
    await page.getByTestId("lead-portal-locked-invoices").click();
    const dialog = page.getByTestId("lead-portal-plan-dialog");
    await chooseRequest(page, "Anna Synthetic");
    await expect(dialog.getByRole("radio", { name: "GMED Reserve Junior", exact: true })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "GMED Reserve Adult", exact: true })).toBeVisible();
    await chooseRequest(page, "Ben Synthetic");
    await dialog.getByRole("radio", { name: "GMED Reserve Junior · Ben", exact: true }).check();
    await page.getByTestId("lead-portal-plan-submit").click();
    await expect(dialog).toContainText("Ваш запрос отправлен в GMED.");
    expect(posts).toEqual([{ path: "/me/lead-requests/child-ben/plan-requests", body: { package_id: PACKAGES[1].id, module_id: "invoices" } }]);
    await expect(page.getByTestId("lead-portal-plan-submit")).toBeDisabled();
    await expect(page).toHaveURL(/\/legal$/);
    expect(unexpected).toEqual([]);
  });

  test("existing pending interest is shown without sending a duplicate", async ({ page }) => {
    const { posts } = await setup(page, { pending: true, singleRequest: true });
    await page.getByTestId("lead-portal-locked-invoices").click();
    const dialog = page.getByTestId("lead-portal-plan-dialog");
    await expect(page.getByTestId("lead-portal-plan-request-name")).toHaveText("Anna Synthetic");
    await dialog.getByRole("radio", { name: "GMED Reserve Junior", exact: true }).check();
    await expect(page.getByTestId("lead-portal-plan-submit")).toBeDisabled();
    await expect(page.getByTestId("lead-portal-plan-submit")).toHaveText("Уже запрошен");
    expect(posts).toEqual([]);
  });

  test("catalogue failure can recover and an empty catalogue never invents plans", async ({ page }) => {
    const { posts } = await setup(page, { failLoad: true, empty: true });
    await page.getByTestId("lead-portal-locked-subscriptions").click();
    const dialog = page.getByTestId("lead-portal-plan-dialog");
    await chooseRequest(page, "Anna Synthetic");
    await expect(dialog.getByRole("alert")).toContainText("Не удалось загрузить пакеты");
    await expect(page.getByTestId("lead-portal-plan-submit")).toBeDisabled();
    await dialog.getByRole("button", { name: "Повторить", exact: true }).click();
    await chooseRequest(page, "Anna Synthetic");
    await expect(dialog).toContainText("Сейчас нет доступных пакетов");
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(page.getByTestId("lead-portal-plan-submit")).toBeDisabled();
    expect(posts).toEqual([]);
  });

  test("a refused request retains its selection and requires explicit retry", async ({ page }) => {
    const { posts } = await setup(page, { failSubmit: true });
    await page.getByTestId("lead-portal-locked-chat").click();
    const dialog = page.getByTestId("lead-portal-plan-dialog");
    await chooseRequest(page, "Anna Synthetic");
    await dialog.getByRole("radio", { name: "GMED One", exact: true }).check();
    await page.getByTestId("lead-portal-plan-submit").click();
    await expect(dialog.getByRole("alert")).toContainText("Не удалось отправить запрос");
    await expect(dialog.getByRole("radio", { name: "GMED One", exact: true })).toBeChecked();
    expect(posts).toHaveLength(1);
    await page.getByTestId("lead-portal-plan-submit").click();
    await expect(dialog).toContainText("Ваш запрос отправлен в GMED.");
    expect(posts).toHaveLength(2);
  });

  test("late catalogue of a previous child cannot replace the current child's choices", async ({ page }) => {
    const { reads, posts, releaseSecond } = await setup(page, { delaySecondChild: true });
    await page.getByTestId("lead-portal-locked-documents").click();
    await chooseRequest(page, "Anna Synthetic");
    await expect(page.getByTestId("lead-portal-plan-dialog").getByRole("radio")).toHaveCount(4);
    await chooseRequest(page, "Ben Synthetic");
    await expect.poll(() => reads.filter((path) => path.includes("child-ben")).length).toBe(1);
    await chooseRequest(page, "Anna Synthetic");
    await expect(page.getByRole("radio", { name: "GMED One", exact: true })).toBeVisible();
    releaseSecond();
    await expect(page.locator("#lead-portal-plan-request")).toContainText("Anna Synthetic");
    await expect(page.getByRole("radio", { name: "GMED One · Ben", exact: true })).toHaveCount(0);
    await page.getByRole("radio", { name: "GMED One", exact: true }).check();
    await page.getByTestId("lead-portal-plan-submit").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].path).toBe("/me/lead-requests/child-anna/plan-requests");
  });

  test("mobile lock dialog stays within the viewport and closing does not submit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // On compact widths the nav intentionally starts closed.
    const { posts } = await setup(page);
    await page.getByRole("button", { name: "Переключить боковую панель", exact: true }).first().click();
    await page.getByTestId("lead-portal-locked-subscriptions").click();
    const dialog = page.getByTestId("lead-portal-plan-dialog");
    await chooseRequest(page, "Anna Synthetic");
    await expect(dialog.getByRole("radio")).toHaveCount(4);
    await dialog.getByRole("radio", { name: "GMED Reserve Adult", exact: true }).check();
    const bounds = await dialog.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "../.tmp/parent-completion-20261014/locked-plan-390.png", animations: "disabled" });
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).first().click();
    await expect(dialog).toHaveCount(0);
    expect(posts).toEqual([]);
    await expect(page).toHaveURL(/\/legal$/);
  });
});
