import { expect, test } from "@playwright/test";

test("catalog description items retain order and internal newlines after saving", async ({ page }) => {
  let service = {
    id: "00000000-0000-0000-0000-000000000901", service_key: "structured_test",
    service_name: "Structured description test", description: "1) First point\n2) Second point",
    description_items: undefined as Array<{ id: string; text: string }> | undefined,
    unit_label: "Tag", unit_price: "100", currency: "EUR", vat_rate: "19",
    is_active: true, valid_from: "2026-01-01", valid_to: null, price_versions: [],
  };
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "catalog-test-token");
    localStorage.setItem("gmed_refresh_token", "catalog-test-refresh");
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") body = {
      id: "00000000-0000-0000-0000-000000000001", email: "catalog@example.com",
      name: "Catalog tester", role: "ceo", created_at: "2026-01-01T00:00:00Z",
    };
    if (path === "/agency-services") body = [service];
    if (path === `/agency-services/${service.id}/update`) {
      const payload = route.request().postDataJSON();
      service = { ...service, ...payload, description: payload.description_items.map((item: { text: string }) => item.text).join("\n\n") };
      body = { id: service.id };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/finance-catalog");
  const row = page.getByRole("row").filter({ hasText: "Structured description test" });
  await row.getByRole("button", { name: /Bearbeiten|Редактировать|Изменить/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/^(Пункт|Punkt) 1$/)).toHaveValue("First point");
  await dialog.getByLabel(/^(Пункт|Punkt) 1$/).fill("First point\n\nInternal paragraph");
  await dialog.getByRole("button", { name: /^(Переместить вверх пункт|Punkt nach oben verschieben) 2$/ }).click();
  await expect(dialog.getByLabel(/^(Пункт|Punkt) 1$/)).toHaveValue("Second point");
  await dialog.getByRole("button", { name: /Добавить пункт|Punkt hinzufügen/ }).click();
  await dialog.getByLabel(/^(Пункт|Punkt) 3$/).fill("Temporary point");
  await dialog.getByRole("button", { name: /^(Удалить пункт|Punkt löschen) 3$/ }).click();
  await expect(dialog.getByLabel(/^(Пункт|Punkt) 3$/)).toHaveCount(0);
  await dialog.getByRole("button", { name: /Добавить пункт|Punkt hinzufügen/ }).click();
  await dialog.getByLabel(/^(Пункт|Punkt) 3$/).fill("Added point for [Fachrichtung 1]");
  await dialog.screenshot({ path: "../artifacts/design-qa/catalog-description-items.png" });
  await dialog.getByRole("button", { name: /Сохранить|Speichern/, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(service.description_items?.map((item) => item.text)).toEqual([
    "Second point", "First point\n\nInternal paragraph", "Added point for [Fachrichtung 1]",
  ]);
  expect(service.description_items?.slice(0, 2).map((item) => item.id)).toEqual(["legacy-2", "legacy-1"]);
  await row.getByRole("button", { name: /Bearbeiten|Редактировать|Изменить/i }).click();
  await expect(page.getByRole("dialog").getByLabel(/^(Пункт|Punkt) 2$/)).toHaveValue("First point\n\nInternal paragraph");
});
