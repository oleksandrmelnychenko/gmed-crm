import { expect, test } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapFullSmokeScenario,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

const SEEDED_MEDICAL_PROVIDER_ID = "c0000000-0000-0000-0000-000000000001";

type ProviderDetail = {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  doctors: Array<{ id: string; name: string }>;
  services: Array<{ id: string; service_name: string }>;
  linked_patients: Array<{
    id: string;
    patient_id: string;
    first_name: string;
    last_name: string;
  }>;
  interactions: Array<{ id: string; title: string }>;
};

test.describe("provider registry live workflows", () => {
  test("patient manager can open the provider registry and inspect the canonical clinic detail surfaces", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    await loginViaApi(
      page,
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    const providerResponse = await request.get(
      `${pmApi.backendUrl}/api/v1/providers/${SEEDED_MEDICAL_PROVIDER_ID}`,
      { headers: pmApi.headers },
    );
    expect(providerResponse.ok()).toBe(true);
    const provider = (await providerResponse.json()) as ProviderDetail;

    await page.goto(
      `/providers?search=${encodeURIComponent(provider.name)}`,
    );
    await expect(page).toHaveURL(/\/providers/);

    const providerRow = page.getByRole("row").filter({ hasText: provider.name }).first();
    await expect(providerRow).toBeVisible();
    if (provider.legal_name && provider.legal_name !== provider.name) {
      await expect(page.getByText(provider.legal_name).first()).toBeVisible();
    }
    await providerRow.click();

    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByRole("heading", { name: provider.name }).first(),
    ).toBeVisible();
    if (provider.tax_id) {
      await expect(
        sheet.getByText(new RegExp(`(Steuer-ID|Tax ID)\\s*(·\\s*)?${provider.tax_id}`, "i")).first(),
      ).toBeVisible();
    }
    await expect(
      sheet.getByRole("heading", { name: /Anbieterprofil|Provider profile/i }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("heading", { name: /Servicekatalog|Service catalog/i }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("heading", { name: /Verknüpfte Patienten|Linked patients/i }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("heading", { name: /Interaktionsverlauf|Interaction history/i }),
    ).toBeVisible();

    const linkedPatient = provider.linked_patients.find(
      (item) => item.id === scenario.patient.id,
    );
    expect(linkedPatient).toBeDefined();
    await expect(sheet.getByText(scenario.patient.patient_id).first()).toBeVisible();

    const visibleInteraction = provider.interactions.find((item) => item.title);
    expect(visibleInteraction).toBeDefined();
    await expect(sheet.getByText(visibleInteraction!.title).first()).toBeVisible();

    await page.goto(`/providers/${SEEDED_MEDICAL_PROVIDER_ID}`);
    await expect(
      page.getByRole("heading", { name: provider.name }).first(),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: /^(Vorlagen|Templates)$/i })).toBeVisible();

    await page.getByRole("tab", { name: /^(Doctors|Ärzte)$/i }).click();
    if (provider.doctors.length > 0) {
      await expect(page.getByText(provider.doctors[0]!.name)).toBeVisible();
    }

    await page.getByRole("tab", { name: /^(Services|Leistungen)$/i }).click();
    if (provider.services.length > 0) {
      await expect(page.getByText(provider.services[0]!.service_name)).toBeVisible();
    }

    await page.getByRole("tab", { name: /^(Linked patients|Verknüpfte Patienten)$/i }).click();
    await expect(page.getByText(scenario.patient.name).first()).toBeVisible();
  });

  test("sales can inspect the provider registry in read-only mode without mutation controls", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    await loginViaApi(
      page,
      request,
      scenario.credentials.sales.email,
      scenario.credentials.password,
    );

    const salesApi = await authenticateApiClient(
      request,
      scenario.credentials.sales.email,
      scenario.credentials.password,
    );
    const providerResponse = await request.get(
      `${salesApi.backendUrl}/api/v1/providers/${SEEDED_MEDICAL_PROVIDER_ID}`,
      { headers: salesApi.headers },
    );
    expect(providerResponse.ok()).toBe(true);
    const provider = (await providerResponse.json()) as ProviderDetail;

    await page.goto(
      `/providers?search=${encodeURIComponent(provider.name)}`,
    );
    await expect(page).toHaveURL(/\/providers/);
    await expect(
      page.getByRole("button", { name: /Neuer Provider|Новый провайдер/i }),
    ).toHaveCount(0);

    const providerRow = page.getByRole("row").filter({ hasText: provider.name }).first();
    await expect(providerRow).toBeVisible();
    await providerRow.click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: provider.name }).first()).toBeVisible();
    await expect(
      sheet.getByText(/Registeränderungen sind für Ihre Rolle gesperrt|Registry edits are restricted for your role/i),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /Save|Speichern/i }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", { name: /Delete/i }),
    ).toHaveCount(0);

    await page.goto(`/providers/${SEEDED_MEDICAL_PROVIDER_ID}`);
    await expect(
      page.getByRole("heading", { name: provider.name }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Save|Speichern/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Delete/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: /^(Vorlagen|Templates)$/i }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /^(Vorlagen|Templates)$/i }).click();
    await expect(
      page.getByText(/Nur Lesezugriff\. CEO oder Patientenmanager können Klinikvorlagen bearbeiten|Read-only access\. CEO or patient manager can edit clinic templates/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Neue Vorlage|New template/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Vorlage speichern|Vorlage erstellen|Save template|Create template/i }),
    ).toHaveCount(0);

    await page.getByRole("tab", { name: /^(Doctors|Ärzte)$/i }).click();
    await expect(
      page.getByRole("button", { name: /^Edit$/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Delete$/i }),
    ).toHaveCount(0);

    await page.getByRole("tab", { name: /^(Services|Leistungen)$/i }).click();
    await expect(
      page.getByRole("button", { name: /^Edit$/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Delete$/i }),
    ).toHaveCount(0);
  });
});
