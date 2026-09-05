import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test, type Page, type Route } from "@playwright/test";

import type { Message } from "../../src/pages/chat/model/types";

const CHAT_E2E_ALGORITHM = "p256-hkdf-aes256gcm-v1";

type LocalMessageKeyRecord = {
  algorithm: string;
  fingerprint: string;
  publicKey: string;
  privateKeyJwk: JsonWebKey;
  createdAt: string;
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function parseMultipart(route: Route) {
  const contentType = route.request().headers()["content-type"] ?? "";
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  const boundary = boundaryMatch?.[1];
  const bodyBuffer = route.request().postDataBuffer() ?? Buffer.alloc(0);

  if (!boundary) {
    return {
      fields: {} as Record<string, string>,
      fileName: null as string | null,
      fileMime: null as string | null,
      fileBytes: Buffer.alloc(0),
    };
  }

  const text = bodyBuffer.toString("latin1");
  const parts = text.split(`--${boundary}`);
  const fields: Record<string, string> = {};
  let fileName: string | null = null;
  let fileMime: string | null = null;
  let fileBytes = Buffer.alloc(0);

  for (const part of parts) {
    if (!part.trim() || part.trim() === "--") continue;
    const [headers, ...bodySegments] = part.split("\r\n\r\n");
    if (bodySegments.length === 0) continue;

    const rawBody = bodySegments.join("\r\n\r\n").replace(/\r\n$/, "");
    const fieldName = headers.match(/name="([^"]+)"/i)?.[1];
    if (!fieldName) continue;

    if (fieldName === "file") {
      const encodedName = headers.match(/filename="([^"]+)"/i)?.[1];
      fileName = encodedName ? Buffer.from(encodedName, "latin1").toString("utf8") : null;
      fileMime = headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] ?? null;
      fileBytes = Buffer.from(rawBody, "latin1");
      continue;
    }

    fields[fieldName] = rawBody.trim();
  }

  return { fields, fileName, fileMime, fileBytes };
}

function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

async function fingerprintPublicKey(publicKeyBytes: Uint8Array) {
  const digest = await webcrypto.subtle.digest("SHA-256", publicKeyBytes);
  return Buffer.from(digest).toString("hex");
}

async function generateLocalMessageKey(): Promise<LocalMessageKeyRecord> {
  const keyPair = await webcrypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"],
  );
  const publicKeyBytes = new Uint8Array(
    await webcrypto.subtle.exportKey("spki", keyPair.publicKey),
  );
  const privateKeyJwk = (await webcrypto.subtle.exportKey(
    "jwk",
    keyPair.privateKey,
  )) as JsonWebKey;

  return {
    algorithm: CHAT_E2E_ALGORITHM,
    fingerprint: await fingerprintPublicKey(publicKeyBytes),
    publicKey: bytesToBase64(publicKeyBytes),
    privateKeyJwk,
    createdAt: "2026-04-13T09:00:00Z",
  };
}

