import { expect, test, type Page } from "@playwright/test";

// Owner 2026-10-12: a supplier cost GMED absorbs instead of re-billing it
// (patient card → «Выставление пациенту»), and the staff-only internal note of
// a quote (contracts → quote sheet).

const patientId = "00000000-0000-0000-0000-000000000301";
const externalId = "00000000-0000-0000-0000-000000000701";
const quoteId = "00000000-0000-0000-0000-000000000501";
const waiverId = "00000000-0000-0000-0000-000000000801";

type Waiver = {
  id: string;
  amount_gross: string;
  reason: string;
  created_at: string;
  created_by_name: string;
  reversed_at: string | null;
  reversal_reason: string | null;
};

async function prepare(page: Page, role = "billing") {
  const errors: string[] = [];
  const writes: { path: string; body: unknown }[] = [];
  const state = { waivers: [] as Waiver[], refuseWaiver: false, quoteNote: "Angebot erst nach Rückruf senden." as string | null };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "billing-tail-test");
    localStorage.setItem("gmed_refresh_token", "billing-tail-refresh");
    localStorage.setItem("gmed_lang", "ru");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  const expense = () => {
    const waived = state.waivers.filter((waiver) => !waiver.reversed_at).reduce((sum, waiver) => sum + Number(waiver.amount_gross), 0);
    return {
      id: externalId,
      external_invoice_number: "HOTEL-4711",
      provider_name: "Hotel Beispiel GmbH",
      invoice_date: "2026-10-01",
      status: "paid",
      paid_by: "agency",
      currency: "EUR",
      amount_gross: "100",
      company_paid_gross: "100",
      remaining_provider_liability_gross: "0",
      patient_receivable_gross: String(100 - waived),
      allocated_receivable_gross: "40",
      remaining_receivable_gross: String(60 - waived),
      waived_receivable_gross: String(waived),
      rebilling_waivers: state.waivers,
      order_service_billed: false,
      source_order_id: null,
      source_order_number: null,
      latest_patient_invoice_id: null,
      latest_patient_invoice_number: null,
      latest_patient_invoice_status: null,
      billable: 60 - waived > 0,
    };
  };
  const quote = () => ({
    id: quoteId, order_id: "order-1", order_number: "A-TEST-1", contract_id: null, patient_id: patientId,
    patient_name: "Mia Muster", patient_pid: "P-TEST-0301", quote_number: "KV-TEST-1", currency: "EUR",
    status: "accepted", total_net: "100", total_vat: "19", total_gross: "119", valid_until: null,
    paid_amount: "0", paid_at: null, notes: "Bitte vor Behandlungsbeginn überweisen.",
    internal_note: state.quoteNote, version_count: 1, current_version_number: 1, superseded_quotes: [],
    created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z", line_items: [],
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ path, body });
      if (path === `/external-invoices/${externalId}/rebilling-waivers`) {
        if (state.refuseWaiver) {
          return route.fulfill({ status: 409, json: { error: "rebilling_waiver_nothing_to_waive", message: "nothing" } });
        }
        const waiver = { id: waiverId, amount_gross: "60", reason: String(body.reason), created_at: "2026-10-12T09:00:00Z", created_by_name: "Billing QA", reversed_at: null, reversal_reason: null };
        state.waivers = [waiver];
        return route.fulfill({ status: 201, json: waiver });
      }
      if (path === `/external-invoices/${externalId}/rebilling-waivers/${waiverId}/reversal`) {
        state.waivers = state.waivers.map((waiver) => ({ ...waiver, reversed_at: "2026-10-12T10:00:00Z", reversal_reason: String(body.reason) }));
        return route.fulfill({ json: state.waivers[0] });
      }
      if (path === `/quotes/${quoteId}/internal-note`) {
        state.quoteNote = (body.internal_note as string | null) ?? null;
        return route.fulfill({ json: quote() });
      }
    }
    let json: unknown = [];
    if (path === "/me") json = { id: "qa", name: "Billing QA", email: "qa@example.org", role, created_at: "2026-01-01T00:00:00Z" };
    if (path === "/auth/refresh") json = { access_token: "billing-tail-test", refresh_token: "billing-tail-refresh", expires_in: 900 };
    if (path === `/patients/${patientId}`) json = { id: patientId, patient_id: "P-TEST-0301", first_name: "Mia", last_name: "Muster", is_active: true, birth_date: "1980-01-10", gender: "female", languages: ["de"], functional_labels: [], contacts: [], created_at: "2026-01-01T00:00:00Z" };
    if (path.includes("taxonomy")) json = { nodes: [] };
    if (path.includes("workflow-checklist")) json = { items: [], open_count: 0, completed_count: 0 };
    if (path === "/stats/overview") json = {};
    if (path === `/patients/${patientId}/billing-workspace`) json = { patient_id: patientId, patient_pid: "P-TEST-0301", patient_name: "Mia Muster", orders: [], expenses: [expense()] };
    if (path === "/quotes") json = [quote()];
    if (path === `/quotes/${quoteId}`) json = quote();
    await route.fulfill({ json });
  });
  return { errors, writes, state };
}

