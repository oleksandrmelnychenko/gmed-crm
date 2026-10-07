import { expect, test, type Page } from "@playwright/test";

import { lazyPageLoad } from "./lazy-pages";

// The lead risk assessment (trigger flow 2026-10-07) for staff: the panel in
// the documents step of the wizard, decisions with a reason, the four-eyes
// state at level 3, staff's identity document data, the lead's own reason in
// the medical step and the CEO's configuration tab. Mocked API, synthetic data.

// The lead the wizard harness opens through "Lead intake".
const leadId = "00000000-0000-0000-0000-000000000222";
const CEO_ID = "00000000-0000-0000-0000-0000000000c1";
const DEPUTY_ID = "00000000-0000-0000-0000-0000000000d2";

const lead = {
  id: leadId,
  first_name: "Anna",
  last_name: "Muster",
  email: "anna.muster@example.com",
  qualification_status: "in_progress",
  intake_model: "patient_first",
  repeat_patient_id: null,
  wizard_state: {},
  services: [],
  attachments: [],
  readiness: { conversion_ready: false, blocking_reasons: [], steps: [], checks: [] },
};

const medicalUpload = {
  id: "doc-medical-1",
  patient_id: null,
  lead_id: leadId,
  has_active_patient_portal_user: true,
  order_id: null,
  appointment_id: null,
  patient_pid: null,
  patient_name: null,
  order_number: null,
  appointment_title: null,
  auto_name: "Befund",
  original_filename: "mrt-befund.pdf",
  art: "befund",
  category: "medical",
  status: "active",
  visibility: "internal",
  is_medical: true,
  mime_type: "application/pdf",
  file_size: 2048,
  has_stored_file: true,
  klinik: null,
  ursprung: null,
  document_direction: null,
  document_variant: null,
  document_language: null,
  access_category: "medical",
  document_date: null,
  source_person: null,
  source_institution: null,
  addressee_person: null,
  addressee_institution: null,
  financial_status: null,
  payment_due_date: null,
  payment_date: null,
  payment_method: null,
  generated_template_id: null,
  notes: null,
  uploaded_by_name: "Anna Muster",
  version_root_document_id: "doc-medical-1",
  replaces_document_id: null,
  superseded_by_document_id: null,
  version_number: 1,
  version_count: 1,
  is_latest_version: true,
  file_deleted_at: null,
  file_deleted_by: null,
  file_deleted_by_name: null,
  file_delete_reason: null,
  created_at: "2026-10-06T09:00:00Z",
  updated_at: "2026-10-06T09:00:00Z",
  share_count: 0,
  shared_to_current: false,
  deletion_protected: false,
  data_sensitivity: "medical",
  needs_categorization: false,
  classification_suggestion: null,
};

const portalIntake = {
  lead_id: leadId,
  fill_mode: "patient",
  patient_fields: {},
  patient_payer: null,
  progress: { filled: 9, total: 12, documents: 1, submitted_at: "2026-10-07T07:00:00Z" },
  submitted_at: "2026-10-07T07:00:00Z",
  submitted_by: "self",
  consents: [],
  uploads: [{ document_id: medicalUpload.id, uploaded_at: medicalUpload.created_at, access_kind: "self", reviewed_at: null }],
  uploads_hidden: false,
  guardians: { links: [], candidates: [] },
  minor: false,
  can_issue: true,
  can_review_uploads: true,
  identification: {
    salutation: "ms",
    birth_place: "Kyiv",
    birth_country: "UA",
    contact_channels: ["email"],
    id_document_type: "passport",
    id_document_number: null,
    id_issuing_country: "UA",
    id_valid_until: "2031-04-30",
    pep_self: false,
    pep_related: false,
    sanctions_links: false,
  },
  identification_updated_at: "2026-10-07T06:50:00Z",
  identity_documents: [{ id: "doc-pass-1", file_name: "pass-front.pdf", uploaded_at: "2026-10-07T06:40:00Z", reviewed: false }],
  // 13.1: the lead's own words (10:00 in Berlin).
  patient_request_reason: { text: "Schmerzen im rechten Knie seit März, MRT liegt bei.", updated_at: "2026-10-07T08:00:00Z" },
};

type Proposal = { id: string; decision: string; reason: string; decided_by: string; decided_by_name: string; decided_at: string };

type RiskState = {
  level: number;
  points: number;
  knockout: boolean;
  status: string;
  triggers: unknown[];
  requested: string[];
  proposal: Proposal | null;
  decisions: unknown[];
};

