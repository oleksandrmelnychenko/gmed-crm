import { expect, test } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  setGermanLanguage,
} from "./support/live-helpers";

test.describe("case live workflows", () => {
  test("patient manager can create a reusable anamnesis text snippet and insert its rendered content into the narrative", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const narrativeReason = `Belastungsdyspnoe ${scenario.tag}`;
    const createCaseResponse = await request.post(
      `${api.backendUrl}/api/v1/cases`,
      {
        headers: api.headers,
        data: {
          patient_id: scenario.patient.id,
          hauptanfragegrund: narrativeReason,
          aktuelle_anamnese: "",
          zuweiser: "Dr. Live E2E",
        },
      },
    );
    expect(createCaseResponse.ok()).toBeTruthy();
    const createdCase = (await createCaseResponse.json()) as { id: string };

    const caseDetailResponse = await request.get(
      `${api.backendUrl}/api/v1/cases/${createdCase.id}`,
      { headers: api.headers },
    );
    expect(caseDetailResponse.ok()).toBeTruthy();
    const caseDetail = (await caseDetailResponse.json()) as {
      case_id: string;
      aktuelle_anamnese: string | null;
    };
    expect(caseDetail.aktuelle_anamnese ?? "").toBe("");

    const snippetLabel = `Live snippet ${scenario.tag}`;
    const snippetBody =
      "Patient {patient_name} ({patient_pid}) berichtet über {hauptanfragegrund}. Referenz {case_id}.";
    const renderedSnippet = `Patient ${scenario.patient.name} (${scenario.patient.patient_id}) berichtet über ${narrativeReason}. Referenz ${caseDetail.case_id}.`;

    await page.goto(`/cases?case=${createdCase.id}`);
    const corePanel = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Kernanamnese" }),
    }).first();
    await expect(
      page.getByRole("button", { name: "Bausteine verwalten" }),
    ).toBeVisible();
    await expect(page.getByText(caseDetail.case_id).first()).toBeVisible();

    await page.getByRole("button", { name: "Bausteine verwalten" }).click();
    const snippetDialog = page.getByRole("dialog", {
      name: "Anamnese-Textbausteine",
    });
    await expect(
      snippetDialog.getByRole("heading", {
        name: "Anamnese-Textbausteine",
      }),
    ).toBeVisible();

    const snippetEditor = snippetDialog.locator("form").last();
    const snippetTextboxes = snippetEditor.getByRole("textbox");
    await snippetTextboxes.nth(0).fill(snippetLabel);
    await snippetTextboxes.nth(1).fill("live-e2e");
    await snippetTextboxes.nth(2).fill(snippetBody);
    await snippetEditor.evaluate((form) => {
      (form.querySelector('button[type="submit"]') as HTMLButtonElement | null)?.click();
    });
    await expect(snippetDialog).toBeHidden({ timeout: 15_000 });

    const snippetCard = corePanel
      .locator("div")
      .filter({
        has: page.getByText(snippetLabel, { exact: true }),
        has: page.getByRole("button", { name: "In Anamnese einfügen" }),
      })
      .first();
    await expect(snippetCard).toBeVisible();
    await expect(snippetCard.getByText(renderedSnippet)).toBeVisible();

    const narrativeField = corePanel.locator("textarea").first();
    await snippetCard
      .getByRole("button", { name: "In Anamnese einfügen" })
      .click();
    await expect(narrativeField).toHaveValue(renderedSnippet);

    await corePanel.getByRole("button", { name: "Save overview" }).click();

    await expect(async () => {
      const caseResponse = await request.get(
        `${api.backendUrl}/api/v1/cases/${createdCase.id}`,
        { headers: api.headers },
      );
      expect(caseResponse.ok()).toBe(true);
      const savedCase = (await caseResponse.json()) as {
        aktuelle_anamnese: string | null;
      };
      expect(savedCase.aktuelle_anamnese).toBe(renderedSnippet);

      const snippetsResponse = await request.get(
        `${api.backendUrl}/api/v1/cases/text-snippets`,
        { headers: api.headers },
      );
      expect(snippetsResponse.ok()).toBe(true);
      const snippets = (await snippetsResponse.json()) as Array<{
        label: string;
        category: string | null;
        body: string;
        is_active: boolean;
      }>;
      const snippet = snippets.find((item) => item.label === snippetLabel);
      expect(snippet).toBeDefined();
      expect(snippet!.category).toBe("live-e2e");
      expect(snippet!.body).toBe(snippetBody);
      expect(snippet!.is_active).toBe(true);
    }).toPass({ timeout: 15_000 });
  });
});
