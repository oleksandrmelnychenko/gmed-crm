import { expect, test, type Page } from "@playwright/test";
import { chooseComboboxOption } from "./helpers";

const orderId = "00000000-0000-0000-0000-000000000901";
const patientId = "00000000-0000-0000-0000-000000000301";

async function prepare(page: Page, lang = "ru") {
  const order = {
    id: orderId, order_number: "A-20260906-0031", patient_id: patientId,
    patient_name: "Toni Müller", patient_pid: "P-20260906-0031", phase: "intake", status: "active",
    total_estimated: "12500", total_actual: "12500", currency: "EUR",
    needs_description: "Abklärung und Koordination der medizinischen Versorgung.",
    signed_patient: true, signed_agency: true,
    created_at: "2026-09-06T12:02:00Z", updated_at: "2026-09-06T12:02:00Z",
    leistungen: [] as Record<string, unknown>[], external_invoices: [] as Record<string, unknown>[],
    process_gates: {
      execution_ready: true, debt_hold: false, overdue_invoice_count: 0,
      billing_release_status: "granted", billing_release_note: "",
      package_coverage_status: "not_covered", package_coverage_note: "",
      blocking_reasons: [],
    },
    planning_preparation: {
      planning_ready: true, treatment_plan_status: "finalized", treatment_plan_note: "Saved plan",
      non_medical_required: false, interpreter_required: false,
      preparation_documents_status: "sent", interpreter_briefing_status: "not_needed",
      medical_total: 1, medical_confirmed: 1, non_medical_total: 0, non_medical_confirmed: 0,
      interpreter_assigned: 0, interpreter_confirmed: 0, blocking_reasons: [],
    },
    execution_flow: {
      closure_ready: true, arrival_status: "arrived", medical_execution_status: "completed",
      non_medical_execution_status: "not_required", interpreter_service_status: "not_required",
      issue_status: "not_required", deviation_note: "", execution_summary: "Saved execution",
      blocking_reasons: [],
    },
    followup_flow: {
      followup_ready: true, doctor_followup_status: "not_required",
      followup_1w_status: "completed", followup_1m_status: "completed", followup_6m_status: "completed",
      package_end_status: "not_required", results_handoff_status: "completed",
      followup_summary: "Saved follow-up", blocking_reasons: [],
    },
    lifecycle: {
      current_stage: "intake", next_stage: "execution",
      allowed_transitions: [{phase: "execution", blocked: false, reasons: []}],
      allowed_status_transitions: [
        {status: "paused", blocked: false, reasons: []},
        {status: "completed", blocked: true, reasons: ["Open services"]},
        {status: "cancelled", blocked: false, reasons: []},
      ],
      history: [{from_stage:"discovery", to_stage:"intake", transition_kind:"manual", note:"Intake history marker", created_at:"2026-09-06T12:02:00Z"}],
    },
  };
  const economics = {
    order_id: orderId, currency: "EUR", economics_valid: true, margin_visible: true,
    planned: { revenue_net:"12500", revenue_gross:"14875", partner_cost_net:"4500", margin_net:"8000" },
    actual: {
      recognized_revenue_net:"12500", patient_cash_collected_gross:"10000",
      invoice_outstanding_gross:"4875", paid_directly_by_patient_gross:"0",
      partner_cost_net:"4500", paid_to_partner_gross:"3000", unpaid_to_partner_gross:"1500",
      margin_net:"8000", margin_percent:"64",
    },
    warnings: [], services: [] as Record<string, unknown>[],
  };
  const writes: Array<{path: string; body: Record<string, unknown>}> = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(language => {
    localStorage.setItem("gmed_access_token", "order-test-token");
    localStorage.setItem("gmed_refresh_token", "order-test-refresh");
    localStorage.setItem("gmed_lang", language);
  }, lang);
  await page.routeWebSocket("**/api/**", socket => socket.close());
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() ?? {};
      writes.push({path, body});
      if (path.endsWith("/planning-preparation")) Object.assign(order.planning_preparation, body);
      if (path.endsWith("/execution-flow")) Object.assign(order.execution_flow, body);
      if (path.endsWith("/followup-flow")) Object.assign(order.followup_flow, body);
      if (path.endsWith("/process-gates")) Object.assign(order.process_gates, body);
      if (path.endsWith("/status")) order.status = body.status;
      if (path.endsWith("/phase")) { order.phase = body.phase; order.lifecycle.current_stage = body.phase; }
    }
    let body: unknown = [];
    if (path === "/me") body = {id:"order-test-user", email:"order@example.org", name:"Order QA", role:"ceo", created_at:"2026-01-01T00:00:00Z"};
    if (path === "/auth/refresh") body = {access_token:"order-test-token", refresh_token:"order-test-refresh", expires_in:900};
    if (path === "/orders/" + orderId) body = order;
    if (path === "/orders/" + orderId + "/economics") body = economics;
    if (path === "/orders/" + orderId + "/group") body = {head:{...order, order_role:"standalone"}, subs:[], covered_patient_ids:[patientId], rollup_total_estimated:order.total_estimated};
    if (path === "/orders/" + orderId + "/workflow-checklist") body = {scope_type:"order", scope_id:orderId, open_count:0, completed_count:0, items:[]};
    if (path === "/orders") body = [order];
    if (path === "/patients") body = [{id:patientId, first_name:"Toni", last_name:"Müller", patient_id:"P-20260906-0031"}];
    if (path.includes("taxonomy")) body = {nodes:[]};
    if (path === "/stats/overview") body = {};
    await route.fulfill({json:body});
  });
  return {order, economics, writes, errors};
}

