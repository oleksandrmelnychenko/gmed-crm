import { expect, test, type Page } from "@playwright/test";

// "Правовой статус" of the patient card (owner decision 2026-10-12): DSGVO
// consent and the confidentiality release follow signed documents only. The
// card shows their state from the document, flags an item ticked by hand
// before, offers "Подписано на бумаге" for the document still to be signed
// and the generator when there is none; the status sheet shows them read-only
// and never sends them. Mocked API, synthetic data only.

const patientId = "00000000-0000-4000-8000-000000000101";
const releaseId = "00000000-0000-4000-8000-000000000201";
const signedReleaseId = "00000000-0000-4000-8000-000000000202";

type Lang = "ru" | "de";
type Width = 1440 | 390;

/** The DSGVO consent revoked in the consent register on 12.10.2026 (Berlin). */
const revokedDsgvoEvidence = {
  key: "dsgvo_signed",
  set: false,
  state: "revoked",
  revoked_at: "2026-10-11T22:30:00+00:00",
  signed_document: {
    id: "00000000-0000-4000-8000-000000000203",
    document_number: "EW-20260901-000003-V02",
    name: "Einverständniserklärung zur Datenübermittlung",
    signed_at: "2026-09-01T08:00:00+00:00",
    source: "paper_signature",
  },
  pending_document: null,
  template_id: "privacy_consents",
};

function patientDetail(releaseSigned: boolean, dsgvoRevoked = false) {
  const detail = patientDetailBase(releaseSigned);
  if (!dsgvoRevoked) return detail;
  return {
    ...detail,
    legal_status: { ...detail.legal_status, dsgvo_signed: false, dsgvo_revoked_at: revokedDsgvoEvidence.revoked_at },
    legal_status_evidence: { ...detail.legal_status_evidence, dsgvo: revokedDsgvoEvidence },
  };
}

function patientDetailBase(releaseSigned: boolean) {
  return {
    id: patientId,
    patient_id: "P-LEGAL-0001",
    first_name: "Mia",
    last_name: "Muster",
    birth_date: "1990-01-01",
    gender: "female",
    is_active: true,
    lifecycle_status: "active",
    created_at: "2026-01-01T09:00:00Z",
    updated_at: releaseSigned ? "2026-10-12T08:00:00Z" : "2026-10-01T09:00:00Z",
    languages: ["de"],
    residence_country: "DE",
    hidden_fields: [],
    legal_status: {
      // Ticked by hand before 2026-10-12, no signed document.
      dsgvo_signed: true,
      confidentiality_release_signed: releaseSigned,
      identity_verified: true,
      document_pack_complete: false,
      compliance_completed: false,
      contract_status: "signed",
      notes: null,
    },
    legal_status_evidence: {
      dsgvo: {
        key: "dsgvo_signed",
        set: true,
        state: "manual",
        signed_document: null,
        pending_document: null,
        template_id: "privacy_consents",
      },
      confidentiality_release: releaseSigned
        ? {
            key: "confidentiality_release_signed",
            set: true,
            state: "signed",
            signed_document: {
              id: signedReleaseId,
              document_number: "SE-20261012-000001-V02",
              name: "Schweigepflichtsentbindung",
              signed_at: "2026-10-12T08:00:00+00:00",
              source: "paper_signature",
            },
            pending_document: null,
            template_id: "confidentiality_release",
          }
        : {
            key: "confidentiality_release_signed",
            set: false,
            state: "missing",
            signed_document: null,
            pending_document: {
              id: releaseId,
              document_number: "SE-20261012-000001",
              name: "Schweigepflichtsentbindung",
              generated_template_id: "confidentiality_release",
              signature_pending: false,
            },
            template_id: "confidentiality_release",
          },
    },
  };
}

const templates = [
  {
    id: "privacy_consents",
    label: "Einverständniserklärung zur Datenübermittlung",
    description: "Einverständnis zur Verarbeitung und Übermittlung personenbezogener und medizinischer Daten.",
    art: "privacy_consents",
    category: "consent",
    default_auto_name: "Einverständniserklärung zur Datenübermittlung",
    default_status: "draft",
    default_visibility: "patient_visible",
    is_medical: false,
    supported_languages: ["de"],
    text_block_keys: [],
  },
  {
    id: "confidentiality_release",
    label: "Schweigepflichtsentbindung",
    description: "Schweigepflichtsentbindung für volljährige Patientinnen und Patienten.",
    art: "confidentiality_release",
    category: "consent",
    default_auto_name: "Schweigepflichtsentbindung",
    default_status: "draft",
    default_visibility: "patient_visible",
    is_medical: false,
    supported_languages: ["de"],
    text_block_keys: [],
  },
];

