import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

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
  const sockets: WebSocketRoute[] = [];
  const state = {
    tasks: [parent] as Record<string, unknown>[], saves: [] as Record<string, unknown>[],
    statuses: [] as Record<string, unknown>[], deletes: [] as string[],
    comments: [] as Record<string, unknown>[], checklist: [] as Record<string, unknown>[],
    attachments: [] as Record<string, unknown>[], listReads: 0, connected: true,
    emit(type: string, entity_id = parentId) {
      for (const socket of sockets) socket.send(JSON.stringify({ type, entity_type: "task", entity_id }));
    },
    disconnect() { state.connected = false; for (const socket of sockets) socket.close(); },
  };
  await page.routeWebSocket("**/api/v1/events/ws*", socket => {
    sockets.push(socket);
    if (state.connected) socket.send(JSON.stringify({ type: "realtime.connected", entity_type: "realtime", entity_id: "tester" }));
  });
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
      } else { state.listReads += 1; body = state.tasks; }
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
    } else if (task && path === `/concierge-operational-items/${id}`) body = { item: task, checklist: state.checklist, comments: state.comments, history: [] };
    if (path.endsWith("/attachments")) body = state.attachments;
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

for (const lang of ["ru", "de"] as const) {
  for (const width of [1440, 390]) {
    test(`task date chips contain both date and time in ${lang} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const state = await mockWorkCenter(page, lang);
      await page.goto("/task-manager");
      const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Timeline parent", exact: true }) });
      const times = card.locator("time");
      await expect(times).toHaveCount(2);
      for (const [index, field] of ["starts_at", "due_at"].entries()) {
        const expected = await page.evaluate(({ lang, value }) => new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
        }).format(new Date(value)), { lang, value: String(state.tasks[0][field]) });
        await expect(times.nth(index)).toHaveText(expected.replace(/[.,]/g, ""));
        await expect(times.nth(index)).not.toContainText(/[.,]/);
        const chip = times.nth(index).locator("..");
        expect(await chip.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        const row = chip.locator("..");
        await expect(row.locator(":scope > span").first()).toHaveText(index === 0 ? (lang === "de" ? "Beginn:" : "Начало:") : (lang === "de" ? "Ende:" : "Окончание:"));
        expect(await chip.evaluate(node => {
          const chipBounds = node.getBoundingClientRect();
          const cardBounds = node.closest("article")!.getBoundingClientRect();
          return chipBounds.left >= cardBounds.left && chipBounds.right <= cardBounds.right;
        })).toBe(true);
      }
    });
  }
}

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
    await expect(dialog.getByRole("button", { name: new RegExp(`Linked ${kind}`) })).toBeVisible();
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

for (const kind of ["task", "event"] as const) {
  test(`remote ${kind} creation, scheduling, status, archive and deletion update the open parent live`, async ({ page }) => {
    const state = await mockWorkCenter(page);
    await page.goto(`/task-manager?task=${parentId}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Подзадач и событий пока нет");
    const child = { ...state.tasks[0], id: "remote-child", kind, title: "Remote child", parent_task_id: parentId, status: "open" };
    state.tasks.push(child);
    state.emit("concierge_operational_item.created", "remote-child");
    const row = dialog.getByRole("button", { name: /Remote child/ });
    await expect(row).toContainText("Открыта");
    Object.assign(child, { status: "on_hold", starts_at: "2026-09-20T08:15:00Z", due_at: "2026-09-20T09:30:00Z", ends_at: "2026-09-20T09:30:00Z" });
    state.emit("concierge_operational_item.updated", "remote-child");
    await expect(row).toContainText("На паузе");
    await expect(row).toContainText("20 сент.");
    Object.assign(child, { status: "completed", archived_at: new Date().toISOString() });
    state.emit("concierge_operational_item.archived", "remote-child");
    await expect(row).toContainText("В архиве");
    Object.assign(child, { archived_at: null });
    state.emit("concierge_operational_item.restored", "remote-child");
    await expect(row).toContainText("Выполнена");
    state.tasks = state.tasks.filter(item => item.id !== "remote-child");
    state.emit("concierge_operational_item.deleted", "remote-child");
    await expect(row).toHaveCount(0);
    await expect(dialog).toContainText("Подзадач и событий пока нет");
  });
}