async function refresh(page: Page, type = "order.process_gates_updated") {
  await page.evaluate(({id, type}) => window.dispatchEvent(new CustomEvent("gmed:realtime-event", {
    detail: {type, entity_type:"order", entity_id:id, payload:{order_id:id}},
  })), {id:orderId, type});
}

for (const lang of ["ru", "de"]) {
  test(`service economics table sorts numbers and preserves hidden margins in ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 1720, height: 1120 });
    const { economics, errors } = await prepare(page, lang);
    economics.services = [
      { order_leistung_id: "s1", name: "Visa Support", planned_revenue_net: "10", actual_revenue_net: "0", planned_partner_cost_net: "1", actual_partner_cost_net: "0", margin_net: "0" },
      { order_leistung_id: "s2", name: "Beratung", planned_revenue_net: "2", actual_revenue_net: "0", planned_partner_cost_net: "1", actual_partner_cost_net: "0", margin_net: "0" },
      { order_leistung_id: "s3", name: "Transfer", planned_revenue_net: "120", actual_revenue_net: "0", planned_partner_cost_net: null, actual_partner_cost_net: null, margin_net: null },
    ];
    await page.goto(`/orders/${orderId}`);
    const section = page.getByTestId("order-economics-table");
    const table = section.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveCount(6);
    await section.scrollIntoViewIfNeeded();
    await table.locator('[role="columnheader"][data-column-id="planned_revenue_net"]').click();
    await expect(table.locator('[role="row"][aria-rowindex="2"]')).toContainText("Beratung");
    await expect(table).toContainText(lang === "ru" ? "Нельзя рассчитать" : "Nicht berechenbar");
    await page.screenshot({ path: `../artifacts/design-qa/order-economics-table-${lang}-desktop.png`, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await section.scrollIntoViewIfNeeded();
    const box = (await section.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `../artifacts/design-qa/order-economics-table-${lang}-mobile.png`, animations: "disabled" });

    economics.margin_visible = false;
    await page.setViewportSize({ width: 1720, height: 1120 });
    await page.reload();
    await expect(table.getByRole("columnheader")).toHaveCount(3);
    await section.getByRole("button", { name: lang === "ru" ? /Колонки/ : /Spalten/ }).click();
    await expect(section.getByRole("menuitemcheckbox")).toHaveCount(3);
    expect(errors).toEqual([]);
  });
}

test("orders list loads patient context on the first request and shows delayed rows", async ({page}) => {
  const {order, errors} = await prepare(page);
  const requests: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/v1\/orders(?:\?.*)?$/, async route => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    await pending;
    await route.fulfill({json: url.searchParams.get("patient_id") === patientId ? [order] : []});
  });
  await page.goto(`/orders?patient=${patientId}`);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  release();
  const row = page.getByRole("row").filter({hasText: order.order_number});
  await expect(row).toBeVisible();
  expect(requests.every(query => new URLSearchParams(query).get("patient_id") === patientId)).toBe(true);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/orders/${orderId}\\?patient=${patientId}$`));
  await expect(page.getByRole("heading", {name:"Toni Müller", exact:true})).toBeVisible();
  await page.goBack();
  await expect(row).toBeVisible();
  expect(errors).toEqual([]);
});