function levelTwoState(): RiskState {
  return {
    level: 2,
    points: 4,
    knockout: false,
    status: "review_required",
    triggers: [
      { key: "T1", subject: "patient", variant: "list_1", points: 2, active: true, first_fired_at: "2026-10-07T07:00:00Z", blocks: ["F"] },
      { key: "T2", subject: "patient", variant: "list_1", points: 2, active: true, first_fired_at: "2026-10-07T07:00:00Z", blocks: ["F"] },
      { key: "T4", subject: "payer", variant: null, points: 1, active: true, first_fired_at: "2026-10-07T07:00:00Z", blocks: ["A", "B", "C", "D"] },
      { key: "T5", subject: "payer", variant: null, points: 2, active: true, first_fired_at: "2026-10-07T07:00:00Z", blocks: ["A", "B"] },
    ],
    requested: [],
    proposal: null,
    decisions: [],
  };
}

function levelThreeState(): RiskState {
  return {
    level: 3,
    points: 2,
    knockout: true,
    status: "review_required",
    triggers: [
      { key: "T14", subject: "patient", variant: null, points: 0, active: true, first_fired_at: "2026-10-07T07:00:00Z", blocks: ["H"] },
      { key: "T12", subject: "patient", variant: null, points: 2, active: true, first_fired_at: "2026-10-07T07:00:00Z", blocks: ["I"] },
    ],
    requested: [],
    proposal: null,
    decisions: [],
  };
}