const words = {
  ru: {
    manual: "Отмечено вручную, подписанный документ отсутствует",
    missing: "Нет подписанного документа",
    toSign: "К подписи: Schweigepflichtsentbindung",
    paperSigned: "Подписано на бумаге",
    create: "Создать документ",
    confirmTitle: "Подтверждение подписи",
    attest: "Я сверил скан",
    store: "Сохранить как подписанный",
    signedLine: "Подписано 12.10.2026 · скан на бумаге",
    generatorTitle: "Сгенерировать из шаблона",
    updateStatus: "Обновить статус",
    sheetTitle: "Обновить правовой статус",
    identity: "Удостоверение личности проверено",
    dsgvo: "DSGVO",
    release: "Разрешение на раскрытие врачебной тайны",
    readOnly: "Отмечается только по подписанному документу",
    save: "Сохранить",
    revoked: "Согласие отозвано 12.10.2026",
    revokedHint: "Новые заказы заблокированы, пока нет согласия, подписанного после отзыва.",
    revokedBadge: "Отозвано",
  },
  de: {
    manual: "Manuell markiert, kein unterschriebenes Dokument vorhanden",
    missing: "Kein unterschriebenes Dokument",
    toSign: "Zu unterschreiben: Schweigepflichtsentbindung",
    paperSigned: "Auf Papier unterschrieben",
    create: "Dokument erstellen",
    confirmTitle: "Unterschrift bestätigen",
    attest: "Ich habe den Scan",
    store: "Als unterschrieben speichern",
    signedLine: "Unterschrieben am 12.10.2026 · Papierunterschrift (Scan)",
    generatorTitle: "Aus Vorlage generieren",
    updateStatus: "Status aktualisieren",
    sheetTitle: "Rechtsstatus aktualisieren",
    identity: "Ausweisdokument geprüft",
    dsgvo: "DSGVO",
    release: "Schweigepflichtentbindung",
    readOnly: "Wird nur über ein unterschriebenes Dokument gesetzt",
    save: "Speichern",
    revoked: "Einwilligung am 12.10.2026 widerrufen",
    revokedHint: "Neue Aufträge sind gesperrt, bis eine danach unterschriebene Einwilligung vorliegt.",
    revokedBadge: "Widerrufen",
  },
} as const;