test("orders table sorts all records before paginating", async ({page}) => {
  const {order} = await prepare(page);
  const rows = Array.from({length: 60}, (_, index) => ({...order, id: `order-${index}`, order_number: `A-${String(index + 1).padStart(3, "0")}`}));
  await page.route(/\/api\/v1\/orders(?:\?.*)?$/, route => route.fulfill({json: rows}));
  await page.goto("/orders");
  const header = page.getByRole("columnheader").filter({hasText: /^Заказ/});
  await header.click();
  await header.click();
  await expect(page.getByRole("row").filter({hasText:"A-060"})).toBeVisible();
  await expect(page.getByRole("row").filter({hasText:"A-001"})).toHaveCount(0);
});

test("orders list ignores an empty lookup cached by the contracts screen", async ({page}) => {
  const {order, errors} = await prepare(page);
  let currentOrders = false;
  let requests = 0;
  await page.route(/\/api\/v1\/orders$/, route => {
    requests++;
    return route.fulfill({json: currentOrders ? [order] : []});
  });
  await page.goto("/contracts");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(page.locator('a[href="/orders"]').first()).toBeVisible();
  currentOrders = true;
  await page.locator('a[href="/orders"]').first().click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole("row").filter({hasText:order.order_number})).toBeVisible();
  expect(errors).toEqual([]);
});

for (const event of ["realtime.connected", "realtime.resync_required"]) {
  test(`orders list reloads after ${event}`, async ({page}) => {
    const {order} = await prepare(page);
    let currentOrders = false;
    await page.route(/\/api\/v1\/orders$/, route => route.fulfill({json:currentOrders ? [order] : []}));
    await page.goto("/orders");
    await expect(page.getByRole("heading", {name:"Заказы не найдены", exact:true})).toBeVisible();
    currentOrders = true;
    await refresh(page, event);
    await expect(page.getByRole("row").filter({hasText:order.order_number})).toBeVisible();
  });
}

test("orders refresh replaces a pending request instead of reusing its stale result", async ({page}) => {
  const {order, errors} = await prepare(page);
  let requests = 0;
  let refreshing = false;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/v1\/orders$/, async route => {
    requests++;
    if (!refreshing) {
      await pending;
      return route.fulfill({json:[]});
    }
    return route.fulfill({json:[order]});
  });
  try {
    await page.goto("/orders");
    await expect.poll(() => requests).toBeGreaterThan(0);
    const initialRequests = requests;
    refreshing = true;
    await page.getByRole("button", {name:"Обновить", exact:true}).click();
    await expect.poll(() => requests).toBeGreaterThan(initialRequests);
    await expect(page.getByRole("row").filter({hasText:order.order_number})).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByRole("row").filter({hasText:order.order_number})).toBeVisible();
  expect(errors).toEqual([]);
});

for (const lang of ["ru", "de"]) {
  for (const width of [1440, 390]) {
    test(`order overview stays readable in ${lang} at ${width}`, async ({page}) => {
      await page.setViewportSize({width, height:1000});
      const {errors} = await prepare(page, lang);
      await page.goto(`/orders/${orderId}`);
      const heading = page.getByRole("heading", {name:"Toni Müller", exact:true});
      await expect(heading).toBeVisible();
      expect((await heading.boundingBox())!.width).toBeGreaterThan(width === 390 ? 250 : 500);
      const economics = page.locator("section").filter({has:page.getByRole("heading", {name:lang === "de" ? "Wirtschaftlichkeit des Auftrags" : "Экономика заказа", exact:true})});
      await expect(economics.locator("dd")).toHaveCount(12);
      const overflow = await economics.locator("dd").evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
      expect(overflow).toEqual([]);
      await page.screenshot({path:`../artifacts/design-qa/order-overview-${lang}-${width}.png`, fullPage:true});
      await page.locator("#main-content").evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.screenshot({path:`../artifacts/design-qa/order-overview-bottom-${lang}-${width}.png`, fullPage:true});
      expect(errors).toEqual([]);
    });
  }
}

