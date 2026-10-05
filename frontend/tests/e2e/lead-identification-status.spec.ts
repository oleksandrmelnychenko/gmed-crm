import { expect, test, type Page } from "@playwright/test";

// Identification by qualified electronic signature in the documents step of
// the staff wizard (§ 12 Abs. 1 GwG): the labels per person and the manual
// confirmation of the payment from the own account. Mocked API, synthetic data.

// The lead the wizard harness opens through "Lead intake".
const leadId = "00000000-0000-0000-0000-000000000222";

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

type Person = {
  qes: { signed_at: string; test_mode: boolean } | null;
  own_account_payment: { confirmed_at: string; confirmed_by_name: string | null; note: string | null } | null;
};
type Representative = Person & { id: string; subject: string; name: string; relation: string; has_email: boolean };
/** A server that knows minors also sends `minor` and `representatives`; an older one does not. */
type Status = { contract_partner: Person; payer: Person | null; minor?: boolean; representatives?: Representative[] };
type Subject = "contract_partner" | "payer";

// 11:20 in Berlin.
const SIGNED = { signed_at: "2026-10-05T09:20:00Z", test_mode: false };
// 12:00 in Berlin; the mocked server confirms as the signed-in user.
const CONFIRMED = { confirmed_at: "2026-10-05T10:00:00Z", confirmed_by_name: "Intake QA", note: null };

function payerDeclaration(kind: "self" | "third_party") {
  const thirdParty = kind === "third_party";
  return {
    declaration: {
      payer_kind: kind,
      acts_on_own_account: true,
      own_account_answered: true,
      beneficial_owner_name: null,
      beneficial_owner_note: null,
      source_of_funds: "savings",
      source_of_funds_description: null,
      source_of_funds_document_id: null,
      first_name: thirdParty ? "Viktor" : null,
      last_name: thirdParty ? "Zahler" : null,
      date_of_birth: thirdParty ? "1970-03-02" : null,
      place_of_birth: thirdParty ? "Wien" : null,
      street: thirdParty ? "Musterweg 1" : null,
      zip: thirdParty ? "1010" : null,
      city: thirdParty ? "Wien" : null,
      country: thirdParty ? "AT" : null,
      citizenships: thirdParty ? ["AT"] : [],
      relationship: thirdParty ? "brother" : null,
      email: thirdParty ? "viktor.zahler@example.com" : null,
      phone: null,
      payer_informed_at: thirdParty ? "2026-10-05T09:00:00Z" : null,
      payer_informed_by: null,
      updated_at: "2026-10-05T09:15:00Z",
    },
    status: {
      complete: true,
      missing: [],
      cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null },
      order_id: null,
      order_number: null,
      client_signed_order: false,
      agency_signed_order: false,
      agency_may_sign: false,
      agency_blocking: [],
      aml_countries: thirdParty ? ["AT"] : [],
    },
  };
}

type Mock = {
  lang: "ru" | "de";
  /** What `GET …/identification-status` answers; `null` stands for a backend without the endpoint. */
  status: Status | null;
  payerKind?: "self" | "third_party";
  /** The server refuses to change the confirmation. */
  refuse?: boolean;
  /** The lead became a minor after this tab loaded the status: the server refuses the child's line. */
  refuseMinor?: boolean;
  /** What the portal state says about the lead's age. */
  minor?: boolean;
};

