import { expect, test, type Page } from "@playwright/test";

const parentId = "10000000-0000-0000-0000-000000000001";
async function mockWorkCenter(page: Page, lang: "ru" | "de" = "ru", role = "ceo") {
  const now = new Date();
  now.setHours(9, 0, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + 2);
  const parent = {
    id: parentId, kind: "task", title: "Timeline parent", note: null, status: "in_progress", priority: "normal",
    assigned_to: "tester", assigned_by: role === "ceo" ? "tester" : "manager", assigned_by_role: "ceo", assigned_to_name: "Test User", assigned_by_name: "Test Manager",
    task_audience: "internal", concierge_service_id: null, patient_id: null, provider_id: null, project_id: null,
    due_at: end.toISOString(), starts_at: now.toISOString(), ends_at: null, parent_task_id: null, child_count: 0,
    reminder_at: null, reminder_sent_at: null, archived_at: null, created_at: now.toISOString(), updated_at: now.toISOString(),
    checklist_total: 0, checklist_completed: 0, comment_count: 0, attachment_count: 0,
  };
  const state = { tasks: [parent] as Record<string, unknown>[], saves: [] as Record<string, unknown>[], statuses: [] as Record<string, unknown>[], deletes: [] as string[] };
  await page.addInitScript(({ lang }) => {
    localStorage.setItem("gmed_access_token", "work-center-test");
    localStorage.setItem("gmed_refresh_token", "work-center-test-refresh");
    localStorage.setItem("gmed_lang", lang);
  }, { lang });
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const method = route.request().method();
    let body: unknown = [];
    if (path === "/me") body = { id: "tester", name: "Test User", email: "test@example.com", role, created_at: now.toISOString() };
    if (path === "/concierge-operational-items/assignees") body = [{ id: "tester", name: "Test User", email: "test@example.com", role, is_active: true }];
    if (path === "/concierge-operational-items") {
      if (method === "POST") {
        const input = route.request().postDataJSON();
        state.saves.push(input);
        const child = { ...parent, ...input, id: `child-${state.saves.length}`, assigned_by: "tester", assigned_by_role: role, status: "open", child_count: 0 };
        state.tasks.push(child);
        for (const item of state.tasks) item.child_count = state.tasks.filter(child => child.parent_task_id === item.id).length;
        body = child;
      } else body = state.tasks;
    }
    const id = path.split("/")[2];
    const task = state.tasks.find(task => task.id === id);
    if (task && method === "DELETE" && path === `/concierge-operational-items/${id}`) {
      state.deletes.push(id);
      state.tasks = state.tasks.filter(task => task.id !== id);
      for (const item of state.tasks) item.child_count = state.tasks.filter(child => child.parent_task_id === item.id).length;
      await route.fulfill({ status: 204 });
      return;
    }
    if (task && path.endsWith("/status")) {
      const input = route.request().postDataJSON();
      state.statuses.push(input);
      Object.assign(task, { status: input.status, updated_at: new Date().toISOString() });
      body = task;
    } else if (task && path.endsWith("/update")) {
      const input = route.request().postDataJSON();
      state.saves.push(input);
      Object.assign(task, input);
      body = task;
    } else if (task && path === `/concierge-operational-items/${id}`) body = { item: task, checklist: [], comments: [], history: [] };
    if (path.endsWith("/expense-context")) body = { patient: null, service: null, task: { ...parent, currency: "EUR" }, mapped_order: null };
    if (path.endsWith("/expenses")) body = { items: [] };
    await route.fulfill({ json: body });
  });
  return state;
}