async function mount(page: Page, initial: RiskState, me: { id: string } = { id: CEO_ID }) {
  const risk = initial;
  const calls: { method: string; path: string; body: unknown }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "lead-risk-assessment-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    const body = request.postData() ? (() => { try { return request.postDataJSON(); } catch { return null; } })() : null;
    if (method !== "GET") calls.push({ method, path, body });
    let response: unknown = [];
    const assessment = () => ({
      started_at: "2026-10-07T07:00:00Z",
      status: risk.status,
      level: risk.level,
      points: risk.points,
      patient_points: risk.points,
      payer_points: risk.level === 2 ? 3 : 0,
      knockout: risk.knockout,
      triggers: risk.triggers,
      blocks: risk.level === 2
        ? {
            A: { open: true, party: "cabinet", answered: false, missing: ["funds_source"] },
            B: { open: true, party: "cabinet", answered: false, missing: ["payment_background"] },
            F: { open: true, party: "cabinet", answered: true, missing: [] },
          }
        : { I: { open: true, party: "cabinet", answered: false, missing: ["id_document_upload"] } },
      requested_blocks: risk.requested,
      follow_up_answered_at: null,
      review_notice: true,
      preview: null,
      decisions: risk.decisions,
      history: [{ id: "e1", at: "2026-10-07T07:00:00Z", kind: "started", level: risk.level, points: risk.points, cause: "cabinet", actor_name: null }],
      pending_proposal: risk.proposal,
      config_version: 1,
      can_decide: true,
      can_confirm: Boolean(risk.proposal && risk.proposal.decided_by !== me.id),
      can_withdraw: Boolean(risk.proposal && risk.proposal.decided_by === me.id),
      four_eyes_required: risk.level === 3,
      reviewers_available: 2,
    });
    if (path === "/me") {
      response = me.id === CEO_ID
        ? { id: CEO_ID, email: "ceo@example.com", name: "Test CEO", role: "ceo", created_at: "2026-01-01T00:00:00Z" }
        : { id: DEPUTY_ID, email: "ben.muster@example.com", name: "Ben Muster", role: "patient_manager", created_at: "2026-01-01T00:00:00Z" };
    } else if (path === "/sanctions/check") {
      response = { status: "clear", list_version_date: "2026-10-01" };
    } else if (path === `/leads/${leadId}`) {
      response = lead;
    } else if (path === `/leads/${leadId}/portal-intake`) {
      response = portalIntake;
    } else if (path === "/documents" && url.searchParams.get("lead_id") === leadId) {
      response = [medicalUpload];
    } else if (path === `/leads/${leadId}/risk-assessment` && method === "GET") {
      response = assessment();
    } else if (path === `/leads/${leadId}/risk-assessment/decisions` && method === "POST") {
      const input = body as { decision: string; reason: string; blocks?: string[] };
      const at = "2026-10-07T10:00:00Z";
      const decidedByName = me.id === CEO_ID ? "Test CEO" : "Ben Muster";
      if (input.decision !== "request_more" && risk.level === 3) {
        risk.proposal = { id: "d-1", decision: input.decision, reason: input.reason, decided_by: me.id, decided_by_name: decidedByName, decided_at: at };
        risk.status = "proposed";
      } else if (input.decision === "request_more") {
        risk.requested = [...new Set([...risk.requested, ...(input.blocks ?? [])])].sort();
        risk.status = "awaiting_answers";
      } else {
        risk.status = input.decision === "release" ? "released" : "rejected";
      }
      risk.decisions = [...risk.decisions, { id: `d-${risk.decisions.length + 1}`, ...input, level: risk.level, decided_by_name: decidedByName, decided_at: at }];
      response = assessment();
    } else if (path === `/leads/${leadId}/risk-assessment/decisions/d-1/confirm` && method === "POST") {
      risk.status = risk.proposal?.decision === "release" ? "released" : "rejected";
      risk.proposal = null;
      response = assessment();
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/lead-risk-assessment-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import('/tests/e2e/fixtures/repeat-intake-harness.tsx').catch(error => {
      const reloads = Number(sessionStorage.getItem('harness-reloads') ?? 0);
      if (reloads >= 3) throw error;
      sessionStorage.setItem('harness-reloads', String(reloads + 1));
      location.reload();
    });</script></body></html>`,
    }),
  );
  const open = async (tab: "Документы" | "Медицинская характеристика") => {
    await page.goto("/lead-risk-assessment-harness");
    await page.getByRole("button", { name: "Lead intake", exact: true }).click();
    const wizard = page.getByRole("dialog", { name: "Оформление обращения", exact: true });
    await wizard.getByRole("tab", { name: tab, exact: false }).click();
    return wizard;
  };
  return { calls, open, risk, me };
}

test("level 2: staff see points and level, request more and release with a reason", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { calls, open } = await mount(page, levelTwoState());
  const wizard = await open("Документы");
  const panel = wizard.getByTestId("lead-risk-assessment");

  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("lead-risk-level")).toHaveText("Уровень 2");
  await expect(panel.getByTestId("lead-risk-status")).toHaveText("Нужно решение");
  await expect(panel.getByTestId("lead-risk-points")).toContainText("4 (пациент 4 · плательщик 3)");
  await expect(panel.getByTestId("lead-risk-trigger-T1")).toContainText("Гражданство пациента в списке стран · список 1");
  await expect(panel.getByTestId("lead-risk-trigger-T5")).toContainText("Плательщик не супруг(а), родитель или ребёнок");
  await expect(panel.getByTestId("lead-risk-block-A")).toContainText("не хватает: источник средств");
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-risk-level-2.png"), animations: "disabled" });

  // Request more: the blocks of the triggers are pre-selected; the reason is mandatory.
  await panel.getByTestId("lead-risk-decide-request_more").click();
  const ask = page.getByRole("dialog", { name: "Запросить дополнительные сведения" });
  await expect(ask.getByTestId("lead-risk-block-chooser")).toBeVisible();
  await ask.getByLabel("Причина").fill("kurz");
  await expect(ask.getByRole("button", { name: "Запросить сведения", exact: true })).toBeDisabled();
  await ask.getByLabel("Причина").fill("Herkunft der Mittel und Beziehung zum Zahler klären");
  await ask.getByRole("button", { name: "Запросить сведения", exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(panel.getByTestId("lead-risk-status")).toHaveText("Ждём ответы");
  const requestMore = calls.find((call) => call.path.endsWith("/risk-assessment/decisions"));
  expect(requestMore?.body).toEqual({
    decision: "request_more",
    reason: "Herkunft der Mittel und Beziehung zum Zahler klären",
    blocks: ["A", "B", "C", "D", "F"],
  });

  // Release at level 2: effective at once.
  await panel.getByTestId("lead-risk-decide-release").click();
  const release = page.getByRole("dialog", { name: "Разрешить работу с обращением" });
  await release.getByLabel("Причина").fill("Angaben plausibel, Nachweis liegt vor");
  await release.getByRole("button", { name: "Разрешить", exact: true }).click();
  await expect(release).toHaveCount(0);
  await expect(panel.getByTestId("lead-risk-status")).toHaveText("Разрешено");
  expect(calls.filter((call) => call.path.endsWith("/risk-assessment/decisions")).at(-1)?.body).toEqual({
    decision: "release",
    reason: "Angaben plausibel, Nachweis liegt vor",
  });

  // Staff enter the identity document data from the scan.
  const idForm = wizard.getByTestId("lead-id-data");
  await idForm.scrollIntoViewIfNeeded();
  await idForm.locator('input[name="id_document_number"]').fill("FA1234567");
  await idForm.getByLabel("Документ нечитаем (запросить новый скан)").check();
  await idForm.getByTestId("lead-id-data-save").click();
  await expect.poll(() => calls.find((call) => call.path === `/leads/${leadId}/identity-document-data`)?.body).toEqual({
    id_document_type: "passport",
    id_document_number: "FA1234567",
    id_issuing_authority: null,
    id_issuing_country: "UA",
    id_issued_on: null,
    id_valid_until: "2031-04-30",
    id_document_unreadable: true,
  });
  expect(calls.find((call) => call.path === `/leads/${leadId}/identity-document-data`)?.method).toBe("PUT");
  await page.screenshot({ path: testInfo.outputPath("lead-id-data.png"), animations: "disabled" });

  // On a phone the panel must not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await wizard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test("level 3: a proposal waits for a second reviewer, who confirms it", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const session = await mount(page, levelThreeState());
  let wizard = await session.open("Документы");
  let panel = wizard.getByTestId("lead-risk-assessment");

  await expect(panel.getByTestId("lead-risk-level")).toHaveText("Уровень 3");
  await expect(panel.getByTestId("lead-risk-knockout")).toHaveText("K.o.");
  await expect(panel.getByTestId("lead-risk-actions")).toContainText("Уровень 3: разрешение и отклонение — это предложение");
  await expect(panel.getByTestId("lead-risk-second-reviewer-missing")).toHaveCount(0);

  await panel.getByTestId("lead-risk-decide-release").click();
  const propose = page.getByRole("dialog", { name: "Предложить разрешение" });
  await expect(propose).toContainText("принцип четырёх глаз");
  await propose.getByLabel("Причина").fill("PEP-Status geprüft, Amt seit 2019 beendet");
  await propose.getByRole("button", { name: "Разрешить", exact: true }).click();
  await expect(propose).toHaveCount(0);

  // The proposer sees the four-eyes state and may only withdraw.
  const proposal = panel.getByTestId("lead-risk-proposal");
  await expect(panel.getByTestId("lead-risk-status")).toHaveText("Ждёт второго проверяющего");
  await expect(proposal).toContainText("Предложение: Разрешить — Test CEO, 07.10.2026 12:00");
  await expect(proposal.getByTestId("lead-risk-four-eyes")).toBeVisible();
  await expect(proposal.getByRole("button", { name: "Отозвать" })).toBeVisible();
  await expect(proposal.getByRole("button", { name: "Подтвердить" })).toHaveCount(0);
  await expect(panel.getByTestId("lead-risk-decide-release")).toHaveCount(0);
  await proposal.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-risk-level-3-proposed.png"), animations: "disabled" });

  // A second reviewer (the CEO's deputy) confirms with an own reason.
  session.me.id = DEPUTY_ID;
  wizard = await session.open("Документы");
  panel = wizard.getByTestId("lead-risk-assessment");
  const pending = panel.getByTestId("lead-risk-proposal");
  await expect(pending.getByRole("button", { name: "Отозвать" })).toHaveCount(0);
  await pending.getByRole("button", { name: "Подтвердить" }).click();
  const confirm = page.getByRole("dialog", { name: "Подтвердить решение: Разрешить" });
  await confirm.getByLabel("Причина").fill("Zweitprüfung: Unterlagen vollständig");
  await confirm.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(panel.getByTestId("lead-risk-status")).toHaveText("Разрешено");
  await expect(panel.getByTestId("lead-risk-proposal")).toHaveCount(0);
  expect(session.calls.find((call) => call.path.endsWith("/decisions/d-1/confirm"))?.body).toEqual({
    reason: "Zweitprüfung: Unterlagen vollständig",
  });
});

test("the lead's own reason stands above staff's concern and can be taken over", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { open } = await mount(page, levelTwoState());
  const wizard = await open("Медицинская характеристика");
  const block = wizard.getByTestId("lead-patient-concern");

  await expect(block).toContainText("Со слов пациента");
  await expect(block.getByTestId("lead-patient-concern-date")).toHaveText("07.10.2026 10:00");
  await expect(block.getByTestId("lead-patient-concern-text")).toHaveText("Schmerzen im rechten Knie seit März, MRT liegt bei.");
  await expect(block.getByTestId("lead-patient-concern-files")).toContainText("mrt-befund.pdf");
  await expect(block.getByTestId("lead-patient-concern-files")).toContainText("06.10.2026");

  // Above the field "Причина обращения".
  const concern = wizard.locator("textarea#lead-wizard-concern");
  const blockBox = await block.boundingBox();
  const concernBox = await concern.boundingBox();
  expect(blockBox!.y + blockBox!.height).toBeLessThanOrEqual(concernBox!.y);

  // Empty concern: taken over at once.
  await block.getByTestId("lead-patient-concern-transfer").click();
  await expect(concern).toHaveValue("Schmerzen im rechten Knie seit März, MRT liegt bei.");
  await expect(block.getByTestId("lead-patient-concern-transfer")).toBeDisabled();

  // Staff's own text: replaced only after the confirmation.
  await concern.fill("Knie rechts, Termin Orthopädie");
  await block.getByTestId("lead-patient-concern-transfer").click();
  await expect(block.getByTestId("lead-patient-concern-confirm")).toBeVisible();
  await expect(concern).toHaveValue("Knie rechts, Termin Orthopädie");
  await block.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-patient-concern.png"), animations: "disabled" });
  await block.getByTestId("lead-patient-concern-replace").click();
  await expect(concern).toHaveValue("Schmerzen im rechten Knie seit März, MRT liegt bei.");
});

test("the CEO saves the risk configuration and sees the review queue", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  let config: Record<string, unknown> = {
    version: 1,
    list_1: ["RU", "SY"],
    list_2: ["IR", "KP", "MM"],
    points: { T1: [2, 4], T2: [2, 4], T3: 1, T4: 1, T5: 2, T6: [2, 4], T7: 1, T8: 2, T9: 4, T10: 1, T11: 2, T12: 2, T13: 1 },
    knockout: ["T14", "T15", "T16"],
    threshold_1_eur: 10000,
    threshold_2_eur: 25000,
    level_2_from: 4,
    level_3_from: 9,
    level_2_blocks_automatic: true,
    reviewers: [],
  };
  const puts: unknown[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "risk-config-token");
    localStorage.setItem("gmed_refresh_token", "risk-config-refresh");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") {
      body = { id: CEO_ID, name: "Test CEO", role: "ceo", email: "ceo@example.com" };
    } else if (path === "/sanctions/hits") {
      body = { hits: [], counts: { open: 0, false_positive: 0, confirmed: 0 } };
    } else if (path === "/compliance/risk-config" && request.method() === "PUT") {
      const sent = request.postDataJSON() as Record<string, unknown>;
      puts.push(sent);
      config = { ...sent, version: Number(config.version) + 1 };
      body = config;
    } else if (path === "/compliance/risk-config") {
      body = { config, eligible_reviewers: [{ id: DEPUTY_ID, name: "Ben Muster", role: "patient_manager" }] };
    } else if (path === "/compliance/risk-reviews") {
      body = [
        {
          lead_id: leadId,
          name: "Anna Muster",
          level: 3,
          status: "proposed",
          since: "2026-10-06T08:00:00Z",
          pending_proposal: { decision: "release", decided_by_name: "Test CEO", decided_at: "2026-10-07T08:00:00Z" },
        },
      ];
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/sanctions?tab=risk");
  const settings = page.getByTestId("risk-config");
  await expect(settings).toBeVisible(lazyPageLoad);
  await expect(settings.getByTestId("risk-config-version")).toHaveText("Версия 1");
  await expect(settings.getByTestId("risk-points")).toContainText("Оплата наличными или криптовалютой");

  const queue = page.getByTestId("risk-review-queue");
  await expect(queue.getByTestId("risk-review-row")).toContainText("Anna Muster");
  await expect(queue.getByTestId("risk-review-row")).toContainText("Уровень 3");
  await expect(queue.getByTestId("risk-review-row")).toContainText("Предложение: Разрешить — Test CEO, 07.10.2026 10:00");

  // A wrong bound is refused before it is sent.
  const save = settings.getByTestId("risk-config-save");
  await settings.getByTestId("risk-level-3-from").fill("4");
  await expect(settings.getByTestId("risk-config-errors")).toContainText("Уровень 2 начинается раньше уровня 3");
  await expect(save).toBeDisabled();

  await settings.getByTestId("risk-level-3-from").fill("10");
  await settings.getByTestId("risk-points-T9").fill("5");
  await settings.getByLabel("Ben Muster").check();
  await expect(save).toBeEnabled();
  await settings.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("risk-config.png"), animations: "disabled", fullPage: true });
  await save.click();

  await expect(page.getByText("Настройки оценки риска сохранены")).toBeVisible();
  await expect(settings.getByTestId("risk-config-version")).toHaveText("Версия 2");
  expect(puts).toHaveLength(1);
  expect(puts[0]).toMatchObject({
    level_2_from: 4,
    level_3_from: 10,
    reviewers: [DEPUTY_ID],
    list_2: ["IR", "KP", "MM"],
    points: { T9: 5, T1: [2, 4] },
  });
});
