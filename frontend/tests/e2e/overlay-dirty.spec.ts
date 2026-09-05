import { expect, test, type Locator } from "@playwright/test";

async function typeText(input: Locator, value: string) {
  await input.press("ControlOrMeta+A");
  await input.pressSequentially(value);
}

if (process.env.OVERLAY_TEST_BASE_URL) test.use({ baseURL: process.env.OVERLAY_TEST_BASE_URL });

for (const kind of ["dialog", "sheet"]) {
  test.describe(`${kind} change detection`, () => {
    test.beforeEach(async ({ page }) => {
      await page.route("**/overlay-dirty-harness?*", (route) => route.fulfill({
        contentType: "text/html",
        body: `<html><body><div id="root"></div><script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => (type) => type;
          window.__vite_plugin_react_preamble_installed__ = true;
          import('/tests/e2e/fixtures/overlay-dirty-harness.tsx');
        </script></body></html>`,
      }));
      await page.goto(`/overlay-dirty-harness?kind=${kind}`);
      await page.getByRole("button", { name: "Open editor" }).click();
    });

    test("blocks pristine submits and allows closing after edits are reverted", async ({ page }) => {
      const save = page.getByRole("button", { name: "Save values" });
      await expect(save).toBeDisabled();
      await page.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
      await expect(page.getByLabel("Save count")).toHaveText("0");
      await page.getByLabel("Name", { exact: true }).fill("Changed");
      await expect(page.getByLabel("Draft name")).toHaveText("Changed");
      await expect(save).toBeEnabled();
      await page.getByLabel("Notes", { exact: true }).fill("Changed notes");
      await typeText(page.getByLabel("Name", { exact: true }), "Original");
      await expect(save).toBeEnabled();
      await page.getByLabel("Notes", { exact: true }).fill("Initial notes");
      await expect(save).toBeDisabled();
      await page.getByLabel("Enabled", { exact: true }).uncheck();
      await expect(save).toBeEnabled();
      await page.getByLabel("Enabled", { exact: true }).check();
      await expect(save).toBeDisabled();
      await page.getByLabel("Radio B", { exact: true }).check();
      await expect(save).toBeEnabled();
      await page.getByLabel("Radio A", { exact: true }).check();
      await expect(save).toBeDisabled();
      await page.getByLabel("Notes", { exact: true }).fill("Draft to reset");
      await expect(save).toBeEnabled();
      await page.getByRole("button", { name: "Reset text fields" }).click();
      await expect(save).toBeDisabled();
      await page.getByRole("button", { name: "Cancel editor" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("ignores combobox search and compares selected values", async ({ page }) => {
      const save = page.getByRole("button", { name: "Save values" });
      await page.getByRole("combobox", { name: "Choice", exact: true }).click();
      await page.getByPlaceholder("Search choices").fill("Beta");
      await page.keyboard.press("Escape");
      await expect(page.getByPlaceholder("Search choices")).toHaveCount(0);
      await expect(save).toBeDisabled();
      await page.getByRole("combobox", { name: "Choice", exact: true }).click();
      await page.getByRole("option", { name: "Beta", exact: true }).click();
      await expect(page.getByPlaceholder("Search choices")).toHaveCount(0);
      await expect(save).toBeEnabled();
      await page.getByRole("combobox", { name: "Choice", exact: true }).click();
      await page.getByPlaceholder("Search choices").fill("Alpha");
      await page.getByRole("option", { name: "Alpha", exact: true }).click();
      await expect(page.getByPlaceholder("Search choices")).toHaveCount(0);
      await expect(save).toBeDisabled();
      await page.getByRole("combobox", { name: "Status" }).click();
      await page.getByRole("option", { name: "Second", exact: true }).click();
      await expect(save).toBeEnabled();
      await page.getByRole("combobox", { name: "Status" }).click();
      await page.getByRole("option", { name: "First", exact: true }).click();
      await expect(save).toBeDisabled();
    });

    test("retains dirty state after a failed save and resets after successful save/reopen", async ({ page }) => {
      await typeText(page.getByLabel("Name", { exact: true }), "Changed");
      await page.getByRole("button", { name: "Save values" }).click();
      await expect(page.getByLabel("Save count")).toHaveText("1");
      await page.getByRole("button", { name: "Open editor" }).click();
      await expect(page.getByRole("button", { name: "Save values" })).toBeDisabled();
      await typeText(page.getByLabel("Name", { exact: true }), "Changed again");
      await page.getByRole("button", { name: "Simulate save failure" }).click();
      await page.getByRole("button", { name: "Save values" }).click();
      await expect(page.getByRole("alert")).toHaveText("Save failed");
      await expect(page.getByRole("button", { name: "Save values" })).toBeEnabled();
      await page.getByRole("button", { name: "Cancel editor" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    });

    test("compares dates selected in a picker", async ({ page }) => {
      const save = page.getByRole("button", { name: "Save values" });
      await page.getByRole("spinbutton", { name: "Day", exact: true }).fill("06");
      await expect(save).toBeEnabled();
      await page.getByRole("spinbutton", { name: "Day", exact: true }).fill("05");
      await expect(save).toBeDisabled();
    });

    test("uses full draft comparison for structural changes and undo", async ({ page }) => {
      await page.goto(`/overlay-dirty-harness?kind=${kind}&controlled=true`);
      await page.getByRole("button", { name: "Open editor" }).click();
      const save = page.getByRole("button", { name: "Save values" });
      await expect(save).toBeDisabled();
      await page.getByRole("button", { name: "Reverse rows" }).click();
      await expect(save).toBeEnabled();
      await page.getByRole("button", { name: "Reverse rows" }).click();
      await expect(save).toBeDisabled();
      await page.getByRole("button", { name: "Cancel editor" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("keeps nested form submissions and changes separate", async ({ page }) => {
      await page.getByRole("button", { name: "Open child" }).click();
      await page.getByRole("button", { name: "Save child" }).click();
      await expect(page.getByRole("dialog", { name: "Child editor" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save values" })).toBeDisabled();
      await page.getByRole("button", { name: "Open child" }).click();
      await page.getByLabel("Child name").fill("Nested change");
      await page.getByRole("button", { name: "Save child" }).click();
      await expect(page.getByRole("dialog", { name: "Child editor" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save values" })).toBeDisabled();
    });
  });
}

test("catalog saves only changed drafts, including reordered description rows", async ({ page }) => {
  let writes = 0;
  let service = {
    id: "00000000-0000-0000-0000-000000000901", service_key: "dirty_test",
    service_name: "Dirty comparison test", description: "1) First point\n2) Second point",
    description_items: undefined as Array<{ id: string; text: string }> | undefined,
    unit_label: "Tag", unit_price: "100", currency: "EUR", vat_rate: "19",
    is_active: true, valid_from: "2026-01-01", valid_to: null, price_versions: [],
  };
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "dirty-test-token");
    localStorage.setItem("gmed_refresh_token", "dirty-test-refresh");
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") body = {
      id: "00000000-0000-0000-0000-000000000001", email: "dirty@example.com",
      name: "Dirty test", role: "ceo", created_at: "2026-01-01T00:00:00Z",
    };
    if (path === "/agency-services") body = [service];
    if (path === `/agency-services/${service.id}/update`) {
      writes += 1;
      const payload = route.request().postDataJSON();
      service = { ...service, ...payload };
      body = { id: service.id };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/finance-catalog");
  const row = page.getByRole("row").filter({ hasText: "Dirty comparison test" });
  await row.getByRole("button", { name: /Bearbeiten|Редактировать|Изменить/i }).click();
  const dialog = page.getByRole("dialog");
  const save = dialog.getByRole("button", { name: /Сохранить|Speichern/, exact: true });
  await expect(save).toBeDisabled();
  await dialog.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
  expect(writes).toBe(0);
  const moveSecondUp = dialog.getByRole("button", { name: /^(Переместить вверх пункт|Punkt nach oben verschieben) 2$/ });
  await moveSecondUp.click();
  await expect(save).toBeEnabled();
  await moveSecondUp.click();
  await expect(save).toBeDisabled();
  await dialog.getByRole("button", { name: /Добавить пункт|Punkt hinzufügen/ }).click();
  await expect(save).toBeEnabled();
  await dialog.getByRole("button", { name: /^(Удалить пункт|Punkt löschen) 3$/ }).click();
  await expect(save).toBeDisabled();
  await moveSecondUp.click();
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toBe(1);
  expect(service.description_items?.map((item) => item.text)).toEqual(["Second point", "First point"]);
  await row.getByRole("button", { name: /Bearbeiten|Редактировать|Изменить/i }).click();
  await expect(save).toBeDisabled();
});
