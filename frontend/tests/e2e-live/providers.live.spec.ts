import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapFullSmokeScenario,
  chooseComboboxOption,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

const SEEDED_MEDICAL_PROVIDER_ID = "c0000000-0000-0000-0000-000000000001";

type ProviderDetail = {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  address_country: string | null;
  phone?: string | null;
  email?: string | null;
  contacts?: Array<{
    contact_kind: string;
    contact_type: string;
    value: string;
    is_primary: boolean;
  }>;
  fachbereich?: string | null;
  parent_provider_name?: string | null;
  organization_level?: string;
  specializations?: Array<{ code: string; name_en: string | null; name_de?: string | null }>;
  doctors: Array<{
    id: string;
    name: string;
    license_number?: string | null;
    licensing_country?: string | null;
    specializations?: Array<{ code: string; name_en: string | null; name_de?: string | null }>;
    relationships?: Array<{
      target_doctor_id: string;
      target_doctor_name: string;
      relationship_type: string;
    }>;
  }>;
  services: Array<{
    id: string;
    service_name: string;
    price_type?: string;
    price?: string | null;
    price_from?: string | null;
    price_to?: string | null;
  }>;
  staff?: Array<{
    id: string;
    display_name: string;
    role: string;
    contacts: Array<{
      contact_kind: string;
      contact_type: string;
      value: string;
      is_primary: boolean;
    }>;
  }>;
  linked_patients: Array<{
    id: string;
    patient_id: string;
    first_name: string;
    last_name: string;
  }>;
  interactions: Array<{ id: string; title: string }>;
};

function formWithHeading(page: Page, heading: RegExp) {
  return page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: heading }) })
    .last();
}

function providerListItem(page: Page, providerName: string) {
  return page.getByRole("button").filter({ hasText: providerName }).first();
}

function hasSpecialization(
  items: Array<{ code?: string | null; name_en?: string | null; name_de?: string | null }> | undefined,
  matcher: RegExp,
) {
  return (items ?? []).some((item) =>
    [item.code, item.name_en, item.name_de].some((value) => matcher.test(value ?? "")),
  );
}

async function openNewDoctorForm(page: Page) {
  await page.locator("main").getByRole("button", { name: /^Neuer Arzt$/i }).click();
}

async function chooseFieldOption(
  page: Page,
  scope: Locator,
  label: RegExp,
  option: string | RegExp,
) {
  const combobox = scope.getByRole("combobox", { name: label }).first();
  await expect(combobox).toBeVisible();
  await chooseComboboxOption(page, combobox, option);
}

