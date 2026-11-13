import { expect, test, type Page } from "@playwright/test";
import { chooseComboboxOption, pickerSection, pickerValueInput } from "./helpers";

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
    // The cancel dialog asks the server what cancelling a line does; none of these lines is invoiced.
    const preview = path.match(/^\/orders\/[^/]+\/leistungen\/([^/]+)\/cancellation-preview$/);
    if (preview) {
      const line: Record<string, unknown> = order.leistungen.find(item => item.id === preview[1]) ?? {};
      body = {
        order_leistung_id:preview[1], order_id:orderId, status:line.status, description:line.description,
        quantity:line.quantity, line_gross:"0", currency:"EUR", draft_invoice_ids:[], requires_credit_note:false,
        credit_total_gross:"0", credit_notes:[], blocked_reason:line.status === "cancelled" ? "order_service_already_cancelled" : null,
        can_issue_credit_note:true,
      };
    }
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

// The overview shows the headline money tiles; the full calculation, including
// the per-service table, sits in a collapsed disclosure below them.
function orderFinance(page: Page, lang = "ru") {
  return page.locator("section").filter({has:page.getByRole("heading", {name:lang === "de" ? "Finanzen des Auftrags" : "Деньги по заказу", exact:true})});
}

async function openFullEconomics(page: Page, lang = "ru") {
  const summary = orderFinance(page, lang).locator("summary", {hasText:lang === "de" ? "Vollständige Finanzübersicht" : "Показать полный финансовый расчёт"});
  await summary.click();
  await expect(summary.locator("xpath=..")).toHaveAttribute("open", "");
}

// Order total tile in the workspace header, shown on every section.
function orderTotal(page: Page) {
  return page.locator("dt", {hasText:/^Сумма заказа$/}).first().locator("xpath=following-sibling::dd");
}