test("a re-billed cost GMED absorbs needs a reason and can be put back", async ({ page }) => {
  const api = await prepare(page);
  await page.goto(`/patients/${patientId}?tab=billing`);
  const billing = page.getByTestId("patient-billing");
  const waive = billing.getByRole("button", { name: "Не перевыставлять", exact: true });
  await expect(waive).toBeVisible();

  // A refusal of the server is shown translated.
  api.state.refuseWaiver = true;
  await waive.click();
  let dialog = page.getByTestId("rebilling-waiver-dialog");
  await expect(dialog).toContainText("Расход за счёт GMED");
  await expect(dialog).toContainText("60,00");
  const submit = dialog.getByRole("button", { name: "Не перевыставлять", exact: true });
  await expect(submit).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Причина", exact: true }).fill("Kulanz für Mia Muster");
  await submit.click();
  await expect(dialog).toContainText("По этому счёту поставщика не осталось суммы для перевыставления.");
  // A typed reason is not dropped silently.
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Закрыть без сохранения", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  api.state.refuseWaiver = false;
  await waive.click();
  dialog = page.getByTestId("rebilling-waiver-dialog");
  await dialog.getByRole("textbox", { name: "Причина", exact: true }).fill("  Kulanz für Mia Muster  ");
  await dialog.getByRole("button", { name: "Не перевыставлять", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const waiverWrites = api.writes.filter((write) => write.path.endsWith("/rebilling-waivers"));
  expect(waiverWrites).toHaveLength(2);
  expect(waiverWrites[1].body).toMatchObject({ reason: "Kulanz für Mia Muster" });
  expect(typeof (waiverWrites[1].body as { request_id?: unknown }).request_id).toBe("string");
  await expect(billing.getByText(/За счёт GMED · 60,00/).filter({ visible: true })).toBeVisible();
  await expect(billing.getByRole("button", { name: "Не перевыставлять", exact: true })).toHaveCount(0);

  await billing.getByRole("button", { name: "Вернуть в перевыставление", exact: true }).click();
  dialog = page.getByTestId("rebilling-waiver-dialog");
  await expect(dialog).toContainText("Вернуть расход в перевыставление");
  await dialog.getByRole("textbox", { name: "Причина", exact: true }).fill("Patient zahlt doch selbst");
  await dialog.getByRole("button", { name: "Вернуть в перевыставление", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.writes.at(-1)).toEqual({
    path: `/external-invoices/${externalId}/rebilling-waivers/${waiverId}/reversal`,
    body: { reason: "Patient zahlt doch selbst" },
  });
  await expect(billing.getByRole("button", { name: "Не перевыставлять", exact: true })).toBeVisible();
  expect(api.errors).toEqual([]);
});

test("a patient manager sees no waiver actions", async ({ page }) => {
  const api = await prepare(page, "patient_manager");
  await page.goto(`/patients/${patientId}?tab=billing`);
  await expect(page.getByTestId("patient-billing").getByText("HOTEL-4711").filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Не перевыставлять", exact: true })).toHaveCount(0);
  expect(api.errors).toEqual([]);
});

test("the quote's internal note is saved on its own and guards the sheet while unsaved", async ({ page }) => {
  const api = await prepare(page, "ceo");
  await page.goto(`/contracts?quote=${quoteId}`);
  const editor = page.getByTestId("quote-internal-note");
  await editor.scrollIntoViewIfNeeded();
  const note = editor.getByRole("textbox", { name: "Внутренняя заметка (не печатается)", exact: true });
  await expect(note).toHaveValue("Angebot erst nach Rückruf senden.");
  // The printed customer remark stays a separate field.
  await expect(page.getByText("Bitte vor Behandlungsbeginn überweisen.", { exact: true }).first()).toBeVisible();

  await note.fill("Zahlung in zwei Raten zugesagt.");
  // Unsaved: closing the sheet asks first.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(note).toHaveValue("Zahlung in zwei Raten zugesagt.");

  await editor.getByRole("button", { name: "Сохранить заметку", exact: true }).click();
  await expect.poll(() => api.writes.filter((write) => write.path.endsWith("/internal-note"))).toEqual([
    { path: `/quotes/${quoteId}/internal-note`, body: { internal_note: "Zahlung in zwei Raten zugesagt." } },
  ]);
  await expect(editor.getByRole("button", { name: "Сохранить заметку", exact: true })).toBeDisabled();
  // Saved: the sheet closes without asking.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(editor).toHaveCount(0);
  expect(api.errors).toEqual([]);
});