test("advance phase prevents duplicate requests and shows a server error in the current view", async ({page}) => {
  await prepare(page);
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  let requests = 0;
  await page.route(`**/orders/${orderId}/phase`, async route => {
    requests++;
    await waiting;
    await route.fulfill({status:409, json:{error:"Phase is blocked by a new invoice"}});
  });
  await page.goto(`/orders/${orderId}`);
  const advance = page.getByRole("button", {name:/Перевести в/});
  await advance.click();
  const disabled = await advance.isDisabled();
  finish();
  expect(disabled).toBe(true);
  await expect(page.getByRole("alert")).toContainText("Phase is blocked by a new invoice");
  await expect(advance).toBeEnabled();
  expect(requests).toBe(1);
});

test("background updates preserve an edited planning note and saving makes it clean", async ({page}) => {
  const {order, writes} = await prepare(page);
  await page.goto(`/orders/${orderId}?section=planning`);
  const note = page.locator("textarea").filter({hasText:"Saved plan"});
  await expect(note).toBeVisible();
  await note.fill("Unsent planning note");
  order.total_estimated = "13500";
  await refresh(page);
  await expect(page.getByText(/Брутто:.*13.500|Брутто:.*13 500/)).toBeVisible();
  await expect(page.locator("textarea").first()).toHaveValue("Unsent planning note");
  const save = page.getByRole("button", {name:/Сохранить/}).last();
  await save.click();
  await expect.poll(() => writes.filter(write => write.path.endsWith("/planning-preparation")).length).toBe(1);
  await expect(save).toBeDisabled();
});

test("readiness exposes lifecycle history and realtime phase changes update navigation", async ({page}) => {
  const {order} = await prepare(page);
  await page.goto(`/orders/${orderId}?section=gates&taxonomy=specialty-1`);
  await expect(page.getByText("Intake history marker", {exact:true})).toBeVisible();
  order.phase = "execution";
  await refresh(page, "order.phase_changed");
  const execution = page.locator('[data-workspace-rail="order"]').getByRole("link", {name:"Исполнение", exact:true});
  await expect(execution).toBeVisible();
  await expect(execution).toHaveAttribute("href", /taxonomy=specialty-1/);
});