function createdProviderIdFromUrl(page: Page) {
  const match = page.url().match(/\/providers\/([0-9a-f-]+)/i);
  expect(match?.[1]).toBeTruthy();
  return match![1]!;
}

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

    const providerRow = providerListItem(page, provider.name);
    await expect(providerRow).toBeVisible();
    await providerRow.click();

    const sheet = page.locator("main");
    await expect(
      sheet.getByRole("heading", { name: provider.name }).first(),
    ).toBeVisible();
    if (provider.legal_name && provider.legal_name !== provider.name) {
      await expect(sheet.getByText(provider.legal_name).first()).toBeVisible();
    }
    if (provider.tax_id) {
      await expect(sheet.getByText(provider.tax_id).first()).toBeVisible();
    }
    await expect(
      sheet.getByRole("heading", { name: /Profil|Profile/i }),
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
    await expect(
      page.getByRole("heading", { name: /Profil|Profile/i }),
    ).toBeVisible();
    await expect(page.locator("form#provider-profile-form")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Speichern$/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Bearbeiten$/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Servicekatalog|Service catalog/i }),
    ).toBeVisible();
    if (provider.doctors.length > 0) {
      await expect(page.getByText(provider.doctors[0]!.name)).toBeVisible();
    }
    if (provider.services.length > 0) {
      await expect(page.getByText(provider.services[0]!.service_name).first()).toBeVisible();
    }
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

    const providerRow = providerListItem(page, provider.name);
    await expect(providerRow).toBeVisible();
    await providerRow.click();

    const sheet = page.locator("main");
    await expect(sheet.getByRole("heading", { name: provider.name }).first()).toBeVisible();
    await expect(
      sheet.locator("form#provider-profile-form"),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", { name: /Save|Speichern/i }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", { name: /^Bearbeiten$/i }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", { name: /Delete/i }),
    ).toHaveCount(0);

    await page.goto(`/providers/${SEEDED_MEDICAL_PROVIDER_ID}`);
    await expect(
      page.getByRole("heading", { name: provider.name }).first(),
    ).toBeVisible();
    await expect(page.locator("form#provider-profile-form")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Save|Speichern/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Bearbeiten$/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Delete/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Neue Vorlage|New template/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Vorlage speichern|Vorlage erstellen|Save template|Create template/i }),
    ).toHaveCount(0);

    await expect(
      page.getByRole("button", { name: /^Edit$/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Delete$/i }),
    ).toHaveCount(0);

    await expect(
      page.getByRole("button", { name: /^Edit$/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Delete$/i }),
    ).toHaveCount(0);
  });

  test("patient manager can create provider registry release entities with custom controls", async ({
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
    const parentResponse = await request.get(
      `${pmApi.backendUrl}/api/v1/providers/${SEEDED_MEDICAL_PROVIDER_ID}`,
      { headers: pmApi.headers },
    );
    expect(parentResponse.ok()).toBe(true);
    const parentProvider = (await parentResponse.json()) as ProviderDetail;

    const tag = Date.now().toString(36);
    const providerName = `Release UI Provider ${tag}`;
    const providerPhone = `+49 30 700 ${tag.slice(-4)}`;
    const providerEmail = `provider-${tag}@clinic.example`;
    const doctorLastName = `Doctor ${tag}`;
    const targetDoctorLastName = `Target ${tag}`;
    const doctorLicenseNumber = `REL-LIC-${tag}`;
    const doctorSpecializationNameEn = `Release specialty ${tag}`;
    const doctorSpecializationNameDe = `Release Spezialgebiet ${tag}`;
    const staffDisplayName = `Release Staff ${tag}`;
    const staffRoleNameEn = `Release role ${tag}`;
    const staffRoleNameDe = `Release Rolle ${tag}`;
    const staffRoleCode = `release_role_${tag}`;
    const serviceName = `Release fixed service ${tag}`;

    await page.goto("/providers");
    await page.getByRole("button", { name: /^Neuer Provider$/i }).click();

    const providerForm = formWithHeading(page, /Neuer Provider/i);
    await expect(providerForm).toBeVisible();
    await providerForm.getByLabel(/Anzeigename/i).fill(providerName);
    await providerForm.getByLabel(/Rechtlicher Name/i).fill(`${providerName} GmbH`);
    await providerForm.getByLabel(/Steuer-ID/i).fill(`VAT-${tag}`);
    await chooseFieldOption(page, providerForm, /^Land$/i, /Deutschland|Germany/i);
    await chooseFieldOption(page, providerForm, /Fachbereich/i, /Cardiology|Kardiologie/i);
    await chooseFieldOption(page, providerForm, /Organisationsebene/i, /Klinik/i);
    await chooseFieldOption(page, providerForm, /Uebergeordneter Provider/i, parentProvider.name);
    await providerForm.getByRole("button", { name: /^Telefon hinzufügen$/i }).click();
    await providerForm.getByLabel(/^Telefon$/i).fill(providerPhone);
    await providerForm.getByRole("button", { name: /^E-Mail hinzufügen$/i }).click();
    await providerForm.getByLabel(/^E-Mail$/i).fill(providerEmail);
    await providerForm.getByRole("button", { name: /^Neuer Provider$/i }).click();

    await expect(page).toHaveURL(/\/providers\/[0-9a-f-]+/i);
    await expect(page.getByRole("heading", { name: providerName }).first()).toBeVisible();
    const providerId = createdProviderIdFromUrl(page);

    await page.getByRole("button", { name: /^Bearbeiten$/i }).first().click();
    const providerEditForm = formWithHeading(page, /^Bearbeiten$/i);
    await expect(providerEditForm).toBeVisible();
    await providerEditForm.getByRole("button", { name: /Spezialisierungen verwalten/i }).click();
    const specializationForm = page.locator("form#provider-specialization-form");
    await expect(specializationForm).toBeVisible();
    await specializationForm.getByLabel(/Name RU/i).fill(doctorSpecializationNameEn);
    await specializationForm.getByLabel(/Name DE/i).fill(doctorSpecializationNameDe);
    await specializationForm.getByLabel(/Sortierung/i).fill("18");
    await page.getByRole("button", { name: /Spezialisierung erstellen/i }).click();
    await expect(page.getByText(doctorSpecializationNameDe).first()).toBeVisible();
    await page.getByRole("button", { name: /Abbrechen/i }).last().click();
    await expect(specializationForm).toBeHidden();
    await providerEditForm.getByRole("button", { name: /Abbrechen/i }).click();
    await expect(providerEditForm).toBeHidden();

    await openNewDoctorForm(page);
    const doctorForm = formWithHeading(page, /Neuer Arzt/i);
    await expect(doctorForm).toBeVisible();
    await doctorForm.getByLabel(/Vorname/i).fill("Release");
    await doctorForm.getByLabel(/Nachname/i).fill(doctorLastName);
    await chooseFieldOption(page, doctorForm, /Titel/i, /Dr\. med\./i);
    await chooseFieldOption(page, doctorForm, /Fachbereich|Spezialisierungen/i, /Neurology|Neurologie/i);
    await chooseFieldOption(page, doctorForm, /Fachbereich|Spezialisierungen/i, doctorSpecializationNameDe);
    await doctorForm.getByRole("button", { name: /^Telefon hinzufügen$/i }).click();
    await doctorForm.getByLabel(/^Telefon$/i).fill("+49 30 555 0101");
    await doctorForm.getByRole("button", { name: /^E-Mail hinzufügen$/i }).click();
    await doctorForm.getByLabel(/^E-Mail$/i).fill(`doctor-${tag}@clinic.example`);
    await chooseFieldOption(page, doctorForm, /Sprachen/i, /Deutsch/i);
    await chooseFieldOption(page, doctorForm, /Sprachen/i, /Englisch/i);
    await doctorForm.getByLabel(/Lizenznummer/i).fill(doctorLicenseNumber);
    await chooseFieldOption(page, doctorForm, /Lizenzland/i, /Osterreich|Österreich|Austria/i);
    await doctorForm.getByRole("button", { name: /Neuer Arzt/i }).click();
    await expect(doctorForm).toBeHidden();
    await expect(page.getByText(`Release ${doctorLastName}`).first()).toBeVisible();

    await openNewDoctorForm(page);
    const targetDoctorForm = formWithHeading(page, /Neuer Arzt/i);
    await expect(targetDoctorForm).toBeVisible();
    await targetDoctorForm.getByLabel(/Vorname/i).fill("Release");
    await targetDoctorForm.getByLabel(/Nachname/i).fill(targetDoctorLastName);
    await chooseFieldOption(page, targetDoctorForm, /Titel/i, /Dr\. med\./i);
    await chooseFieldOption(page, targetDoctorForm, /Fachbereich|Spezialisierungen/i, /Neurology|Neurologie/i);
    await targetDoctorForm.getByRole("button", { name: /Neuer Arzt/i }).click();
    await expect(targetDoctorForm).toBeHidden();
    await expect(page.getByText(`Release ${targetDoctorLastName}`).first()).toBeVisible();

    await page.getByText(`Release ${doctorLastName}`).first().click();
    const readOnlyDoctorSheet = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: new RegExp(`Release ${doctorLastName}`) }) })
      .last();
    await expect(readOnlyDoctorSheet).toBeVisible();
    await expect(readOnlyDoctorSheet.getByText(doctorLicenseNumber).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(readOnlyDoctorSheet).toBeHidden();

    await page.getByRole("button", { name: /Beziehung/i }).first().click();
    const relationshipForm = formWithHeading(page, /Beziehung hinzufuegen/i);
    await expect(relationshipForm).toBeVisible();
    await chooseFieldOption(page, relationshipForm, /Zielarzt/i, new RegExp(`Release ${targetDoctorLastName}`));
    await chooseFieldOption(page, relationshipForm, /Beziehungstyp/i, /Ueberweisung|referral/i);
    await relationshipForm.getByRole("button", { name: /Beziehung hinzufuegen/i }).click();
    await expect(page.getByText(`Release ${targetDoctorLastName}`).first()).toBeVisible();

    await page.getByRole("button", { name: /Rollen verwalten/i }).click();
    const roleForm = page.locator("form#provider-staff-role-form");
    await expect(roleForm).toBeVisible();
    await roleForm.getByLabel(/Name RU/i).fill(staffRoleNameEn);
    await roleForm.getByLabel(/Name DE/i).fill(staffRoleNameDe);
    await roleForm.getByLabel(/Sortierung/i).fill("17");
    await page.getByRole("button", { name: /Rolle erstellen/i }).click();
    await expect(page.getByText(staffRoleNameDe).first()).toBeVisible();
    await page.getByRole("button", { name: /Abbrechen/i }).click();

    await page.getByRole("button", { name: /Neuer Mitarbeitender/i }).click();
    const staffForm = formWithHeading(page, /Neuer Mitarbeitender/i);
    await expect(staffForm).toBeVisible();
    await staffForm.getByLabel(/Vorname/i).fill("Release");
    await staffForm.getByLabel(/Nachname/i).fill(`Staff ${tag}`);
    await staffForm.getByLabel(/Anzeigename/i).fill(staffDisplayName);
    await chooseFieldOption(page, staffForm, /Rolle/i, staffRoleNameDe);
    await staffForm.getByLabel(/Abteilung/i).fill("Front desk");
    await staffForm.getByRole("button", { name: /^Telefon hinzufügen$/i }).click();
    await staffForm.getByLabel(/^Telefon$/i).fill("+49 30 555 0202");
    await staffForm.getByRole("button", { name: /^E-Mail hinzufügen$/i }).click();
    await staffForm.getByLabel(/^E-Mail$/i).fill(`staff-${tag}@clinic.example`);
    await staffForm.getByRole("button", { name: /Neuer Mitarbeitender/i }).click();
    await expect(staffForm).toBeHidden();
    await expect(page.getByText(staffDisplayName).first()).toBeVisible();
    await expect(page.getByText(staffRoleNameDe).first()).toBeVisible();

    await page.getByText(staffDisplayName).first().click();
    const readOnlyStaffSheet = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: staffDisplayName }) })
      .last();
    await expect(readOnlyStaffSheet).toBeVisible();
    await expect(readOnlyStaffSheet.getByText(`staff-${tag}@clinic.example`).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(readOnlyStaffSheet).toBeHidden();

    await page.getByRole("button", { name: /Neue Leistung/i }).click();
    const serviceForm = formWithHeading(page, /Neue Leistung/i);
    await expect(serviceForm).toBeVisible();
    await serviceForm.getByLabel(/Leistungsname/i).fill(serviceName);
    await serviceForm.getByLabel(/Beschreibung/i).fill("Release service UI smoke");
    const servicePriceType = serviceForm.getByRole("combobox", { name: /Preistyp/i }).first();
    await expect(servicePriceType).toBeEnabled();
    await chooseComboboxOption(page, servicePriceType, /Festpreis/i);
    await serviceForm.getByLabel(/^Preis$/i).fill("120");
    await serviceForm.getByLabel(/Preisnotiz/i).fill("Release smoke fixed");
    await serviceForm.getByRole("button", { name: /Neue Leistung/i }).click();
    await expect(serviceForm).toBeHidden();
    await expect(page.getByText(serviceName).first()).toBeVisible();

    const detailResponse = await request.get(
      `${pmApi.backendUrl}/api/v1/providers/${providerId}`,
      { headers: pmApi.headers },
    );
    expect(detailResponse.ok()).toBe(true);
    const detail = (await detailResponse.json()) as ProviderDetail;

    expect(detail.name).toBe(providerName);
    expect(detail.address_country).toBe("Germany");
    expect(detail.phone).toBe(providerPhone);
    expect(detail.email).toBe(providerEmail);
    expect(detail.contacts?.some((item) => item.contact_kind === "phone" && item.value === providerPhone)).toBe(true);
    expect(detail.contacts?.some((item) => item.contact_kind === "email" && item.value === providerEmail)).toBe(true);
    expect(detail.organization_level).toBe("clinic");
    expect(detail.parent_provider_name).toBe(parentProvider.name);
    expect(hasSpecialization(detail.specializations, /^(cardiology|kardiologie)$/i)).toBe(true);

    const doctor = detail.doctors.find((item) => item.name === `Release ${doctorLastName}`);
    expect(doctor).toBeDefined();
    expect(doctor!.license_number).toBe(doctorLicenseNumber);
    expect(doctor!.licensing_country).toBe("Austria");
    expect(
      doctor!.specializations?.some((item) => item.name_en === doctorSpecializationNameEn),
    ).toBe(true);
    const targetDoctor = detail.doctors.find((item) => item.name === `Release ${targetDoctorLastName}`);
    expect(targetDoctor).toBeDefined();
    expect(
      doctor!.relationships?.some((item) =>
        item.target_doctor_id === targetDoctor!.id && item.relationship_type === "referral"
      ),
    ).toBe(true);

    const staff = detail.staff?.find((item) => item.display_name === staffDisplayName);
    expect(staff).toBeDefined();
    expect(staff!.role).toBe(staffRoleCode);
    expect(staff!.contacts.some((item) => item.value === "+49 30 555 0202")).toBe(true);
    expect(staff!.contacts.some((item) => item.value === `staff-${tag}@clinic.example`)).toBe(true);

    const service = detail.services.find((item) => item.service_name === serviceName);
    expect(service).toBeDefined();
    expect(service!.price_type).toBe("fixed");
    expect(Number(service!.price)).toBe(120);
  });
});