test("timeline shows both dates and pauses/resumes without changing the deadline", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const state = await mockWorkCenter(page);
  const deadline = state.tasks[0].due_at;
  await page.goto("/task-manager");
  await page.getByRole("button", { name: "Таймлайн", exact: true }).click();
  const row = page.getByTestId(`timeline-row-${parentId}`);
  await expect(row).toContainText("Начало:");
  await expect(row).toContainText("Окончание:");
  await row.getByRole("button", { name: "На паузу", exact: true }).click();
  await expect(row.getByRole("button", { name: "Продолжить", exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(row.getByRole("button", { name: "На паузу", exact: true })).toBeVisible();
  expect(state.statuses.map(s => s.status)).toEqual(["on_hold", "in_progress"]);
  expect(state.tasks[0].due_at).toBe(deadline);
  await page.screenshot({ path: info.outputPath("timeline.png"), fullPage: true });
  expect(errors).toEqual([]);
});

for (const kind of ["task", "event"] as const) {
  test(`creates a linked ${kind} and shows it below its parent after reload`, async ({ page }) => {
    const state = await mockWorkCenter(page);
    await page.goto(`/task-manager?task=${parentId}`);
    await page.getByRole("dialog").getByRole("button", { name: kind === "task" ? "Подзадача" : "Событие", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toContainText("Основная задача: Timeline parent");
    await dialog.getByRole("textbox", { name: "Название", exact: true }).fill(`Linked ${kind}`);
    await dialog.getByRole("button", { name: "Создать", exact: true }).click();
    await expect.poll(() => state.saves.length).toBe(1);
    expect(state.saves[0].parent_task_id).toBe(parentId);
    expect(state.saves[0].kind).toBe(kind);
    expect(state.saves[0].starts_at).toBeTruthy();
    expect(state.saves[0][kind === "task" ? "due_at" : "ends_at"]).toBeTruthy();
    await page.reload();
    await expect(page.getByRole("dialog")).toContainText(`Linked ${kind}`);
    await page.getByRole("dialog").getByRole("button", { name: new RegExp(`Linked ${kind}`) }).click();
    await expect(page.getByRole("dialog")).toContainText("К основной задаче");
    await page.getByRole("dialog").getByRole("button", { name: "К основной задаче" }).click();
    await expect(page.getByRole("dialog")).toContainText("Подзадачи и события");
  });
}

test("task form rejects equal dates and preserves a legacy empty start on edit", async ({ page }) => {
  const state = await mockWorkCenter(page);
  state.tasks[0].starts_at = null;
  await page.goto("/task-manager");
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Начало", { exact: true })).toHaveValue("");
  for (const label of ["Начало", "Окончание"]) {
    const field = dialog.locator(".MuiFormControl-root").filter({ has: page.locator(`input[aria-label="${label}"]`) });
    for (const [name, value] of [["Year", "2026"], ["Month", "09"], ["Hours", "10"], ["Minutes", "00"], ["Day", "10"]]) {
      await field.getByRole("spinbutton", { name, exact: true }).fill(value);
    }
    await field.getByRole("spinbutton", { name: "Minutes", exact: true }).press("Tab");
    await expect(field.getByRole("spinbutton", { name: "Day", exact: true })).toHaveText("10");
  }
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Окончание должно быть позже начала");
  expect(state.saves).toHaveLength(0);
});

for (const width of [1440, 390]) {
  test(`German timeline stays within the viewport at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await mockWorkCenter(page, "de", "concierge");
    await page.goto("/task-manager");
    await page.getByRole("button", { name: "Zeitplan", exact: true }).click();
    await expect(page.getByTestId(`timeline-row-${parentId}`)).toContainText("Ende:");
    await expect(page.getByRole("button", { name: "Pausieren", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`timeline-${width}.png`), fullPage: true });
  });
}

test("child form retains reduced-motion support", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockWorkCenter(page);
  await page.goto(`/task-manager?task=${parentId}`);
  await page.getByRole("dialog").getByRole("button", { name: "Подзадача", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Основная задача: Timeline parent");
  expect(await dialog.evaluate(node => getComputedStyle(node).animationName)).toBe("none");
});

test("concierge creates a personal subtask on an assigned task and deletes only the owned subtask", async ({ page }) => {
  const state = await mockWorkCenter(page, "ru", "concierge");
  await page.goto(`/task-manager?task=${parentId}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Удалить", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Подзадача", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Название", exact: true }).fill("My concierge subtask");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0]).toMatchObject({ assigned_to: "tester", parent_task_id: parentId, kind: "task" });
  // Worked-on subtasks remain deletable by their concierge creator.
  Object.assign(state.tasks[1], { status: "on_hold", comment_count: 1, checklist_total: 1, attachment_count: 1 });
  await page.reload();
  await dialog.getByRole("button", { name: /My concierge subtask/ }).click();
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Удалить задачу?" }).getByRole("button", { name: "Удалить", exact: true }).click();
  await expect.poll(() => state.deletes).toEqual(["child-1"]);
  expect(state.tasks.map(task => task.id)).toEqual([parentId]);
  await page.goto(`/task-manager?task=${parentId}`);
  await expect(dialog.getByRole("button", { name: "Удалить", exact: true })).toHaveCount(0);
  await expect(dialog).not.toContainText("My concierge subtask");
});

test("concierge creates and deletes a regular personal task", async ({ page }) => {
  const state = await mockWorkCenter(page, "ru", "concierge");
  await page.goto("/task-manager");
  await page.getByRole("button", { name: "Задача / событие", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Название", exact: true }).fill("My regular task");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0].assigned_to).toBe("tester");
  expect(state.saves[0].parent_task_id).toBeUndefined();
  await page.goto("/task-manager?task=child-1");
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Удалить задачу?" }).getByRole("button", { name: "Удалить", exact: true }).click();
  await expect.poll(() => state.deletes).toEqual(["child-1"]);
  await page.reload();
  await expect(page.getByText("My regular task", { exact: true })).toHaveCount(0);
});

test("a concierge subtask defaults to self even when the owned parent is assigned to a colleague", async ({ page }) => {
  const state = await mockWorkCenter(page, "ru", "concierge");
  Object.assign(state.tasks[0], { assigned_by: "tester", assigned_by_role: "concierge", assigned_to: "colleague" });
  await page.route("**/api/v1/concierge-operational-items/assignees", route => route.fulfill({ json: [
    { id: "tester", name: "Test User", email: "test@example.com", role: "concierge", is_active: true },
    { id: "colleague", name: "Colleague", email: "colleague@example.com", role: "concierge", is_active: true },
  ] }));
  await page.goto(`/task-manager?task=${parentId}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Удалить", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Подзадача", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Название", exact: true }).fill("Personal follow-up");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0].assigned_to).toBe("tester");
  await expect(dialog.getByRole("button", { name: "Удалить", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: /Personal follow-up/ }).click();
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Удалить", exact: true }).click();
  await expect.poll(() => state.deletes).toEqual(["child-1"]);
  await page.goto(`/task-manager?task=${parentId}`);
  await expect(dialog.getByRole("button", { name: "Удалить", exact: true })).toBeEnabled();
});