test("batched realtime updates refresh details, comments, checklist and files without clearing drafts", async ({ page }) => {
  const state = await mockWorkCenter(page);
  await page.goto(`/task-manager?task=${parentId}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Данные задачи");
  const draft = dialog.locator("textarea");
  await draft.fill("Keep my unsent comment");
  await dialog.getByRole("combobox", { name: "Статус", exact: true }).click();
  await page.getByRole("option", { name: "На паузе", exact: true }).click();
  state.tasks[0].note = "Updated in another session";
  state.comments.push({ id: "remote-comment", body: "Remote comment", created_by: "other", created_by_name: "Colleague", created_at: new Date().toISOString() });
  state.checklist.push({ id: "remote-check", label: "Remote checklist", is_completed: true, created_by: "other", created_at: new Date().toISOString(), position: 1 });
  state.attachments.push({ id: "remote-file", file_name: "live.pdf", file_size: 100, mime_type: "application/pdf", uploaded_by: "other", uploaded_by_name: "Colleague", created_at: new Date().toISOString() });
  for (const suffix of ["updated", "comment_added", "checklist_item_toggled", "attachment_added"]) {
    state.emit(`concierge_operational_item.${suffix}`);
    state.emit(`concierge_operational_item.${suffix}`, "unrelated-last-in-batch");
  }
  await expect(dialog).toContainText("Updated in another session");
  await expect(dialog).toContainText("Remote comment");
  await expect(dialog).toContainText("Remote checklist");
  await expect(dialog).toContainText("live.pdf");
  await expect(draft).toHaveValue("Keep my unsent comment");
  await expect(dialog.getByRole("combobox", { name: "Статус", exact: true })).toContainText("На паузе");
  state.comments = [];
  state.checklist = [];
  state.attachments = [];
  for (const suffix of ["comment_deleted", "checklist_item_deleted", "attachment_deleted"]) state.emit(`concierge_operational_item.${suffix}`);
  await expect(dialog.getByText("Remote comment", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Remote checklist", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("live.pdf", { exact: true })).toHaveCount(0);
  await expect(draft).toHaveValue("Keep my unsent comment");
});

test("realtime refresh cannot clear a half-written subtask or create it twice", async ({ page }) => {
  const state = await mockWorkCenter(page);
  await page.goto(`/task-manager?task=${parentId}`);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Подзадача", exact: true }).click();
  const title = dialog.getByRole("textbox", { name: "Название", exact: true });
  await title.fill("Draft survives realtime");
  const start = await dialog.getByLabel("Начало", { exact: true }).inputValue();
  const reads = state.listReads;
  state.emit("concierge_operational_item.updated");
  await expect.poll(() => state.listReads).toBeGreaterThan(reads);
  await expect(title).toHaveValue("Draft survives realtime");
  await expect(dialog.getByLabel("Начало", { exact: true })).toHaveValue(start);
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /Draft survives realtime/ })).toBeVisible();
  expect(state.saves).toHaveLength(1);
  expect(state.saves[0].parent_task_id).toBe(parentId);
  await page.reload();
  await expect(dialog.getByRole("button", { name: /Draft survives realtime/ })).toBeVisible();
});

for (const type of ["realtime.connected", "realtime.resync_required"]) {
  test(`${type} catches up both the open detail and its children`, async ({ page }) => {
    const state = await mockWorkCenter(page);
    await page.goto(`/task-manager?task=${parentId}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Подзадач и событий пока нет");
    state.tasks[0].note = "Recovered detail";
    state.tasks.push({ ...state.tasks[0], id: "missed-child", parent_task_id: parentId, title: "Missed child" });
    state.emit(type, "tester");
    await expect(dialog).toContainText("Recovered detail");
    await expect(dialog.getByRole("button", { name: /Missed child/ })).toBeVisible();
  });
}

test("a disconnected socket falls back to refresh without manual reload", async ({ page }) => {
  const state = await mockWorkCenter(page);
  await page.goto(`/task-manager?task=${parentId}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Данные задачи");
  state.disconnect();
  state.tasks[0].note = "Recovered while websocket unavailable";
  await expect(dialog).toContainText("Recovered while websocket unavailable", { timeout: 18_000 });
});

test("remote deletion makes the open task unavailable instead of leaving stale actions", async ({ page }) => {
  const state = await mockWorkCenter(page);
  await page.goto(`/task-manager?task=${parentId}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Данные задачи");
  state.tasks = [];
  await page.route(`**/api/v1/concierge-operational-items/${parentId}`, route => route.fulfill({ status: 404, json: { error: "Not found" } }));
  state.emit("concierge_operational_item.deleted");
  await expect(dialog.getByRole("alert")).toContainText("Задача удалена или больше недоступна");
  await expect(dialog.getByRole("button", { name: "Подзадача", exact: true })).toHaveCount(0);
});

test("events during a slow list request queue one follow-up instead of losing a new child", async ({ page }) => {
  const state = await mockWorkCenter(page);
  await page.goto(`/task-manager?task=${parentId}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Подзадач и событий пока нет");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  await page.route("**/api/v1/concierge-operational-items?**", async route => {
    if (held) return route.fallback();
    held = true;
    const oldRows = structuredClone(state.tasks);
    await gate;
    await route.fulfill({ json: oldRows });
  });
  state.emit("concierge_operational_item.updated");
  await expect.poll(() => held).toBe(true);
  state.tasks.push({ ...state.tasks[0], id: "while-loading", parent_task_id: parentId, title: "Created while loading" });
  state.emit("concierge_operational_item.created", "while-loading");
  state.emit("concierge_operational_item.updated", "other-task");
  release();
  await expect(dialog.getByRole("button", { name: /Created while loading/ })).toBeVisible();
});

test("a failed subtask save keeps the form and retries the same request without duplicates", async ({ page }) => {
  const state = await mockWorkCenter(page);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/v1/concierge-operational-items", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) return route.fulfill({ status: 422, contentType: "text/plain", body: "Invalid task interval" });
    return route.fallback();
  });
  await page.goto(`/task-manager?task=${parentId}`);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Подзадача", exact: true }).click();
  const title = dialog.getByRole("textbox", { name: "Название", exact: true });
  await title.fill("Retry my subtask");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Invalid task interval");
  const reads = state.listReads;
  state.emit("concierge_operational_item.updated");
  await expect.poll(() => state.listReads).toBeGreaterThan(reads);
  await expect(title).toHaveValue("Retry my subtask");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /Retry my subtask/ })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0].request_id).toBe(requests[1].request_id);
  expect(requests[1].parent_task_id).toBe(parentId);
  expect(state.saves).toHaveLength(1);
});
