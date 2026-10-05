import { expect, test, type Page } from "@playwright/test";

// The "Плательщик" card of the patient profile: who pays (the payer
// declaration of the converted request), the contracting party, the invoice
// recipient and the identification, from the mocked
// `GET /patients/{id}/payer-summary`. Synthetic data only.

const patientId = "00000000-0000-4000-8000-000000000001";
const leadId = "00000000-0000-4000-8000-000000000002";
const openLeadId = "00000000-0000-4000-8000-000000000003";
const annaContactId = "11111111-1111-4111-8111-111111111111";
const benContactId = "22222222-2222-4222-8222-222222222222";
const annaRelationId = "33333333-3333-4333-8333-333333333333";
const benRelationId = "44444444-4444-4444-8444-444444444444";

type Lang = "ru" | "de";
type Width = 1440 | 390;

// 12:01 and 10:00 in Berlin.
const SIGNED = { signed_at: "2026-10-05T10:01:00Z", test_mode: false };
const CONFIRMED = { confirmed_at: "2026-10-06T08:00:00Z", confirmed_by_name: "Olek", note: null };

const source = { lead_id: leadId, converted_at: "2026-10-06T09:12:00Z", declared_at: "2026-10-05T16:40:00Z" };

const annaDeclaration = {
  payer_kind: "third_party",
  payer_type: "person",
  name: "Anna Muster",
  organisation_name: null,
  first_name: "Anna",
  last_name: "Muster",
  relationship_kind: "parent",
  relationship: null,
  street: "Musterweg 1",
  zip: "10115",
  city: "Berlin",
  country: "DE",
  email: "anna.muster@example.com",
  phone: "+49 30 000000",
  contact_consent_at: "2026-10-05T16:40:00Z",
  payer_informed_at: "2026-10-05T17:00:00Z",
};

const minorParty = {
  kind: "legal_representatives",
  explicit: false,
  patient_id: patientId,
  patient_name: "Mia Muster",
  patient_is_minor: true,
  debtor_name: "Anna Muster und Ben Muster",
  representatives: [
    { relation_id: annaRelationId, related_patient_id: null, relation_type: "parent", name: "Anna Muster", email: "anna.muster@example.com", address: "Musterweg 1, 10115 Berlin, DE", is_default_payer: true },
    { relation_id: benRelationId, related_patient_id: null, relation_type: "parent", name: "Ben Muster", email: "ben.muster@example.com", address: null, is_default_payer: false },
  ],
};

const annaRecipient = {
  source: "default_payer",
  role: "contracting_party",
  kind: "relation",
  name: "Anna Muster",
  street: "Musterweg 1",
  zip: "10115",
  city: "Berlin",
  country: "DE",
  email: "anna.muster@example.com",
  payer_patient_relation_id: annaRelationId,
  payer_patient_id: null,
  missing: [],
  minor_without_payer: false,
};

const minorIdentification = {
  minor: true,
  contract_partner: { qes: null, own_account_payment: null },
  payer: { qes: SIGNED, own_account_payment: null, same_person_as: `representative:${annaContactId}` },
  representatives: [
    { id: annaContactId, subject: `representative:${annaContactId}`, name: "Anna Muster", relation: "parent", has_email: true, qes: SIGNED, own_account_payment: CONFIRMED },
    { id: benContactId, subject: `representative:${benContactId}`, name: "Ben Muster", relation: "parent", has_email: true, qes: null, own_account_payment: null },
  ],
};

/** The full example: minor Mia Muster, the parent Anna pays, is the default payer and is identified. */
const minorSummary = {
  patient_id: patientId,
  patient_is_minor: true,
  source,
  declaration: annaDeclaration,
  contracting_party: minorParty,
  invoice_recipient: annaRecipient,
  identification: minorIdentification,
  open_request: null,
};

/** Billing sees the same, without the identification. */
const billingSummary = { ...minorSummary, identification: null };