for (const width of [1440, 390]) {
  test(`every order subsection is reachable and renders without errors at ${width}`, async ({page}) => {
    await page.setViewportSize({width, height:1000});
    const {order, errors} = await prepare(page);
    order.phase = "closure";
    await page.goto(`/orders/${orderId}`);
    const rail = page.locator(`[data-workspace-rail="${width === 390 ? "order-mobile" : "order"}"]`);
    for (const section of ["gates", "planning", "execution", "followup", "workflow", "services", "invoices"]) {
      const link = rail.locator(`a[href*="section=${section}"]`);
      await link.click();
      await expect(link).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", {name:"Toni Müller", exact:true})).toBeVisible();
      expect(errors).toEqual([]);
      const main = page.locator("#main-content");
      expect(await main.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await main.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.screenshot({path:`../tmp/order-${section}-${width}.png`});
    }
  });
}

for (const [section, note, endpoint] of [
  ["execution", "Saved execution", "execution-flow"],
  ["followup", "Saved follow-up", "followup-flow"],
]) {
  test(`${section} saves edited notes and retains edits after background updates`, async ({page}) => {
    const {order, writes} = await prepare(page);
    order.phase = "closure";
    await page.goto(`/orders/${orderId}?section=${section}`);
    const input = page.locator("textarea").filter({hasText:note});
    await input.fill("Updated note");
    const response = page.waitForResponse(res => res.url().endsWith(`/orders/${orderId}`));
    await refresh(page);
    await response;
    const edited = page.locator("textarea").filter({hasText:"Updated note"});
    await expect(edited).toHaveValue("Updated note");
    const save = page.getByRole("button", {name:/Сохранить/}).last();
    await save.click();
    await expect.poll(() => writes.filter(write => write.path.endsWith(endpoint)).length).toBe(1);
    await expect(save).toBeDisabled();
  });
}

test("a failed background refresh leaves the form editable and its error visible", async ({page}) => {
  await prepare(page);
  await page.goto(`/orders/${orderId}?section=planning`);
  const note = page.locator("textarea").first();
  await note.fill("Keep this note");
  await page.route(`**/api/v1/orders/${orderId}`, route => route.fulfill({status:503, json:{error:"Temporary outage"}}));
  await refresh(page);
  await expect(page.getByText("Temporary outage", {exact:true})).toBeVisible();
  await expect(note).toHaveValue("Keep this note");
  await expect(note).toBeEditable();
});

test("saving a normalized note clears the dirty state", async ({page}) => {
  const {writes} = await prepare(page);
  await page.goto(`/orders/${orderId}?section=planning`);
  const note = page.locator("textarea").first();
  await note.fill("  Trimmed planning note  ");
  const save = page.getByRole("button", {name:/Сохранить/}).last();
  await save.click();
  await expect(save).toBeDisabled();
  await expect(note).toHaveValue("Trimmed planning note");
  expect(writes.find(write => write.path.endsWith("/planning-preparation"))?.body.treatment_plan_note)
    .toBe("Trimmed planning note");
});

test("opening debt management preserves other readiness drafts", async ({page}) => {
  await prepare(page);
  await page.goto(`/orders/${orderId}?section=gates`);
  const note = page.locator("textarea").first();
  await note.fill("Unsent billing release note");
  await page.getByRole("button", {name:"Редактировать", exact:true}).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", {name:"Отмена", exact:true}).click();
  await expect(note).toHaveValue("Unsent billing release note");
});

test("successful phase and status changes update the workspace", async ({page}) => {
  const {order, writes} = await prepare(page);
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByRole("button", {name:"Завершить", exact:true})).toBeDisabled();
  await page.getByRole("button", {name:/Перевести в/}).click();
  await expect.poll(() => order.phase).toBe("execution");
  await expect(page.locator('[data-workspace-rail="order"]').getByRole("link", {name:"Исполнение", exact:true})).toBeVisible();
  await page.getByRole("button", {name:"Приостановить", exact:true}).click();
  await expect.poll(() => order.status).toBe("paused");
  await expect(page.getByRole("button", {name:/Перевести в/})).toBeDisabled();
  expect(writes.filter(write => write.path.endsWith("/phase"))).toHaveLength(1);
  expect(writes.filter(write => write.path.endsWith("/status"))).toHaveLength(1);
});

test("workflow creation keeps the draft and shows request errors inside its sheet", async ({page}) => {
  const {writes} = await prepare(page);
  await page.goto(`/orders/${orderId}?section=workflow`);
  await page.getByRole("button", {name:"Добавить пункт", exact:true}).click();
  const sheet = page.getByRole("dialog", {name:"Новый пункт процесса", exact:true});
  await sheet.locator("#order-workflow-item-sheet").fill("QA workflow task");
  await page.route(`**/orders/${orderId}/workflow-checklist`, route => route.request().method() === "POST"
    ? route.fulfill({status:409, json:{error:"Workflow changed; try again"}}) : route.fallback());
  await sheet.getByRole("button", {name:"Добавить пункт", exact:true}).click();
  await expect(sheet.getByText("Workflow changed; try again", {exact:true})).toBeVisible();
  await expect(sheet.locator("#order-workflow-item-sheet")).toHaveValue("QA workflow task");
  await page.unroute(`**/orders/${orderId}/workflow-checklist`);
  await sheet.getByRole("button", {name:"Добавить пункт", exact:true}).click();
  await expect(sheet).toBeHidden();
  expect(writes.find(write => write.path.endsWith("/workflow-checklist"))?.body.item_text).toBe("QA workflow task");
});