async function mount(page: Page, lang: Lang, width: Width, options: { dsgvoRevoked?: boolean } = {}) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.addInitScript((language) => {
    localStorage.setItem("gmed_lang", language);
    localStorage.setItem("gmed_access_token", "patient-legal-status-token");
  }, lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  const state = { releaseSigned: false, paperSignatures: [] as string[], updates: [] as Record<string, unknown>[] };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path === "/me") {
      return route.fulfill({
        json: { id: "legal-status-user", email: "qa@example.com", name: "Legal QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" },
      });
    }
    if (path === `/patients/${patientId}` && request.method() === "GET") {
      return route.fulfill({ json: patientDetail(state.releaseSigned, options.dsgvoRevoked) });
    }
    if (path === `/patients/${patientId}/update` && request.method() === "POST") {
      state.updates.push(request.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { ok: true } });
    }
    const paper = path.match(/^\/documents\/([^/]+)\/paper-signature$/);
    if (paper && request.method() === "POST") {
      state.paperSignatures.push(paper[1]);
      state.releaseSigned = true;
      return route.fulfill({
        json: {
          ok: true,
          document_id: signedReleaseId,
          replaced_document_id: paper[1],
          signed_at: "2026-10-12T08:00:00+00:00",
          compliance_kind: "confidentiality_release",
        },
      });
    }
    if (path === "/documents/templates") {
      return route.fulfill({ json: { templates, text_blocks: [] } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/__patient-legal-status-qa", (route) => route.fulfill({
    contentType: "text/html",
    body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      // A cold dev server answers "504 Outdated Optimize Dep" on the first import; reload like Vite's client would.
      import('/tests/e2e/fixtures/patient-legal-status.tsx').catch(error => {
        const reloads = Number(sessionStorage.getItem('harness-reloads') ?? 0);
        if (reloads >= 3) throw error;
        sessionStorage.setItem('harness-reloads', String(reloads + 1));
        location.reload();
      });
    </script></html>`,
  }));
  await page.goto("/__patient-legal-status-qa");
  return { errors, state };
}

async function expectNoHorizontalScroll(page: Page, width: Width) {
  if (width !== 390) return;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
}

for (const lang of ["ru", "de"] as const) {
  for (const width of [1440, 390] as const) {
    const w = words[lang];

    test(`document-bound items: flagged manual item, paper signature, generator ${lang} ${width}`, async ({ page }) => {
      const { errors, state } = await mount(page, lang, width);
      const dsgvo = page.getByTestId("legal-status-document-dsgvo");
      const release = page.getByTestId("legal-status-document-confidentiality_release");
      await expect(dsgvo).toBeVisible();
      await dsgvo.scrollIntoViewIfNeeded();

      // The item ticked by hand before stays set and is flagged.
      await expect(dsgvo).toHaveAttribute("data-state", "manual");
      await expect(page.getByTestId("legal-status-document-dsgvo-state")).toHaveText(w.manual);
      await expect(dsgvo.getByRole("button", { name: w.create })).toBeVisible();
      // No checkbox: the state comes from the document.
      await expect(dsgvo.getByRole("checkbox")).toHaveCount(0);

      // The release is still to be signed: its generated document waits.
      await expect(release).toHaveAttribute("data-state", "missing");
      await expect(page.getByTestId("legal-status-document-confidentiality_release-state")).toHaveText(w.missing);
      await expect(release).toContainText(w.toSign);
      await expectNoHorizontalScroll(page, width);
      await page.screenshot({ path: `../artifacts/design-qa/patient-legal-status-${lang}-${width}.png`, animations: "disabled", fullPage: true });

      // "Подписано на бумаге": the scan of the signed copy, attested.
      await release.getByRole("button", { name: w.paperSigned }).click();
      const confirm = page.getByRole("dialog", { name: w.confirmTitle });
      await expect(confirm).toBeVisible();
      await confirm.locator('input[type="file"]').setInputFiles({
        name: "schweigepflicht-scan.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 signed scan"),
      });
      await confirm.getByRole("checkbox").check();
      await confirm.getByRole("button", { name: w.store }).click();
      await expect(confirm).toBeHidden();
      expect(state.paperSignatures).toEqual([releaseId]);
      await expect(release).toHaveAttribute("data-state", "signed");
      await expect(page.getByTestId("legal-status-document-confidentiality_release-state")).toHaveText(w.signedLine);
      await expect(release.getByRole("button")).toHaveCount(0);

      // No DSGVO document yet: the generator opens with its template chosen.
      await dsgvo.getByRole("button", { name: w.create }).click();
      const generator = page.getByRole("dialog", { name: w.generatorTitle });
      await expect(generator).toBeVisible();
      await expect(generator).toContainText("Einverständniserklärung zur Datenübermittlung");
      await expectNoHorizontalScroll(page, width);
      expect(errors).toEqual([]);
    });

    test(`a revoked DSGVO consent names the day and offers a new consent ${lang} ${width}`, async ({ page }) => {
      const { errors } = await mount(page, lang, width, { dsgvoRevoked: true });
      const dsgvo = page.getByTestId("legal-status-document-dsgvo");
      await dsgvo.scrollIntoViewIfNeeded();
      await expect(dsgvo).toHaveAttribute("data-state", "revoked");
      await expect(page.getByTestId("legal-status-document-dsgvo-state")).toHaveText(w.revoked);
      await expect(dsgvo).toContainText(w.revokedHint);
      await expect(dsgvo).toContainText(w.revokedBadge);
      // Every earlier copy is signed: a new consent is generated and signed.
      await expect(dsgvo.getByRole("button", { name: w.create })).toBeVisible();
      await expectNoHorizontalScroll(page, width);
      await page.screenshot({ path: `../artifacts/design-qa/patient-legal-status-revoked-${lang}-${width}.png`, animations: "disabled", fullPage: true });

      await page.getByRole("button", { name: w.updateStatus }).click();
      const sheet = page.getByRole("dialog", { name: w.sheetTitle });
      await expect(sheet.getByTestId("legal-status-sheet-document-dsgvo")).toContainText(w.revoked);
      expect(errors).toEqual([]);
    });

    test(`the status sheet shows the document-bound items read-only and never sends them ${lang} ${width}`, async ({ page }) => {
      const { errors, state } = await mount(page, lang, width);
      await page.getByRole("button", { name: w.updateStatus }).click();
      const sheet = page.getByRole("dialog", { name: w.sheetTitle });
      await expect(sheet).toBeVisible();
      const dsgvoRow = sheet.getByTestId("legal-status-sheet-document-dsgvo");
      const releaseRow = sheet.getByTestId("legal-status-sheet-document-confidentiality_release");
      await expect(dsgvoRow).toContainText(w.dsgvo);
      await expect(dsgvoRow).toContainText(w.manual);
      await expect(releaseRow).toContainText(w.release);
      await expect(releaseRow).toContainText(w.missing);
      await expect(dsgvoRow.getByRole("button")).toHaveCount(0);
      await expect(releaseRow.getByRole("button")).toHaveCount(0);
      await expect(sheet).toContainText(w.readOnly);
      await expectNoHorizontalScroll(page, width);
      await page.screenshot({ path: `../artifacts/design-qa/patient-legal-status-sheet-${lang}-${width}.png`, animations: "disabled" });

      // The other items stay editable; the save carries no DSGVO or release value.
      await sheet.getByRole("button", { name: w.identity }).click();
      await sheet.getByRole("button", { name: w.save, exact: true }).click();
      await expect(sheet).toBeHidden();
      expect(state.updates).toHaveLength(1);
      const legalStatus = state.updates[0].legal_status as Record<string, unknown>;
      expect(legalStatus).toMatchObject({ identity_verified: false, contract_status: "signed" });
      expect(legalStatus).not.toHaveProperty("dsgvo_signed");
      expect(legalStatus).not.toHaveProperty("confidentiality_release_signed");
      expect(errors).toEqual([]);
    });
  }
}