async function installSecureChatApiMocks(
  page: Page,
  myKey: LocalMessageKeyRecord,
  peerKey: LocalMessageKeyRecord,
  options?: {
    meId?: string;
    meEmail?: string;
    meName?: string;
    meRole?: string;
    peerId?: string;
    peerName?: string;
    peerEmail?: string;
    peerRole?: string;
    peerHasKey?: boolean;
  },
) {
  const myId = options?.meId ?? "00000000-0000-0000-0000-000000000001";
  const peerId = options?.peerId ?? "00000000-0000-0000-0000-000000000777";
  const meRole = options?.meRole ?? "ceo";
  const meName = options?.meName ?? "Admin GMED";
  const meEmail = options?.meEmail ?? "admin@gmed.de";
  const peerName = options?.peerName ?? "Dr Secure Peer";
  const peerEmail = options?.peerEmail ?? "peer@gmed.de";
  const peerRole = options?.peerRole ?? "patient_manager";
  let peerHasKey = options?.peerHasKey !== false;
  let messages: Message[] = [
    {
      id: "00000000-0000-0000-0000-000000001001",
      from_user: peerId,
      to_user: myId,
      message: "Secure history bootstrap",
      is_e2e: false,
      e2e_algorithm: null,
      e2e_ciphertext: null,
      e2e_nonce: null,
      e2e_salt: null,
      sender_key_fingerprint: null,
      recipient_key_fingerprint: null,
      is_read: false,
      read_at: null,
      created_at: "2026-04-13T09:00:00Z",
      attachment_filename: null,
      attachment_mime: null,
      attachment_size: null,
      attachment_key: null,
      attachment_is_e2e: false,
      attachment_e2e_algorithm: null,
      attachment_e2e_nonce: null,
      attachment_e2e_salt: null,
    },
  ];
  const attachmentBytes = new Map<string, Buffer>();
  let loseUploadResponseAt = 0;

  const buildConversations = () => {
    const unreadIncoming = messages.filter(
      (message) => message.to_user === myId && !message.read_at,
    ).length;
    const lastIncomingReadAt = [...messages]
      .reverse()
      .find((message) => message.to_user === myId && message.read_at)?.read_at;

    return [
      {
        user_id: peerId,
        name: peerName,
        email: peerEmail,
        role: peerRole,
        last_message:
          messages.length > 0
            ? messages[messages.length - 1]?.message ?? "[Encrypted message]"
            : "",
        last_at:
          messages.length > 0
            ? messages[messages.length - 1]?.created_at ?? "2026-04-13T09:00:00Z"
            : "2026-04-13T09:00:00Z",
        is_read: unreadIncoming === 0,
        last_read_at: lastIncomingReadAt ?? "2026-04-13T09:00:00Z",
        is_mine: false,
        unread: unreadIncoming,
        is_e2e: true,
      },
    ];
  };

  await page.addInitScript(
    ({ keyRecord }) => {
      window.localStorage.setItem("gmed_lang", "de");
      window.localStorage.setItem(
        "gmed_chat_e2e_keyring_v1",
        JSON.stringify({
          activeFingerprint: keyRecord.fingerprint,
          keys: {
            [keyRecord.fingerprint]: keyRecord,
          },
        }),
      );
    },
    { keyRecord: myKey },
  );

  await page.route("**/auth/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;

    if (pathname === "/auth/login" && route.request().method() === "POST") {
      return json(route, {
        access_token: "playwright-access-token",
        refresh_token: "playwright-refresh-token",
        token_type: "Bearer",
        expires_in: 900,
      });
    }

    if (pathname === "/auth/logout") {
      return json(route, { ok: true });
    }

    return json(route, { message: "Not mocked" }, 404);
  });

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");

    if (path === "/auth/refresh") {
      return json(route, {
        access_token: "playwright-access-token", refresh_token: "playwright-refresh-token",
        token_type: "Bearer", expires_in: 900,
      });
    }

    if (path === "/me") {
      return json(route, {
        id: myId,
        email: meEmail,
        name: meName,
        role: meRole,
        created_at: "2026-01-01T00:00:00Z",
      });
    }

    if (path === "/notifications" || path === "/notifications/unread-count") {
      return json(route, path.endsWith("unread-count") ? { count: 0 } : []);
    }

    if (
      path === "/messages/e2e-key" &&
      route.request().method() === "POST"
    ) {
      return json(route, {
        id: "key-me",
        user_id: myId,
        fingerprint: myKey.fingerprint,
        algorithm: myKey.algorithm,
        public_key: myKey.publicKey,
        is_active: true,
        created_at: myKey.createdAt,
      });
    }

    if (
      path === "/messages/e2e-key" &&
      route.request().method() === "GET"
    ) {
      return json(route, {
        id: "key-me",
        user_id: myId,
        fingerprint: myKey.fingerprint,
        algorithm: myKey.algorithm,
        public_key: myKey.publicKey,
        is_active: true,
        created_at: myKey.createdAt,
      });
    }

    if (path === `/messages/e2e-key/${peerId}`) {
      if (!peerHasKey) {
        return json(route, { message: "Not found" }, 404);
      }
      return json(route, {
        id: "key-peer",
        user_id: peerId,
        fingerprint: peerKey.fingerprint,
        algorithm: peerKey.algorithm,
        public_key: peerKey.publicKey,
        is_active: true,
        created_at: peerKey.createdAt,
      });
    }

    if (path === "/messages/conversations") {
      return json(route, buildConversations());
    }

    if (path === "/messages/allowed-peers") {
      const search = url.searchParams.get("search")?.toLowerCase().trim();
      const candidates = [
        {
          id: peerId,
          name: peerName,
          email: peerEmail,
          role: peerRole,
          is_active: true,
        },
      ];
      const filtered = search
        ? candidates.filter(
            (item) =>
              item.name.toLowerCase().includes(search) ||
              item.email.toLowerCase().includes(search),
          )
        : candidates;
      return json(route, filtered);
    }

    if (path === `/messages/${peerId}` && route.request().method() === "GET") {
      const before = url.searchParams.get("before_created_at");
      const beforeId = url.searchParams.get("before_id") ?? "";
      return json(route, [...messages]
        .filter((message) => !before || message.created_at < before || (message.created_at === before && message.id < beforeId))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id))
        .slice(0, 100));
    }

    if (
      path === `/messages/${peerId}/read` &&
      route.request().method() === "POST"
    ) {
      messages = messages.map((message) =>
        message.to_user === myId
          ? { ...message, is_read: true, read_at: "2026-04-13T09:01:00Z" }
          : message,
      );
      return json(route, { ok: true });
    }

    if (path === `/messages/${peerId}` && route.request().method() === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        message?: string;
        e2e_algorithm?: string;
        e2e_ciphertext?: string;
        e2e_nonce?: string;
        e2e_salt?: string;
        sender_key_fingerprint?: string;
        recipient_key_fingerprint?: string;
        client_message_id?: string;
      };
      messages = [
        ...messages,
        {
          id: webcrypto.randomUUID(),
          client_message_id: payload.client_message_id,
          from_user: myId,
          to_user: peerId,
          message: payload.message ?? null,
          is_e2e: !payload.message,
          e2e_algorithm: payload.e2e_algorithm ?? null,
          e2e_ciphertext: payload.e2e_ciphertext ?? null,
          e2e_nonce: payload.e2e_nonce ?? null,
          e2e_salt: payload.e2e_salt ?? null,
          sender_key_fingerprint: payload.sender_key_fingerprint ?? null,
          recipient_key_fingerprint: payload.recipient_key_fingerprint ?? null,
          is_read: false,
          read_at: null,
          created_at: "2026-04-13T09:05:00Z",
          attachment_filename: null,
          attachment_mime: null,
          attachment_size: null,
          attachment_key: null,
          attachment_is_e2e: false,
          attachment_e2e_algorithm: null,
          attachment_e2e_nonce: null,
          attachment_e2e_salt: null,
        },
      ];
      const sent = messages[messages.length - 1]!;
      return json(route, {
        ok: true,
        id: sent.id,
        created_at: sent.created_at,
        client_message_id: payload.client_message_id ?? null,
        duplicate: false,
      });
    }

    if (
      path.startsWith(`/messages/${peerId}/`) &&
      route.request().method() === "DELETE"
    ) {
      const messageId = path.slice(`/messages/${peerId}/`.length);
      messages = messages.filter((message) => message.id !== messageId);
      return json(route, { ok: true, id: messageId });
    }

    if (
      path === `/messages/${peerId}/upload` &&
      route.request().method() === "POST"
    ) {
      const multipart = parseMultipart(route);
      const existing = messages.find((message) => message.client_message_id === multipart.fields.client_message_id);
      if (existing) return json(route, { ok: true, id: existing.id, created_at: existing.created_at,
        client_message_id: existing.client_message_id, duplicate: true, attachment_key: existing.attachment_key });
      const attachmentKey = `secure-attachment-key-${attachmentBytes.size + 1}`;
      attachmentBytes.set(attachmentKey, multipart.fileBytes);
      messages = [
        ...messages,
        {
          id: webcrypto.randomUUID(),
          client_message_id: multipart.fields.client_message_id,
          from_user: myId,
          to_user: peerId,
          message: null,
          is_e2e: Boolean(multipart.fields.e2e_ciphertext),
          e2e_algorithm: multipart.fields.e2e_algorithm ?? null,
          e2e_ciphertext: multipart.fields.e2e_ciphertext ?? null,
          e2e_nonce: multipart.fields.e2e_nonce ?? null,
          e2e_salt: multipart.fields.e2e_salt ?? null,
          sender_key_fingerprint:
            multipart.fields.sender_key_fingerprint ?? null,
          recipient_key_fingerprint:
            multipart.fields.recipient_key_fingerprint ?? null,
          is_read: false,
          read_at: null,
          created_at: "2026-04-13T09:06:00Z",
          attachment_filename: multipart.fileName,
          attachment_mime: multipart.fileMime ?? "application/octet-stream",
          attachment_size: Number(
            multipart.fields.attachment_plaintext_size ?? multipart.fileBytes.length,
          ),
          attachment_key: attachmentKey,
          attachment_is_e2e: Boolean(
            multipart.fields.attachment_e2e_algorithm,
          ),
          attachment_e2e_algorithm:
            multipart.fields.attachment_e2e_algorithm ?? null,
          attachment_e2e_nonce:
            multipart.fields.attachment_e2e_nonce ?? null,
          attachment_e2e_salt:
            multipart.fields.attachment_e2e_salt ?? null,
        },
      ];
      const sent = messages[messages.length - 1]!;
      if (loseUploadResponseAt > 0 && attachmentBytes.size === loseUploadResponseAt) {
        loseUploadResponseAt = 0;
        return json(route, { message: "Upload accepted, response lost" }, 503);
      }
      return json(route, {
        ok: true,
        id: sent.id,
        created_at: sent.created_at,
        client_message_id: multipart.fields.client_message_id ?? null,
        duplicate: false,
        attachment_key: attachmentKey,
      });
    }

    if (path.startsWith("/messages/file/")) {
      const bytes = attachmentBytes.get(path.slice("/messages/file/".length));
      if (!bytes) return json(route, { message: "File not found" }, 404);
      return route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: bytes,
      });
    }

    return json(route, []);
  });
  return {
    myId, peerId,
    getMessages: () => messages,
    setMessages: (next: Message[]) => { messages = next; },
    setPeerReady: (ready: boolean) => { peerHasKey = ready; },
    loseUploadResponse: (fileNumber: number) => { loseUploadResponseAt = fileNumber; },
  };
}

