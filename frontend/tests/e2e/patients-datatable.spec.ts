import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const patients = [
  {
    id: "00000000-0000-0000-0000-000000000301",
    patient_id: "PT-0001",
    first_name: "Anna",
    last_name: "Müller",
    birth_date: "1990-01-01",
    gender: "female",
    nationality: "DE",
    residence_country: "DE",
    languages: ["de", "en"],
    functional_labels: ["high_risk", "complex coordination"],
    phone_primary: "+49 30 111111",
    email: "anna@example.com",
    insurance_provider: "AOK",
    insurance_type: "public",
    is_active: true,
    created_at: "2026-04-10T09:00:00Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000302",
    patient_id: "PT-0002",
    first_name: "Boris",
    last_name: "Petrov",
    birth_date: "1973-11-02",
    gender: "male",
    nationality: "RU",
    residence_country: "DE",
    languages: ["ru", "de"],
    functional_labels: ["vip"],
    phone_primary: "+49 30 222222",
    email: null,
    insurance_provider: "Techniker",
    insurance_type: "private",
    is_active: true,
    created_at: "2026-04-15T09:00:00Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000303",
    patient_id: "PT-0003",
    first_name: "Clara",
    last_name: "O'Neill",
    birth_date: "1985-05-14",
    gender: "female",
    nationality: "IE",
    residence_country: "DE",
    languages: ["en"],
    functional_labels: [],
    phone_primary: "+49 30 333333",
    email: "clara@example.com",
    insurance_provider: null,
    insurance_type: "self_pay",
    is_active: false,
    created_at: "2026-03-20T09:00:00Z",
  },
];

const patientCases = [
  {
    id: "case-0001",
    case_id: "CASE-001",
    status: "open",
    hauptanfragegrund: "Cardiology second opinion",
    created_at: "2026-04-18T09:00:00Z",
  },
];

const caseDetail = {
  id: "case-0001",
  case_uuid: "case-0001",
  case_id: "CASE-001",
  patient_id: "00000000-0000-0000-0000-000000000301",
  manager_id: "00000000-0000-0000-0000-000000000001",
  status: "open",
  hauptanfragegrund: "Cardiology second opinion",
  aktuelle_anamnese: "Patient asks for a second opinion.",
  zuweiser: null,
  notes: null,
  created_at: "2026-04-18T09:00:00Z",
  updated_at: "2026-04-18T09:00:00Z",
  retention_until: null,
  last_clinical_update_at: null,
  vorerkrankungen: [],
  allergien: [],
  operationen: [],
  medikamente: [],
  pain_records: [],
  symptome: [],
  history: [],
};

async function mockAuth(page: Page) {
  await page.route("**/auth/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/login" && route.request().method() === "POST") {
      return json(route, {
        access_token: "test-token",
        refresh_token: "test-refresh",
        token_type: "Bearer",
        expires_in: 900,
      });
    }
    if (url.pathname === "/auth/logout") return json(route, { ok: true });
    return json(route, { message: "Not mocked" }, 404);
  });
}

async function mockPatientsApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");

    if (path === "/auth/login" && route.request().method() === "POST") {
      return json(route, {
        access_token: "test-token",
        refresh_token: "test-refresh",
        token_type: "Bearer",
        expires_in: 900,
      });
    }
    if (path === "/auth/logout") return json(route, { ok: true });
    if (path === "/me") {
      return json(route, {
        id: "00000000-0000-0000-0000-000000000001",
        email: "admin@gmed.de",
        name: "Admin GMED",
        role: "ceo",
        created_at: "2026-01-01T00:00:00Z",
      });
    }
    if (path === "/stats/overview") {
      return json(route, { patients: 3, leads: 0, orders: 0, appointments: 0, cases: 0, users: 1 });
    }
    if (path === "/users") return json(route, []);
    if (path === "/providers") return json(route, []);
    if (path === "/patients" || path.startsWith("/patients?")) {
      const activeOnly = url.searchParams.get("active_only");
      const rows = activeOnly === "true"
          ? patients.filter((p) => p.is_active)
          : patients;
      return json(route, rows);
    }
    if (path.startsWith("/patients/")) {
      const [, , patientId, child] = path.split("/");
      if (child === "assignments") return json(route, []);
      if (child === "cases") return json(route, patientCases);
      if (["vitals", "card-entries", "medical-orders", "risk-scores"].includes(child ?? "")) {
        return json(route, { items: [] });
      }
      const patient = patients.find((p) => p.id === patientId);
      if (patient) return json(route, patient);
    }
    if (path === "/cases/meta/doctors") return json(route, []);
    if (path === "/cases/text-snippets") return json(route, []);
    if (path === "/cases" || path.startsWith("/cases?")) return json(route, patientCases);
    if (path === "/cases/case-0001") return json(route, caseDetail);
    if (path === "/appointments/meta/staff") return json(route, []);
    return json(route, { message: "Not mocked" }, 404);
  });
}

