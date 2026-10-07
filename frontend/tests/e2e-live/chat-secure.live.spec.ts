import { expect, test } from "@playwright/test";

import {
  bootstrapFullSmokeScenario,
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

/**
 * The message bubble with that text. Since the chat stores messages on the
 * server, the conversation list also previews the text ("Du: …"), so a plain
 * text lookup would find two elements.
 */
function messageBubble(page: import("@playwright/test").Page, text: string) {
  return page.locator('[data-testid^="chat-message-text-"]').filter({ hasText: text });
}

async function waitForConversationContent(
  page: import("@playwright/test").Page,
  peer: ChatPeer,
  content: string,
) {
  const contentPattern = new RegExp(escapeRegExp(content), "i");
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
  // Let in-flight history/key requests finish. Reloading every 750 ms aborts
  // them on a slower connection and can prevent decryption indefinitely.
  await expect(page.getByText(peer.name).first()).toBeVisible();
  await expect(textBubbleLocator.or(secureAttachmentButton).or(attachmentLink).first())
    .toBeVisible({ timeout: 35_000 });
}

async function sendTextWithRetry(
  page: import("@playwright/test").Page,
  peerUserId: string,
  message: string,
) {
  async function attemptSend(attempt: number): Promise<void> {
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
        `Text send failed after retries: ${lastStatus} ${lastBody}`,
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

      // The chat is encrypted on the server (owner decision 2026-10-07): no
      // device key is created or registered, so chatting starts right away.
      const keyRegistrations: string[] = [];
      for (const page of [patientPage, conciergePage]) {
        page.on("request", (request) => {
          if (request.method() === "POST" && request.url().includes("/api/v1/messages/e2e-key")) {
            keyRegistrations.push(request.url());
          }
        });
      }
      await Promise.all([patientPage, conciergePage].map(async (page) => {
        await page.goto("/chat");
        await expect(page.getByRole("heading", { name: /^Chat$/i })).toBeVisible();
      }));

      await patientPage
        .getByRole("button", { name: /Neue Nachricht|Новое сообщение/i })
        .click();
      const patientPicker = patientPage.getByTestId("chat-new-picker");
      await patientPicker
        .getByPlaceholder(/Benutzer suchen|Поиск пользователей/i)
        .fill(scenario.credentials.concierge.name);
      await patientPicker
        .getByRole("option", { name: new RegExp(scenario.credentials.concierge.name, "i") })
        .click();

      await conciergePage
        .getByRole("button", { name: /Neue Nachricht|Новое сообщение/i })
        .click();
      const conciergePicker = conciergePage.getByTestId("chat-new-picker");
      await conciergePicker
        .getByPlaceholder(/Benutzer suchen|Поиск пользователей/i)
        .fill(scenario.credentials.patient.name);
      await conciergePicker
        .getByRole("option", { name: new RegExp(scenario.credentials.patient.name, "i") })
        .click();

      const encryptedChatLabel = /Serverseitig verschlüsselt|Шифрование на сервере/i;
      await expect(patientPage.getByText(encryptedChatLabel)).toBeVisible();
      await expect(conciergePage.getByText(encryptedChatLabel)).toBeVisible();

      await sendTextWithRetry(
        patientPage,
        scenario.credentials.concierge.user_id,
        "Patient secure update for the care team",
      );
      await expect(
        messageBubble(patientPage, "Patient secure update for the care team"),
      ).toBeVisible();

      await reopenConversation(conciergePage, {
        id: scenario.credentials.patient.user_id,
        name: scenario.credentials.patient.name,
        role: "patient",
      });
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
      await expect(patientPage.getByText("patient-secure-note.pdf").first()).toBeVisible();

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
        .getByRole("button", { name: "Herunterladen: patient-secure-note.pdf", exact: true })
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
        messageBubble(patientPage, "Patient secure update for the care team"),
      ).toHaveCount(0);

      await reopenConversation(conciergePage, {
        id: scenario.credentials.patient.user_id,
        name: scenario.credentials.patient.name,
        role: "patient",
      });
      await expect(
        messageBubble(conciergePage, "Patient secure update for the care team"),
      ).toHaveCount(0);
      expect(keyRegistrations).toEqual([]);
    } finally {
      await patientContext.close();
      await conciergeContext.close();
    }
  });
});
