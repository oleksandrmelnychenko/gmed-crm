import { expect, test } from "@playwright/test";

import {
  bootstrapFullSmokeScenario,
  ensureLiveBackendHealthy,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
  "utf8",
);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function reopenConversation(page: import("@playwright/test").Page, peerName: string) {
  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: /^Chat$/i })).toBeVisible();
  const peerButton = page
    .getByRole("button", { name: new RegExp(peerName, "i") })
    .first();
  await expect(peerButton).toBeVisible();
  const loadMessagesResponse = page.waitForResponse(
    (nextResponse) =>
      nextResponse.request().method() === "GET" &&
      nextResponse.url().includes("/api/v1/messages/"),
    { timeout: 10_000 },
  ).catch(() => undefined);
  await peerButton.click();
  await loadMessagesResponse;
}

async function waitForConversationContent(
  page: import("@playwright/test").Page,
  peerName: string,
  content: string,
) {
  const contentPattern = new RegExp(escapeRegExp(content), "i");
  const deadline = Date.now() + 35_000;

  async function pollForMessage(): Promise<void> {
    if (Date.now() >= deadline) {
      return;
    }

    const textBubbleLocator = page
      .locator('[data-testid^="chat-message-text-"]')
      .filter({ hasText: content })
      .first();
    const secureAttachmentButton = page
      .getByRole("button", { name: contentPattern })
      .first();
    const attachmentLink = page
      .getByRole("link", { name: contentPattern })
      .first();
    return Promise.all([
      textBubbleLocator.isVisible().catch(() => false),
      secureAttachmentButton.isVisible().catch(() => false),
      attachmentLink.isVisible().catch(() => false),
    ]).then(async ([textVisible, buttonVisible, linkVisible]) => {
      if (textVisible || buttonVisible || linkVisible) {
        return;
      }

      await ensureLiveBackendHealthy().catch(() => undefined);
      await refreshOwnChatKey(page).catch(() => undefined);
      await reopenConversation(page, peerName).catch(() => undefined);
      await page.waitForTimeout(750);
      return pollForMessage();
    });
  }

  await pollForMessage();

  const textBubbleLocator = page
    .locator('[data-testid^="chat-message-text-"]')
    .filter({ hasText: content })
    .first();
  const secureAttachmentButton = page
    .getByRole("button", { name: contentPattern })
    .first();
  const attachmentLink = page
    .getByRole("link", { name: contentPattern })
    .first();
  if (await secureAttachmentButton.isVisible().catch(() => false)) {
    await expect(secureAttachmentButton).toBeVisible();
    return;
  }
  if (await attachmentLink.isVisible().catch(() => false)) {
    await expect(attachmentLink).toBeVisible();
    return;
  }
  await expect(textBubbleLocator).toBeVisible({ timeout: 35_000 });
}

async function refreshOwnChatKey(page: import("@playwright/test").Page) {
  const result = await page.evaluate(async () => {
    const token = window.localStorage.getItem("gmed_access_token");
    const ringRaw = window.localStorage.getItem("gmed_chat_e2e_keyring_v1");
    if (!ringRaw) {
      return { ok: false, error: "missing local chat keyring" };
    }

    const ring = JSON.parse(ringRaw) as {
      activeFingerprint: string | null;
      keys: Record<
        string,
        {
          algorithm: string;
          publicKey: string;
        }
      >;
    };
    const activeFingerprint = ring.activeFingerprint;
    if (!activeFingerprint || !ring.keys[activeFingerprint]) {
      return { ok: false, error: "missing active chat key" };
    }

    const activeKey = ring.keys[activeFingerprint];
    const response = await fetch("/api/v1/messages/e2e-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        algorithm: activeKey.algorithm,
        public_key: activeKey.publicKey,
      }),
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  });

  expect(result.ok, "failed to refresh active chat key").toBeTruthy();
}

async function sendEncryptedTextWithRetry(
  page: import("@playwright/test").Page,
  peerUserId: string,
  message: string,
) {
  async function attemptSend(attempt: number): Promise<void> {
    await refreshOwnChatKey(page);
    await page
      .getByPlaceholder(/Nachricht eingeben|Введите сообщение/i)
      .fill(message);
    const textSendResponse = page.waitForResponse(
      (nextResponse) => {
        const responseUrl = new URL(nextResponse.url());
        return (
          responseUrl.pathname === `/api/v1/messages/${peerUserId}` &&
          nextResponse.request().method() === "POST"
        );
      },
    );
    await page.locator("form button[type='submit']").click();
    const response = await textSendResponse;
    if (response.ok()) {
      return;
    }

    const lastStatus = response.status();
    const lastBody = await response.text();
    if (attempt >= 2) {
      throw new Error(
        `Encrypted text send failed after retries: ${lastStatus} ${lastBody}`,
      );
    }
    await page.waitForTimeout(1_000);
    return attemptSend(attempt + 1);
  }

  await attemptSend(0);
}