/** An adult who pays for himself. */
const selfSummary = {
  patient_id: patientId,
  patient_is_minor: false,
  source,
  declaration: {
    payer_kind: "self", payer_type: null, name: null, organisation_name: null, first_name: null, last_name: null,
    relationship_kind: null, relationship: null, street: null, zip: null, city: null, country: null,
    email: null, phone: null, contact_consent_at: null, payer_informed_at: null,
  },
  contracting_party: { kind: "patient", explicit: false, patient_id: patientId, patient_name: "Ben Muster", patient_is_minor: false, debtor_name: "Ben Muster", representatives: [] },
  invoice_recipient: {
    source: "none", role: null, kind: "patient", name: "Ben Muster", street: "Musterweg 1", zip: "10115", city: "Berlin", country: "DE",
    email: "ben.muster@example.com", payer_patient_relation_id: null, payer_patient_id: null, missing: [], minor_without_payer: false,
  },
  identification: { minor: false, contract_partner: { qes: SIGNED, own_account_payment: null }, payer: null, representatives: [] },
  open_request: null,
};

/** A minor created without a request and without relations: the warnings of the recipient. */
const noLeadSummary = {
  patient_id: patientId,
  patient_is_minor: true,
  source: null,
  declaration: null,
  contracting_party: { kind: "legal_representatives", explicit: false, patient_id: patientId, patient_name: "Mia Muster", patient_is_minor: true, debtor_name: "Mia Muster", representatives: [] },
  invoice_recipient: {
    source: "none", role: null, kind: "patient", name: "Mia Muster", street: null, zip: null, city: "Berlin", country: "DE",
    email: null, payer_patient_relation_id: null, payer_patient_id: null, missing: ["street", "zip"], minor_without_payer: true,
  },
  identification: null,
  open_request: null,
};

/** The declaration of the converted request stands while a new request is open. */
const openRequestSummary = { ...minorSummary, open_request: { lead_id: openLeadId, has_declaration: true } };

type Answer = { status: number; json: unknown };

type Mock = {
  lang: Lang;
  width: Width;
  role: "ceo" | "billing";
  /** The answers of `GET /patients/{id}/payer-summary`, one per request; the last one repeats. */
  answers: Answer[];
};