async function mount(page: Page, mock: Mock) {
  const state = { status: mock.status, statusRequests: 0 };
  const calls: Array<{ subject: string; body: unknown }> = [];
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "lead-identification-token");
  }, mock.lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const confirmation = path.match(/^\/leads\/[^/]+\/identification-status\/([^/]+)\/own-account-payment$/);
    let response: unknown = [];
    if (path === "/me") {
      response = { id: "ident-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    } else if (path === "/sanctions/check") {
      response = { status: "clear", list_version_date: "2026-10-01" };
    } else if (path === `/leads/${leadId}`) {
      response = lead;
    } else if (path === `/leads/${leadId}/portal-intake`) {
      response = {
        lead_id: leadId,
        fill_mode: "patient",
        patient_fields: {},
        patient_payer: null,
        progress: { filled: 9, total: 12, documents: 0, submitted_at: null },
        submitted_at: null,
        submitted_by: null,
        consents: [],
        uploads: [],
        uploads_hidden: false,
        guardians: { links: [], candidates: [] },
        minor: mock.minor ?? false,
        can_issue: true,
        can_review_uploads: true,
      };
    } else if (path === `/leads/${leadId}/payer-declaration`) {
      response = payerDeclaration(mock.payerKind ?? "self");
    } else if (path === `/leads/${leadId}/identification-status`) {
      state.statusRequests += 1;
      response = state.status ?? [];
    } else if (confirmation && request.method() === "POST") {
      const subject = confirmation[1] as Subject;
      const body = request.postDataJSON() as { confirmed?: boolean };
      calls.push({ subject, body });
      if (mock.refuseMinor) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ error: "identification_subject_minor", message: "The lead is a minor" }),
        });
        return;
      }
      if (mock.refuse) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "lead_converted", message: "The lead is converted" }),
        });
        return;
      }
      const person = state.status?.[subject];
      if (state.status && person) {
        state.status = {
          ...state.status,
          [subject]: { ...person, own_account_payment: body.confirmed ? CONFIRMED : null },
        };
      }
      response = state.status ?? [];
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  // The wizard harness of the repeat-intake spec, under its own address.
  await page.route("**/lead-identification-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    // A cold dev server answers "504 Outdated Optimize Dep" on the first import; reload like Vite's client would.
    import('/tests/e2e/fixtures/repeat-intake-harness.tsx').catch(error => {
      const reloads = Number(sessionStorage.getItem('harness-reloads') ?? 0);
      if (reloads >= 3) throw error;
      sessionStorage.setItem('harness-reloads', String(reloads + 1));
      location.reload();
    });</script></body></html>`,
    }),
  );
  await page.goto("/lead-identification-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: mock.lang === "ru" ? "Оформление обращения" : "Lead-Aufnahme", exact: true });
  await wizard.getByRole("tab", { name: mock.lang === "ru" ? "Документы" : "Unterlagen", exact: false }).click();
  const block = wizard.getByTestId("lead-identification-status");
  const row = (subject: Subject) => ({
    line: block.getByTestId(`lead-identification-${subject}`),
    qes: block.getByTestId(`lead-identification-qes-${subject}`),
    payment: block.getByTestId(`lead-identification-payment-${subject}`),
  });
  return { wizard, block, row, calls, statusRequests: () => state.statusRequests };
}

test("without a qualified signature the labels say so, and only the patient is listed while the patient pays", async ({ page }) => {
  const { wizard, block, row } = await mount(page, {
    lang: "ru",
    status: { contract_partner: { qes: null, own_account_payment: null }, payer: null },
  });
  await expect(block).toContainText("Идентификация по квалифицированной подписи");
  const patient = row("contract_partner");
  await expect(patient.line).toContainText("Пациент");
  await expect(patient.qes).toHaveText("Квалифицированной подписи ещё нет");
  await expect(patient.qes).toHaveAttribute("data-tone", "neutral");
  // The payment label is always there, with the button to confirm it.
  await expect(patient.payment).toHaveText("Ожидается платёж с собственного счёта");
  await expect(patient.payment).toHaveAttribute("data-tone", "warning");
  await expect(patient.line.getByRole("button")).toHaveText("Подтвердить платёж");
  await expect(row("payer").line).toHaveCount(0);
  await expect(block).toContainText(
    "§ 12 Abs. 1 GwG: к квалифицированной подписи нужен платёж со счёта на имя этого человека. Это не блокирует работу.",
  );
  // Nothing is blocked: the sheet can be created as before.
  await expect(wizard.getByTestId("gwg-identification-actions").getByRole("button")).toBeEnabled();
});

test("staff confirm the payment from the own account and take it back", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, block, row, calls } = await mount(page, {
    lang: "ru",
    status: { contract_partner: { qes: SIGNED, own_account_payment: null }, payer: null },
  });
  const patient = row("contract_partner");
  await expect(patient.qes).toHaveText("Квалифицированная подпись · 05.10.2026");
  await expect(patient.qes).toHaveAttribute("data-tone", "success");
  await expect(patient.payment).toHaveText("Ожидается платёж с собственного счёта");
  await expect(patient.payment).toHaveAttribute("data-tone", "warning");

  // Above the lead's own statements, inside the section of the sheet.
  const statements = wizard.getByTestId("lead-gwg-statements");
  const blockBox = await block.boundingBox();
  const statementsBox = await statements.boundingBox();
  expect(blockBox!.y + blockBox!.height).toBeLessThanOrEqual(statementsBox!.y);

  await patient.line.getByRole("button", { name: "Подтвердить платёж" }).click();
  await expect(patient.payment).toHaveText("Платёж с собственного счёта подтверждён · 05.10.2026 · Intake QA");
  await expect(patient.payment).toHaveAttribute("data-tone", "success");
  await expect(patient.line.getByRole("button", { name: "Подтвердить платёж" })).toHaveCount(0);
  await block.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-identification-confirmed-ru-desktop.png"), animations: "disabled" });
  // On a phone the long label wraps and does not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await wizard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await block.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-identification-confirmed-ru-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1100 });

  await patient.line.getByRole("button", { name: "Отменить" }).click();
  await expect(patient.payment).toHaveText("Ожидается платёж с собственного счёта");
  await expect(patient.line.getByRole("button", { name: "Подтвердить платёж" })).toBeVisible();
  // The signature is not touched by either change.
  await expect(patient.qes).toHaveText("Квалифицированная подпись · 05.10.2026");
  expect(calls).toEqual([
    { subject: "contract_partner", body: { confirmed: true } },
    { subject: "contract_partner", body: { confirmed: false } },
  ]);
  await expect(block.getByTestId("lead-identification-error")).toHaveCount(0);
});

test("a third-party payer gets a line of its own, in German too", async ({ page }) => {
  const { block, row, calls } = await mount(page, {
    lang: "de",
    payerKind: "third_party",
    status: {
      contract_partner: { qes: SIGNED, own_account_payment: CONFIRMED },
      // Signed on the demo account of the signature provider.
      payer: { qes: { signed_at: "2026-10-05T09:40:00Z", test_mode: true }, own_account_payment: null },
    },
  });
  await expect(block).toContainText("Identifizierung per qualifizierter Signatur");
  const patient = row("contract_partner");
  await expect(patient.line).toContainText("Patient/in");
  await expect(patient.qes).toHaveText("Qualifizierte Signatur · 05.10.2026");
  await expect(patient.payment).toHaveText("Zahlung vom eigenen Konto bestätigt · 05.10.2026 · Intake QA");
  await expect(patient.line.getByRole("button")).toHaveText("Zurücknehmen");

  const payer = row("payer");
  await expect(payer.line).toContainText("Kostenübernehmer");
  await expect(payer.qes).toHaveText("Qualifizierte Signatur · 05.10.2026 · Test");
  await expect(payer.qes).toHaveAttribute("data-tone", "info");
  await expect(payer.payment).toHaveText("Zahlung vom eigenen Konto ausstehend");

  // The payer's payment is confirmed for the payer; the patient's line stays.
  await payer.line.getByRole("button", { name: "Zahlung bestätigen" }).click();
  await expect(payer.payment).toHaveText("Zahlung vom eigenen Konto bestätigt · 05.10.2026 · Intake QA");
  await expect(payer.line.getByRole("button")).toHaveText("Zurücknehmen");
  await expect(patient.payment).toHaveText("Zahlung vom eigenen Konto bestätigt · 05.10.2026 · Intake QA");
  expect(calls).toEqual([{ subject: "payer", body: { confirmed: true } }]);
  await expect(block).toContainText("Das blockiert die Arbeit nicht.");
});

test("a refused change is reported and the label stays", async ({ page }) => {
  const { block, row, calls } = await mount(page, {
    lang: "ru",
    refuse: true,
    status: { contract_partner: { qes: SIGNED, own_account_payment: null }, payer: null },
  });
  const patient = row("contract_partner");
  await patient.line.getByRole("button", { name: "Подтвердить платёж" }).click();
  await expect(block.getByTestId("lead-identification-error")).toBeVisible();
  await expect(patient.payment).toHaveText("Ожидается платёж с собственного счёта");
  await expect(patient.line.getByRole("button", { name: "Подтвердить платёж" })).toBeEnabled();
  expect(calls).toHaveLength(1);
});

test("a minor has no line of his own: without a parent on file the block asks for one", async ({ page }) => {
  const { wizard, block, row, calls } = await mount(page, {
    lang: "ru",
    minor: true,
    // The child neither signs nor pays; nobody represents him yet.
    status: { contract_partner: { qes: null, own_account_payment: null }, payer: null, minor: true, representatives: [] },
  });
  await expect(block).toContainText("Идентификация по квалифицированной подписи");
  await expect(block.getByTestId("lead-identification-minor")).toContainText(
    "подписывают и платят законные представители, у ребёнка своей строки нет",
  );
  await expect(block.getByTestId("lead-identification-no-representative")).toHaveText(
    "Добавьте родителя или законного представителя",
  );
  await expect(row("contract_partner").line).toHaveCount(0);
  await expect(block.getByRole("listitem")).toHaveCount(0);
  await expect(block.getByRole("button")).toHaveCount(0);
  // No sheet for the child either.
  const actions = wizard.getByTestId("gwg-identification-actions");
  await expect(actions.getByTestId("gwg-identification-no-representative")).toBeVisible();
  await expect(actions.getByRole("button")).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("a parent of a minor is identified on the own line, with the payment sent for that parent", async ({ page }) => {
  const motherId = "11111111-1111-4111-8111-111111111111";
  const mother = `representative:${motherId}`;
  const { block, row, calls } = await mount(page, {
    lang: "de",
    minor: true,
    refuse: true,
    status: {
      contract_partner: { qes: null, own_account_payment: null },
      payer: null,
      minor: true,
      representatives: [
        { id: motherId, subject: mother, name: "Anna Muster", relation: "parent", has_email: true, qes: SIGNED, own_account_payment: null },
      ],
    },
  });
  await expect(row("contract_partner").line).toHaveCount(0);
  const line = block.getByTestId(`lead-identification-${mother}`);
  await expect(line).toContainText("Anna Muster");
  await expect(line).toContainText("Elternteil");
  await expect(block.getByTestId(`lead-identification-qes-${mother}`)).toHaveText("Qualifizierte Signatur · 05.10.2026");
  await expect(block.getByTestId(`lead-identification-payment-${mother}`)).toHaveText("Zahlung vom eigenen Konto ausstehend");
  await line.getByRole("button", { name: "Zahlung bestätigen" }).click();
  // The server of this mock refuses; what matters is whom the confirmation was sent for.
  await expect(block.getByTestId("lead-identification-error")).toBeVisible();
  expect(calls).toEqual([{ subject: mother, body: { confirmed: true } }]);
});

test("a tab that still shows the child's line is told why the payment was refused", async ({ page }) => {
  const { block, row, calls } = await mount(page, {
    lang: "ru",
    refuseMinor: true,
    // Loaded while the lead still counted as an adult.
    status: { contract_partner: { qes: SIGNED, own_account_payment: null }, payer: null },
  });
  const patient = row("contract_partner");
  await patient.line.getByRole("button", { name: "Подтвердить платёж" }).click();
  await expect(block.getByTestId("lead-identification-error")).toHaveText(
    "Пациент несовершеннолетний: платёж подтверждается у законного представителя, а не у ребёнка. Обновите страницу",
  );
  await expect(patient.payment).toHaveText("Ожидается платёж с собственного счёта");
  expect(calls).toHaveLength(1);
});

test("a backend without the status does not break the documents step", async ({ page }) => {
  const { wizard, block, statusRequests } = await mount(page, { lang: "ru", status: null });
  await expect(wizard.getByTestId("lead-gwg-statements")).toBeVisible();
  await expect(wizard.getByTestId("gwg-identification-actions")).toBeVisible();
  // The status was asked for and the answer was not one: no block, no claim.
  await expect.poll(statusRequests).toBeGreaterThan(0);
  await expect(block).toHaveCount(0);
});
