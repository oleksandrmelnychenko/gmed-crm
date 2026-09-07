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
    saves: [] as Record<string, unknown>[], deletes: 0, deleted: false,
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
    if (path === "/concierge-operational-items") {
      if (route.request().method() === "POST") {
        const input = route.request().postDataJSON();
        state.saves.push(input);
        state.task = { ...state.task, ...input, id: "2d785f73-0000-0000-0000-000000000002" };
        state.deleted = false;
        body = state.task;
      } else {
        body = state.deleted ? [] : [state.task];
      }
    }
    if (path === "/concierge-operational-items/assignees") body = [{ id: "tester", name: "Test Manager", email: "tester@example.com", role: "ceo", is_active: true }];
    if (path === `/concierge-operational-items/${state.task.id}`) {
      if (route.request().method() === "DELETE") {
        state.deletes++;
        state.deleted = true;
        body = {};
      } else {
        body = { item: state.task, checklist: [], comments: [], history: [] };
      }
    }
    if (path === `/concierge-operational-items/${taskId}/update`) {
      const input = route.request().postDataJSON();
      state.saves.push(input);
      state.task = { ...state.task, ...input };
      body = state.task;
    }
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

test("failed task deletion leaves a visible error and a closable detail dialog", async ({ page }) => {
  await mockTasks(page, "ru");
  await page.route(`**/concierge-operational-items/${taskId}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({
      message: "Only an untouched open task can be deleted; cancel or archive it instead",
    }) });
  });
  await page.goto(`/task-manager?task=${taskId}`);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Удалить задачу?" }).getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(dialog.getByRole("alert")).toContainText("Удалить можно только");
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
  await page.getByRole("heading", { name: labels.ru.title, exact: true }).click();
  await expect(dialog.getByRole("heading", { name: labels.ru.title, exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("late error from a closed task does not replace a reopened task", async ({ page }) => {
  const state = await mockTasks(page, "ru");
  let finishFirst!: () => void;
  const firstRequest = new Promise<void>((resolve) => { finishFirst = resolve; });
  let requests = 0;
  await page.route(`**/concierge-operational-items/${taskId}`, async (route) => {
    requests += 1;
    if (requests === 1) {
      await firstRequest;
      await route.fulfill({ status: 404, contentType: "application/json", body: '{"message":"Operational item not found"}' });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ item: state.task, checklist: [], comments: [], history: [] }) });
  });
  await page.goto(`/task-manager?task=${taskId}`);
  const dialog = page.getByRole("dialog");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("heading", { name: labels.ru.title, exact: true }).click();
  await expect(dialog.getByRole("heading", { name: labels.ru.title, exact: true })).toBeVisible();
  const staleResponse = page.waitForResponse((response) => response.status() === 404 && response.url().endsWith(taskId));
  finishFirst();
  await (await staleResponse).finished();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("failed task creation can be discarded without reopening the modal", async ({ page }) => {
  await mockTasks(page, "ru");
  await page.route("**/concierge-operational-items", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Temporary save failure"}' });
  });
  await page.goto("/task-manager?create=1");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Название", exact: true }).fill("Failed draft");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Temporary save failure");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Закрыть без сохранения", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/create=1/);
  await page.getByRole("button", { name: "Задача / событие", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Название", exact: true })).toHaveValue("");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("deleted task closes and a new task can be created immediately", async ({ page }) => {
  const state = await mockTasks(page, "ru");
  await page.goto(`/task-manager?task=${taskId}`);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: labels.ru.title, exact: true })).toHaveCount(0);
  expect(state.deletes).toBe(1);
  await page.getByRole("button", { name: "Задача / событие", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Название", exact: true }).fill("Replacement task");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Replacement task", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.saves).toHaveLength(1);
  expect(state.saves[0].request_id).toBeTruthy();
});

test("failed deletion from a task card closes its confirmation", async ({ page }) => {
  await mockTasks(page, "ru");
  await page.route(`**/concierge-operational-items/${taskId}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    await route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Temporary delete failure"}' });
  });
  await page.goto("/task-manager");
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Temporary delete failure");
  await page.getByRole("heading", { name: labels.ru.title, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