async function loginAsCeo(page: Page) {
  await page.goto("/login");
  await page.locator("#email").waitFor();
  await page.evaluate(() => {
    window.localStorage.removeItem("patients.hiddenColumns");
    window.localStorage.removeItem("patients.frozenColumns");
    window.localStorage.removeItem("patients.density");
  });
  await page.locator("#email").fill("admin@gmed.de");
  await page.locator("#password").fill("admin123");
  await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

async function openPatientsAsCeo(page: Page) {
  await loginAsCeo(page).then(() => page.goto("/patients"));
}

test.describe("patients data-table", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await mockPatientsApi(page);
  });

  test("renders active patients by default", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();
    await expect(page.getByText("PT-0002")).toBeVisible();
    await expect(page.getByText("PT-0003")).not.toBeVisible();
    await expect(page.locator('[role="table"] input[type="checkbox"]')).toHaveCount(0);
  });

  test("global search filters rows", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0002")).toBeVisible();
    const searchInput = page.getByPlaceholder(/search|Suchen|Поиск/i).first();
    await searchInput.fill("Petrov");
    await expect(page).toHaveURL(/q=Petrov/);
    await expect(page.getByText("PT-0001")).not.toBeVisible();
    await expect(page.getByText("PT-0002")).toBeVisible();
  });

  test("slash key focuses global search", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();
    await page.keyboard.press("/");
    const searchInput = page.getByPlaceholder(/search|Suchen|Поиск/i).first();
    await expect(searchInput).toBeFocused();
  });

  test("row click opens the patient edit page", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();
    await page.getByText("Anna Müller").first().click();
    await expect(page).toHaveURL(/\/patients\/00000000-0000-0000-0000-000000000301$/);
  });

  test("patient grid does not reserve an empty trailing actions column", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();

    const header = page.locator('[role="row"][aria-rowindex="1"]');
    const [headerColumnCount, gridTrackCount] = await Promise.all([
      page.locator('[role="columnheader"]').count(),
      header.evaluate((element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
      ),
    ]);

    expect(gridTrackCount).toBe(headerColumnCount);
  });

  test("patient rows have a visible hover state", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();

    const firstRow = page.locator('[role="row"][aria-rowindex="2"]');
    const patientCell = firstRow.locator('[role="cell"][data-column-id="patient"]');
    const beforeHover = await patientCell.evaluate((element) =>
      getComputedStyle(element).backgroundColor,
    );

    await firstRow.hover();

    const afterHover = await patientCell.evaluate((element) =>
      getComputedStyle(element).backgroundColor,
    );

    expect(afterHover).not.toBe(beforeHover);
    await expect
      .poll(() =>
        firstRow.evaluate((element) =>
          Number(getComputedStyle(element, "::before").opacity),
        ),
      )
      .toBeGreaterThan(0.8);
  });

  test("patient functional labels render as translated color chips", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();

    const annaRow = page.locator('[role="row"]').filter({ hasText: "Anna Müller" }).first();
    const patientCell = annaRow.locator('[role="cell"][data-column-id="patient"]');
    const complexChip = patientCell.locator('[data-patient-functional-label="complex_coordination"]');
    await expect(complexChip).toBeVisible();
    await expect(complexChip).toHaveText(/Сложная координация|Komplexe Koordination|Complex coordination/i);

    const patientChipStyles = await complexChip.evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
        color: styles.color,
      };
    });

    expect(patientChipStyles.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(patientChipStyles.borderColor).not.toBe("rgba(0, 0, 0, 0)");

    await page.getByRole("button", { name: /Columns|Колонки|Spalten/i }).click();
    await page.getByRole("menuitemcheckbox", { name: /Labels|Метки|Merkmale/i }).click();
    await page.keyboard.press("Escape");

    const labelColumnChip = annaRow.locator(
      '[role="cell"][data-column-id="functional_labels"] [data-patient-functional-label="complex_coordination"]',
    );
    await labelColumnChip.scrollIntoViewIfNeeded();
    await expect(labelColumnChip).toBeVisible();
    await expect(labelColumnChip).toHaveText(/Сложная координация|Komplexe Koordination|Complex coordination/i);

    const labelColumnBackground = await labelColumnChip.evaluate((element) =>
      getComputedStyle(element).backgroundColor,
    );
    expect(labelColumnBackground).toBe(patientChipStyles.backgroundColor);
  });

  test("patient case opens in the case workspace with patient and case menus", async ({ page }) => {
    await loginAsCeo(page);
    await page.goto("/patients/00000000-0000-0000-0000-000000000301?tab=cases");
    await expect(page.getByText("CASE-001")).toBeVisible();

    await page.getByText("CASE-001").click();

    await expect(page).toHaveURL(
      /\/cases\/case-0001\?patient=00000000-0000-0000-0000-000000000301$/,
    );
    await expect(page.locator('[data-workspace-rail="patient"]')).toBeVisible();
    await expect(page.locator('[data-workspace-rail="case"]')).toBeVisible();
    await expect(page.locator('[data-workspace-rail="patient"] [aria-current="page"]')).toContainText(
      /Cases|Кейсы|Fälle/i,
    );
    await expect(page.getByRole("heading", { name: "CASE-001" })).toBeVisible();
    await expect(page.getByRole("textbox").first()).toHaveValue("Cardiology second opinion");
    await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0);
  });

  test("columns menu can freeze an extra visible column", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();

    await page.getByRole("button", { name: /Columns|Колонки|Spalten/i }).click();
    await page.getByRole("button", { name: /(Freeze|Закрепить|Fixieren).*(Status|Статус)/i }).click();

    const frozenStatusHeader = page.locator(
      '[role="columnheader"][data-column-id="status"][data-pinned="left"]',
    );
    await expect(frozenStatusHeader).toBeVisible();

    await page.reload();
    await expect(page.getByText("PT-0001")).toBeVisible();
    await expect(frozenStatusHeader).toBeVisible();

    await page.locator('[role="table"]').evaluate((element) => {
      element.scrollLeft = 320;
      element.dispatchEvent(new Event("scroll"));
    });
    const frozenStatusCell = page.locator(
      '[role="cell"][data-column-id="status"][data-pinned="left"][data-frozen-opaque="true"]',
    ).first();
    await expect(frozenStatusCell).toBeVisible();
    const background = await frozenStatusCell.evaluate((element) =>
      getComputedStyle(element).backgroundColor,
    );
    expect(background).not.toMatch(/transparent|rgba\([^)]*,\s*0(?:\.0+)?\)|\/\s*0?\.[0-9]+/i);
  });

  test("default frozen columns render as one left block", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();

    const noHeader = page.locator('[role="columnheader"][data-column-id="no"]');
    const patientHeader = page.locator('[role="columnheader"][data-column-id="patient"]');
    const statusHeader = page.locator('[role="columnheader"][data-column-id="status"]');
    await expect(noHeader).toBeVisible();
    await expect(patientHeader).toBeVisible();
    await expect(statusHeader).toBeVisible();

    const [noBox, patientBox, statusBox] = await Promise.all([
      noHeader.boundingBox(),
      patientHeader.boundingBox(),
      statusHeader.boundingBox(),
    ]);
    expect(noBox).not.toBeNull();
    expect(patientBox).not.toBeNull();
    expect(statusBox).not.toBeNull();

    expect(patientBox!.x).toBeGreaterThanOrEqual(noBox!.x + noBox!.width - 1);
    expect(statusBox!.x).toBeGreaterThanOrEqual(patientBox!.x + patientBox!.width - 1);

    const noCell = page.locator('[role="cell"][data-column-id="no"]').first();
    const patientCell = page.locator('[role="cell"][data-column-id="patient"]').first();
    const statusCell = page.locator('[role="cell"][data-column-id="status"]').first();
    const [noCellBox, patientCellBox, statusCellBox] = await Promise.all([
      noCell.boundingBox(),
      patientCell.boundingBox(),
      statusCell.boundingBox(),
    ]);
    expect(noCellBox).not.toBeNull();
    expect(patientCellBox).not.toBeNull();
    expect(statusCellBox).not.toBeNull();
    expect(patientCellBox!.x).toBeGreaterThanOrEqual(noCellBox!.x + noCellBox!.width - 1);
    expect(statusCellBox!.x).toBeGreaterThanOrEqual(patientCellBox!.x + patientCellBox!.width - 1);

    await page.locator('[role="table"]').evaluate((element) => {
      element.scrollLeft = 260;
      element.dispatchEvent(new Event("scroll"));
    });
    const [scrolledNoCellBox, scrolledPatientCellBox, scrolledStatusCellBox] = await Promise.all([
      noCell.boundingBox(),
      patientCell.boundingBox(),
      statusCell.boundingBox(),
    ]);
    expect(scrolledNoCellBox).not.toBeNull();
    expect(scrolledPatientCellBox).not.toBeNull();
    expect(scrolledStatusCellBox).not.toBeNull();
    expect(Math.abs(scrolledNoCellBox!.x - noCellBox!.x)).toBeLessThan(1);
    expect(Math.abs(scrolledPatientCellBox!.x - patientCellBox!.x)).toBeLessThan(1);
    expect(scrolledStatusCellBox!.x).toBeLessThan(statusCellBox!.x);
  });

  test("status column renders color pills per status", async ({ page }) => {
    await loginAsCeo(page);
    await page.goto("/patients?active=");
    await expect(page.getByText("PT-0001")).toBeVisible();
    await expect(page.getByText("PT-0003")).toBeVisible();

    const activePill = page.locator('[data-patient-status-pill="active"]').first();
    const inactivePill = page.locator('[data-patient-status-pill="inactive"]').first();
    await expect(activePill).toBeVisible();
    await expect(inactivePill).toBeVisible();

    const [activeStyles, inactiveStyles] = await Promise.all([
      activePill.evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          backgroundColor: styles.backgroundColor,
          borderColor: styles.borderColor,
          color: styles.color,
        };
      }),
      inactivePill.evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          backgroundColor: styles.backgroundColor,
          borderColor: styles.borderColor,
          color: styles.color,
        };
      }),
    ]);

    expect(activeStyles.backgroundColor).not.toBe(inactiveStyles.backgroundColor);
    expect(activeStyles.borderColor).not.toBe(inactiveStyles.borderColor);
    expect(activeStyles.color).not.toBe(inactiveStyles.color);
  });

  test("sort menu opens under its trigger above the grid", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();

    const sortButton = page.getByRole("button", { name: /Created|Создан|Erstellt/i }).first();
    await sortButton.click();
    const menu = page.locator("[data-table-sort-menu]");
    await expect(menu).toBeVisible();

    const [buttonBox, menuBox] = await Promise.all([sortButton.boundingBox(), menu.boundingBox()]);
    expect(buttonBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(buttonBox!.x - 1);

    const [menuZ, headerZ] = await Promise.all([
      menu.evaluate((element) => Number(getComputedStyle(element).zIndex)),
      page
        .locator('[role="row"][aria-rowindex="1"]')
        .evaluate((element) => Number(getComputedStyle(element).zIndex)),
    ]);
    expect(menuZ).toBeGreaterThan(headerZ);
  });

  test("density icon controls update row height", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();

    const firstBodyRow = page.locator('[role="row"][aria-rowindex="2"]');
    const compactHeight = await firstBodyRow.evaluate((element) =>
      element.getBoundingClientRect().height,
    );

    await page.locator('[data-density-value="condensed"]').click();
    await expect
      .poll(() => firstBodyRow.evaluate((element) => element.getBoundingClientRect().height))
      .toBeLessThan(compactHeight);

    await page.locator('[data-density-value="comfortable"]').click();
    await expect
      .poll(() => firstBodyRow.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThan(compactHeight);
  });

  test("column header context menu toggles frozen state", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();

    const statusHeader = page.locator('[role="columnheader"][data-column-id="status"]');
    await statusHeader.click({ button: "right" });

    const menu = page.locator("[data-column-header-context-menu]");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitemcheckbox", { name: /Freeze|Закрепить|Fixieren/i }).click();

    await expect(
      page.locator('[role="columnheader"][data-column-id="status"][data-pinned="left"]'),
    ).toBeVisible();

    await statusHeader.click({ button: "right" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitemcheckbox", { name: /Unfreeze|Открепить|Lösen/i }).click();

    await expect(
      page.locator('[role="columnheader"][data-column-id="status"][data-pinned="left"]'),
    ).toHaveCount(0);
  });

  test("newly shown columns keep row styling", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();

    await page.getByRole("button", { name: /Columns|Колонки|Spalten/i }).click();
    await page.getByRole("menuitemcheckbox", { name: /Email|E-Mail|Электронная почта/i }).click();
    await page.getByRole("menuitemcheckbox", { name: /Nationality|Гражданство|Staatsangehörigkeit/i }).click();
    await page.getByRole("menuitemcheckbox", { name: /Residence|Страна проживания|Wohnsitzland/i }).click();
    await page.getByRole("menuitemcheckbox", { name: /Languages|Языки|Sprachen/i }).click();
    await page.keyboard.press("Escape");

    const emailCell = page.locator('[role="cell"][data-column-id="email"]').nth(1);
    const patientCell = page.locator('[role="cell"][data-column-id="patient"]').nth(1);
    await emailCell.scrollIntoViewIfNeeded();
    await expect(emailCell).toBeVisible();
    await expect(patientCell).toBeVisible();

    const className = await emailCell.getAttribute("class");
    expect(className ?? "").toContain("data-table-cell");
    await expect(emailCell.locator('[data-patient-cell-render="email"]')).toBeVisible();

    const [emailBackground, patientBackground] = await Promise.all([
      emailCell.evaluate((element) => getComputedStyle(element).backgroundColor),
      patientCell.evaluate((element) => getComputedStyle(element).backgroundColor),
    ]);
    expect(emailBackground).toBe(patientBackground);

    const topCellColumn = await emailCell.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit?.closest('[role="cell"]')?.getAttribute("data-column-id");
    });
    expect(topCellColumn).toBe("email");

    await Promise.all([
      ["nationality", "nationality"],
      ["residence_country", "residence_country"],
      ["languages", "languages"],
    ].map(async ([columnId, renderId]) => {
      const cell = page.locator(`[role="cell"][data-column-id="${columnId}"]`).nth(1);
      await cell.scrollIntoViewIfNeeded();
      await expect(cell.locator(`[data-patient-cell-render="${renderId}"]`)).toBeVisible();
      const styledToken = cell.locator(".rounded-md").first();
      await expect(styledToken).toBeVisible();
    }));
  });

  test("newly shown column headers keep the same flat surface", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();

    await page.getByRole("button", { name: /Columns|Колонки|Spalten/i }).click();
    await page.getByRole("menuitemcheckbox", { name: /Birth date|Дата рождения|Geburtsdatum/i }).click();
    await page.getByRole("menuitemcheckbox", { name: /Gender|Пол|Geschlecht/i }).click();
    await page.keyboard.press("Escape");

    await page.locator('[role="columnheader"][data-column-id="created_at"]').scrollIntoViewIfNeeded();

    const headerStyles = await Promise.all(
      ["birth_date", "gender", "created_at"].map((columnId) =>
        page.locator(`[role="columnheader"][data-column-id="${columnId}"]`).evaluate((element) => {
          const styles = getComputedStyle(element);
          return {
            backgroundColor: styles.backgroundColor,
            borderBottomStyle: styles.borderBottomStyle,
            borderBottomWidth: styles.borderBottomWidth,
            boxShadow: styles.boxShadow,
          };
        }),
      ),
    );

    expect(new Set(headerStyles.map((style) => style.backgroundColor)).size).toBe(1);
    expect(headerStyles.every((style) => style.borderBottomStyle === "solid")).toBe(true);
    expect(headerStyles.every((style) => Number.parseFloat(style.borderBottomWidth) >= 1)).toBe(true);
    expect(headerStyles.every((style) => style.boxShadow === "none")).toBe(true);
  });

  test("created filter editor opens above grid menus", async ({ page }) => {
    await openPatientsAsCeo(page);
    await expect(page.getByText("PT-0001")).toBeVisible();

    await page.getByRole("button", { name: /Filter|Фильтр/i }).click();
    const filterPicker = page.locator("[data-table-filter-picker]");
    await expect(filterPicker).toBeVisible();
    await filterPicker.getByRole("menuitem", { name: /Created|Создан|Erstellt/i }).click();

    const editor = page.locator("[data-table-filter-editor]");
    await expect(editor).toBeVisible();
    await expect(page.locator('[data-filter-field="created_at"]')).toBeVisible();

    const zIndex = await editor.evaluate((element) => getComputedStyle(element).zIndex);
    expect(Number(zIndex)).toBeGreaterThan(50);
  });

  test("URL filter state round-trip", async ({ page }) => {
    await loginAsCeo(page);
    await page.goto("/patients?q=Petrov");
    await expect(page.getByText("PT-0002")).toBeVisible();
    await expect(page.getByText("PT-0001")).not.toBeVisible();
  });
});