test("incoming invoice requires an explicit gross amount and balanced totals", async ({page}) => {
  const {writes} = await prepare(page);
  await page.goto(`/orders/${orderId}?section=invoices`);
  await page.getByRole("button", {name:"Зарегистрировать внешний счёт", exact:true}).click();
  const sheet = page.getByRole("dialog", {name:"Зарегистрировать внешний счёт", exact:true});
  await sheet.getByLabel("Номер счёта", {exact:true}).fill("QA-INVOICE-1");
  const submit = sheet.locator('button[type="submit"]');
  await submit.click();
  await expect(sheet.getByRole("alert")).toBeVisible();
  expect(writes.filter(write => write.path.endsWith("/external-invoices"))).toHaveLength(0);
  await sheet.getByLabel("Нетто", {exact:true}).fill("100");
  await sheet.getByLabel("НДС", {exact:true}).fill("19");
  await sheet.getByLabel("Брутто", {exact:true}).fill("120");
  await submit.click();
  await expect(sheet.getByRole("alert")).toContainText("должна быть равна");
  await sheet.getByLabel("Брутто", {exact:true}).fill("119");
  await submit.click();
  await expect(sheet).toBeHidden();
  expect(writes.find(write => write.path.endsWith("/external-invoices"))?.body).toMatchObject({amount_net:100, amount_vat:19, amount_gross:119});
});

test("a manual service requires an explicit unit price before saving", async ({page}) => {
  const {writes} = await prepare(page);
  await page.goto(`/orders/${orderId}?section=services`);
  await page.getByRole("button", {name:"Добавить услугу", exact:true}).click();
  const sheet = page.getByRole("dialog", {name:"Добавить услугу", exact:true});
  await sheet.getByLabel("Описание", {exact:true}).fill("QA service");
  await sheet.getByRole("button", {name:"Сохранить", exact:true}).click();
  await expect(sheet.getByRole("alert")).toBeVisible();
  expect(writes.filter(write => write.path.endsWith("/leistungen"))).toHaveLength(0);
  await sheet.getByLabel("Цена за единицу (EUR)", {exact:true}).fill("100,50");
  await sheet.getByRole("button", {name:"Сохранить", exact:true}).click();
  await expect(sheet).toBeHidden();
  expect(writes.find(write => write.path.endsWith("/leistungen"))?.body).toMatchObject({description:"QA service", unit_price:100.5});
});

test("a rejected invoice-to-service link is visible on the invoice page", async ({page}) => {
  const {order} = await prepare(page);
  order.leistungen.push({id:"service-1", description:"QA service", quantity:"1", unit_price:"100", currency:"EUR", vat_rate:"19", status:"planned", notes:null});
  order.external_invoices.push({
    id:"external-1", external_invoice_number:"QA-INVOICE-1", status:"received", paid_by:"unpaid",
    amount_net:"100", amount_vat:"19", amount_gross:"119", currency:"EUR", service_delivered:false,
    patient_receivable_gross:"0", allocated_receivable_gross:"0", remaining_receivable_gross:"0", provider_liability_gross:"119",
  });
  await page.route(`**/orders/${orderId}/external-invoices/external-1/update`, route => route.fulfill({status:409, json:{error:"Invoice link rejected"}}));
  await page.goto(`/orders/${orderId}?section=invoices`);
  await chooseComboboxOption(page, page.getByRole("combobox", {name:"Связанная услуга"}), "QA service");
  await expect(page.getByText("Invoice link rejected", {exact:true})).toBeVisible();
});

test("amount amendments accept decimal commas and reject zero", async ({page}) => {
  const {writes} = await prepare(page);
  await page.goto(`/orders/${orderId}?section=services`);
  const delta = page.getByRole("textbox", {name:"Изменение суммы", exact:true});
  await page.getByRole("textbox", {name:"Что согласовано с пациентом", exact:true}).fill("QA agreed change");
  const propose = page.getByRole("button", {name:"Предложить", exact:true});
  await delta.fill("0");
  await expect(propose).toBeDisabled();
  await delta.fill("9,50");
  await propose.click();
  await expect(delta).toHaveValue("");
  expect(writes.find(write => write.path.endsWith("/amendments"))?.body)
    .toMatchObject({delta_amount:"9.50", agreed_note:"QA agreed change"});
});

