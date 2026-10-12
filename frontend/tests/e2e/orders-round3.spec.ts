import { expect, test, type Page } from "@playwright/test";

// QA round 3, group C (2026-10-12): the signed order version (C3-01), the
// group payer form on a phone (C3-04), readable order-line notes and charge
// sources (C3-10, C3-11) and the order workspace loading once (C-33).
// Synthetic data only.

const orderId = "00000000-0000-0000-0000-000000000931";
const patientId = "00000000-0000-0000-0000-000000000331";
const reportId = "6b37536f-f492-40a8-ba01-7405d8629e92";
const visitId = "12d3e355-d43f-4189-9c6e-d9cb249d8c48";

type Write = { path: string; body: Record<string, unknown> };

async function prepare(page: Page) {
  const order: Record<string, unknown> & { leistungen: Record<string, unknown>[] } = {
    id: orderId, order_number: "A-20261012-0010", patient_id: patientId,
    patient_name: "Mia Muster", patient_pid: "P-20261012-0005", phase: "intake", status: "active",
    total_estimated: "889.15", total_actual: "0", currency: "EUR",
    needs_description: "Kardiologische Abklärung.",
    date_from: "2026-10-25", date_to: "2026-10-30",
    signed_patient: true, signed_agency: true,
    client_signature: {
      signed_total: "889.15", signed_date_from: "2026-10-25", signed_date_to: "2026-10-30",
      signed_at: "2026-10-12T10:00:00Z", signed_document_id: "doc-1",
      terms_changed_at: null, changes_await_signature: false,
    },
    created_at: "2026-10-12T09:00:00Z", updated_at: "2026-10-12T09:00:00Z",
    leistungen: [], external_invoices: [],
    process_gates: {
      execution_ready: true, debt_hold: false, overdue_invoice_count: 0,
      package_coverage_status: "not_covered", package_coverage_note: "", blocking_reasons: [],
    },
    planning_preparation: {
      planning_ready: true, treatment_plan_status: "finalized", treatment_plan_note: "",
      non_medical_required: false, interpreter_required: false,
      preparation_documents_status: "sent", interpreter_briefing_status: "not_needed",
      medical_total: 0, medical_confirmed: 0, non_medical_total: 0, non_medical_confirmed: 0,
      interpreter_assigned: 0, interpreter_confirmed: 0, blocking_reasons: [],
    },
    execution_flow: {
      closure_ready: false, arrival_status: "pending", medical_execution_status: "pending",
      non_medical_execution_status: "not_required", interpreter_service_status: "not_required",
      issue_status: "not_required", deviation_note: "", execution_summary: "", blocking_reasons: [],
    },
    followup_flow: {
      followup_ready: false, doctor_followup_status: "not_required",
      followup_1w_status: "pending", followup_1m_status: "pending", followup_6m_status: "pending",
      package_end_status: "not_required", results_handoff_status: "pending",
      followup_summary: "", blocking_reasons: [],
    },
    lifecycle: {
      current_stage: "intake", next_stage: "execution",
      allowed_transitions: [{ phase: "execution", blocked: false, reasons: [] }],
      allowed_status_transitions: [],
      history: [],
    },
  };
  const writes: Write[] = [];
  const reads: string[] = [];
  let refuseUnconfirmedService = true;
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "round3-test-token");
    localStorage.setItem("gmed_refresh_token", "round3-test-refresh");
    localStorage.setItem("gmed_lang", "ru");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (request.method() === "GET") reads.push(path);
    if (request.method() === "POST") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      writes.push({ path, body });
      if (path === `/orders/${orderId}/leistungen`) {
        if (refuseUnconfirmedService && body.confirm_signature_reset !== true) {
          await route.fulfill({
            status: 409,
            json: {
              error: "order_signed_terms_change",
              message: "The client signed this order",
              signed_total: "889.15", new_total: "1317.55",
              signed_total_label: "889,15 €", new_total_label: "1.317,55 €",
            },
          });
          return;
        }
        await route.fulfill({ status: 201, json: { id: "new-line", signature_reset: true } });
        return;
      }
    }
    let body: unknown = [];
    if (path === "/me") body = { id: "round3-user", email: "ceo@example.com", name: "Round3 CEO", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    if (path === "/auth/refresh") body = { access_token: "round3-test-token", refresh_token: "round3-test-refresh", expires_in: 900 };
    if (path === `/orders/${orderId}`) body = order;
    if (path === `/orders/${orderId}/economics`) body = { order_id: orderId, currency: "EUR", economics_valid: true, margin_visible: true, planned: {}, actual: {}, warnings: [], services: [] };
    if (path === `/orders/${orderId}/group`) body = { head: { ...order, order_role: "standalone" }, subs: [], covered_patient_ids: [patientId], rollup_total_estimated: order.total_estimated };
    if (path === `/orders/${orderId}/workflow-checklist`) body = { scope_type: "order", scope_id: orderId, open_count: 0, completed_count: 0, items: [] };
    if (path === "/orders") body = [order];
    if (path.includes("taxonomy")) body = { nodes: [] };
    if (path === "/stats/overview") body = {};
    await route.fulfill({ json: body });
  });
  return {
    order, writes, reads,
    allowServices: () => { refuseUnconfirmedService = false; },
  };
}