async function mount(page: Page, mock: Mock) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: mock.width, height: mock.width === 390 ? 844 : 1000 });
  await page.addInitScript((language) => {
    localStorage.setItem("gmed_lang", language);
    localStorage.setItem("gmed_access_token", "patient-payer-summary-token");
  }, mock.lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  const state = { summaryRequests: 0 };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") {
      return route.fulfill({
        json: { id: "payer-summary-user", email: "qa@example.com", name: "Payer QA", role: mock.role, created_at: "2026-01-01T00:00:00Z" },
      });
    }
    if (path === `/patients/${patientId}/payer-summary`) {
      const answer = mock.answers[Math.min(state.summaryRequests, mock.answers.length - 1)];
      state.summaryRequests += 1;
      return route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.json) });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/__patient-payer-summary-qa", (route) => route.fulfill({
    contentType: "text/html",
    body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      // A cold dev server answers "504 Outdated Optimize Dep" on the first import; reload like Vite's client would.
      import('/tests/e2e/fixtures/patient-payer-summary.tsx').catch(error => {
        const reloads = Number(sessionStorage.getItem('harness-reloads') ?? 0);
        if (reloads >= 3) throw error;
        sessionStorage.setItem('harness-reloads', String(reloads + 1));
        location.reload();
      });
    </script></html>`,
  }));
  await page.goto("/__patient-payer-summary-qa");
  const card = page.getByTestId("patient-payer-summary");
  const line = (id: string) => page.getByTestId(`patient-payer-summary-${id}`);
  return { card, line, errors, summaryRequests: () => state.summaryRequests };
}

/** The whole page, however tall: the harness lets it scroll so the card is never cut. */
async function screenshot(page: Page, name: string, mock: Pick<Mock, "lang" | "width">) {
  await page.screenshot({
    path: `../artifacts/design-qa/patient-payer-summary-${name}-${mock.lang}-${mock.width}.png`,
    animations: "disabled",
    fullPage: true,
  });
}

/** The page and the card are no wider than a phone. */
async function expectNoHorizontalScroll(page: Page, width: Width) {
  if (width !== 390) return;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const card = page.getByTestId("patient-payer-summary");
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
}

const words = {
  ru: {
    title: "Плательщик",
    whoPays: "Кто платит",
    thirdParty: "Третье лицо — Частное лицо",
    self: "Пациент сам",
    noDeclaration: "Декларация плательщика отсутствует (пациент создан без обращения)",
    name: "Имя / организация",
    relationship: "Отношение к пациенту",
    parent: "Родитель",
    address: "Адрес",
    addressLine: "Musterweg 1, 10115 Berlin, Германия",
    contact: "Контакт",
    consent: "Согласие на контакт с плательщиком",
    consentGiven: "дано 05.10.2026",
    informed: "Плательщик проинформирован (Art. 14 DSGVO)",
    informedYes: "да, 05.10.2026",
    party: "Сторона договора",
    representatives: "Законные представители: Anna Muster und Ben Muster",
    noRepresentatives: "Законные представители: не указаны",
    patient: "Пациент",
    defaultPayer: "плательщик по умолчанию",
    recipient: "Получатель счёта",
    sourceDefaultPayer: "плательщик по умолчанию",
    sourcePatient: "пациент",
    identification: "Идентификация",
    signed: "Квалифицированная подпись · 05.10.2026",
    notSigned: "Квалифицированной подписи ещё нет",
    paid: "Платёж с собственного счёта подтверждён · 06.10.2026 · Olek",
    awaiting: "Ожидается платёж с собственного счёта",
    samePerson: "Плательщик — тот же человек, что и представитель Anna Muster",
    converted: "Зафиксировано при конвертации обращения 06.10.2026",
    openLead: "Открыть обращение",
    changedElsewhere: "Плательщика заказа или счёта меняют в заказе и в счёте",
    addressIncomplete: "Адрес неполный: улица, индекс",
    minorRecipient: "Несовершеннолетний получит счёт — укажите плательщика",
    openRequest: "Открыто новое обращение — плательщик уточняется в нём",
    loadFailed: "Не удалось загрузить данные плательщика",
    retry: "Повторить",
  },
  de: {
    title: "Zahler",
    whoPays: "Wer zahlt",
    thirdParty: "Dritte/r — Privatperson",
    self: "Patient selbst",
    noDeclaration: "Keine Zahlererklärung (Patient ohne Anfrage angelegt)",
    name: "Name / Organisation",
    relationship: "Verhältnis zum Patienten",
    parent: "Elternteil",
    address: "Adresse",
    addressLine: "Musterweg 1, 10115 Berlin, Deutschland",
    contact: "Kontakt",
    consent: "Einwilligung zur Kontaktaufnahme",
    consentGiven: "erteilt am 05.10.2026",
    informed: "Zahler informiert (Art. 14 DSGVO)",
    informedYes: "ja, 05.10.2026",
    party: "Vertragspartei",
    representatives: "Gesetzliche Vertreter: Anna Muster und Ben Muster",
    noRepresentatives: "Gesetzliche Vertreter: nicht erfasst",
    patient: "Patient",
    defaultPayer: "Standardzahler",
    recipient: "Rechnungsempfänger",
    sourceDefaultPayer: "Standardzahler",
    sourcePatient: "Patient",
    identification: "Identifizierung",
    signed: "Qualifizierte Signatur · 05.10.2026",
    notSigned: "Noch keine qualifizierte Signatur",
    paid: "Zahlung vom eigenen Konto bestätigt · 06.10.2026 · Olek",
    awaiting: "Zahlung vom eigenen Konto ausstehend",
    samePerson: "Kostenträger — dieselbe Person wie Vertreter/in Anna Muster",
    converted: "Bei der Umwandlung der Anfrage am 06.10.2026 festgehalten",
    openLead: "Anfrage öffnen",
    changedElsewhere: "Der Zahler eines Auftrags oder einer Rechnung wird dort geändert",
    addressIncomplete: "Adresse unvollständig: Straße, PLZ",
    minorRecipient: "Minderjährige/r als Empfänger – Zahler angeben",
    openRequest: "Eine neue Anfrage ist offen – der Zahler wird dort erfasst",
    loadFailed: "Zahlerdaten konnten nicht geladen werden",
    retry: "Erneut versuchen",
  },
} as const;

for (const lang of ["ru", "de"] as const) {
  for (const width of [1440, 390] as const) {
    const w = words[lang];

    test(`minor with a paying parent: the six line groups, the lead link, the refetch ${lang} ${width}`, async ({ page }) => {
      const mock: Mock = { lang, width, role: "ceo", answers: [{ status: 200, json: minorSummary }] };
      const { card, line, errors, summaryRequests } = await mount(page, mock);
      await expect(card).toHaveAttribute("data-state", "loaded");
      await expect(card.getByRole("heading", { name: w.title, exact: true })).toBeVisible();

      // 1. Who pays.
      await expect(line("who-pays")).toContainText(w.whoPays);
      await expect(line("who-pays")).toContainText(w.thirdParty);
      // 2. The third party.
      await expect(line("name")).toContainText(w.name);
      await expect(line("name")).toContainText("Anna Muster");
      await expect(line("relationship")).toContainText(w.parent);
      await expect(line("address")).toContainText(w.addressLine);
      await expect(line("contact")).toContainText("anna.muster@example.com · +49 30 000000");
      await expect(line("contact-consent")).toContainText(w.consentGiven);
      await expect(line("informed")).toContainText(w.informedYes);
      // 3. The contracting party: both parents, the paying one badged.
      await expect(line("contracting-party")).toContainText(w.representatives);
      await expect(line("representative")).toHaveCount(2);
      await expect(line("representative").first()).toContainText("Anna Muster");
      await expect(line("representative").first()).toContainText("Musterweg 1, 10115 Berlin, DE");
      await expect(line("representative").first().getByTestId("patient-payer-summary-default-payer")).toHaveText(w.defaultPayer);
      await expect(line("representative").last()).toContainText("Ben Muster");
      await expect(line("representative").last().getByTestId("patient-payer-summary-default-payer")).toHaveCount(0);
      // 4. The invoice recipient with its source.
      await expect(line("recipient")).toContainText("Anna Muster");
      await expect(line("recipient")).toContainText(w.addressLine);
      await expect(line("recipient")).toContainText("anna.muster@example.com");
      await expect(line("recipient-source")).toHaveText(w.sourceDefaultPayer);
      await expect(line("recipient-address-warning")).toHaveCount(0);
      await expect(line("recipient-minor-warning")).toHaveCount(0);
      // 5. The identification with the wizard's words.
      await expect(line("identification")).toContainText(w.identification);
      const anna = line(`identification-representative:${annaContactId}`);
      await expect(anna).toContainText("Anna Muster");
      await expect(anna).toContainText(w.signed);
      await expect(anna).toContainText(w.paid);
      const ben = line(`identification-representative:${benContactId}`);
      await expect(ben).toContainText(w.notSigned);
      await expect(ben).toContainText(w.awaiting);
      await expect(line("identification-payer")).toContainText(w.samePerson);
      // 6. The footer.
      await expect(line("footer")).toContainText(w.converted);
      await expect(line("footer")).toContainText(w.changedElsewhere);
      const order = await Promise.all(
        ["who-pays", "name", "contracting-party", "recipient", "identification", "footer"].map(async (id) => (await line(id).boundingBox())!.y),
      );
      expect([...order].sort((a, b) => a - b)).toEqual(order);

      await expectNoHorizontalScroll(page, width);
      await screenshot(page, "minor", mock);

      // The link opens the request in the lead wizard.
      await line("footer").getByRole("button", { name: w.openLead }).click();
      await expect(page.getByTestId("navigated")).toHaveText(`/leads?lead=${leadId}`);

      // A reload of the page's patient detail fetches the summary again.
      expect(summaryRequests()).toBe(1);
      await page.getByRole("button", { name: "Reload patient" }).click();
      await expect.poll(summaryRequests).toBe(2);
      await expect(card).toHaveAttribute("data-state", "loaded");
      expect(errors).toEqual([]);
    });

    test(`Billing: the projection without identification and without the lead link ${lang} ${width}`, async ({ page }) => {
      const mock: Mock = { lang, width, role: "billing", answers: [{ status: 200, json: billingSummary }] };
      const { card, line, errors } = await mount(page, mock);
      await expect(card).toHaveAttribute("data-state", "loaded");
      await expect(line("who-pays")).toContainText(w.thirdParty);
      await expect(line("name")).toContainText("Anna Muster");
      await expect(line("address")).toContainText(w.addressLine);
      await expect(line("contact-consent")).toContainText(w.consentGiven);
      await expect(line("informed")).toContainText(w.informedYes);
      await expect(line("contracting-party")).toContainText(w.representatives);
      await expect(line("recipient")).toContainText("Anna Muster");
      await expect(line("recipient-source")).toHaveText(w.sourceDefaultPayer);
      await expect(line("identification")).toHaveCount(0);
      await expect(card).not.toContainText(w.identification);
      await expect(line("footer")).toContainText(w.converted);
      await expect(line("open-lead")).toHaveCount(0);
      await expect(card).not.toContainText(w.openLead);
      await expectNoHorizontalScroll(page, width);
      await screenshot(page, "billing", mock);
      expect(errors).toEqual([]);
    });
  }
}

test("self-payer adult: no third-party lines, the patient is party and recipient ru 1440", async ({ page }) => {
  const mock: Mock = { lang: "ru", width: 1440, role: "ceo", answers: [{ status: 200, json: selfSummary }] };
  const { card, line, errors } = await mount(page, mock);
  await expect(card).toHaveAttribute("data-state", "loaded");
  await expect(line("who-pays")).toContainText(words.ru.whoPays);
  await expect(line("who-pays")).toContainText(words.ru.self);
  for (const id of ["name", "relationship", "address", "contact", "contact-consent", "informed", "representative", "identification-payer"]) {
    await expect(line(id)).toHaveCount(0);
  }
  await expect(line("contracting-party")).toContainText(words.ru.party);
  await expect(line("contracting-party")).toContainText(words.ru.patient);
  await expect(line("contracting-party")).not.toContainText("Законные представители");
  await expect(line("recipient")).toContainText("Ben Muster");
  await expect(line("recipient-source")).toHaveText(words.ru.sourcePatient);
  await expect(line("identification-contract_partner")).toContainText(words.ru.patient);
  await expect(line("identification-contract_partner")).toContainText(words.ru.signed);
  await screenshot(page, "self", mock);
  expect(errors).toEqual([]);
});

test("self-payer adult de 390", async ({ page }) => {
  const mock: Mock = { lang: "de", width: 390, role: "ceo", answers: [{ status: 200, json: selfSummary }] };
  const { card, line, errors } = await mount(page, mock);
  await expect(card).toHaveAttribute("data-state", "loaded");
  await expect(line("who-pays")).toContainText(words.de.self);
  await expect(line("contracting-party")).toContainText(words.de.patient);
  await expect(line("contracting-party")).not.toContainText("Gesetzliche Vertreter");
  await expect(line("recipient-source")).toHaveText(words.de.sourcePatient);
  await expectNoHorizontalScroll(page, 390);
  await screenshot(page, "self", mock);
  expect(errors).toEqual([]);
});

for (const [lang, width] of [["de", 1440], ["ru", 390]] as const) {
  const w = words[lang];
  test(`never a lead: no declaration, the recipient warnings in amber ${lang} ${width}`, async ({ page }) => {
    const mock: Mock = { lang, width, role: "ceo", answers: [{ status: 200, json: noLeadSummary }] };
    const { card, line, errors } = await mount(page, mock);
    await expect(card).toHaveAttribute("data-state", "loaded");
    await expect(line("who-pays")).toContainText(w.noDeclaration);
    await expect(line("name")).toHaveCount(0);
    await expect(line("contracting-party")).toContainText(w.party);
    await expect(line("contracting-party")).toContainText(w.noRepresentatives);
    await expect(line("contracting-party")).not.toContainText("Mia Muster");
    await expect(line("representative")).toHaveCount(0);
    await expect(line("recipient")).toContainText("Mia Muster");
    await expect(line("recipient-source")).toHaveText(w.sourcePatient);
    await expect(line("recipient-address-warning")).toHaveText(w.addressIncomplete);
    await expect(line("recipient-address-warning")).toHaveClass(/text-amber-700/);
    await expect(line("recipient-minor-warning")).toHaveText(w.minorRecipient);
    await expect(line("identification")).toHaveCount(0);
    await expect(line("open-lead")).toHaveCount(0);
    await expect(line("footer")).not.toContainText(w.converted.slice(0, 20));
    await expect(line("footer")).toContainText(w.changedElsewhere);
    await expectNoHorizontalScroll(page, width);
    await screenshot(page, "no-lead", mock);
    expect(errors).toEqual([]);
  });
}

test("open request: the note links the new request beside the declaration of the converted one ru 1440", async ({ page }) => {
  const mock: Mock = { lang: "ru", width: 1440, role: "ceo", answers: [{ status: 200, json: openRequestSummary }] };
  const { card, line, errors } = await mount(page, mock);
  await expect(card).toHaveAttribute("data-state", "loaded");
  await expect(line("open-request")).toContainText(words.ru.openRequest);
  await expect(line("who-pays")).toContainText(words.ru.thirdParty);
  await line("open-request").getByRole("button", { name: words.ru.openLead }).click();
  await expect(page.getByTestId("navigated")).toHaveText(`/leads?lead=${openLeadId}`);
  await line("footer").getByRole("button", { name: words.ru.openLead }).click();
  await expect(page.getByTestId("navigated")).toHaveText(`/leads?lead=${leadId}`);
  await screenshot(page, "open-request", mock);
  expect(errors).toEqual([]);
});

test("a failed load shows the message and a retry; the retry loads the card de 390", async ({ page }) => {
  const mock: Mock = {
    lang: "de",
    width: 390,
    role: "ceo",
    answers: [{ status: 500, json: { error: "internal" } }, { status: 200, json: minorSummary }],
  };
  const { card, line, errors, summaryRequests } = await mount(page, mock);
  await expect(card).toHaveAttribute("data-state", "error");
  await expect(card.getByRole("alert")).toHaveText(words.de.loadFailed);
  await expectNoHorizontalScroll(page, 390);
  await screenshot(page, "error", mock);
  await card.getByRole("button", { name: words.de.retry }).click();
  await expect(card).toHaveAttribute("data-state", "loaded");
  expect(summaryRequests()).toBe(2);
  await expect(line("who-pays")).toContainText(words.de.thirdParty);
  expect(errors).toEqual([]);
});

test("403: the card is not rendered and nothing is reported ru 1440", async ({ page }) => {
  const mock: Mock = { lang: "ru", width: 1440, role: "ceo", answers: [{ status: 403, json: { error: "forbidden" } }] };
  const { card, errors, summaryRequests } = await mount(page, mock);
  await expect.poll(summaryRequests).toBe(1);
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(words.ru.title);
  await screenshot(page, "forbidden", mock);
  expect(errors).toEqual([]);
});
