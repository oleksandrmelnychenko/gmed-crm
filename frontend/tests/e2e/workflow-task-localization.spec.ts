import { expect, test, type Page } from "@playwright/test";

const taskId = "2d785f73-0000-0000-0000-000000000001";
const title = "Order checklist: Review order scope and convert needs into service blocks";
const note = "Auto-generated from order workflow checklist";
const labels = {
  ru: { title: "Проверить объём заказа и преобразовать в сервисные блоки", note: "Создано автоматически из чек-листа заказа", delete: "Удалить", confirm: "Удалить задачу?", cancel: "Отмена", edit: "Изменить", save: "Сохранить", titleField: "Название", noteField: "Операционная заметка", location: "Место или адрес", search: "Поиск по задаче, адресу или исполнителю" },
  de: { title: "Auftragsumfang prüfen und in Leistungsblöcke überführen", note: "Automatisch aus der Auftragscheckliste erstellt", delete: "Löschen", confirm: "Aufgabe löschen?", cancel: "Abbrechen", edit: "Bearbeiten", save: "Speichern", titleField: "Titel", noteField: "Operative Notiz", location: "Ort oder Adresse", search: "Aufgabe, Ort oder zuständige Person suchen" },
};

async function mockTasks(page: Page, lang: "ru" | "de") {
  const state = {
    saves: [] as Record<string, unknown>[], deletes: 0,
    task: {
      id: taskId, title, note, kind: "task", status: "open", priority: "high",
      assigned_to: "tester", assigned_to_name: "Test Manager", assigned_by: "tester", assigned_by_name: "Test Manager",
      task_audience: "internal", concierge_service_id: null, patient_id: null, provider_id: null, project_id: null,
      due_at: "2026-09-07T12:00:00Z", starts_at: null, ends_at: null, reminder_at: null, location: null,
      created_at: "2026-09-05T12:00:00Z", updated_at: "2026-09-05T12:00:00Z", archived_at: null,
      checklist_completed: 0, checklist_total: 0, comment_count: 0, attachment_count: 0,
    },
  };
  await page.addInitScript((language) => {
    localStorage.setItem("gmed_access_token", "task-locale-test");
    localStorage.setItem("gmed_refresh_token", "task-locale-refresh");
    localStorage.setItem("gmed_lang", language);
  }, lang);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") body = { id: "tester", name: "Test Manager", email: "tester@example.com", role: "ceo", created_at: state.task.created_at };
    if (path === "/concierge-operational-items") body = [state.task];
    if (path === "/concierge-operational-items/assignees") body = [{ id: "tester", name: "Test Manager", email: "tester@example.com", role: "ceo", is_active: true }];
    if (path === `/concierge-operational-items/${taskId}`) body = { item: state.task, checklist: [], comments: [], history: [] };
    if (path === `/concierge-operational-items/${taskId}/update`) {
      const input = route.request().postDataJSON();
      state.saves.push(input);
      state.task = { ...state.task, ...input };
      body = state.task;
    }
    if (path === `/concierge-operational-items/${taskId}/delete`) { state.deletes++; body = {}; }
    if (path.endsWith("/expense-context")) body = { patient: null, service: null, task: { ...state.task, currency: "EUR" }, mapped_order: null };
    if (path.endsWith("/expenses")) body = { items: [] };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return state;
}

for (const lang of ["ru", "de"] as const) {
  test(`generated task details use ${lang} and keep deletion in the footer`, async ({ page }) => {
    const state = await mockTasks(page, lang);
    const l = labels[lang];
    await page.goto(`/task-manager?task=${taskId}`);
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: l.title }) });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(l.note, { exact: true })).toBeVisible();
    await expect(dialog).not.toContainText("Order checklist:");
    await expect(dialog).not.toContainText("Auto-generated");
    const remove = dialog.getByRole("button", { name: l.delete, exact: true });
    await expect(remove).toBeVisible();
    const box = await dialog.boundingBox();
    const button = await remove.boundingBox();
    expect(button!.y).toBeGreaterThan(box!.y + box!.height - 85);
    await remove.click();
    const confirmation = page.getByRole("alertdialog", { name: l.confirm });
    await expect(confirmation).toBeVisible();
    expect(state.deletes).toBe(0);
    await confirmation.getByRole("button", { name: l.cancel, exact: true }).click();
    await expect(dialog).toBeVisible();
    if (lang === "ru") {
      await page.screenshot({ path: "../artifacts/design-qa/task-localized-desktop.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(remove).toBeInViewport();
      await page.screenshot({ path: "../artifacts/design-qa/task-localized-mobile.png" });
    }
  });

  test(`task search and editing use ${lang} without rewriting unchanged templates`, async ({ page }) => {
    const state = await mockTasks(page, lang);
    const l = labels[lang];
    await page.goto("/task-manager");
    const search = page.getByPlaceholder(l.search);
    await search.fill(l.title);
    await expect(page.getByRole("heading", { name: l.title })).toBeVisible();
    await page.getByRole("button", { name: l.edit, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("textbox", { name: l.titleField, exact: true })).toHaveValue(l.title);
    await expect(dialog.getByRole("textbox", { name: l.noteField, exact: true })).toHaveValue(l.note);
    await dialog.getByRole("textbox", { name: l.location, exact: true }).fill("Berlin");
    await dialog.getByRole("button", { name: l.save, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(state.saves).toHaveLength(1);
    expect(state.saves[0]).toMatchObject({ title, note, location: "Berlin" });
    await page.getByRole("button", { name: l.edit, exact: true }).click();
    await dialog.getByRole("textbox", { name: l.titleField, exact: true }).fill("Custom task title");
    await dialog.getByRole("textbox", { name: l.noteField, exact: true }).fill("Custom task note");
    await dialog.getByRole("button", { name: l.save, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(state.saves[1]).toMatchObject({ title: "Custom task title", note: "Custom task note" });
  });
}