test("approving an amount amendment refreshes the order total", async ({page}) => {
  const {order} = await prepare(page);
  const amendment = {id:"amendment-1", order_id:orderId, delta_amount:"100", agreed_note:"QA agreed change", status:"pending", currency:"EUR", created_at:"2026-09-06T12:02:00Z"};
  await page.route(`**/orders/${orderId}/amendments`, route => route.fulfill({json:[amendment]}));
  await page.route(`**/orders/${orderId}/amendments/amendment-1/decision`, route => {
    order.total_estimated = "12600";
    amendment.status = "approved";
    return route.fulfill({json:{amendment, order_total_estimated:"12600"}});
  });
  await page.goto(`/orders/${orderId}?section=services`);
  await page.getByRole("button", {name:"Одобрить", exact:true}).click();
  await expect(page.getByText("Одобрено", {exact:true})).toBeVisible();
  await expect(page.getByText(/Брутто:.*12.600|Брутто:.*12 600/)).toBeVisible();
});

test("a failed amendment load is visible and can be retried", async ({page}) => {
  await prepare(page);
  await page.route(`**/orders/${orderId}/amendments`, route => route.fulfill({status:503, json:{error:"Amendments unavailable"}}));
  await page.goto(`/orders/${orderId}?section=services`);
  await expect(page.getByRole("alert")).toContainText("Amendments unavailable");
  await expect(page.getByText("Изменений пока нет.", {exact:true})).toBeHidden();
  await page.unroute(`**/orders/${orderId}/amendments`);
  await page.getByRole("button", {name:"Повторить загрузку", exact:true}).click();
  await expect(page.getByText("Изменений пока нет.", {exact:true})).toBeVisible();
});

test("invoice allocation validates capacity, accepts commas and retries with the same request ID", async ({page}) => {
  const {order} = await prepare(page);
  order.external_invoices.push({id:"external-1", external_invoice_number:"QA-INVOICE-1", status:"approved", paid_by:"unpaid", amount_net:"100", amount_vat:"19", amount_gross:"119", currency:"EUR", patient_receivable_gross:"100", remaining_receivable_gross:"100", allocated_receivable_gross:"0", provider_liability_gross:"119"});
  const workspace = {
    order_id:orderId, external_invoice_id:"external-1", external_invoice_number:"QA-INVOICE-1", currency:"EUR", status:"approved",
    patient_receivable_gross:"100", allocated_receivable_gross:"0", remaining_receivable_gross:"100", allocations:[],
    candidate_invoices:[{id:"patient-invoice-1", invoice_number:"QA-PATIENT-1", total_gross:"50", balance_due:"50", allocatable_capacity:"25"}],
  };
  const attempts: Array<Record<string, unknown>> = [];
  await page.route(`**/orders/${orderId}/external-invoices/external-1/allocations`, route => {
    if (route.request().method() === "POST") {
      attempts.push(route.request().postDataJSON());
      if (attempts.length === 1) return route.fulfill({status:503, json:{error:"Allocation temporarily unavailable"}});
      workspace.allocated_receivable_gross = "10.50";
      workspace.remaining_receivable_gross = "89.50";
      workspace.candidate_invoices[0].allocatable_capacity = "14.50";
      return route.fulfill({json:{id:"allocation-1"}});
    }
    return route.fulfill({json:workspace});
  });
  await page.goto(`/orders/${orderId}?section=invoices`);
  await page.getByRole("button", {name:"Связать со счётом пациента", exact:true}).click();
  const sheet = page.getByRole("dialog", {name:"Связать со счётом пациента", exact:true});
  const amount = sheet.getByLabel("Сумма требования к распределению", {exact:true});
  await expect(amount).toHaveValue("25.00");
  const save = sheet.getByRole("button", {name:"Сохранить распределение", exact:true});
  for (const invalid of ["", "0", "-5", "26", "bad"]) {
    await amount.fill(invalid);
    await expect(save).toBeDisabled();
  }
  await amount.fill("10,50");
  await save.click();
  await expect(sheet.getByRole("alert")).toContainText("Allocation temporarily unavailable");
  await expect(amount).toHaveValue("10,50");
  await save.click();
  await expect(amount).toHaveValue("14.50");
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toMatchObject({amount_gross:"10.50", patient_invoice_id:"patient-invoice-1"});
  expect(attempts[1].request_id).toBe(attempts[0].request_id);
});
