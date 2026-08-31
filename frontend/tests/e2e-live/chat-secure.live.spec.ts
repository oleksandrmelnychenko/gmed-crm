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

type DownloadProbeWindow = Window & {
  __gmedCapturedDownload?: Blob;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type ChatPeer = {
  id: string;
  name: string;
  role: "concierge" | "patient";
};

async function reopenConversation(
  page: import("@playwright/test").Page,
  peer: ChatPeer,
) {
  const route = new URLSearchParams({
    peer: peer.id,
    name: peer.name,
    role: peer.role,
  });
  await page.goto(`/chat?${route.toString()}`);
  await expect(page.getByRole("heading", { name: /^Chat$/i })).toBeVisible();
  await expect(page.getByText(peer.name).first()).toBeVisible();
}

async function waitForConversationContent(
  page: import("@playwright/test").Page,
  peer: ChatPeer,
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
      await reopenConversation(page, peer).catch(() => undefined);
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
  // The polling loop already spent the full delivery budget. Keep the final
  // assertion short so a missing/decryption-failed message reports its real
  // locator instead of consuming a second full timeout window.
  await expect(textBubbleLocator).toBeVisible({ timeout: 1_000 });
}

async function refreshOwnChatKey(page: import("@playwright/test").Page) {
  const result = await page.evaluate(async () => {
    const token = window.localStorage.getItem("gmed_access_token");
    const response = await fetch("/api/v1/messages/e2e-key", {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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
      { timeout: 15_000 },
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
  test("assigned patient and concierge can exchange secure chat text and attachment", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    const [scenario, patientContext, conciergeContext] = await Promise.all([
      bootstrapFullSmokeScenario(request),
      browser.newContext(),
      browser.newContext(),
    ]);
    const [patientPage, conciergePage] = await Promise.all([
      patientContext.newPage(),
      conciergeContext.newPage(),
    ]);

    try {
      await Promise.all([
        setGermanLanguage(patientPage),
        setGermanLanguage(conciergePage),
      ]);

      await Promise.all([
        loginViaApi(
          patientPage,
          request,
          scenario.credentials.patient.email,
          scenario.credentials.password,
        ),
        loginViaApi(
          conciergePage,
          request,
          scenario.credentials.concierge.email,
          scenario.credentials.password,
        ),
      ]);

      const patientKeyResponse = patientPage.waitForResponse(
        (nextResponse) =>
          nextResponse.url().includes("/api/v1/messages/e2e-key") &&
          nextResponse.request().method() === "POST",
        { timeout: 15_000 },
      );
      await patientPage.goto("/chat");
      await expect(
        patientPage.getByRole("heading", { name: /^Chat$/i }),
      ).toBeVisible();
      expect((await patientKeyResponse).ok()).toBeTruthy();

      const conciergeKeyResponse = conciergePage.waitForResponse(
        (nextResponse) =>
          nextResponse.url().includes("/api/v1/messages/e2e-key") &&
          nextResponse.request().method() === "POST",
        { timeout: 15_000 },
      );
      await conciergePage.goto("/chat");
      await expect(conciergePage.getByRole("heading", { name: /^Chat$/i })).toBeVisible();
      expect((await conciergeKeyResponse).ok()).toBeTruthy();

      await patientPage
        .getByRole("button", { name: /Neue Nachricht|Новое сообщение/i })
        .click();
      const patientPicker = patientPage.getByTestId("chat-new-picker");
      await patientPicker
        .getByPlaceholder(/Benutzer suchen|Поиск пользователей/i)
        .fill(scenario.credentials.concierge.name);
      await patientPicker
        .getByRole("button", { name: new RegExp(scenario.credentials.concierge.name, "i") })
        .click();

      await conciergePage
        .getByRole("button", { name: /Neue Nachricht|Новое сообщение/i })
        .click();
      const conciergePicker = conciergePage.getByTestId("chat-new-picker");
      await conciergePicker
        .getByPlaceholder(/Benutzer suchen|Поиск пользователей/i)
        .fill(scenario.credentials.patient.name);
      await conciergePicker
        .getByRole("button", { name: new RegExp(scenario.credentials.patient.name, "i") })
        .click();

      const encryptedChatLabel = /End-to-end encrypted chat|Ende-zu-Ende verschlüsselt/i;
      await expect(patientPage.getByText(encryptedChatLabel)).toBeVisible();
      await expect(conciergePage.getByText(encryptedChatLabel)).toBeVisible();

      await sendEncryptedTextWithRetry(
        patientPage,
        scenario.credentials.concierge.user_id,
        "Patient secure update for the care team",
      );
      await expect(
        patientPage.getByText("Patient secure update for the care team"),
      ).toBeVisible();

      await reopenConversation(conciergePage, scenario.credentials.patient.name);
      await refreshOwnChatKey(conciergePage);
      await waitForConversationContent(
        conciergePage,
        {
          id: scenario.credentials.patient.user_id,
          name: scenario.credentials.patient.name,
          role: "patient",
        },
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
            .includes(`/api/v1/messages/${scenario.credentials.concierge.user_id}/upload`),
        { timeout: 15_000 },
      );
      await patientPage.locator("form button[type='submit']").click();
      const uploadResponse = await uploadResponsePromise;
      expect(
        uploadResponse.ok(),
        `secure attachment upload failed: ${uploadResponse.status()} ${await uploadResponse.text()}`,
      ).toBeTruthy();
      await expect(patientPage.getByText("patient-secure-note.pdf")).toBeVisible();

      await waitForConversationContent(
        conciergePage,
        {
          id: scenario.credentials.patient.user_id,
          name: scenario.credentials.patient.name,
          role: "patient",
        },
        "patient-secure-note.pdf",
      );

      await conciergePage.evaluate(() => {
        const probeWindow = window as DownloadProbeWindow;
        const createObjectUrl = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (blob: Blob) => {
          probeWindow.__gmedCapturedDownload = blob;
          return createObjectUrl(blob);
        };
      });
      const attachmentDownloadResponse = conciergePage.waitForResponse(
        (nextResponse) =>
          nextResponse.request().method() === "GET" &&
          nextResponse.url().includes("/api/v1/messages/file/"),
        { timeout: 15_000 },
      );
      await conciergePage
        .getByRole("button", { name: /patient-secure-note\.pdf/i })
        .click();
      expect((await attachmentDownloadResponse).ok()).toBeTruthy();
      await expect
        .poll(
          () =>
            conciergePage.evaluate(async () => {
              const blob = (window as DownloadProbeWindow)
                .__gmedCapturedDownload;
              if (!blob) return null;
              return {
                type: blob.type,
                bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
              };
            }),
          { timeout: 15_000 },
        )
        .toEqual({
          type: "application/pdf",
          bytes: Array.from(MINIMAL_PDF),
        });

      const deleteResponsePromise = patientPage.waitForResponse(
        (nextResponse) =>
          nextResponse.request().method() === "DELETE" &&
          nextResponse
            .url()
            .includes(`/api/v1/messages/${scenario.credentials.concierge.user_id}/`),
        { timeout: 15_000 },
      );
      await patientPage
        .getByRole("button", { name: /Nachricht löschen|Удалить сообщение/i })
        .first()
        .click();
      await patientPage
        .getByRole("button", { name: /Löschen|Удалить/i })
        .last()
        .click();
      expect((await deleteResponsePromise).ok()).toBeTruthy();
      await expect(
        patientPage.getByText("Patient secure update for the care team"),
      ).toHaveCount(0);

      await reopenConversation(conciergePage, {
        id: scenario.credentials.patient.user_id,
        name: scenario.credentials.patient.name,
        role: "patient",
      });
      await expect(
        conciergePage.getByText("Patient secure update for the care team"),
      ).toHaveCount(0);
    } finally {
      await patientContext.close();
      await conciergeContext.close();
    }
  });
});