test.describe("chat secure flows", () => {
  async function openCeoChat(page: Page) {
    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/);
    await page.goto("/chat");
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();
  }

  test("a newly signed-in CEO registers a device key before visiting chat", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    let registered: Record<string, unknown> | null = null;
    await page.route("**/api/v1/messages/e2e-key", async (route) => {
      if (route.request().method() === "GET") {
        return registered ? json(route, registered) : json(route, { message: "Not found" }, 404);
      }
      const body = JSON.parse(route.request().postData() ?? "{}");
      registered = {
        id: "registered", user_id: api.myId, public_key: body.public_key, algorithm: body.algorithm,
        fingerprint: await fingerprintPublicKey(Buffer.from(body.public_key, "base64")),
        is_active: true, created_at: new Date().toISOString(),
      };
      return json(route, registered);
    });
    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/);
    await expect.poll(() => registered).not.toBeNull();
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("CEO can send after the recipient activates chat without reopening the conversation", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey, { peerHasKey: false });
    await openCeoChat(page);
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("CEO delivery after activation");
    await expect(page.locator("form button[type='submit']")).toBeDisabled();
    api.setPeerReady(true);
    await expect(page.locator("form button[type='submit']")).toBeEnabled({ timeout: 15_000 });
    await page.locator("form button[type='submit']").click();
    await expect(page.getByText("Gesendet", { exact: true })).toBeVisible();
    expect(api.getMessages().filter((message) => message.from_user === api.myId)).toHaveLength(1);
    expect(api.getMessages().at(-1)?.e2e_ciphertext).toBeTruthy();
    expect(api.getMessages().at(-1)?.message).toBeNull();
  });

  test("CEO and care manager exchange and decrypt messages in separate browser sessions", async ({ page, browser }) => {
    const [ceoKey, managerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const ceo = await installSecureChatApiMocks(page, ceoKey, managerKey);
    const recipientContext = await browser.newContext({ baseURL: "http://127.0.0.1:5174" });
    try {
      const recipientPage = await recipientContext.newPage();
      const manager = await installSecureChatApiMocks(recipientPage, managerKey, ceoKey, {
        meId: ceo.peerId, peerId: ceo.myId, meRole: "patient_manager", peerRole: "ceo",
      });
      await page.routeWebSocket("**/messages/ws", (socket) => socket.close());
      await recipientPage.routeWebSocket("**/messages/ws", (socket) => socket.close());
      await openCeoChat(page);
      await openCeoChat(recipientPage);
      await page.getByPlaceholder(/Nachricht eingeben/i).fill("Encrypted message from the CEO");
      await page.locator("form button[type='submit']").click();
      await expect(page.getByText("Gesendet", { exact: true })).toBeVisible();
      manager.setMessages(ceo.getMessages());
      await expect(recipientPage.getByText("Encrypted message from the CEO", { exact: true })).toBeVisible({ timeout: 12_000 });
      await recipientPage.getByPlaceholder(/Nachricht eingeben/i).fill("Care manager received and replied");
      await recipientPage.locator("form button[type='submit']").click();
      await expect(recipientPage.getByText("Gesendet", { exact: true })).toBeVisible();
      ceo.setMessages(manager.getMessages());
      await expect(page.getByText("Care manager received and replied", { exact: true })).toBeVisible({ timeout: 12_000 });
      await expect(page.getByText(/Gesehen/).first()).toBeVisible();
    } finally {
      await recipientContext.close();
    }
  });

  test("mobile chat keeps the composer visible and safely renders a long message", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    await installSecureChatApiMocks(page, myKey, peerKey);
    await page.setViewportSize({ width: 390, height: 844 });
    await openCeoChat(page);
    const composer = page.getByPlaceholder(/Nachricht eingeben/i);
    await composer.fill("Clinical follow-up " + "x".repeat(300));
    await page.locator("form button[type='submit']").click();
    await expect(page.getByText("Gesendet", { exact: true })).toBeVisible();
    await expect(composer).toBeInViewport();
    expect(await page.getByTestId("chat-workspace").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: "../artifacts/design-qa/chat-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "../artifacts/design-qa/chat-desktop.png", fullPage: true });
  });

  test("HTTP fallback receives messages and deletions when websocket is unavailable", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    await page.routeWebSocket("**/messages/ws", (socket) => socket.close());
    await openCeoChat(page);
    await expect(page.getByText("Secure history bootstrap")).toBeVisible();
    api.setMessages([...api.getMessages(), {
      ...api.getMessages()[0], id: webcrypto.randomUUID(), message: "Arrived without a websocket",
      is_read: false, read_at: null, created_at: new Date().toISOString(),
    }]);
    await expect(page.getByText("Arrived without a websocket")).toBeVisible({ timeout: 12_000 });
    api.setMessages([]);
    await expect(page.getByText("Arrived without a websocket")).toHaveCount(0, { timeout: 12_000 });
    await expect(page.getByText("Secure history bootstrap")).toHaveCount(0);
  });

  test("failed CEO sends survive refresh and retry exactly once with the original idempotency key", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    const attempts: string[] = [];
    let fail = true;
    await page.route(`**/api/v1/messages/${api.peerId}`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      attempts.push(JSON.parse(route.request().postData() ?? "{}").client_message_id);
      if (fail) return json(route, { message: "Temporarily unavailable" }, 503);
      return route.fallback();
    });
    await openCeoChat(page);
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("Keep this failed message");
    await page.locator("form button[type='submit']").click();
    await expect(page.getByText("Nicht gesendet", { exact: true })).toBeVisible();
    const refreshed = page.waitForResponse((response) => response.url().includes(`/messages/${api.peerId}?`) && response.request().method() === "GET");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await refreshed;
    await expect(page.getByText("Keep this failed message")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
    await expect(page.getByText("Gesendet", { exact: true })).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts).size).toBe(1);
    await expect(page.getByText("Keep this failed message")).toHaveCount(1);
  });

  test("an accepted attachment clears the composer even if the subsequent history refresh fails", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    await openCeoChat(page);
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "confirmed-document.txt", mimeType: "text/plain", buffer: Buffer.from("Secure test attachment"),
    });
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("Confirmed attachment caption");
    await page.route(`**/api/v1/messages/${api.peerId}?*`, (route) => json(route, { message: "History temporarily unavailable" }, 503));
    await page.locator("form button[type='submit']").click();
    await expect(page.getByPlaceholder(/Nachricht eingeben/i)).toHaveValue("");
    await expect(page.getByRole("button", { name: "Herunterladen: confirmed-document.txt", exact: true })).toBeVisible();
    await expect(page.getByText("Confirmed attachment caption")).toBeVisible();
    await expect(page.getByTestId("chat-attachment-queue")).toHaveCount(0);
    await expect(page.locator("form button[type='submit']")).toBeDisabled();
    expect(api.getMessages().filter((message) => message.attachment_key)).toHaveLength(1);
  });

  test("drafts stay with their recipient when the CEO switches conversations", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    const secondId = "00000000-0000-0000-0000-000000000888";
    await page.route("**/api/v1/messages/conversations", (route) => json(route, [api.peerId, secondId].map((id, index) => ({
      user_id: id, name: index ? "Second colleague" : "Dr Secure Peer", email: `peer${index}@gmed.de`,
      role: "patient_manager", last_message: "", last_at: new Date().toISOString(), is_read: true, is_mine: false, unread: 0,
    }))));
    await openCeoChat(page);
    const composer = page.getByPlaceholder(/Nachricht eingeben/i);
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: "private-draft.txt", mimeType: "text/plain", buffer: Buffer.from("Private draft") });
    await composer.fill("Private draft for the first colleague");
    await page.getByRole("button", { name: /Second colleague/i }).click();
    await expect(composer).toHaveValue("");
    await expect(page.getByTestId("chat-attachment-queue")).toHaveCount(0);
    await composer.fill("Separate second draft");
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();
    await expect(composer).toHaveValue("Private draft for the first colleague");
    await expect(page.getByTestId("chat-attachment-queue").getByText("private-draft.txt")).toBeVisible();
  });

  test("a multi-file queue retries lost acknowledgements with the same encrypted payload and no duplicates", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    api.loseUploadResponse(2);
    const attempts: ReturnType<typeof parseMultipart>[] = [];
    await page.route(`**/api/v1/messages/${api.peerId}/upload`, async (route) => {
      attempts.push(parseMultipart(route));
      await route.fallback();
    });
    await openCeoChat(page);
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles([1, 2, 3].map((number) => ({
      name: `queued-${number}.txt`, mimeType: "text/plain", buffer: Buffer.from(`Original file ${number}`),
    })));
    const queue = page.getByTestId("chat-attachment-queue");
    await expect(queue.getByRole("listitem")).toHaveCount(3);
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("Caption sent once");
    await page.locator("form button[type='submit']").click();
    await expect(queue.getByRole("listitem")).toHaveCount(2);
    await expect(page.locator("form button[type='submit']")).toBeEnabled();
    await expect(page.getByPlaceholder(/Nachricht eingeben/i)).toHaveValue("");
    expect(api.getMessages().filter((message) => message.attachment_key)).toHaveLength(2);
    await page.locator("form button[type='submit']").click();
    await expect(queue).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Herunterladen: queued-/ })).toHaveCount(3);
    await expect(page.getByText("Caption sent once")).toHaveCount(1);
    expect(api.getMessages().filter((message) => message.attachment_key)).toHaveLength(3);
    expect(attempts.map((attempt) => attempt.fileName)).toEqual(["queued-1.txt", "queued-2.txt", "queued-2.txt", "queued-3.txt"]);
    expect(attempts[1].fields).toEqual(attempts[2].fields);
    expect(attempts[1].fileBytes).toEqual(attempts[2].fileBytes);
    expect(attempts[0].fileBytes).not.toEqual(Buffer.from("Original file 1"));
    expect(attempts.filter((attempt) => attempt.fields.e2e_ciphertext)).toHaveLength(1);
    for (const number of [1, 2, 3]) {
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: `Herunterladen: queued-${number}.txt`, exact: true }).click();
      expect(await readFile((await (await downloaded).path())!)).toEqual(Buffer.from(`Original file ${number}`));
    }
  });

  test("invalid files preserve the queue and files can be dropped, pasted, removed, and reselected", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    await installSecureChatApiMocks(page, myKey, peerKey);
    await openCeoChat(page);
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({ name: "keep.txt", mimeType: "text/plain", buffer: Buffer.from("keep") });
    await input.setInputFiles({ name: "blocked.exe", mimeType: "application/octet-stream", buffer: Buffer.from("blocked") });
    const queue = page.getByTestId("chat-attachment-queue");
    await expect(queue.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText(/blocked\.exe:/)).toBeVisible();
    await page.getByTestId("chat-message-panel").evaluate((panel) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(["dropped text"], "dropped.txt", { type: "text/plain" }));
      panel.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    });
    await page.getByPlaceholder(/Nachricht eingeben/i).evaluate((composer) => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File(["pasted text"], "pasted.txt", { type: "text/plain" }));
      composer.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(queue.getByRole("listitem")).toHaveCount(3);
    await queue.getByRole("button", { name: /Entfernen: keep\.txt/ }).click();
    await expect(queue.getByRole("listitem")).toHaveCount(2);
    await input.setInputFiles({ name: "keep.txt", mimeType: "text/plain", buffer: Buffer.from("keep") });
    await expect(queue.getByRole("listitem")).toHaveCount(3);
    await input.setInputFiles(Array.from({ length: 10 }, (_, index) => ({ name: `limit-${index}.txt`, mimeType: "text/plain", buffer: Buffer.from("limit") })));
    await expect(queue.getByRole("listitem")).toHaveCount(10);
    await expect(queue.getByText("keep.txt")).toBeVisible();
  });

  test("attachment previews decrypt locally, render text literally, and recover after download failure", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    await installSecureChatApiMocks(page, myKey, peerKey);
    await openCeoChat(page);
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    const content = '<script>window.attachmentExecuted = true</script>\nClinical note: 123';
    await page.locator('input[type="file"]').setInputFiles({ name: "safe-preview.txt", mimeType: "text/html", buffer: Buffer.from(content) });
    await page.getByRole("button", { name: "Vorschau: safe-preview.txt", exact: true }).click();
    await expect(page.getByRole("dialog").locator("pre")).toHaveText(content);
    await page.keyboard.press("Escape");
    await page.locator("form button[type='submit']").click();
    await expect(page.getByTestId("chat-attachment-queue")).toHaveCount(0);
    let failDownload = true;
    await page.route("**/api/v1/messages/file/*", (route) => failDownload ? json(route, { message: "Unavailable" }, 503) : route.fallback());
    await page.getByRole("button", { name: "Vorschau: safe-preview.txt", exact: true }).click();
    await expect(page.locator('[data-testid^="chat-attachment-"]').getByRole("alert")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    failDownload = false;
    await page.getByRole("button", { name: "Vorschau: safe-preview.txt", exact: true }).click();
    await expect(page.getByRole("dialog").locator("pre")).toHaveText(content);
    expect(await page.evaluate(() => (window as Window & { attachmentExecuted?: boolean }).attachmentExecuted)).toBeUndefined();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("image previews and the attachment composer fit desktop and mobile", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    await installSecureChatApiMocks(page, myKey, peerKey);
    await openCeoChat(page);
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "scan.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"),
    });
    await expect(page.getByTestId("chat-attachment-queue").locator("img")).toBeVisible();
    await page.locator("form button[type='submit']").click();
    await expect(page.getByTestId("chat-attachment-queue")).toHaveCount(0);
    await page.getByRole("button", { name: "Vorschau: scan.png", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("img", { name: "scan.png" })).toBeVisible();
    expect(await page.getByRole("dialog").locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
    await page.keyboard.press("Escape");
    await page.locator('input[type="file"]').setInputFiles(["Clinical-report-for-care-team.txt", "Laboratory-values.csv", "Medical-record.pdf"].map((name) => ({ name, mimeType: "application/octet-stream", buffer: Buffer.from("Report content") })));
    await expect(page.locator("form button[type='submit']")).toBeEnabled();
    await page.screenshot({ path: "../artifacts/design-qa/chat-attachments-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 393, height: 852 });
    const composer = page.getByPlaceholder(/Nachricht eingeben/i);
    await expect(composer).toBeVisible();
    const box = await composer.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(852);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
    await page.screenshot({ path: "../artifacts/design-qa/chat-attachments-mobile.png", fullPage: true });
  });

  test("PDF attachments use a PDF preview and corrupt PDF files keep a download fallback", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    await installSecureChatApiMocks(page, myKey, peerKey);
    await openCeoChat(page);
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
      "<< /Length 0 >>\nstream\n\nendstream",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    await page.locator('input[type="file"]').setInputFiles([
      { name: "valid.pdf", mimeType: "application/octet-stream", buffer: Buffer.from(pdf) },
      { name: "corrupt.pdf", mimeType: "text/html", buffer: Buffer.from("<h1>This is not a PDF</h1>") },
    ]);
    await page.locator("form button[type='submit']").click();
    await expect(page.getByTestId("chat-attachment-queue")).toHaveCount(0);
    await page.getByRole("button", { name: "Vorschau: valid.pdf", exact: true }).click();
    const frame = page.getByRole("dialog").locator("iframe");
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("src", /^blob:/);
    const content = await frame.evaluate(async (element: HTMLIFrameElement) => {
      const response = await fetch(element.src);
      return { type: response.headers.get("content-type"), text: await response.text() };
    });
    expect(content.type).toBe("application/pdf");
    expect(content.text).toBe(pdf);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Vorschau: corrupt.pdf", exact: true }).click();
    await expect(page.getByRole("dialog").getByText(/Keine Vorschau verfügbar/)).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Herunterladen", exact: true })).toBeEnabled();
  });

  test("finishing an upload after switching peers preserves the new conversation draft", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    const secondId = "00000000-0000-0000-0000-000000000888";
    await page.route("**/api/v1/messages/conversations", (route) => json(route, [api.peerId, secondId].map((id, index) => ({
      user_id: id, name: index ? "Second colleague" : "Dr Secure Peer", email: `peer${index}@gmed.de`,
      role: "patient_manager", last_message: "", last_at: new Date().toISOString(), is_read: true, is_mine: false, unread: 0,
    }))));
    let releaseUpload!: () => void;
    const gate = new Promise<void>((resolve) => { releaseUpload = resolve; });
    let uploading = false;
    await page.route(`**/api/v1/messages/${api.peerId}/upload`, async (route) => { uploading = true; await gate; await route.fallback(); });
    await openCeoChat(page);
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: "first-peer.txt", mimeType: "text/plain", buffer: Buffer.from("First peer's file") });
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("First peer's caption");
    await page.locator("form button[type='submit']").click();
    await expect.poll(() => uploading).toBe(true);
    await page.getByRole("button", { name: /Second colleague/i }).click();
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("Second peer's new draft");
    releaseUpload();
    await expect.poll(() => api.getMessages().filter((message) => message.attachment_key).length).toBe(1);
    await expect(page.getByPlaceholder(/Nachricht eingeben/i)).toHaveValue("Second peer's new draft");
    await expect(page.getByText("first-peer.txt", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();
    await expect(page.getByRole("button", { name: "Herunterladen: first-peer.txt", exact: true })).toBeVisible();
    await expect(page.getByPlaceholder(/Nachricht eingeben/i)).toHaveValue("");
    await expect(page.getByTestId("chat-attachment-queue")).toHaveCount(0);
    await page.getByRole("button", { name: /Second colleague/i }).click();
    await expect(page.getByPlaceholder(/Nachricht eingeben/i)).toHaveValue("Second peer's new draft");
  });

  test("a definitive key rejection re-encrypts the retry and supports Unicode filenames", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    const attempts: ReturnType<typeof parseMultipart>[] = [];
    await page.route(`**/api/v1/messages/${api.peerId}/upload`, async (route) => {
      attempts.push(parseMultipart(route));
      if (attempts.length === 1) return json(route, { error: "Recipient message key is not active" }, 422);
      await route.fallback();
    });
    await openCeoChat(page);
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: "Результати аналізів.txt", mimeType: "text/plain", buffer: Buffer.from("Гемоглобін: 123") });
    await page.locator("form button[type='submit']").click();
    await expect(page.locator("form button[type='submit']")).toBeEnabled();
    await expect(page.getByTestId("chat-attachment-queue").getByRole("listitem")).toHaveCount(1);
    await page.locator("form button[type='submit']").click();
    await expect(page.getByTestId("chat-attachment-queue")).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].fields.client_message_id).toBe(attempts[1].fields.client_message_id);
    expect(attempts[0].fileBytes).not.toEqual(attempts[1].fileBytes);
    expect(attempts[0].fields.attachment_e2e_nonce).not.toBe(attempts[1].fields.attachment_e2e_nonce);
    await page.getByRole("button", { name: "Vorschau: Результати аналізів.txt", exact: true }).click();
    await expect(page.getByRole("dialog").locator("pre")).toHaveText("Гемоглобін: 123");
  });

  test("loading older history preserves scroll position and failed key lookup does not hide other messages", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    const base = api.getMessages()[0];
    api.setMessages(Array.from({ length: 120 }, (_, index) => ({
      ...base, id: String(index).padStart(36, "0"), message: `History item ${index}`,
      created_at: new Date(Date.UTC(2026, 8, 1, 12, index)).toISOString(),
    })));
    api.setMessages([...api.getMessages(), {
      ...base, id: webcrypto.randomUUID(), is_e2e: true, e2e_ciphertext: "unavailable", message: null,
      recipient_key_fingerprint: myKey.fingerprint, sender_key_fingerprint: peerKey.fingerprint,
      created_at: new Date(Date.UTC(2026, 8, 1, 12, 120)).toISOString(),
    }]);
    await page.route(`**/api/v1/messages/e2e-key/${api.peerId}?fingerprint=*`, (route) => json(route, { message: "Unavailable key" }, 503));
    await openCeoChat(page);
    await expect(page.getByText("History item 119", { exact: true })).toBeVisible();
    expect(api.getMessages().some((message) => message.is_read)).toBe(false);
    const log = page.getByRole("log");
    await log.evaluate((element) => { element.scrollTop = 0; });
    await page.getByRole("button", { name: "Ältere Nachrichten laden" }).click();
    await expect(page.getByText("History item 0", { exact: true })).toBeAttached();
    expect(await log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeGreaterThan(1_000);
    await expect(page.getByRole("button", { name: "Zu den neuesten Nachrichten" })).toBeVisible();
  });

  test("background refresh keeps the reading position near the latest messages", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    const base = api.getMessages()[0];
    api.setMessages(Array.from({ length: 50 }, (_, index) => ({ ...base, id: `reading-${index}`,
      message: `Reading position ${index}`, is_read: true, read_at: base.created_at,
      created_at: new Date(Date.UTC(2026, 8, 1, 12, index)).toISOString(),
    })));
    await openCeoChat(page);
    await expect(page.getByText("Reading position 49", { exact: true })).toBeVisible();
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    const log = page.getByRole("log");
    await log.evaluate((element) => { element.scrollTop = element.scrollHeight - element.clientHeight - 40; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
    const before = await log.evaluate((element) => element.scrollTop);
    let refreshed = 0;
    await page.route(`**/api/v1/messages/${api.peerId}?*`, async (route) => { await route.fallback(); refreshed += 1; });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => refreshed).toBeGreaterThan(0);
    await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBeCloseTo(before, 0);
    // A new incoming message must not pull someone out of the history either.
    api.setMessages([...api.getMessages(), { ...base, id: "new-while-reading", message: "New while reading", created_at: "2026-09-01T14:00:00Z" }]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("New while reading", { exact: true })).toBeAttached();
    await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBeCloseTo(before, 0);
    await expect(page.getByRole("button", { name: "Zu den neuesten Nachrichten" })).toBeVisible();
    const viewport = await log.boundingBox();
    await page.getByRole("button", { name: "Zu den neuesten Nachrichten" }).click();
    expect(await log.boundingBox()).toEqual(viewport);
    // Readers already at the bottom still follow incoming messages.
    api.setMessages([...api.getMessages(), { ...base, id: "follow-at-bottom", message: "Follow at bottom", created_at: "2026-09-01T14:01:00Z" }]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("Follow at bottom", { exact: true })).toBeVisible();
    await expect.poll(() => log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(2);
  });

  test("background refresh does not replace empty search results with a loading screen", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    await openCeoChat(page);
    await expect(page.getByText("Secure history bootstrap")).toBeVisible();
    await page.getByPlaceholder("Nachrichten durchsuchen").fill("no matches here");
    await expect(page.getByText("Keine Treffer im geladenen Verlauf.")).toBeVisible();
    let releaseRefresh!: () => void;
    const gate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let requested = false;
    await page.route(`**/api/v1/messages/${api.peerId}?*`, async (route) => { requested = true; await gate; await route.fallback(); });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => requested).toBe(true);
    try { await expect(page.getByText("Keine Treffer im geladenen Verlauf.")).toBeVisible(); }
    finally { releaseRefresh(); }
  });

  test("connection status changes do not move the message viewport or composer", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    await installSecureChatApiMocks(page, myKey, peerKey);
    await page.addInitScript(() => {
      class StableTestSocket extends EventTarget {
        onopen: ((event: Event) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        constructor() { super(); window.setTimeout(() => this.onopen?.(new Event("open")), 10); }
        send() { /* HTTP handles test messages. */ }
        close() { this.onclose?.(new CloseEvent("close")); }
      }
      Object.defineProperty(window, "WebSocket", { value: StableTestSocket });
    });
    await openCeoChat(page);
    await expect(page.getByText("Verbunden", { exact: true })).toBeVisible();
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    const before = await page.getByRole("log").boundingBox();
    const composer = await page.getByPlaceholder(/Nachricht eingeben/i).boundingBox();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
      window.dispatchEvent(new Event("offline"));
    });
    await expect(page.getByText("Offline", { exact: true }).first()).toBeVisible();
    expect(await page.getByRole("log").boundingBox()).toEqual(before);
    expect(await page.getByPlaceholder(/Nachricht eingeben/i).boundingBox()).toEqual(composer);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
      window.dispatchEvent(new Event("online"));
    });
    await expect(page.getByText("Verbunden", { exact: true })).toBeVisible();
    expect(await page.getByRole("log").boundingBox()).toEqual(before);
  });

  test("failed history refresh keeps the viewport fixed while retrying", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    await openCeoChat(page);
    await expect(page.getByText("Secure history bootstrap")).toBeVisible();
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    const before = await page.getByRole("log").boundingBox();
    const messageBefore = await page.getByText("Secure history bootstrap").boundingBox();
    await page.route(`**/api/v1/messages/${api.peerId}?*`, (route) => json(route, { message: "Unavailable" }, 503));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await page.getByRole("log").boundingBox()).toEqual(before);
    expect(await page.getByText("Secure history bootstrap").boundingBox()).toEqual(messageBefore);
    let releaseRefresh!: () => void;
    const gate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let requested = false;
    await page.route(`**/api/v1/messages/${api.peerId}?*`, async (route) => { requested = true; await gate; await json(route, api.getMessages()); });
    await page.getByRole("alert").getByRole("button").click();
    await expect.poll(() => requested).toBe(true);
    try {
      await expect(page.getByRole("alert")).toBeVisible();
      expect(await page.getByText("Secure history bootstrap").boundingBox()).toEqual(messageBefore);
    } finally { releaseRefresh(); }
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await page.getByText("Secure history bootstrap").boundingBox()).toEqual(messageBefore);
  });

  test("temporary key lookup failures keep the verified layout and changed keys show one warning", async ({ page }) => {
    const [myKey, peerKey, newKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    await openCeoChat(page);
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    const before = await page.getByRole("log").boundingBox();
    let requested = 0;
    await page.route(`**/api/v1/messages/e2e-key/${api.peerId}`, async (route) => { requested += 1; await json(route, { message: "Unavailable" }, 503); });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => requested).toBeGreaterThan(0);
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt/i)).toBeVisible();
    expect(await page.getByRole("log").boundingBox()).toEqual(before);
    // An actual changed identity must still stop sends until explicitly verified.
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("Only send after verifying the recipient");
    await expect(page.locator("form button[type='submit']")).toBeEnabled();
    await page.route(`**/api/v1/messages/e2e-key/${api.peerId}`, (route) => json(route, {
      id: "changed-peer-key", user_id: api.peerId, fingerprint: newKey.fingerprint,
      algorithm: newKey.algorithm, public_key: newKey.publicKey, is_active: true, created_at: newKey.createdAt,
    }));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText(/Schlüssel der Gegenseite hat sich geändert/)).toHaveCount(1);
    await expect(page.locator("form button[type='submit']")).toBeDisabled();
    const changedBox = await page.getByRole("log").boundingBox();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect(await page.getByRole("log").boundingBox()).toEqual(changedBox);
    await expect(page.getByText(/Schlüssel der Gegenseite hat sich geändert/)).toHaveCount(1);
  });

  test("staff cannot downgrade to plaintext before the peer creates an E2E key", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([
      generateLocalMessageKey(),
      generateLocalMessageKey(),
    ]);

    await installSecureChatApiMocks(page, myKey, peerKey, { peerHasKey: false });

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto("/chat");
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();
    await expect(page.getByText(/Identität der Gegenseite nicht bestätigt|Личность собеседника не подтверждена/i)).toBeVisible();
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("First protected hello");
    await expect(page.locator("form button[type='submit']")).toBeDisabled();
  });

  test("staff can send a secure text message in browser E2E", async ({
    page,
  }) => {
    const [myKey, peerKey] = await Promise.all([
      generateLocalMessageKey(),
      generateLocalMessageKey(),
    ]);

    await installSecureChatApiMocks(page, myKey, peerKey);
    let activePeerKeyRequests = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "GET" &&
        url.pathname.endsWith(
          "/api/v1/messages/e2e-key/00000000-0000-0000-0000-000000000777",
        ) &&
        !url.search
      ) {
        activePeerKeyRequests += 1;
      }
    });

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto("/chat");
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();

    await expect(page.getByText(/Ende-zu-Ende|End-to-end/i)).toBeVisible();

    await page.getByPlaceholder(/Nachricht eingeben/i).fill("Secure browser hello");
    await page.locator("form button[type='submit']").click();

    await expect(page.getByText("Secure browser hello")).toBeVisible();
    expect(activePeerKeyRequests).toBeGreaterThanOrEqual(2);

    const deleteRequest = page.waitForRequest((request) =>
      request.method() === "DELETE" &&
      request.url().includes("/api/v1/messages/00000000-0000-0000-0000-000000000777/"),
    );
    await page.getByRole("button", { name: /Nachricht löschen|Удалить сообщение/i }).click();
    await page.getByRole("button", { name: /Löschen|Удалить/i }).last().click();
    await deleteRequest;
    await expect(page.getByText("Secure browser hello")).toHaveCount(0);
  });

  test("chat reconnects after a websocket disconnect", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([
      generateLocalMessageKey(),
      generateLocalMessageKey(),
    ]);

    await installSecureChatApiMocks(page, myKey, peerKey);
    await page.addInitScript(() => {
      let connectionCount = 0;
      class TestWebSocket extends EventTarget {
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;

        constructor(url: string | URL) {
          super();
          void url;
          connectionCount += 1;
          const currentConnection = connectionCount;
          window.setTimeout(() => {
            const event = new Event("open");
            this.dispatchEvent(event);
            this.onopen?.(event);
            if (currentConnection === 1) {
              window.setTimeout(() => this.close(), 100);
            }
          }, 10);
        }

        send(data: string) {
          void data;
        }

        close() {
          const event = new CloseEvent("close");
          this.dispatchEvent(event);
          this.onclose?.(event);
        }
      }

      Object.defineProperty(window, "WebSocket", { value: TestWebSocket });
      Object.defineProperty(window, "__chatSocketConnectionCount", {
        get: () => connectionCount,
      });
    });

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });
    await page.goto("/chat");
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as Window & { __chatSocketConnectionCount?: number })
            .__chatSocketConnectionCount ?? 0,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    await expect(page.getByText(/Verbunden|В сети/i)).toBeVisible({ timeout: 5_000 });
  });

  test("staff can send a secure attachment in browser E2E", async ({
    page,
  }) => {
    const peerId = "00000000-0000-0000-0000-000000000777";
    const attachmentKey = "secure-attachment-key-1";
    const [myKey, peerKey] = await Promise.all([
      generateLocalMessageKey(),
      generateLocalMessageKey(),
    ]);

    await installSecureChatApiMocks(page, myKey, peerKey);

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto("/chat");
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();

    await expect(page.getByText(/Ende-zu-Ende|End-to-end/i)).toBeVisible();

    await page.locator("form input[type='file']").setInputFiles({
      name: "secure-result.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("secure-attachment-browser"),
    });
    await page
      .getByPlaceholder(/Nachricht eingeben/i)
      .fill("Secure attachment browser hello");

    const uploadRequest = page.waitForRequest((request) =>
      request.method() === "POST" &&
      request.url().includes(`/api/v1/messages/${peerId}/upload`),
    );
    await page.locator("form button[type='submit']").click();
    await uploadRequest;

    await expect(page.getByRole("button", { name: "Herunterladen: secure-result.pdf", exact: true })).toBeVisible();
    await expect(page.getByText("Secure attachment browser hello")).toBeVisible();

    const downloadRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes(`/api/v1/messages/file/${attachmentKey}`),
    );
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Herunterladen: secure-result.pdf", exact: true }).click();
    await downloadRequest;
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("secure-result.pdf");
    expect(await readFile((await download.path())!)).toEqual(Buffer.from("secure-attachment-browser"));
  });

  test("patient can use secure chat with assigned care team in browser E2E", async ({
    page,
  }) => {
    const peerId = "00000000-0000-0000-0000-000000000778";
    const attachmentKey = "secure-attachment-key-1";
    const [myKey, peerKey] = await Promise.all([
      generateLocalMessageKey(),
      generateLocalMessageKey(),
    ]);

    await installSecureChatApiMocks(page, myKey, peerKey, {
      meId: "00000000-0000-0000-0000-000000000009",
      meEmail: "patient@gmed.de",
      meName: "Anna Portal",
      meRole: "patient",
      peerId,
      peerName: "Assigned Care Manager",
      peerEmail: "pm@gmed.de",
      peerRole: "patient_manager",
    });

    await page.goto("/login");
    await page.locator("#email").fill("patient@gmed.de");
    await page.locator("#password").fill("patient123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto("/chat");
    await page.getByRole("button", { name: /Assigned Care Manager/i }).click();

    await expect(page.getByText(/Ende-zu-Ende|End-to-end/i)).toBeVisible();

    await page
      .getByPlaceholder(/Nachricht eingeben/i)
      .fill("Patient secure update for the care team");
    await page.locator("form button[type='submit']").click();
    await expect(
      page.getByText("Patient secure update for the care team"),
    ).toBeVisible();

    await page.locator("form input[type='file']").setInputFiles({
      name: "patient-secure-note.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("patient-secure-attachment-browser"),
    });
    await page
      .getByPlaceholder(/Nachricht eingeben/i)
      .fill("Please see the attached secure note.");

    const uploadRequest = page.waitForRequest((request) =>
      request.method() === "POST" &&
      request.url().includes(`/api/v1/messages/${peerId}/upload`),
    );
    await page.locator("form button[type='submit']").click();
    await uploadRequest;

    await expect(page.getByRole("button", { name: "Herunterladen: patient-secure-note.pdf", exact: true })).toBeVisible();
    await expect(
      page.getByText("Please see the attached secure note."),
    ).toBeVisible();

    const downloadRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes(`/api/v1/messages/file/${attachmentKey}`),
    );
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Herunterladen: patient-secure-note.pdf", exact: true }).click();
    await downloadRequest;
    const download = await downloadEvent;
    expect(await readFile((await download.path())!)).toEqual(Buffer.from("patient-secure-attachment-browser"));
  });

  test("patient portal chat clears unread state and only exposes allowed peers", async ({
    page,
  }) => {
    const peerId = "00000000-0000-0000-0000-000000000779";
    const hiddenPeerName = "Unrelated Billing";
    const [myKey, peerKey] = await Promise.all([
      generateLocalMessageKey(),
      generateLocalMessageKey(),
    ]);

    await installSecureChatApiMocks(page, myKey, peerKey, {
      meId: "00000000-0000-0000-0000-000000000010",
      meEmail: "patient@gmed.de",
      meName: "Anna Portal",
      meRole: "patient",
      peerId,
      peerName: "Assigned Care Manager",
      peerEmail: "pm@gmed.de",
      peerRole: "patient_manager",
    });

    await page.goto("/login");
    await page.locator("#email").fill("patient@gmed.de");
    await page.locator("#password").fill("patient123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto("/chat");
    const convoButton = page
      .locator("button")
      .filter({ hasText: "Assigned Care Manager" })
      .first();
    await expect(convoButton.getByText("1", { exact: true })).toBeVisible();

    const readRequest = page.waitForRequest((request) =>
      request.method() === "POST" &&
      request.url().includes(`/api/v1/messages/${peerId}/read`),
    );
    await convoButton.click();
    await readRequest;

    await expect(
      page.getByTestId("chat-message-text-00000000-0000-0000-0000-000000001001"),
    ).toHaveText("Secure history bootstrap");
    await expect(convoButton.getByText("1", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /Neue Nachricht|Новое сообщение/i }).click();
    const picker = page.getByTestId("chat-new-picker");
    const pickerSearch = picker.getByPlaceholder(/Benutzer suchen|Поиск пользователей/i);

    await pickerSearch.fill("Assigned");
    await expect(
      picker.getByRole("option", { name: /Assigned Care Manager/i }),
    ).toBeVisible();

    await pickerSearch.fill("Billing");
    await expect(
      picker.getByRole("option", { name: /Assigned Care Manager/i }),
    ).toHaveCount(0);
    await expect(picker.getByText(hiddenPeerName)).toHaveCount(0);
  });
});