// The status transitions sit in a menu; its items are menuitems.
async function openOrderActions(page: Page) {
  await page.getByRole("button", {name:"Управление заказом"}).click();
  await expect(page.getByRole("menu")).toBeVisible();
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
    await openFullEconomics(page, lang);
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
    await openFullEconomics(page, lang);
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
      // The compact header shares the name row with the action buttons; the
      // name still gets a readable column and is never clipped.
      const heading = page.getByRole("heading", {name:"Toni Müller", exact:true});
      await expect(heading).toBeVisible();
      expect((await heading.boundingBox())!.width).toBeGreaterThan(width === 390 ? 250 : 300);
      expect(await heading.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      const economics = orderFinance(page, lang);
      // Four headline tiles, then plan (4) and actual state (11: billed, received, open,
      // open invoices, advance available, patient credit, paid directly, and four margin
      // tiles) once the full calculation is open.
      await expect(economics.locator("dd:visible")).toHaveCount(4);
      await openFullEconomics(page, lang);
      await expect(economics.locator("dd:visible")).toHaveCount(19);
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
  const advance = page.getByRole("button", {name:/Перейти в Исполнение/});
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
  await expect(orderTotal(page)).toHaveText(/12.500|12 500/);
  order.total_estimated = "13500";
  await refresh(page);
  await expect(orderTotal(page)).toHaveText(/13.500|13 500/);
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

test("planning starts a new appointment of the order and comes back to it", async ({page}) => {
  await prepare(page);
  await page.goto(`/orders/${orderId}?section=planning`);
  const link = page.getByRole("link", {name:"Новый приём"});
  await expect(link).toBeVisible();
  const href = new URL((await link.getAttribute("href")) ?? "", "http://gmed.test");
  expect(href.pathname).toBe("/appointments");
  expect(href.searchParams.get("order")).toBe(orderId);
  expect(href.searchParams.get("create")).toBe("1");
  expect(href.searchParams.get("return_to")).toContain(`/orders/${orderId}`);
  expect(href.searchParams.get("return_to")).toContain("section=planning");
});

test("planning lists the order's appointments by day and by doctor (plan stage 2)", async ({page}) => {
  await prepare(page);
  const item = (id: string, overrides: Record<string, unknown>) => ({
    id, title: id, appointment_type: "medical", time_start: null, time_end: null, status: "planned", location: null,
    provider_name: "Klinik Nord", doctor_name: "Dr. Weber", interpreter_name: null, interpreter_response: null, ...overrides,
  });
  await page.route(`**/api/v1/orders/${orderId}/pipeline`, route => route.fulfill({json: {
    order_id: orderId, phase: "intake", status: "active", stages: [], medical: {visible: false, required: false}, appointments: [
      item("MRT Abdomen", {date: "2026-11-02", time_start: "08:30:00", time_end: "09:30:00"}),
      item("Kardiologie", {date: "2026-11-03", doctor_name: "Dr. Klein", interpreter_name: "Olga Test"}),
      item("Nachbesprechung", {date: "2026-11-03", time_start: "13:00:00"}),
      item("Abgesagt", {date: "2026-11-04", status: "cancelled"}),
    ],
  }}));
  await page.goto(`/orders/${orderId}?section=planning`);
  const plan = page.getByTestId("order-planned-appointments");
  // A planner starts with the doctors (plan stage 3).
  await plan.getByRole("button", {name: "По дням"}).click();
  await expect(plan.getByRole("heading", {level: 3})).toHaveText(["Пн, 02.11.2026", "Вт, 03.11.2026"]);
  await expect(plan).toContainText("08:30–09:30");
  await expect(plan).toContainText("Переводчик: Olga Test");
  await expect(plan).not.toContainText("Abgesagt");
  await plan.getByRole("button", {name: "По врачам"}).click();
  await expect(plan.getByRole("heading", {level: 3})).toHaveText([/Dr. Weber.*Klinik Nord/, /Dr. Klein.*Klinik Nord/]);
  const followup = plan.getByRole("listitem").filter({has: page.getByRole("link", {name: "Nachbesprechung", exact: true})});
  await expect(followup).toContainText("Вт, 03.11.2026");
  await expect(followup).toContainText("13:00");
  const href = await plan.getByRole("link", {name: "MRT Abdomen"}).getAttribute("href");
  expect(href).toContain("appointment=MRT%20Abdomen");
  expect(href).toContain("return_to=");
});

test("planning adds visits right under the doctors and a new doctor (plan stage 3)", async ({page}) => {
  await prepare(page);
  const created: Array<Record<string, unknown>> = [];
  let pipelineLoads = 0;
  const pipeline = () => ({
    order_id: orderId, phase: "intake", status: "active", stages: [], medical: {visible: false, required: false},
    care_team: [
      {provider_id: "klinik", provider_name: "Klinik Nord", provider_type: "medical", doctor_id: "weber", doctor_name: "Dr. Weber",
       doctor_title: null, doctor_specialty: null, services: 1, appointments: 1},
      {provider_id: "klinik", provider_name: "Klinik Nord", provider_type: "medical", doctor_id: "klein", doctor_name: "Dr. Klein",
       doctor_title: null, doctor_specialty: null, services: 1, appointments: 0},
      {provider_id: "hotel", provider_name: "Hotel Mitte", provider_type: "non_medical", doctor_id: null, doctor_name: null,
       doctor_title: null, doctor_specialty: null, services: 1, appointments: 0},
    ],
    appointments: [
      {id: "visit-1", title: "Kardiologie", appointment_type: "medical", date: "2026-11-16", time_start: "08:30", time_end: "09:30",
       status: "planned", location: "Klinik Nord", provider_id: "klinik", provider_name: "Klinik Nord", doctor_id: "weber",
       doctor_name: "Dr. Weber", interpreter_name: null, interpreter_response: null},
    ],
  });
  await page.route(`**/api/v1/orders/${orderId}/pipeline`, route => {
    pipelineLoads += 1;
    return route.fulfill({json: pipeline()});
  });
  await page.route(/\/api\/v1\/appointments$/, route => {
    if (route.request().method() !== "POST") return route.fallback();
    created.push(route.request().postDataJSON());
    return route.fulfill({json: {id: `new-${created.length}`}});
  });
  await page.route(/\/api\/v1\/providers(\?.*)?$/, route => route.fulfill({json: [
    {id: "labor", name: "Labor Süd", provider_type: "medical", address_city: "Berlin", fachbereich: null},
    {id: "hotel", name: "Hotel Mitte", provider_type: "non_medical", address_city: "Berlin", fachbereich: null},
  ]}));
  await page.route("**/api/v1/providers/labor/doctors", route => route.fulfill({json: [
    {id: "roth", name: "Dr. Roth", title: null, fachbereich: null},
  ]}));

  await page.goto(`/orders/${orderId}?section=planning`);
  const plan = page.getByTestId("order-planned-appointments");
  // A planner starts on the grid (plan stage 6); the rows stay under «По врачам».
  await plan.getByRole("button", {name: "По врачам"}).click();
  await expect(plan.getByRole("heading", {level: 3})).toHaveText([/Dr. Weber/, /Dr. Klein/]);
  await expect(plan.getByTestId("order-appointment-entry")).toHaveCount(2);

  // Weber's row starts on his last visit day; Klein has no visit yet.
  const weberRow = plan.getByTestId("order-appointment-entry").first();
  const pickerValue = (label: RegExp) =>
    pickerValueInput(weberRow, label);
  const typeInto = async (label: RegExp, digits: string) => {
    await weberRow.getByRole("group", {name: label}).getByRole("spinbutton").first().click();
    await page.keyboard.type(digits, {delay: 120});
  };
  await expect(pickerValue(/^Дата/)).toHaveValue("16.11.2026");
  await weberRow.getByRole("button", {name: "Добавить"}).click();
  await expect(weberRow.getByRole("alert")).toContainText("Название");
  expect(created).toHaveLength(0);

  const loadsBefore = pipelineLoads;
  await typeInto(/^Начало/, "1300");
  await typeInto(/^Конец/, "1330");
  await weberRow.getByRole("textbox", {name: "Название"}).fill("Nachbesprechung");
  await weberRow.getByRole("button", {name: "Добавить"}).click();
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({
    patient_id: patientId, order_id: orderId, provider_id: "klinik", doctor_id: "weber",
    appointment_type: "medical", title: "Nachbesprechung", date: "2026-11-16", time_start: "13:00", time_end: "13:30",
    location: "Klinik Nord",
  });
  await expect(weberRow.getByRole("textbox", {name: "Название"})).toHaveValue("");
  await expect(pickerValue(/^Дата/)).toHaveValue("16.11.2026");
  await expect.poll(() => pipelineLoads).toBeGreaterThan(loadsBefore);

  // A doctor outside the order joins the plan with a row of his own.
  await plan.getByRole("button", {name: "Добавить врача"}).click();
  const picker = plan.getByTestId("order-planning-doctor-picker");
  await picker.getByRole("combobox", {name: "Клиника / провайдер"}).click();
  await expect(page.getByRole("option", {name: /Hotel Mitte/})).toHaveCount(0);
  await page.keyboard.press("Escape");
  await chooseComboboxOption(page, picker.getByRole("combobox", {name: "Клиника / провайдер"}), /Labor Süd/);
  await chooseComboboxOption(page, picker.getByRole("combobox", {name: "Врач"}), "Dr. Roth");
  await picker.getByRole("button", {name: "Добавить"}).click();
  await expect(plan.getByRole("heading", {level: 3})).toHaveText([/Dr. Weber/, /Dr. Klein/, /Dr. Roth.*Labor Süd/]);
  await expect(plan.getByTestId("order-appointment-entry")).toHaveCount(3);
});

test("planning lays doctors out on the grid and creates every visit at once (plan stage 6)", async ({page}) => {
  await page.clock.setFixedTime(new Date("2026-11-13T09:00:00+01:00"));
  await prepare(page);
  const batches: Array<{dry_run: boolean; items: Array<Record<string, unknown>>}> = [];
  let busyQuery = "";
  await page.route(`**/api/v1/orders/${orderId}/pipeline`, route => route.fulfill({json: {
    order_id: orderId, phase: "intake", status: "active", stages: [], medical: {visible: false, required: false},
    care_team: [
      {provider_id: "klinik", provider_name: "Klinik Nord", provider_type: "medical", doctor_id: "weber", doctor_name: "Dr. Weber",
       doctor_title: null, doctor_specialty: null, services: 1, appointments: 1},
      {provider_id: "klinik", provider_name: "Klinik Nord", provider_type: "medical", doctor_id: "klein", doctor_name: "Dr. Klein",
       doctor_title: null, doctor_specialty: null, services: 1, appointments: 0},
    ],
    appointments: [
      {id: "visit-1", title: "Kardiologie", appointment_type: "medical", date: "2026-11-16", time_start: "08:30", time_end: "09:30",
       status: "planned", location: "Klinik Nord", provider_id: "klinik", provider_name: "Klinik Nord", doctor_id: "weber",
       doctor_name: "Dr. Weber", interpreter_name: null, interpreter_response: null, portal_released_at: null},
    ],
  }}));
  await page.route(`**/api/v1/orders/${orderId}/appointments/busy**`, route => {
    busyQuery = new URL(route.request().url()).search;
    return route.fulfill({json: {items: [
      {id: "visit-1", date: "2026-11-16", time_start: "08:30", time_end: "09:30", scopes: ["patient"], doctor_id: null,
       interpreter_id: null, title: "Kardiologie", same_order: true},
      {id: null, date: "2026-11-17", time_start: "10:00", time_end: "11:00", scopes: ["doctor"], doctor_id: "klein",
       interpreter_id: null, title: null, same_order: false},
    ]}});
  });
  await page.route(`**/api/v1/orders/${orderId}/appointments/batch`, route => {
    const body = route.request().postDataJSON();
    batches.push(body);
    if (body.dry_run) return route.fulfill({json: {ok: true, failures: []}});
    return route.fulfill({status: 201, json: {created: body.items.map((_: unknown, index: number) => ({index, id: `new-${index}`}))}});
  });
  await page.route("**/api/v1/appointments/meta/interpreters", route => route.fulfill({json: [
    {id: "olga", name: "Olga Test", role: "interpreter", assignable: true},
    {id: "blocked", name: "Blocked Person", role: "interpreter", assignable: false},
  ]}));

  await page.goto(`/orders/${orderId}?section=planning`);
  const planner = page.getByTestId("order-visit-planner");
  await expect(planner).toBeVisible();
  // The grid opens on the order's next planned day and shows taken time without other patients' names.
  await expect(planner).toContainText("Пн, 16.11.2026");
  await expect(planner.getByTestId("order-visit-planner-busy")).toHaveCount(2);
  await expect(planner.getByTestId("order-visit-planner-busy").first()).toContainText("Kardiologie");
  await expect(planner.getByTestId("order-visit-planner-busy").nth(1)).toContainText("Занято: врач");
  expect(busyQuery).toContain("from=2026-11-16");
  expect(busyQuery).toContain("to=2026-11-20");
  const slot = (date: string, time: string) =>
    planner.locator(`[data-testid="order-visit-planner-day"][data-date="${date}"] [data-slot-time="${time}"]`);
  const create = planner.getByTestId("order-visit-planner-create");

  // Dr. Klein is busy at 10:00 on Tuesday: the conflict shows before saving.
  await planner.getByRole("option", {name: /Dr. Klein/}).click();
  await slot("2026-11-17", "10:00").click();
  await expect(planner.getByTestId("order-visit-planner-conflicts")).toContainText("Вт, 17.11.2026 10:00 Dr. Klein: накладка (врач)");
  await expect(create).toBeDisabled();
  await planner.getByRole("button", {name: "Убрать из плана"}).click();
  await slot("2026-11-17", "11:00").click();

  // Dr. Weber on Monday at 10:00 for 90 minutes with an interpreter.
  await planner.getByRole("option", {name: /Dr. Weber/}).click();
  await slot("2026-11-16", "10:00").click();
  const inspector = planner.getByTestId("order-visit-planner-inspector");
  await inspector.getByRole("button", {name: "90 мин"}).click();
  await inspector.getByRole("textbox", {name: "Название приёма"}).fill("Echo und Gespräch");
  await inspector.getByRole("checkbox", {name: "Нужен переводчик"}).check();
  await inspector.getByRole("combobox", {name: "Переводчик"}).click();
  await expect(page.getByRole("option", {name: "Blocked Person"})).toHaveCount(0);
  await page.keyboard.press("Escape");
  await chooseComboboxOption(page, inspector.getByRole("combobox", {name: "Переводчик"}), "Olga Test");
  await expect(planner.getByTestId("order-visit-planner-draft")).toHaveCount(2);
  await expect(planner.getByTestId("order-visit-planner-conflicts")).toContainText("Накладок нет");
  await expect.poll(() => batches.filter(batch => batch.dry_run).length).toBeGreaterThan(0);

  await expect(create).toHaveText("Создать все приёмы (2)");
  await create.click();
  await expect(planner.getByTestId("order-visit-planner-notice")).toContainText("Создано приёмов: 2");
  const saved = batches.filter(batch => !batch.dry_run);
  expect(saved).toHaveLength(1);
  expect(saved[0].items).toEqual([
    expect.objectContaining({provider_id: "klinik", doctor_id: "klein", date: "2026-11-17", time_start: "11:00", time_end: "12:00",
      interpreter_needed: false, interpreter_id: null, title: "Dr. Klein", location: "Klinik Nord"}),
    expect.objectContaining({doctor_id: "weber", date: "2026-11-16", time_start: "10:00", time_end: "11:30",
      title: "Echo und Gespräch", interpreter_needed: true, interpreter_id: "olga"}),
  ]);
  await expect(planner.getByTestId("order-visit-planner-draft")).toHaveCount(0);
});

test("the planning grid shows the server's refusal per visit and creates nothing (plan stage 6)", async ({page}) => {
  await page.clock.setFixedTime(new Date("2026-11-13T09:00:00+01:00"));
  await prepare(page, "de");
  let saves = 0;
  await page.route(`**/api/v1/orders/${orderId}/pipeline`, route => route.fulfill({json: {
    order_id: orderId, phase: "intake", status: "active", stages: [], medical: {visible: false, required: false},
    care_team: [
      {provider_id: "klinik", provider_name: "Klinik Nord", provider_type: "medical", doctor_id: "weber", doctor_name: "Dr. Weber",
       doctor_title: null, doctor_specialty: null, services: 1, appointments: 0},
    ],
    appointments: [],
  }}));
  await page.route(`**/api/v1/orders/${orderId}/appointments/busy**`, route => route.fulfill({json: {items: []}}));
  await page.route(`**/api/v1/orders/${orderId}/appointments/batch`, route => {
    const body = route.request().postDataJSON();
    if (!body.dry_run) saves += 1;
    // Another planner booked the interpreter meanwhile.
    return route.fulfill({json: {ok: false, failures: [
      {index: 0, code: "conflict", message: "Appointment conflict", conflicts: {interpreter_conflict_count: 1}},
    ]}});
  });
  await page.goto(`/orders/${orderId}?section=planning`);
  const planner = page.getByTestId("order-visit-planner");
  await expect(planner).toContainText("Fr, 13.11.2026");
  await planner.locator('[data-testid="order-visit-planner-day"][data-date="2026-11-13"] [data-slot-time="14:00"]').click();
  await expect(planner.getByTestId("order-visit-planner-conflicts")).toContainText("Zeit bereits belegt (Dolmetscher)");
  await expect(planner.getByTestId("order-visit-planner-create")).toBeDisabled();
  expect(saves).toBe(0);
});

test("planning shows the hidden plan to the patient in one step (plan stage 4)", async ({page}) => {
  await prepare(page);
  let released = false;
  let releaseCalls = 0;
  const item = (id: string, date: string, portalReleasedAt: string | null) => ({
    id, title: id, appointment_type: "medical", date, time_start: null, time_end: null, status: "planned", location: null,
    provider_name: "Klinik Nord", doctor_name: "Dr. Weber", interpreter_name: null, interpreter_response: null,
    portal_released_at: portalReleasedAt,
  });
  await page.route(`**/api/v1/orders/${orderId}/pipeline`, route => route.fulfill({json: {
    order_id: orderId, phase: "intake", status: "active", stages: [], medical: {visible: false, required: false}, appointments: [
      item("Shown visit", "2026-11-02", "2026-11-01T10:00:00Z"),
      item("MRT Abdomen", "2026-11-03", released ? "2026-11-02T10:00:00Z" : null),
      item("Kardiologie", "2026-11-04", released ? "2026-11-02T10:00:00Z" : null),
    ],
  }}));
  await page.route(`**/api/v1/orders/${orderId}/appointments/release-to-portal`, route => {
    releaseCalls += 1;
    released = true;
    return route.fulfill({json: {released: 2, appointment_ids: ["MRT Abdomen", "Kardiologie"]}});
  });
  await page.goto(`/orders/${orderId}?section=planning`);
  const plan = page.getByTestId("order-planned-appointments");
  await plan.getByRole("button", {name: "По дням"}).click();
  await expect(plan.getByTestId("order-planned-appointment-hidden")).toHaveCount(2);
  // A short confirmation first: cancelling sends nothing.
  await plan.getByRole("button", {name: "Показать план пациенту (2)"}).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Пациент увидит в портале приёмы плана (2)");
  await confirm.getByRole("button", {name: "Отмена"}).click();
  await expect(confirm).toBeHidden();
  expect(releaseCalls).toBe(0);
  await plan.getByRole("button", {name: "Показать план пациенту (2)"}).click();
  await page.getByRole("alertdialog").getByRole("button", {name: "Показать", exact: true}).dblclick();
  await expect(plan.getByTestId("order-planned-appointment-hidden")).toHaveCount(0);
  await expect(plan.getByTestId("order-plan-release")).toHaveCount(0);
  expect(releaseCalls).toBe(1);
});

test("planning warns about a doctor outside the quote and records the agreement (plan stage 4)", async ({page}) => {
  const {order, writes} = await prepare(page);
  order.planning_preparation.treatment_plan_status = "draft";
  order.planning_preparation.treatment_plan_note = "";
  const item = (id: string, outside: boolean) => ({
    id, title: id, appointment_type: "medical", date: "2026-11-02", time_start: null, time_end: null, status: "planned",
    location: null, provider_name: "Klinik Nord", doctor_name: "Dr. Weber", interpreter_name: null,
    interpreter_response: null, portal_released_at: "2026-11-01T10:00:00Z", outside_signed_quote: outside,
  });
  await page.route(`**/api/v1/orders/${orderId}/pipeline`, route => route.fulfill({json: {
    order_id: orderId, phase: "intake", status: "active", stages: [], medical: {visible: false, required: false},
    appointments: [item("Im KV", false), item("Ausserhalb KV", true)],
  }}));
  let generated: Record<string, unknown> | null = null;
  await page.route("**/api/v1/documents/generate", route => {
    generated = route.request().postDataJSON();
    return route.fulfill({json: {id: "plan-pdf-1"}});
  });
  await page.goto(`/orders/${orderId}?section=planning`);

  const plan = page.getByTestId("order-planned-appointments");
  await plan.getByRole("button", {name: "По дням"}).click();
  await expect(plan.getByTestId("order-planned-appointment-outside-quote")).toHaveCount(1);
  await expect(plan.locator("li", {hasText: "Ausserhalb KV"})).toContainText("Врача нет в подписанном КВ");

  const agreement = page.getByTestId("order-plan-agreement");
  await expect(agreement).toContainText("Черновик");
  await agreement.getByTestId("order-plan-pdf").click();
  const pdfHref = await agreement.getByRole("link", {name: "PDF плана лечения"}).getAttribute("href");
  expect(pdfHref).toContain("document=plan-pdf-1");
  expect(generated).toMatchObject({
    template_id: "treatment_plan", order_id: orderId, patient_id: patientId,
  });

  await agreement.getByTestId("order-plan-note").fill("Plan per e-mail gesendet");
  // A double click records the step once.
  await agreement.getByRole("button", {name: "Отметить: отправлен пациенту"}).dblclick();
  await expect(agreement).toContainText("Отправлен пациенту");
  await expect(agreement.getByRole("button", {name: "Пациент согласовал"})).toBeVisible();
  const steps = writes.filter(write => write.path.endsWith("/planning-preparation"));
  expect(steps).toHaveLength(1);
  expect(steps[0].body).toEqual({
    treatment_plan_status: "sent", treatment_plan_note: "Plan per e-mail gesendet",
  });
});

test("planning names who set the plan status and warns when visits came later (QA round 13)", async ({page}) => {
  const {order} = await prepare(page);
  // Planning already runs in the first phase; its gate is checked only later.
  order.phase = "discovery";
  Object.assign(order.planning_preparation, {
    treatment_plan_status: "finalized",
    treatment_plan_status_updated_at: "2026-11-02T13:49:00Z",
    treatment_plan_status_updated_by_name: "Petra Planer",
    appointments_last_added_at: "2026-11-02T15:00:00Z",
    non_medical_required: false, non_medical_total: 1,
    interpreter_required: true, interpreter_assigned: 2, interpreter_confirmed: 0,
    interpreter_needed: 3, interpreter_missing: 1, interpreter_unconfirmed: 2,
    blocking_reasons: ["Interpreter is required but not assigned yet"],
  });
  await page.route(`**/api/v1/orders/${orderId}/pipeline`, route => route.fulfill({json: {
    order_id: orderId, phase: "intake", status: "active", stages: [], medical: {visible: false, required: false}, appointments: [],
  }}));
  await page.route("**/api/v1/documents?*", route => route.fulfill({json: [{
    id: "plan-pdf-old", order_id: orderId, generated_template_id: "treatment_plan", is_latest_version: true,
    status: "draft", created_at: "2026-11-02T14:00:00Z",
  }]}));
  await page.goto(`/orders/${orderId}?section=planning`);

  const agreement = page.getByTestId("order-plan-agreement");
  await expect(agreement.getByTestId("order-plan-status-set")).toHaveText("Статус установил Petra Planer 02.11.2026 14:49");
  await expect(agreement.getByTestId("order-plan-changed")).toContainText("После статуса «Финализировано» в план добавлены приёмы");
  await expect(agreement.getByTestId("order-plan-changed")).toContainText("обновите PDF");
  // No automatic status change.
  await expect(agreement).toContainText("Финализировано");

  await expect(page.getByText("2 из 3 назначено / 0 принято")).toBeVisible();
  await expect(page.getByTestId("order-planning-readiness-reasons")).toContainText("Для готовности планирования ещё нужно:");
  await expect(page.getByTestId("order-planning-non-medical-hint")).toContainText("В плане немедицинских приёмов: 1");
});

test("planning books one interpreter for a whole day in one request (plan stage 5)", async ({page}) => {
  const {order, writes} = await prepare(page);
  // One booked visit out of two medical ones is not enough any more.
  Object.assign(order.planning_preparation, {
    interpreter_required: true, interpreter_assigned: 1, interpreter_confirmed: 0,
    interpreter_missing: 1, interpreter_unconfirmed: 1,
  });
  const item = (id: string, overrides: Record<string, unknown>) => ({
    id, title: id, appointment_type: "medical", date: "2026-11-03", time_start: null, time_end: null,
    status: "planned", location: null, provider_name: "Klinik Nord", doctor_name: "Dr. Weber",
    interpreter_id: null, interpreter_name: null, interpreter_response: null, ...overrides,
  });
  await page.route(`**/api/v1/orders/${orderId}/pipeline`, route => route.fulfill({json: {
    order_id: orderId, phase: "intake", status: "active", stages: [], medical: {visible: false, required: false}, appointments: [
      item("Kardiologie", {time_start: "09:00:00", time_end: "10:00:00", interpreter_id: "int-olga", interpreter_name: "Olga Test", interpreter_response: "pending"}),
      item("Nachbesprechung", {time_start: "13:00:00", time_end: "14:00:00"}),
      item("Transfer", {date: "2026-11-04", appointment_type: "non_medical"}),
    ],
  }}));
  await page.route("**/api/v1/appointments/meta/interpreters", route => route.fulfill({json: [
    {id: "int-olga", name: "Olga Test", role: "interpreter", assignable: true},
    {id: "int-ivan", name: "Ivan Test", role: "interpreter", assignable: true},
    {id: "int-hidden", name: "Hidden Test", role: "interpreter", assignable: true},
  ]}));
  await page.route("**/api/v1/appointments/*/interpreter-suggestions", route => route.fulfill({json: []}));
  await page.route("**/api/v1/appointments/meta/conflicts?*", route => {
    const url = new URL(route.request().url());
    const interpreter = url.searchParams.get("interpreter_id");
    const busy = url.searchParams.get("appointment_id") === "Nachbesprechung" && (interpreter === "int-ivan" || interpreter === "int-hidden");
    const conflict = interpreter === "int-hidden"
      // A booking the planner may not see comes back redacted, in English.
      ? {id: null, title: "Resource unavailable", date: "2026-11-03", time_start: "13:15", time_end: "13:45", type: null, status: null, patient_name: "", patient_pid: "", provider_name: null, is_redacted: true}
      : {id: "x", title: "Andere Patientin", date: "2026-11-03", time_start: "13:30", time_end: "14:30", type: "medical", status: "confirmed", patient_name: "", patient_pid: "", provider_name: null};
    return route.fulfill({json: {
      patient_conflict_count: 0, interpreter_conflict_count: busy ? 1 : 0, has_conflicts: busy,
      patient_conflicts: [], interpreter_conflicts: busy ? [conflict] : [],
    }});
  });
  // The first batch is refused for the hidden booking, as the server words it.
  let refuseBatch = true;
  await page.route(`**/api/v1/orders/${orderId}/appointments/assign-interpreter`, route => {
    if (!refuseBatch) return route.fallback();
    refuseBatch = false;
    return route.fulfill({status: 409, json: {
      error: "Conflict", message: "Some appointments cannot take the interpreter; nothing was changed",
      failures: [{
        appointment_id: "Nachbesprechung", code: "schedule_conflict",
        message: "Appointment conflict: selected slot overlaps with existing interpreter booking Resource unavailable at 2026-11-03 13:15-13:45",
        conflicts: {
          patient_conflict_count: 0, interpreter_conflict_count: 1, doctor_conflict_count: 0, has_conflicts: true,
          patient_conflicts: [], doctor_conflicts: [],
          interpreter_conflicts: [{id: null, title: "Resource unavailable", date: "2026-11-03", time_start: "13:15", time_end: "13:45", is_redacted: true}],
        },
      }],
    }});
  });
  await page.goto(`/orders/${orderId}?section=planning`);

  // «Переводчики по дням» replaces the older «Назначить переводчика» hint.
  await expect(page.getByTestId("order-interpreter-callout")).toHaveCount(0);

  const block = page.getByTestId("order-interpreters-by-day");
  const day = block.locator('[data-testid="order-interpreter-day"][data-date="2026-11-03"]');
  await expect(day).toContainText("Без переводчика: 1");
  await expect(day).toContainText("Olga Test");
  await expect(day).toContainText("Нужен переводчик");
  await day.getByRole("button", {name: "Назначить переводчика на день"}).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  // Only the visit without an interpreter is preselected; the booked one can be added.
  await expect(sheet.getByRole("checkbox", {name: "Nachbesprechung"})).toBeChecked();
  await expect(sheet.getByRole("checkbox", {name: "Kardiologie"})).not.toBeChecked();
  await sheet.getByRole("checkbox", {name: "Kardiologie"}).check();
  // A hidden booking is named in Russian, and so is the refusal of the batch.
  await chooseComboboxOption(page, sheet.getByRole("combobox", {name: "Переводчик"}), "Hidden Test");
  const hint = sheet.getByTestId("order-interpreter-row-hint");
  await expect(hint).toHaveText("Конфликт: другой приём (нет доступа) 13:15–13:45");
  await sheet.getByRole("button", {name: "Назначить", exact: true}).click();
  await expect(hint).toHaveText("Приём нельзя сохранить: переводчик уже занят в выбранное время. Выберите другое время.");
  await expect(hint).not.toContainText("Resource unavailable");
  await expect(hint).not.toContainText("Appointment conflict");

  // Another interpreter drops the old refusal at once.
  await chooseComboboxOption(page, sheet.getByRole("combobox", {name: "Переводчик"}), "Ivan Test");
  await expect(hint).toHaveText("Конфликт: Andere Patientin 13:30–14:30");

  // A double click sends the batch once.
  await sheet.getByRole("button", {name: "Назначить", exact: true}).dblclick();
  await expect(sheet).toBeHidden();
  const batch = writes.filter(write => write.path.endsWith("/appointments/assign-interpreter"));
  expect(batch).toHaveLength(1);
  expect(batch[0].path).toBe(`/orders/${orderId}/appointments/assign-interpreter`);
  expect(batch[0].body.interpreter_id).toBe("int-ivan");
  expect([...(batch[0].body.appointment_ids as string[])].sort()).toEqual(["Kardiologie", "Nachbesprechung"]);

  // Taking the interpreter off asks first.
  await day.getByRole("button", {name: "Назначить переводчика на день"}).click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", {name: "Снять переводчика"}).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Переводчик будет снят с отмеченных приёмов");
  await confirm.getByRole("button", {name: "Отмена"}).click();
  expect(writes.filter(write => write.path.endsWith("/appointments/assign-interpreter"))).toHaveLength(1);
  await sheet.getByRole("button", {name: "Снять переводчика"}).click();
  await page.getByRole("alertdialog").getByRole("button", {name: "Снять", exact: true}).click();
  await expect(sheet).toBeHidden();
  const removal = writes.filter(write => write.path.endsWith("/appointments/assign-interpreter"));
  expect(removal).toHaveLength(2);
  expect(removal[1].body.interpreter_id).toBeNull();
});

test("the interpreter answer badge stays inside its card on a phone (QA round 13)", async ({page}) => {
  await page.setViewportSize({width: 390, height: 900});
  const {order} = await prepare(page);
  Object.assign(order.planning_preparation, {interpreter_required: true});
  await page.route(`**/api/v1/orders/${orderId}/pipeline`, route => route.fulfill({json: {
    order_id: orderId, phase: "intake", status: "active", stages: [], medical: {visible: false, required: false}, appointments: [{
      id: "Kardiologische Nachbesprechung", title: "Kardiologische Nachbesprechung", appointment_type: "medical",
      date: "2026-11-10", time_start: "10:00:00", time_end: "11:00:00", status: "planned", location: null,
      provider_name: "Charité", doctor_name: "Prof. Dr. Johannes Keller", interpreter_id: "int-long",
      interpreter_name: "Alexandra Konstantinopolskaja-Hohenberg", interpreter_response: "pending",
    }],
  }}));
  await page.goto(`/orders/${orderId}?section=planning`);
  const row = page.getByTestId("order-interpreter-row");
  await expect(row).toContainText("Ждёт ответа");
  const card = await page.getByTestId("order-interpreters-by-day").boundingBox();
  const badge = await row.getByText("Ждёт ответа").boundingBox();
  expect(card && badge).toBeTruthy();
  expect(badge!.x + badge!.width).toBeLessThanOrEqual(card!.x + card!.width);
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
  // Status changes live in the "Управление заказом" menu; a blocked one stays disabled.
  await openOrderActions(page);
  await expect(page.getByRole("menuitem", {name:/^Завершить/})).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", {name:/Перейти в Исполнение/}).click();
  await expect.poll(() => order.phase).toBe("execution");
  await expect(page.locator('[data-workspace-rail="order"]').getByRole("link", {name:"Исполнение", exact:true})).toBeVisible();
  await openOrderActions(page);
  await page.getByRole("menuitem", {name:/^Приостановить/}).click();
  await expect.poll(() => order.status).toBe("paused");
  await expect(page.getByRole("button", {name:/Перейти в Исполнение/})).toBeDisabled();
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
  // A refusal reads in the UI language, never as the raw server text (system QA 2026-11-12, F-C10).
  await expect(sheet.getByRole("alert")).toHaveText("Не удалось создать пункт чек-листа.");
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

test("a planned service is cancelled with a required reason and shows it afterwards", async ({page}) => {
  const {order} = await prepare(page);
  const line: Record<string, unknown> = {id:"service-1", description:"QA interpreter block", quantity:"4", unit_price:"80", currency:"EUR", vat_rate:"19", status:"planned", notes:null};
  order.leistungen.push(line, {id:"service-2", description:"QA delivered service", quantity:"1", unit_price:"100", currency:"EUR", vat_rate:"19", status:"delivered", delivered_at:"2026-09-10T09:00:00Z", notes:null});
  const cancelBodies: unknown[] = [];
  await page.route(`**/orders/${orderId}/leistungen/service-1/cancel`, route => {
    const body = route.request().postDataJSON() as {reason: string};
    cancelBodies.push(body);
    Object.assign(line, {status:"cancelled", cancelled_at:"2026-09-25T10:15:00Z", cancellation_reason:body.reason});
    return route.fulfill({json:{id:"service-1", order_id:orderId, status:"cancelled", cancelled_at:"2026-09-25T10:15:00Z", cancelled_by:"order-test-user", cancellation_reason:body.reason}});
  });
  await page.goto(`/orders/${orderId}?section=services`);
  // Every line that is not cancelled yet offers the action (decision 2026-09-29).
  const plannedLine = page.locator("article").filter({has:page.getByRole("heading", {name:"QA interpreter block", exact:true})});
  const deliveredLine = page.locator("article").filter({has:page.getByRole("heading", {name:"QA delivered service", exact:true})});
  await expect(plannedLine.getByRole("button", {name:"Отменить услугу", exact:true})).toHaveCount(1);
  await expect(deliveredLine.getByRole("button", {name:"Отменить услугу", exact:true})).toHaveCount(1);
  await plannedLine.getByRole("button", {name:"Отменить услугу", exact:true}).click();
  const dialog = page.getByRole("dialog", {name:"Отменить услугу", exact:true});
  await expect(dialog.getByText("QA interpreter block", {exact:true})).toBeVisible();
  const submit = dialog.getByRole("button", {name:"Отменить услугу", exact:true});
  const reason = dialog.getByLabel("Причина отмены");
  await expect(submit).toBeDisabled();
  await reason.fill("  ab  ");
  await expect(submit).toBeDisabled();
  await reason.fill("  Часы уже выставлены по отчёту переводчика  ");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog).toBeHidden();
  // No released invoice bills the line, so no credit note is requested.
  expect(cancelBodies).toEqual([{reason:"Часы уже выставлены по отчёту переводчика", issue_credit_note:false}]);
  const note = page.getByTestId("leistung-cancellation-note");
  await expect(note).toContainText("Отменено");
  await expect(note).toContainText("Причина: Часы уже выставлены по отчёту переводчика");
  await expect(plannedLine.getByRole("button", {name:"Отменить услугу", exact:true})).toHaveCount(0);
  await expect(deliveredLine.getByRole("button", {name:"Отменить услугу", exact:true})).toHaveCount(1);
});

test("cancelling a service of a signed order asks before the client's signature is reset (QA 2026-10-31)", async ({page}) => {
  const {order} = await prepare(page);
  const line: Record<string, unknown> = {id:"service-1", description:"QA interpreter block", quantity:"4", unit_price:"80", currency:"EUR", vat_rate:"19", status:"planned", notes:null};
  order.leistungen.push(line);
  const cancelBodies: Array<{reason: string; confirm_signature_reset?: boolean}> = [];
  await page.route(`**/orders/${orderId}/leistungen/service-1/cancel`, route => {
    const body = route.request().postDataJSON() as {reason: string; confirm_signature_reset?: boolean};
    cancelBodies.push(body);
    if (body.confirm_signature_reset !== true) {
      return route.fulfill({status:409, json:{error:"order_signed_terms_change", message:"The client signed this order", signed_total_label:"889,15 €", new_total_label:"508,15 €"}});
    }
    Object.assign(line, {status:"cancelled", cancelled_at:"2026-09-25T10:15:00Z", cancellation_reason:body.reason});
    return route.fulfill({json:{id:"service-1", order_id:orderId, status:"cancelled", cancelled_at:"2026-09-25T10:15:00Z", cancelled_by:"order-test-user", cancellation_reason:body.reason, signature_reset:true}});
  });
  await page.goto(`/orders/${orderId}?section=services`);
  await page.getByRole("button", {name:"Отменить услугу", exact:true}).click();
  const dialog = page.getByRole("dialog", {name:"Отменить услугу", exact:true});
  await dialog.getByLabel("Причина отмены").fill("Услуга не нужна");
  await dialog.getByRole("button", {name:"Отменить услугу", exact:true}).click();
  const ask = page.getByTestId("leistung-signed-terms-change-dialog");
  await expect(ask).toContainText("889,15 €");
  await expect(ask).toContainText("508,15 €");
  // Keeping the signature leaves the line as it was, with the reason still typed.
  await ask.getByRole("button", {name:"Отмена", exact:true}).click();
  await expect(ask).toBeHidden();
  await expect(dialog.getByRole("alert")).toContainText("подпись клиента сохранена");
  expect(cancelBodies).toHaveLength(1);
  await dialog.getByRole("button", {name:"Отменить услугу", exact:true}).click();
  await ask.getByRole("button", {name:"Изменить, подпись сбросится", exact:true}).click();
  await expect(dialog).toBeHidden();
  expect(cancelBodies[cancelBodies.length - 1]).toEqual({reason:"Услуга не нужна", issue_credit_note:false, confirm_signature_reset:true});
});

test("the order workspace shows a prepayment above the total and adjusts it (QA 2026-10-31)", async ({page}) => {
  const {order} = await prepare(page);
  Object.assign(order, {total_estimated:"339.15", prepayment_required:true, prepayment_amount:"458.15", prepayment_due_at:null});
  const writes: Array<Record<string, unknown>> = [];
  await page.route(`**/orders/${orderId}/commercial-basis`, route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    writes.push(body);
    Object.assign(order, {prepayment_amount:body.prepayment_amount});
    return route.fulfill({json:{ok:true, order_id:orderId, prepayment_required:true, prepayment_amount:body.prepayment_amount, prepayment_due_at:null, signature_reset:false}});
  });
  await page.goto(`/orders/${orderId}`);
  const card = page.getByTestId("order-prepayment");
  await expect(card.getByTestId("order-prepayment-exceeds-total")).toContainText("339,15");
  await card.getByTestId("order-prepayment-edit").click();
  const dialog = page.getByRole("dialog", {name:"Изменить предоплату", exact:true});
  await dialog.getByLabel("Сумма предоплаты, EUR").fill("500");
  await dialog.getByRole("button", {name:"Сохранить", exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText("не может превышать");
  expect(writes).toHaveLength(0);
  await dialog.getByLabel("Сумма предоплаты, EUR").fill("300");
  await dialog.getByRole("button", {name:"Сохранить", exact:true}).click();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([{prepayment_required:true, prepayment_amount:"300.00", prepayment_due_at:""}]);
  await expect(card.getByTestId("order-prepayment-exceeds-total")).toHaveCount(0);
});

test("a cancellation conflict shows a localized error and reloads the line", async ({page}) => {
  const {order} = await prepare(page, "de");
  const line: Record<string, unknown> = {id:"service-1", description:"QA interpreter block", quantity:"4", unit_price:"80", currency:"EUR", vat_rate:"19", status:"planned", notes:null};
  order.leistungen.push(line);
  await page.route(`**/orders/${orderId}/leistungen/service-1/cancel`, route => {
    // Someone cancelled the line meanwhile (any line that is not cancelled yet can be cancelled).
    Object.assign(line, {status:"cancelled", cancelled_at:"2026-09-25T10:00:00Z", cancellation_reason:"Cancelled elsewhere"});
    return route.fulfill({status:409, json:{error:"Conflict", code:"order_service_already_cancelled", message:"The order service is already cancelled", order_leistung_id:"service-1"}});
  });
  await page.goto(`/orders/${orderId}?section=services`);
  await page.getByRole("button", {name:"Leistung stornieren", exact:true}).click();
  const dialog = page.getByRole("dialog", {name:"Leistung stornieren", exact:true});
  await dialog.getByLabel("Stornogrund").fill("Doppelt geplant");
  await dialog.getByRole("button", {name:"Leistung stornieren", exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText("Die Leistung ist bereits storniert.");
  await expect(dialog.getByRole("alert")).not.toContainText("The order service is already cancelled");
  // The typed reason is unsaved input, so closing asks before discarding it.
  await dialog.getByRole("button", {name:"Abbrechen", exact:true}).click();
  await page.getByRole("button", {name:"Ohne Speichern schließen", exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", {name:"Leistung stornieren", exact:true})).toHaveCount(0);
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

test("amount amendments need a VAT treatment, accept decimal commas and reject zero or reductions", async ({page}) => {
  const {writes} = await prepare(page);
  await page.goto(`/orders/${orderId}?section=services`);
  const delta = page.getByRole("textbox", {name:"Сумма увеличения с НДС", exact:true});
  await page.getByRole("textbox", {name:"Что согласовано с пациентом", exact:true}).fill("QA agreed change");
  const propose = page.getByRole("button", {name:"Предложить", exact:true});
  await delta.fill("9,50");
  // Without the VAT treatment the proposal cannot be sent.
  await expect(propose).toBeDisabled();
  await chooseComboboxOption(page, page.getByRole("combobox", {name:"НДС для этой суммы", exact:true}), "Услуга агентства · НДС 19 %");
  await delta.fill("0");
  await expect(propose).toBeDisabled();
  await delta.fill("-50");
  await expect(propose).toBeDisabled();
  await delta.fill("9,50");
  await propose.click();
  await expect(delta).toHaveValue("");
  await expect(page.getByText("Предложение отправлено на согласование.", {exact:true})).toBeVisible();
  expect(writes.find(write => write.path.endsWith("/amendments"))?.body)
    .toMatchObject({delta_amount:"9.50", agreed_note:"QA agreed change", vat_treatment:"standard_vat"});
});

test("approving an amount amendment adds a billing line and refreshes the order total", async ({page}) => {
  const {order} = await prepare(page);
  const amendment: Record<string, unknown> = {id:"amendment-1", order_id:orderId, delta_amount:"100", agreed_note:"QA agreed change", status:"pending", currency:"EUR", created_at:"2026-09-06T12:02:00Z", vat_treatment:"standard_vat", vat_rate:"19", is_cost_passthrough:false, order_leistung_id:null, billable:false};
  await page.route(`**/orders/${orderId}/amendments`, route => route.fulfill({json:[amendment]}));
  await page.route(`**/orders/${orderId}/amendments/amendment-1/decision`, route => {
    order.total_estimated = "12600";
    Object.assign(amendment, {status:"approved", order_leistung_id:"line-amendment", order_leistung_status:"approved"});
    return route.fulfill({json:{amendment, order_total_estimated:"12600", order_leistung_id:"line-amendment"}});
  });
  await page.goto(`/orders/${orderId}?section=services`);
  await expect(orderTotal(page)).toHaveText(/12.500|12 500/);
  await expect(page.getByText("Услуга агентства · НДС 19 %", {exact:true})).toBeVisible();
  await page.getByRole("button", {name:"Одобрить", exact:true}).click();
  await expect(page.getByText("Одобрено", {exact:true})).toBeVisible();
  await expect(page.getByText("В услугах заказа", {exact:true})).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Строка «Корректировка» добавлена в услуги заказа"})).toBeVisible();
  await expect(orderTotal(page)).toHaveText(/12.600|12 600/);
});

test("a pending amendment without a VAT treatment asks for it before approval", async ({page}) => {
  const {writes} = await prepare(page);
  const amendment = {id:"amendment-legacy", order_id:orderId, delta_amount:"80", agreed_note:"Legacy change", status:"pending", currency:"EUR", created_at:"2026-09-06T12:02:00Z"};
  await page.route(`**/orders/${orderId}/amendments`, route => route.fulfill({json:[amendment]}));
  await page.goto(`/orders/${orderId}?section=services`);
  const approve = page.getByRole("button", {name:"Одобрить", exact:true});
  await expect(approve).toBeDisabled();
  await chooseComboboxOption(page, page.getByRole("combobox", {name:"НДС для этой суммы", exact:true}).last(), "Организация лечения · НДС 0 %");
  await approve.click();
  await expect.poll(() => writes.find(write => write.path.endsWith("/amendment-legacy/decision"))?.body)
    .toMatchObject({decision:"approve", vat_treatment:"termin_fee_0"});
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
  await expect(amount).toHaveValue("25,00");
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
  await expect(amount).toHaveValue("14,50");
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toMatchObject({amount_gross:"10.50", patient_invoice_id:"patient-invoice-1"});
  expect(attempts[1].request_id).toBe(attempts[0].request_id);
});

test("cancelling an order needs a reason and shows what is cancelled and what stays for billing", async ({page}) => {
  const {order, writes} = await prepare(page);
  await page.route(`**/orders/${orderId}/cancellation-preview`, route => route.fulfill({json:{
    reason: null,
    cancelled_services: [{id:"line-1", description:"Dolmetscher", quantity:"2", gross:"119"}],
    cancelled_appointment_ids: ["appointment-1", "appointment-2"],
    closed_quotes: [{id:"quote-1", quote_number:"KV-QA-1", previous_status:"sent"}],
    rejected_amendment_ids: [],
    settlement: {currency:"EUR", accrued_gross:"200", invoiced_gross:"0", paid_gross:"500", balance_gross:"-300", uninvoiced_gross:"200",
      lines:[{description:"Organisation der Behandlung", status:"delivered", gross:"200"}]},
  }}));
  await page.goto(`/orders/${orderId}`);
  await openOrderActions(page);
  await page.getByRole("menuitem", {name:/^Отменить/}).click();
  const dialog = page.getByRole("dialog", {name:"Отменить заказ", exact:true});
  const preview = dialog.getByTestId("order-cancellation-preview");
  await expect(preview).toContainText("Запланированные услуги: 1");
  await expect(preview).toContainText("Предстоящие приёмы: 2");
  await expect(preview).toContainText("KV-QA-1");
  await expect(dialog.getByTestId("order-cancellation-balance")).toContainText("Пациенту к возврату: 300,00");
  const confirm = dialog.getByRole("button", {name:"Отменить заказ", exact:true});
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox", {name:"Причина отмены"}).fill("Patient postponed the treatment");
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => order.status).toBe("cancelled");
  expect(writes.filter(write => write.path.endsWith("/status")).at(-1)?.body)
    .toEqual({status:"cancelled", reason:"Patient postponed the treatment"});
});

test("an order waits for the draft invoices of its planned services (QA 2026-10-31)", async ({page}) => {
  const {writes} = await prepare(page);
  await page.route(`**/orders/${orderId}/cancellation-preview`, route => route.fulfill({json:{
    reason: null,
    cancelled_services: [{id:"line-1", description:"Dolmetscher", quantity:"2", gross:"119"}],
    cancelled_appointment_ids: [], closed_quotes: [], rejected_amendment_ids: [], settlement: null,
    draft_invoices: [{id:"draft-1", total_gross:"178.5", currency:"EUR"}],
  }}));
  await page.goto(`/orders/${orderId}`);
  await openOrderActions(page);
  await page.getByRole("menuitem", {name:/^Отменить/}).click();
  const dialog = page.getByRole("dialog", {name:"Отменить заказ", exact:true});
  await expect(dialog.getByTestId("order-cancellation-draft-invoices")).toContainText("178,50");
  await dialog.getByRole("textbox", {name:"Причина отмены"}).fill("Patient postponed the treatment");
  await expect(dialog.getByRole("button", {name:"Отменить заказ", exact:true})).toBeDisabled();
  expect(writes.filter(write => write.path.endsWith("/status"))).toHaveLength(0);
});

test("follow-up blockers open the milestone planner, which plans and creates the reminder with feedback", async ({page}) => {
  const {order, writes} = await prepare(page);
  const reason = "1-week follow-up is not scheduled yet";
  Object.assign(order, {phase:"closure"});
  Object.assign(order.lifecycle, {
    current_stage:"closure", next_stage:"followup",
    allowed_transitions:[{phase:"followup", blocked:true, reasons:[reason]}],
  });
  Object.assign(order.followup_flow, {
    followup_ready:false, followup_1w_status:"pending", followup_1w_ready:false,
    followup_1m_ready:true, followup_6m_ready:true, followup_1w_date:null,
    followup_1w_visits:0, followup_1w_reminders:0, followup_1m_visits:0, followup_1m_reminders:0,
    followup_6m_visits:0, followup_6m_reminders:0, followup_appointments_total:0,
    package_end_reminders:0, results_portal_shares:0,
    closure_anchor_at:"2026-09-28T10:00:00+02:00", reminder_anchor_appointment_id:"appointment-anchor",
    blocking_reasons:[reason],
  });
  // The blockers list lives in the "Что нужно сделать" section; the header
  // only counts them and links there.
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByText("До следующего этапа осталось: 1", {exact:true})).toBeVisible();
  await page.getByRole("link", {name:"Что нужно сделать"}).first().click();
  await page.getByRole("button", {name:/Недельный контроль ещё не запланирован/}).click();
  const planner = page.getByTestId("order-followup-milestones");
  await expect(planner).toBeInViewport();
  const week = planner.getByTestId("followup-milestone-post_1w");
  await chooseComboboxOption(page, week.getByRole("combobox", {name:"Через 1 неделю: статус"}), /Запланировано/);
  // Prefilled one week after the closure anchor, shown as DD.MM.YYYY in the segmented date field.
  const date = week.getByRole("group", {name:"Через 1 неделю: дата", exact:true});
  await expect(date.getByRole("spinbutton", {name:pickerSection.day})).toHaveText("05");
  await expect(date.getByRole("spinbutton", {name:pickerSection.month})).toHaveText("10");
  await expect(date.getByRole("spinbutton", {name:pickerSection.year})).toHaveText("2026");
  await expect(date.locator("input")).toHaveValue("05.10.2026");
  await week.getByRole("button", {name:"Создать напоминание", exact:true}).click();
  await expect(week.getByRole("status")).toHaveText("Напоминание на 05.10.2026 создано.");
  const reminder = writes.find(write => write.path === "/appointments/appointment-anchor/reminders");
  expect(reminder?.body).toMatchObject({title:"Контроль через 1 неделю", user_id:"order-test-user"});
  expect(writes.find(write => write.path.endsWith("/followup-flow"))?.body)
    .toEqual({followup_1w_status:"scheduled", followup_1w_date:"2026-10-05"});
});

test("an order has no billing release step: blockers open their section", async ({page}) => {
  // Owner decision 2026-10-05: no manual billing release any more.
  const {order} = await prepare(page);
  const reason = "Order signatures are still incomplete";
  Object.assign(order.process_gates, {execution_ready:false, blocking_reasons:[reason]});
  Object.assign(order.lifecycle, {allowed_transitions:[{phase:"execution", blocked:true, reasons:[reason]}]});
  await page.route("**/api/v1/me", route => route.fulfill({json:{id:"pm-user", email:"pm@example.org", name:"PM QA", role:"patient_manager", created_at:"2026-01-01T00:00:00Z"}}));
  await page.goto(`/orders/${orderId}?section=gates`);
  await expect(page.getByRole("button", {name:/Подписи по заказу/})).toBeVisible();
  await expect(page.getByText("Покрытие пакетом").first()).toBeVisible();
  await expect(page.getByText(/Разрешение бухгалтерии|Ждёт бухгалтерию/)).toHaveCount(0);
});