test("a signed order asks before a new service resets the client's signature (QA C3-01)", async ({ page }) => {
  const { writes } = await prepare(page);
  const serviceWrites = () => writes.filter((write) => write.path === `/orders/${orderId}/leistungen`);
  await page.goto(`/orders/${orderId}?section=services`);
  await page.getByRole("button", { name: "Добавить услугу", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Добавить услугу", exact: true });
  await sheet.getByLabel("Описание", { exact: true }).fill("Flughafentransfer");
  await sheet.getByLabel("Цена за единицу (EUR)", { exact: true }).fill("120");

  // "No": the change is not saved and the sheet says the signature stays.
  let question = "";
  page.once("dialog", (dialog) => {
    question = dialog.message();
    void dialog.dismiss();
  });
  await sheet.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(sheet.getByRole("alert")).toContainText("Изменение не сохранено: подпись клиента сохранена.");
  expect(question).toContain("889,15 €");
  expect(question).toContain("1.317,55 €");
  expect(question).not.toContain("The client signed");
  expect(serviceWrites()).toHaveLength(1);
  expect(serviceWrites()[0].body.confirm_signature_reset).toBe(false);

  // "Yes": the same service is sent again with the confirmation.
  page.once("dialog", (dialog) => void dialog.accept());
  await sheet.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(serviceWrites()).toHaveLength(3);
  expect(serviceWrites()[2].body).toMatchObject({ description: "Flughafentransfer", confirm_signature_reset: true });
});

test("the order shows which version the client signed (QA C3-01)", async ({ page }) => {
  const { order } = await prepare(page);
  order.signed_patient = false;
  order.signed_agency = false;
  order.total_estimated = "1002.20";
  order.client_signature = {
    signed_total: "889.15", signed_date_from: "2026-10-25", signed_date_to: "2026-10-30",
    signed_at: "2026-10-12T10:00:00Z", signed_document_id: "doc-1",
    terms_changed_at: "2026-10-12T11:00:00Z", changes_await_signature: true,
  };
  await page.goto(`/orders/${orderId}`);
  const note = page.getByTestId("order-client-signed-version");
  await expect(note).toContainText("Изменения ждут подписи клиента");
  await expect(note).toContainText("889,15");
  await expect(note).toContainText("12.10.2026");
});

test("service cards name their charge source and show system notes in Russian (QA C3-10, C3-11)", async ({ page }) => {
  const { order } = await prepare(page);
  order.leistungen.push(
    {
      id: "line-report", description: "Dolmetscherbetreuung", quantity: "1.5", unit_price: "95", currency: "EUR",
      vat_rate: "19", is_cost_passthrough: false, status: "approved", provider_id: null, provider_name: null,
      doctor_id: null, doctor_name: null, source_interpreter_report_id: reportId, source_report_hours: "1.5",
      source_appointment_title: "Kardiologie", source_appointment_date: "2026-10-12",
      notes: [
        "Geplante Leistung (3 Std.) durch den freigegebenen Dolmetscherbericht mit den tatsächlichen Stunden ersetzt",
        "Stunden: 1.5",
        "Termin: Kardiologie am 12.10.2026",
        `Bericht: ${reportId}`,
      ].join("\n"),
    },
    {
      id: "line-visit", description: "Organisation der Behandlung", quantity: "1", unit_price: "550", currency: "EUR",
      vat_rate: "0", is_cost_passthrough: false, status: "delivered", provider_id: null, provider_name: null,
      doctor_id: null, doctor_name: null, source_medical_appointment_id: visitId,
      source_appointment_title: "Kardiologie", source_appointment_date: "2026-10-12",
      notes: "Automatisch aus dem abgeschlossenen medizinischen Termin erstellt\nDatum: 12.10.2026",
    },
  );
  await page.goto(`/orders/${orderId}?section=services`);
  const reportLine = page.locator("article").filter({ has: page.getByRole("heading", { name: "Услуги переводчика", exact: true }) });
  await expect(reportLine).toContainText("Отчёт переводчика · 1,5 ч · Kardiologie · 12.10.2026");
  await expect(reportLine).toContainText("Часы: 1,5");
  await expect(reportLine).toContainText("Запланированная услуга (3 ч) заменена фактическими часами");
  await expect(reportLine).not.toContainText(reportId);
  await expect(reportLine).not.toContainText("Stunden: 1.5");
  const visitLine = page.locator("article").filter({ has: page.getByRole("heading", { name: "Организация лечения", exact: true }) });
  await expect(visitLine).toContainText("Завершённый приём · Kardiologie · 12.10.2026");
  await expect(visitLine).toContainText("Автоматически начислено по завершённому медицинскому приёму");
  await expect(visitLine).not.toContainText(visitId);
});

test("the group payer form fits a phone screen (QA C3-04)", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/orders/${orderId}?section=services`);
  const recipient = page.getByRole("combobox", { name: "Получатель счёта" });
  await recipient.scrollIntoViewIfNeeded();
  await expect(recipient).toBeVisible();
  const payerBox = page.locator("div").filter({ has: page.getByText("Плательщик группы", { exact: true }) }).last();
  const container = (await payerBox.boundingBox())!;
  for (const control of await payerBox.locator("select, input:not([type=checkbox])").all()) {
    const box = await control.boundingBox();
    if (!box) continue;
    expect(box.x + box.width).toBeLessThanOrEqual(container.x + container.width + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
});

test("the order workspace loads once when the live connection opens (QA C-33)", async ({ page }) => {
  const { reads } = await prepare(page);
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByText("A-20261012-0010").first()).toBeVisible();
  const detailReads = () => reads.filter((path) => path === `/orders/${orderId}`).length;
  await expect.poll(detailReads).toBeGreaterThanOrEqual(1);
  const afterLoad = detailReads();
  // The socket's own "connected" frame right after the load changes nothing.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("gmed:realtime-event", { detail: { type: "realtime.connected" } })));
  await page.waitForTimeout(800);
  expect(detailReads()).toBe(afterLoad);
  // A real change still reloads the order.
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent("gmed:realtime-event", {
    detail: { type: "order.process_gates_updated", entity_type: "order", entity_id: id, payload: { order_id: id } },
  })), orderId);
  await expect.poll(detailReads).toBeGreaterThan(afterLoad);
});