test.describe("secure chat live workflows", () => {
  test("assigned patient and patient manager can exchange secure chat text and attachment", async ({
    browser,
    request,
  }) => {
    const [scenario, patientContext, pmContext] = await Promise.all([
      bootstrapFullSmokeScenario(request),
      browser.newContext(),
      browser.newContext(),
    ]);
    const [patientPage, pmPage] = await Promise.all([
      patientContext.newPage(),
      pmContext.newPage(),
    ]);

    try {
      await Promise.all([
        setGermanLanguage(patientPage),
        setGermanLanguage(pmPage),
      ]);

      await Promise.all([
        loginViaApi(
          patientPage,
          request,
          scenario.credentials.patient.email,
          scenario.credentials.password,
        ),
        loginViaApi(
          pmPage,
          request,
          scenario.credentials.pm.email,
          scenario.credentials.password,
        ),
      ]);

      const patientKeyResponse = patientPage.waitForResponse(
        (nextResponse) =>
          nextResponse.url().includes("/api/v1/messages/e2e-key") &&
          nextResponse.request().method() === "POST",
      );
      await patientPage.goto("/chat");
      await expect(
        patientPage.getByRole("heading", { name: /^Chat$/i }),
      ).toBeVisible();
      expect((await patientKeyResponse).ok()).toBeTruthy();

      const pmKeyResponse = pmPage.waitForResponse(
        (nextResponse) =>
          nextResponse.url().includes("/api/v1/messages/e2e-key") &&
          nextResponse.request().method() === "POST",
      );
      await pmPage.goto("/chat");
      await expect(pmPage.getByRole("heading", { name: /^Chat$/i })).toBeVisible();
      expect((await pmKeyResponse).ok()).toBeTruthy();

      await patientPage
        .getByRole("button", { name: /Neue Nachricht|Новое сообщение/i })
        .click();
      const patientPicker = patientPage.getByTestId("chat-new-picker");
      await patientPicker
        .getByPlaceholder(/Benutzer suchen|Поиск пользователей/i)
        .fill(scenario.credentials.pm.name);
      await patientPicker
        .getByRole("button", { name: new RegExp(scenario.credentials.pm.name, "i") })
        .click();

      await pmPage
        .getByRole("button", { name: /Neue Nachricht|Новое сообщение/i })
        .click();
      const pmPicker = pmPage.getByTestId("chat-new-picker");
      await pmPicker
        .getByPlaceholder(/Benutzer suchen|Поиск пользователей/i)
        .fill(scenario.credentials.patient.name);
      await pmPicker
        .getByRole("button", { name: new RegExp(scenario.credentials.patient.name, "i") })
        .click();

      const encryptedChatLabel = /End-to-end encrypted chat|Ende-zu-Ende verschlüsselt/i;
      await expect(patientPage.getByText(encryptedChatLabel)).toBeVisible();
      await expect(pmPage.getByText(encryptedChatLabel)).toBeVisible();

      await sendEncryptedTextWithRetry(
        patientPage,
        scenario.credentials.pm.user_id,
        "Patient secure update for the care team",
      );
      await expect(
        patientPage.getByText("Patient secure update for the care team"),
      ).toBeVisible();

      await reopenConversation(pmPage, scenario.credentials.patient.name);
      await refreshOwnChatKey(pmPage);
      await waitForConversationContent(
        pmPage,
        scenario.credentials.patient.name,
        "Patient secure update for the care team",
      );

      await patientPage
        .locator("form input[type='file']")
        .setInputFiles({
          name: "patient-secure-note.pdf",
          mimeType: "application/pdf",
          buffer: MINIMAL_PDF,
        });
      await refreshOwnChatKey(patientPage);
      await patientPage
        .getByPlaceholder(/Nachricht eingeben|Введите сообщение/i)
        .fill("Please see the attached secure note.");

      const uploadResponsePromise = patientPage.waitForResponse(
        (nextResponse) =>
          nextResponse.request().method() === "POST" &&
          nextResponse
            .url()
            .includes(`/api/v1/messages/${scenario.credentials.pm.user_id}/upload`),
      );
      await patientPage.locator("form button[type='submit']").click();
      const uploadResponse = await uploadResponsePromise;
      expect(
        uploadResponse.ok(),
        `secure attachment upload failed: ${uploadResponse.status()} ${await uploadResponse.text()}`,
      ).toBeTruthy();
      await expect(patientPage.getByText("patient-secure-note.pdf")).toBeVisible();

      await waitForConversationContent(
        pmPage,
        scenario.credentials.patient.name,
        "patient-secure-note.pdf",
      );

      const [download] = await Promise.all([
        pmPage.waitForEvent("download"),
        pmPage.getByRole("button", { name: /patient-secure-note\.pdf/i }).click(),
      ]);
      expect(download.suggestedFilename()).toBe("patient-secure-note.pdf");
    } finally {
      await patientContext.close();
      await pmContext.close();
    }
  });
});
