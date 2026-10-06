import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test, type Page, type Route, type WebSocketRoute } from "@playwright/test";

import type { Message } from "../../src/pages/chat/model/types";

// Since 2026-10-07 the chat is encrypted on the server: the browser sends text
// and files over TLS and never creates a device key. These mocked flows also
// cover the old end-to-end history, which opens only in a browser that still
// holds its old device key and is then handed back to the server once.

const CHAT_E2E_ALGORITHM = "p256-hkdf-aes256gcm-v1";
const SERVER_ENCRYPTION_LABEL = /Serverseitig verschlüsselt|Шифрование на сервере/;
const OLD_E2E_PLACEHOLDER = /nur auf dem Gerät lesbar, auf dem sie geöffnet wurde/;

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

    fields[fieldName] = Buffer.from(rawBody.trim(), "latin1").toString("utf8");
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

// What the old end-to-end chat produced; the application can no longer do this.
async function encryptLikeTheOldChat(bytes: Uint8Array, sender: LocalMessageKeyRecord, recipient: LocalMessageKeyRecord) {
  const privateKey = await webcrypto.subtle.importKey("jwk", sender.privateKeyJwk,
    { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const publicKey = await webcrypto.subtle.importKey("spki", Buffer.from(recipient.publicKey, "base64"),
    { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await webcrypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const material = await webcrypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const nonce = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await webcrypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt,
    info: new TextEncoder().encode("gmed-chat-e2e-v1") }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ciphertext = Buffer.from(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, bytes));
  return { ciphertext, nonce: bytesToBase64(nonce), salt: bytesToBase64(salt) };
}

async function encryptTestMessage(text: string, sender: LocalMessageKeyRecord, recipient: LocalMessageKeyRecord): Promise<Partial<Message>> {
  const sealed = await encryptLikeTheOldChat(new TextEncoder().encode(text), sender, recipient);
  return {
    message: null, is_e2e: true, e2e_algorithm: CHAT_E2E_ALGORITHM,
    e2e_ciphertext: sealed.ciphertext.toString("base64"),
    e2e_salt: sealed.salt, e2e_nonce: sealed.nonce,
    sender_key_fingerprint: sender.fingerprint, recipient_key_fingerprint: recipient.fingerprint,
  };
}

type Conversion = { kind: "text" | "attachment"; messageId: string; text?: string; bytes?: Buffer };

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
    /** This browser still holds the device key of the old end-to-end chat. */
    holdsOldDeviceKey?: boolean;
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
  const peerHasKey = options?.peerHasKey !== false;
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
  const conversions: Conversion[] = [];
  const keyRegistrations: string[] = [];
  const activeKeyLookups: string[] = [];
  let loseUploadResponseAt = 0;

  const keyEnvelope = (userId: string, key: LocalMessageKeyRecord) => ({
    id: `key-${userId}`,
    user_id: userId,
    fingerprint: key.fingerprint,
    algorithm: key.algorithm,
    public_key: key.publicKey,
    is_active: true,
    created_at: key.createdAt,
  });

  const buildConversations = () => {
    const unreadIncoming = messages.filter(
      (message) => message.to_user === myId && !message.read_at,
    ).length;
    const lastIncomingReadAt = [...messages]
      .reverse()
      .find((message) => message.to_user === myId && message.read_at)?.read_at;
    const last = messages.at(-1);

    return [
      {
        user_id: peerId,
        name: peerName,
        email: peerEmail,
        role: peerRole,
        last_message: !last
          ? ""
          : last.is_e2e
            ? "[Encrypted message]"
            : last.message ?? (last.attachment_filename ? `[${last.attachment_filename}]` : ""),
        last_at: last?.created_at ?? "2026-04-13T09:00:00Z",
        is_read: unreadIncoming === 0,
        last_read_at: lastIncomingReadAt ?? "2026-04-13T09:00:00Z",
        is_mine: last?.from_user === myId,
        unread: unreadIncoming,
        is_e2e: last?.is_e2e ?? false,
      },
    ];
  };

  await page.addInitScript(
    ({ keyRecord, holdsOldDeviceKey }) => {
      window.localStorage.setItem("gmed_lang", "de");
      if (!holdsOldDeviceKey) return;
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
    { keyRecord: myKey, holdsOldDeviceKey: options?.holdsOldDeviceKey !== false },
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
    const method = route.request().method();

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

    if (path === "/messages/e2e-key") {
      // The server-encrypted chat never registers or reads an active device key.
      if (method === "POST") keyRegistrations.push(route.request().postData() ?? "");
      return json(route, { message: "Not found" }, 404);
    }

    // Old device keys are only looked up by fingerprint, to open old messages.
    if (path === `/messages/e2e-key/${peerId}` || path === `/messages/e2e-key/${myId}`) {
      const fingerprint = url.searchParams.get("fingerprint");
      if (!fingerprint) activeKeyLookups.push(path);
      const [owner, key, available] = path.endsWith(peerId)
        ? [peerId, peerKey, peerHasKey]
        : [myId, myKey, true];
      if (!available || fingerprint !== key.fingerprint) {
        return json(route, { message: "Not found" }, 404);
      }
      return json(route, keyEnvelope(owner, key));
    }

    const conversion = path.match(/^\/messages\/([^/]+)\/(convert-from-e2e|convert-attachment-from-e2e)$/);
    if (conversion && method === "POST") {
      const [, messageId, kind] = conversion;
      const target = messages.find((message) => message.id === messageId);
      if (!target) return json(route, { message: "Message not found" }, 404);
      if (kind === "convert-from-e2e") {
        if (!target.is_e2e) return json(route, { message: "Message is not end-to-end encrypted" }, 409);
        const { text } = JSON.parse(route.request().postData() ?? "{}") as { text?: string };
        conversions.push({ kind: "text", messageId, text });
        messages = messages.map((message) => message.id === messageId ? {
          ...message, message: text ?? null, is_e2e: false, e2e_algorithm: null, e2e_ciphertext: null,
          e2e_nonce: null, e2e_salt: null, converted_from_e2e_at: "2026-10-07T10:00:00Z",
          ...(message.attachment_is_e2e ? {} : { sender_key_fingerprint: null, recipient_key_fingerprint: null }),
        } : message);
        return json(route, { ok: true, id: messageId });
      }
      if (!target.attachment_is_e2e) return json(route, { message: "Attachment is not end-to-end encrypted" }, 409);
      if (target.is_e2e) return json(route, { message: "Convert the end-to-end encrypted caption first" }, 409);
      const multipart = parseMultipart(route);
      const newKey = `converted-${messageId}`;
      attachmentBytes.set(newKey, multipart.fileBytes);
      conversions.push({ kind: "attachment", messageId, bytes: multipart.fileBytes });
      messages = messages.map((message) => message.id === messageId ? {
        ...message, attachment_key: newKey, attachment_is_e2e: false, attachment_e2e_algorithm: null,
        attachment_e2e_nonce: null, attachment_e2e_salt: null, sender_key_fingerprint: null,
        recipient_key_fingerprint: null, attachment_converted_from_e2e_at: "2026-10-07T10:00:00Z",
      } : message);
      return json(route, { ok: true, id: messageId, attachment_key: newKey });
    }

    if (path === "/messages/conversations") {
      return json(route, buildConversations());
    }

    if (path === "/messages/unread-total") {
      return json(route, { count: buildConversations().reduce((total, conversation) => total + conversation.unread, 0) });
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

    if (path === `/messages/${peerId}` && method === "GET") {
      const before = url.searchParams.get("before_created_at");
      const beforeId = url.searchParams.get("before_id") ?? "";
      return json(route, [...messages]
        .filter((message) => !before || message.created_at < before || (message.created_at === before && message.id < beforeId))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id))
        .slice(0, Number(url.searchParams.get("limit") ?? 100)));
    }

    if (path === `/messages/${peerId}/read` && method === "POST") {
      messages = messages.map((message) =>
        message.to_user === myId
          ? { ...message, is_read: true, read_at: "2026-04-13T09:01:00Z" }
          : message,
      );
      return json(route, { ok: true });
    }

    if (path === `/messages/${peerId}` && method === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown> & {
        message?: string;
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
          is_e2e: false,
          e2e_algorithm: null,
          e2e_ciphertext: (payload.e2e_ciphertext as string | undefined) ?? null,
          e2e_nonce: null,
          e2e_salt: null,
          sender_key_fingerprint: null,
          recipient_key_fingerprint: null,
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
        is_e2e: false,
      });
    }

    if (path.startsWith(`/messages/${peerId}/`) && method === "DELETE") {
      const messageId = path.slice(`/messages/${peerId}/`.length);
      messages = messages.filter((message) => message.id !== messageId);
      return json(route, { ok: true, id: messageId });
    }

    if (path === `/messages/${peerId}/upload` && method === "POST") {
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
          message: multipart.fields.message ?? null,
          is_e2e: false,
          e2e_algorithm: null,
          e2e_ciphertext: null,
          e2e_nonce: null,
          e2e_salt: null,
          sender_key_fingerprint: null,
          recipient_key_fingerprint: null,
          is_read: false,
          read_at: null,
          created_at: "2026-04-13T09:06:00Z",
          attachment_filename: multipart.fileName,
          attachment_mime: multipart.fileMime ?? "application/octet-stream",
          attachment_size: multipart.fileBytes.length,
          attachment_key: attachmentKey,
          attachment_is_e2e: false,
          attachment_e2e_algorithm: null,
          attachment_e2e_nonce: null,
          attachment_e2e_salt: null,
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
        attachment_is_e2e: false,
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
    setAttachment: (key: string, bytes: Buffer) => { attachmentBytes.set(key, bytes); },
    conversions: () => conversions,
    keyRegistrations: () => keyRegistrations,
    activeKeyLookups: () => activeKeyLookups,
    loseUploadResponse: (fileNumber: number) => { loseUploadResponseAt = fileNumber; },
  };
}

test.describe("chat secure flows", () => {
  async function openCeoChat(page: Page, openConversation = true) {
    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/);
    await page.goto("/chat");
    if (openConversation) await page.getByRole("button", { name: /Dr Secure Peer/i }).click();
  }

  test("opening an unread old message for a missing device key clears both badges and stays cleared after reload", async ({ page }) => {
    const [myKey, peerKey, otherDeviceKey] = await Promise.all([
      generateLocalMessageKey(), generateLocalMessageKey(), generateLocalMessageKey(),
    ]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    api.setMessages([{ ...api.getMessages()[0], ...await encryptTestMessage("Other device only", peerKey, otherDeviceKey) }]);
    await page.routeWebSocket("**/api/**", socket => socket.close());
    await openCeoChat(page, false);
    const conversation = page.getByRole("button", { name: /Dr Secure Peer/i });
    const nav = page.locator('a[href="/chat"]').filter({ visible: true }).first();
    await expect(conversation.getByText("1", { exact: true })).toBeVisible();
    await expect(nav.getByText("1", { exact: true })).toBeVisible();
    await conversation.click();
    await expect(page.getByTestId("chat-message-history").getByText(OLD_E2E_PLACEHOLDER)).toBeVisible();
    await expect(conversation.getByText("1", { exact: true })).toHaveCount(0);
    await expect(nav.getByText("1", { exact: true })).toHaveCount(0);
    expect(api.getMessages()[0].is_read).toBe(true);
    // Nothing this browser cannot open is ever sent back.
    expect(api.conversions()).toEqual([]);
    await page.reload();
    await expect(conversation).toBeVisible();
    await expect(conversation.getByText("1", { exact: true })).toHaveCount(0);
    await expect(nav.getByText("1", { exact: true })).toHaveCount(0);
  });

  for (const mine of [false, true]) {
    test(`conversation preview opens old ${mine ? "outgoing" : "incoming"} ciphertext without opening or marking it read`, async ({ page }) => {
      const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
      const api = await installSecureChatApiMocks(page, myKey, peerKey);
      const latest = { ...api.getMessages()[0],
        from_user: mine ? api.myId : api.peerId, to_user: mine ? api.peerId : api.myId,
        ...await encryptTestMessage("Latest private message", mine ? myKey : peerKey, mine ? peerKey : myKey) };
      api.setMessages([latest]);
      let readReceipts = 0;
      await page.route(`**/messages/${api.peerId}/read`, route => { readReceipts++; return route.fallback(); });
      await page.routeWebSocket("**/api/**", socket => socket.close());
      await openCeoChat(page, false);
      const conversation = page.getByRole("button", { name: /Dr Secure Peer/i });
      await expect(conversation).toContainText("Latest private message");
      expect(readReceipts).toBe(0);
      expect(api.getMessages()[0].is_read).toBe(false);
      await expect(conversation.getByText("1", { exact: true })).toHaveCount(mine ? 0 : 1);
      // The browser that could open it hands the text back once; afterwards the
      // server serves it like any other message.
      await expect.poll(() => api.conversions()).toEqual([
        { kind: "text", messageId: latest.id, text: "Latest private message" },
      ]);
      const refreshed = page.waitForResponse(response => response.url().endsWith("/messages/conversations"));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await refreshed;
      await expect(conversation).toContainText("Latest private message");

      api.setMessages([{ ...latest, id: "new-preview", created_at: "2026-04-13T09:02:00Z",
        ...await encryptTestMessage("Changed private preview", mine ? myKey : peerKey, mine ? peerKey : myKey) }]);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(conversation).toContainText("Changed private preview");
      expect(readReceipts).toBe(0);
      await conversation.click();
      await expect(page.getByTestId("chat-message-history").getByText("Changed private preview", { exact: true })).toBeVisible();
      const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
      expect(storage).not.toContain("Changed private preview");
    });
  }

  test("old end-to-end history is handed back once and then reads on another device", async ({ page, browser, baseURL }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    const base = api.getMessages()[0];
    const fileBytes = Buffer.from("Synthetic lab values: Hb 13.5 g/dl");
    const sealedFile = await encryptLikeTheOldChat(fileBytes, myKey, peerKey);
    api.setAttachment("old-e2e-attachment", sealedFile.ciphertext);
    const incoming = { ...base, id: "old-incoming", is_read: true, read_at: base.created_at,
      ...await encryptTestMessage("Old incoming note", peerKey, myKey) };
    const outgoing: Message = { ...base, id: "old-outgoing", from_user: api.myId, to_user: api.peerId,
      created_at: "2026-04-13T09:03:00Z",
      ...await encryptTestMessage("Old caption", myKey, peerKey),
      attachment_filename: "lab-values.txt", attachment_mime: "text/plain", attachment_size: fileBytes.length,
      attachment_key: "old-e2e-attachment", attachment_is_e2e: true, attachment_e2e_algorithm: CHAT_E2E_ALGORITHM,
      attachment_e2e_nonce: sealedFile.nonce, attachment_e2e_salt: sealedFile.salt };
    api.setMessages([incoming, outgoing]);
    await page.routeWebSocket("**/api/**", socket => socket.close());
    await openCeoChat(page);
    const history = page.getByTestId("chat-message-history");
    await expect(history.getByText("Old incoming note", { exact: true })).toBeVisible();
    await expect(history.getByText("Old caption", { exact: true })).toBeVisible();

    // Each part exactly once, the attachment after its caption.
    const converted = () => api.conversions().map(({ kind, messageId }) => `${kind}:${messageId}`);
    await expect.poll(() => [...converted()].sort(), { timeout: 15_000 })
      .toEqual(["attachment:old-outgoing", "text:old-incoming", "text:old-outgoing"]);
    expect(converted().indexOf("text:old-outgoing")).toBeLessThan(converted().indexOf("attachment:old-outgoing"));
    expect(api.conversions().filter(({ kind }) => kind === "text").map(({ text }) => text).sort())
      .toEqual(["Old caption", "Old incoming note"]);
    expect(api.conversions().find(({ kind }) => kind === "attachment")?.bytes).toEqual(fileBytes);
    await expect(page.getByRole("button", { name: "Herunterladen: lab-values.txt", exact: true })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(500);
    expect(api.conversions()).toHaveLength(3);

    // A fresh browser without any old device key now reads the same history.
    const otherDevice = await browser.newContext({ baseURL });
    try {
      const otherPage = await otherDevice.newPage();
      const otherApi = await installSecureChatApiMocks(otherPage, myKey, peerKey, { holdsOldDeviceKey: false });
      otherApi.setMessages(api.getMessages());
      otherApi.setAttachment("converted-old-outgoing", fileBytes);
      await otherPage.routeWebSocket("**/api/**", socket => socket.close());
      await openCeoChat(otherPage);
      const otherHistory = otherPage.getByTestId("chat-message-history");
      await expect(otherHistory.getByText("Old incoming note", { exact: true })).toBeVisible();
      await expect(otherHistory.getByText("Old caption", { exact: true })).toBeVisible();
      await expect(otherHistory.getByText(OLD_E2E_PLACEHOLDER)).toHaveCount(0);
      const downloaded = otherPage.waitForEvent("download");
      await otherPage.getByRole("button", { name: "Herunterladen: lab-values.txt", exact: true }).click();
      expect(await readFile((await (await downloaded).path())!)).toEqual(fileBytes);
      expect(otherApi.conversions()).toEqual([]);
      expect(otherApi.keyRegistrations()).toEqual([]);
    } finally {
      await otherDevice.close();
    }
  });

  test("legacy inactive keys survive IndexedDB migration and decrypt historical messages", async ({ page }) => {
    const [myKey, oldKey, peerKey] = await Promise.all([
      generateLocalMessageKey(), generateLocalMessageKey(), generateLocalMessageKey(),
    ]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    await page.addInitScript(({ active, old }) => {
      localStorage.setItem("gmed_chat_e2e_keyring_v1", JSON.stringify({
        activeFingerprint: active.fingerprint,
        keys: { [old.fingerprint]: old, [active.fingerprint]: active },
      }));
    }, { active: myKey, old: oldKey });
    await page.route(`**/messages/e2e-key/${api.myId}?fingerprint=${oldKey.fingerprint}`, route => json(route, {
      id: "historical-own-key", user_id: api.myId, algorithm: oldKey.algorithm,
      public_key: oldKey.publicKey, fingerprint: oldKey.fingerprint, is_active: false, created_at: oldKey.createdAt,
    }));
    api.setMessages([{ ...api.getMessages()[0], ...await encryptTestMessage("History still readable", peerKey, oldKey) }]);
    await page.routeWebSocket("**/api/**", socket => socket.close());
    await openCeoChat(page);
    await expect(page.getByTestId("chat-message-history").getByText("History still readable", { exact: true })).toBeVisible();
    const stored = await page.evaluate(async ({ owner, fingerprint }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("gmed-chat-e2e-v2", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const record = await new Promise<{ privateKey: CryptoKey }>((resolve, reject) => {
          const request = database.transaction("message-keys", "readonly").objectStore("message-keys").get([owner, fingerprint]);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return { extractable: record.privateKey.extractable, legacyRemoved: localStorage.getItem("gmed_chat_e2e_keyring_v1") === null };
      } finally { database.close(); }
    }, { owner: api.myId, fingerprint: oldKey.fingerprint });
    expect(stored).toEqual({ extractable: false, legacyRemoved: true });
    await expect.poll(() => api.conversions().map(({ text }) => text)).toEqual(["History still readable"]);
  });

  test("preview key lookup recovers after a temporary failure without acknowledging messages", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    api.setMessages([{ ...api.getMessages()[0], ...await encryptTestMessage("Preview recovered", peerKey, myKey) }]);
    let failing = true;
    let failures = 0;
    await page.route(`**/messages/e2e-key/${api.peerId}?fingerprint=*`, route => {
      if (!failing) return route.fallback();
      failures++;
      return json(route, { message: "Temporarily unavailable" }, 503);
    });
    await page.routeWebSocket("**/api/**", socket => socket.close());
    await openCeoChat(page, false);
    await expect.poll(() => failures).toBeGreaterThan(0);
    const conversation = page.getByRole("button", { name: /Dr Secure Peer/i });
    await expect(conversation.getByText("1", { exact: true })).toBeVisible();
    failing = false;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(conversation).toContainText("Preview recovered");
    await expect(conversation.getByText("1", { exact: true })).toBeVisible();
    expect(api.getMessages()[0].is_read).toBe(false);
  });

  test("opening a conversation clears both unread badges despite unavailable already-read history and no websocket", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    const incoming = api.getMessages()[0];
    api.setMessages([{ ...incoming, id: "old-unavailable", created_at: "2026-04-12T09:00:00Z",
      is_read: true, read_at: "2026-04-12T10:00:00Z", is_e2e: true, message: null,
      recipient_key_fingerprint: "missing-historical-key", sender_key_fingerprint: "missing-peer-key" }, incoming]);
    await page.routeWebSocket("**/api/**", socket => socket.close());
    await openCeoChat(page, false);
    const conversation = page.getByRole("button", { name: /Dr Secure Peer/i });
    const nav = page.locator('a[href="/chat"]').filter({ visible: true }).first();
    await expect(conversation.getByText("1", { exact: true })).toBeVisible();
    await expect(nav.getByText("1", { exact: true })).toBeVisible();
    await conversation.click();
    await expect(page.getByTestId("chat-message-history").getByText("Secure history bootstrap", { exact: true })).toBeVisible();
    await expect(page.getByTestId("chat-message-history").getByText(OLD_E2E_PLACEHOLDER)).toBeVisible();
    await expect(conversation.getByText("1", { exact: true })).toHaveCount(0, { timeout: 3000 });
    await expect(nav.getByText("1", { exact: true })).toHaveCount(0, { timeout: 3000 });
    expect(api.getMessages().every(message => message.is_read)).toBe(true);
  });

  test("a rejected read receipt keeps both unread badges and clicking the active conversation retries", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    await page.routeWebSocket("**/api/**", socket => socket.close());
    let reject = true;
    let attempts = 0;
    await page.route(`**/messages/${api.peerId}/read`, route => {
      attempts++;
      return reject ? json(route, { message: "Temporarily unavailable" }, 503) : route.fallback();
    });
    await openCeoChat(page);
    await expect.poll(() => attempts).toBeGreaterThan(0);
    const conversation = page.getByRole("button", { name: /Dr Secure Peer/i });
    const nav = page.locator('a[href="/chat"]').filter({ visible: true }).first();
    await expect(page.getByTestId("chat-message-history").getByText("Secure history bootstrap", { exact: true })).toBeVisible();
    await expect(conversation.getByText("1", { exact: true })).toBeVisible();
    await expect(nav.getByText("1", { exact: true })).toBeVisible();
    reject = false;
    await conversation.click();
    await expect(conversation.getByText("1", { exact: true })).toHaveCount(0, { timeout: 3000 });
    await expect(nav.getByText("1", { exact: true })).toHaveCount(0, { timeout: 3000 });
  });

  test("a stale counter response cannot restore unread badges after a successful read receipt", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    await installSecureChatApiMocks(page, myKey, peerKey);
    await page.routeWebSocket("**/api/**", socket => socket.close());
    await openCeoChat(page, false);
    const conversation = page.getByRole("button", { name: /Dr Secure Peer/i });
    const nav = page.locator('a[href="/chat"]').filter({ visible: true }).first();
    await expect(nav.getByText("1", { exact: true })).toBeVisible();
    let release!: () => void;
    let requested = false;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/messages/unread-total", async route => {
      if (requested) return route.fallback();
      requested = true;
      await pending;
      return json(route, { count: 1, stale: true });
    });
    try {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => requested).toBe(true);
      await conversation.click();
      await expect(nav.getByText("1", { exact: true })).toHaveCount(0, { timeout: 3000 });
      const oldResponse = page.waitForResponse(async response => response.url().endsWith("/messages/unread-total") && (await response.json()).stale === true);
      release();
      await oldResponse;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(nav.getByText("1", { exact: true })).toHaveCount(0);
    } finally { release(); }
  });

  test("a successful read receipt clears the conversation badge even if refreshing the list fails", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    await page.routeWebSocket("**/api/**", socket => socket.close());
    await page.route("**/messages/conversations", route => api.getMessages().every(message => message.is_read)
      ? json(route, { message: "Temporary list failure" }, 503) : route.fallback());
    await openCeoChat(page);
    const conversation = page.getByRole("button", { name: /Dr Secure Peer/i });
    await expect(conversation.getByText("1", { exact: true })).toHaveCount(0, { timeout: 3000 });
    await expect(page.getByTestId("chat-message-history").getByText("Secure history bootstrap", { exact: true })).toBeVisible();
  });

  test("signing in and chatting never creates or registers a device key", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey, { holdsOldDeviceKey: false });
    await page.routeWebSocket("**/api/**", socket => socket.close());
    await openCeoChat(page);
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("No device key needed");
    await page.locator("form button[type='submit']").click();
    await expect(page.getByText("Gesendet", { exact: true })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(500);
    expect(api.keyRegistrations()).toEqual([]);
    expect(api.activeKeyLookups()).toEqual([]);
    const stores = await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name));
    expect(stores).not.toContain("gmed-chat-e2e-v2");
  });

  test("staff message a peer who never created a device key and the text goes to the server as text", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey, { peerHasKey: false });
    const sent: Record<string, unknown>[] = [];
    await page.route(`**/api/v1/messages/${api.peerId}`, async (route) => {
      if (route.request().method() === "POST") sent.push(JSON.parse(route.request().postData() ?? "{}"));
      return route.fallback();
    });
    await openCeoChat(page);
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
    await expect(page.getByText(/Identität der Gegenseite|Gegenseite hat den sicheren Chat/)).toHaveCount(0);
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("Plain hello for the server");
    await expect(page.locator("form button[type='submit']")).toBeEnabled();
    await page.locator("form button[type='submit']").click();
    await expect(page.getByText("Gesendet", { exact: true })).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toBe("Plain hello for the server");
    for (const field of ["e2e_ciphertext", "e2e_nonce", "e2e_salt", "sender_key_fingerprint", "recipient_key_fingerprint"]) {
      expect(sent[0]).not.toHaveProperty(field);
    }
    expect(api.getMessages().at(-1)?.message).toBe("Plain hello for the server");
  });

  test("CEO and care manager read each other's messages in separate browser sessions", async ({ page, browser, baseURL }) => {
    const [ceoKey, managerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const ceo = await installSecureChatApiMocks(page, ceoKey, managerKey);
    const recipientContext = await browser.newContext({ baseURL });
    try {
      const recipientPage = await recipientContext.newPage();
      const manager = await installSecureChatApiMocks(recipientPage, managerKey, ceoKey, {
        meId: ceo.peerId, peerId: ceo.myId, meRole: "patient_manager", peerRole: "ceo", holdsOldDeviceKey: false,
      });
      await page.routeWebSocket("**/messages/ws", (socket) => socket.close());
      await recipientPage.routeWebSocket("**/messages/ws", (socket) => socket.close());
      await openCeoChat(page);
      await openCeoChat(recipientPage);
      await page.getByPlaceholder(/Nachricht eingeben/i).fill("Message from the CEO");
      await page.locator("form button[type='submit']").click();
      await expect(page.getByText("Gesendet", { exact: true })).toBeVisible();
      manager.setMessages(ceo.getMessages());
      await expect(recipientPage.getByTestId("chat-message-history").getByText("Message from the CEO", { exact: true })).toBeVisible({ timeout: 12_000 });
      await recipientPage.getByPlaceholder(/Nachricht eingeben/i).fill("Care manager received and replied");
      await recipientPage.locator("form button[type='submit']").click();
      await expect(recipientPage.getByText("Gesendet", { exact: true })).toBeVisible();
      ceo.setMessages(manager.getMessages());
      await expect(page.getByTestId("chat-message-history").getByText("Care manager received and replied", { exact: true })).toBeVisible({ timeout: 12_000 });
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
    await expect(page.getByTestId("chat-message-history").getByText("Secure history bootstrap")).toBeVisible();
    api.setMessages([...api.getMessages(), {
      ...api.getMessages()[0], id: webcrypto.randomUUID(), message: "Arrived without a websocket",
      is_read: false, read_at: null, created_at: new Date().toISOString(),
    }]);
    await expect(page.getByTestId("chat-message-history").getByText("Arrived without a websocket")).toBeVisible({ timeout: 12_000 });
    api.setMessages([]);
    await expect(page.getByTestId("chat-message-history").getByText("Arrived without a websocket")).toHaveCount(0, { timeout: 12_000 });
    await expect(page.getByTestId("chat-message-history").getByText("Secure history bootstrap")).toHaveCount(0);
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
    await expect(page.getByTestId("chat-message-history").getByText("Keep this failed message")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
    await expect(page.getByText("Gesendet", { exact: true })).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts).size).toBe(1);
    await expect(page.getByTestId("chat-message-history").getByText("Keep this failed message")).toHaveCount(1);
  });

  test("an accepted attachment clears the composer even if the subsequent history refresh fails", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    await openCeoChat(page);
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "confirmed-document.txt", mimeType: "text/plain", buffer: Buffer.from("Test attachment"),
    });
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("Confirmed attachment caption");
    await page.route(`**/api/v1/messages/${api.peerId}?*`, (route) => json(route, { message: "History temporarily unavailable" }, 503));
    await page.locator("form button[type='submit']").click();
    await expect(page.getByPlaceholder(/Nachricht eingeben/i)).toHaveValue("");
    await expect(page.getByRole("button", { name: "Herunterladen: confirmed-document.txt", exact: true })).toBeVisible();
    await expect(page.getByTestId("chat-message-history").getByText("Confirmed attachment caption")).toBeVisible();
    await expect(page.getByTestId("chat-attachment-queue")).toHaveCount(0);
    await expect(page.locator("form button[type='submit']")).toBeDisabled();
    expect(api.getMessages().filter((message) => message.attachment_key)).toHaveLength(1);
    expect(api.getMessages().at(-1)?.message).toBe("Confirmed attachment caption");
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
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
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

  test("a multi-file queue retries lost acknowledgements with the same payload and no duplicates", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    api.loseUploadResponse(2);
    const attempts: ReturnType<typeof parseMultipart>[] = [];
    await page.route(`**/api/v1/messages/${api.peerId}/upload`, async (route) => {
      attempts.push(parseMultipart(route));
      await route.fallback();
    });
    await openCeoChat(page);
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
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
    await expect(page.getByTestId("chat-message-history").getByText("Caption sent once")).toHaveCount(1);
    expect(api.getMessages().filter((message) => message.attachment_key)).toHaveLength(3);
    expect(attempts.map((attempt) => attempt.fileName)).toEqual(["queued-1.txt", "queued-2.txt", "queued-2.txt", "queued-3.txt"]);
    expect(attempts[1].fields).toEqual(attempts[2].fields);
    expect(attempts[1].fileBytes).toEqual(attempts[2].fileBytes);
    // The server encrypts at rest: the browser sends the file itself.
    expect(attempts[0].fileBytes).toEqual(Buffer.from("Original file 1"));
    expect(attempts[0].fileMime).toBe("text/plain");
    expect(attempts.filter((attempt) => attempt.fields.message === "Caption sent once")).toHaveLength(1);
    expect(attempts.filter((attempt) => Object.keys(attempt.fields).some((field) => field.includes("e2e")))).toHaveLength(0);
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
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
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

  test("attachment previews render text literally and recover after download failure", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    await installSecureChatApiMocks(page, myKey, peerKey);
    await openCeoChat(page);
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
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
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
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
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
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
    // Chrome's PDF viewer takes keyboard focus once the PDF has loaded; Escape from the
    // dialog itself closes it whether or not the browser renders PDFs inline.
    await page.getByRole("dialog").getByRole("button", { name: "Schließen", exact: true }).press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
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
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
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

  test("a failed upload retries with the same idempotency key and file and supports Unicode filenames", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    const attempts: ReturnType<typeof parseMultipart>[] = [];
    await page.route(`**/api/v1/messages/${api.peerId}/upload`, async (route) => {
      attempts.push(parseMultipart(route));
      if (attempts.length === 1) return json(route, { message: "Temporarily unavailable" }, 503);
      await route.fallback();
    });
    await openCeoChat(page);
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: "Результати аналізів.txt", mimeType: "text/plain", buffer: Buffer.from("Гемоглобін: 123") });
    await page.locator("form button[type='submit']").click();
    await expect(page.getByText("Der Anhang konnte nicht gesendet werden.")).toBeVisible();
    await expect(page.locator("form button[type='submit']")).toBeEnabled();
    await expect(page.getByTestId("chat-attachment-queue").getByRole("listitem")).toHaveCount(1);
    await page.locator("form button[type='submit']").click();
    await expect(page.getByTestId("chat-attachment-queue")).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].fields.client_message_id).toBe(attempts[1].fields.client_message_id);
    expect(attempts[0].fileBytes).toEqual(attempts[1].fileBytes);
    expect(attempts[1].fileBytes).toEqual(Buffer.from("Гемоглобін: 123"));
    expect(attempts[1].fileName).toBe("Результати аналізів.txt");
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
    await expect(page.getByTestId("chat-message-history").getByText("History item 119", { exact: true })).toBeVisible();
    await expect.poll(() => api.getMessages().every((message) => message.is_read)).toBe(true);
    const log = page.getByRole("log");
    await log.evaluate((element) => { element.scrollTop = 0; });
    await page.getByRole("button", { name: "Ältere Nachrichten laden" }).click();
    await expect(page.getByTestId("chat-message-history").getByText("History item 0", { exact: true })).toBeAttached();
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
    await expect(page.getByTestId("chat-message-history").getByText("Reading position 49", { exact: true })).toBeVisible();
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
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
    await expect(page.getByTestId("chat-message-history").getByText("New while reading", { exact: true })).toBeAttached();
    await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBeCloseTo(before, 0);
    await expect(page.getByRole("button", { name: "Zu den neuesten Nachrichten" })).toBeVisible();
    const viewport = await log.boundingBox();
    await page.getByRole("button", { name: "Zu den neuesten Nachrichten" }).click();
    expect(await log.boundingBox()).toEqual(viewport);
    // Readers already at the bottom still follow incoming messages.
    api.setMessages([...api.getMessages(), { ...base, id: "follow-at-bottom", message: "Follow at bottom", created_at: "2026-09-01T14:01:00Z" }]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("chat-message-history").getByText("Follow at bottom", { exact: true })).toBeVisible();
    await expect.poll(() => log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(2);
  });

  test("background refresh does not replace empty search results with a loading screen", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    await openCeoChat(page);
    await expect(page.getByTestId("chat-message-history").getByText("Secure history bootstrap")).toBeVisible();
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
    await page.routeWebSocket("**/messages/ws", (socket) => {
      socket.onMessage(() => socket.send(JSON.stringify({
        type: "messages.connected", user_id: "00000000-0000-0000-0000-000000000001",
      })));
    });
    await openCeoChat(page);
    await expect(page.getByText("Verbunden", { exact: true })).toBeVisible();
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
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
    await expect(page.getByTestId("chat-message-history").getByText("Secure history bootstrap")).toBeVisible();
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
    const before = await page.getByRole("log").boundingBox();
    const messageBefore = await page.getByTestId("chat-message-history").getByText("Secure history bootstrap").boundingBox();
    await page.route(`**/api/v1/messages/${api.peerId}?*`, (route) => json(route, { message: "Unavailable" }, 503));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await page.getByRole("log").boundingBox()).toEqual(before);
    expect(await page.getByTestId("chat-message-history").getByText("Secure history bootstrap").boundingBox()).toEqual(messageBefore);
    let releaseRefresh!: () => void;
    const gate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let requested = false;
    await page.route(`**/api/v1/messages/${api.peerId}?*`, async (route) => { requested = true; await gate; await json(route, api.getMessages()); });
    await page.getByRole("alert").getByRole("button").click();
    await expect.poll(() => requested).toBe(true);
    try {
      await expect(page.getByRole("alert")).toBeVisible();
      expect(await page.getByTestId("chat-message-history").getByText("Secure history bootstrap").boundingBox()).toEqual(messageBefore);
    } finally { releaseRefresh(); }
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await page.getByTestId("chat-message-history").getByText("Secure history bootstrap").boundingBox()).toEqual(messageBefore);
  });

  test("the conversation header names server-side encryption and shows no device-key warnings", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey, { peerHasKey: false });
    await openCeoChat(page);
    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();
    await expect(page.getByText(/Ende-zu-Ende verschlüsselt|Сквозное шифрование/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Chat-Sicherheit|Безопасность чата/ })).toHaveCount(0);
    await expect(page.getByText(/Schlüssel der Gegenseite|Identität der Gegenseite|sicheren Chat noch nicht aktiviert/)).toHaveCount(0);
    await page.getByPlaceholder(/Nachricht eingeben/i).fill("Sending does not wait for any key");
    await expect(page.locator("form button[type='submit']")).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("note") });
    await expect(page.getByTestId("chat-attachment-queue").getByRole("listitem")).toHaveCount(1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(500);
    expect(api.activeKeyLookups()).toEqual([]);
  });

  test("staff can send a text message and delete it", async ({
    page,
  }) => {
    const [myKey, peerKey] = await Promise.all([
      generateLocalMessageKey(),
      generateLocalMessageKey(),
    ]);

    const api = await installSecureChatApiMocks(page, myKey, peerKey);

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto("/chat");
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();

    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();

    await page.getByPlaceholder(/Nachricht eingeben/i).fill("Browser hello");
    await page.locator("form button[type='submit']").click();

    await expect(page.getByTestId("chat-message-history").getByText("Browser hello")).toBeVisible();
    expect(api.activeKeyLookups()).toEqual([]);
    expect(api.getMessages().at(-1)?.message).toBe("Browser hello");

    const deleteRequest = page.waitForRequest((request) =>
      request.method() === "DELETE" &&
      request.url().includes("/api/v1/messages/00000000-0000-0000-0000-000000000777/"),
    );
    await page.getByRole("button", { name: /Nachricht löschen|Удалить сообщение/i }).click();
    await page.getByRole("button", { name: /Löschen|Удалить/i }).last().click();
    await deleteRequest;
    await expect(page.getByTestId("chat-message-history").getByText("Browser hello")).toHaveCount(0);
  });

  test("chat and realtime wait for server readiness without opening duplicate sockets on focus", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    const api = await installSecureChatApiMocks(page, myKey, peerKey);
    const sockets = new Map<string, WebSocketRoute>();
    let connectionCount = 0;
    await page.routeWebSocket(/\/(messages|events)\/ws/, (socket) => {
      connectionCount++;
      socket.onMessage(() => sockets.set(new URL(socket.url()).pathname, socket));
    });
    await openCeoChat(page);
    await expect.poll(() => sockets.has("/api/v1/messages/ws")).toBe(true);
    const countBeforeFocus = connectionCount;
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByText("Verbunden", { exact: true })).toHaveCount(0);
    await expect(page.locator('[aria-label="Realtime verbunden"]')).toHaveCount(0);
    expect(connectionCount).toBe(countBeforeFocus);

    sockets.get("/api/v1/messages/ws")!.send(JSON.stringify({ type: "messages.connected", user_id: "wrong-user" }));
    sockets.get("/api/v1/events/ws")!.send(JSON.stringify({ type: "realtime.connected", entity_id: "wrong-user" }));
    await expect(page.getByText("Verbunden", { exact: true })).toHaveCount(0);
    sockets.get("/api/v1/messages/ws")!.send(JSON.stringify({ type: "messages.connected", user_id: api.myId }));
    sockets.get("/api/v1/events/ws")!.send(JSON.stringify({ type: "realtime.connected", entity_id: api.myId }));
    await expect(page.getByText("Verbunden", { exact: true })).toBeVisible();
    await expect(page.locator('[aria-label="Realtime verbunden"]')).toBeVisible();
    expect(connectionCount).toBe(countBeforeFocus);
  });

  test("rejected chat and realtime sockets back off without flashing connected", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([generateLocalMessageKey(), generateLocalMessageKey()]);
    await installSecureChatApiMocks(page, myKey, peerKey);
    await page.addInitScript(() => {
      const statuses: string[] = [];
      window.localStorage.setItem("gmed_access_token", "playwright-access-token");
      window.localStorage.setItem("gmed_refresh_token", "playwright-refresh-token");
      Object.assign(window, { __realtimeStatuses: statuses });
      window.addEventListener("gmed:realtime-connection", (event) => {
        statuses.push((event as CustomEvent<{ status: string }>).detail.status);
      });
    });
    const attempts = new Map<string, number[]>();
    await page.routeWebSocket(/\/(messages|events)\/ws/, (socket) => {
      socket.onMessage(() => {
        const path = new URL(socket.url()).pathname;
        const times = attempts.get(path) ?? [];
        times.push(Date.now());
        attempts.set(path, times);
        socket.close();
      });
    });
    await page.goto("/chat");
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();
    await expect.poll(() => Math.min(
      attempts.get("/api/v1/messages/ws")?.length ?? 0,
      attempts.get("/api/v1/events/ws")?.length ?? 0,
    ), { timeout: 25_000 }).toBeGreaterThanOrEqual(4);
    for (const [path, times] of attempts) {
      const timing = JSON.stringify({ path, offsets: times.map((time) => time - times[0]) });
      expect(times[1] - times[0], timing).toBeGreaterThanOrEqual(900);
      expect(times[2] - times[1], timing).toBeGreaterThanOrEqual(1_800);
      expect(times[3] - times[2], timing).toBeGreaterThanOrEqual(3_600);
    }
    await expect(page.getByText("Verbunden", { exact: true })).toHaveCount(0);
    const statuses = await page.evaluate(() => (window as Window & { __realtimeStatuses: string[] }).__realtimeStatuses);
    expect(statuses).not.toContain("connected");
  });

  test("chat reconnects after a websocket disconnect", async ({ page }) => {
    const [myKey, peerKey] = await Promise.all([
      generateLocalMessageKey(),
      generateLocalMessageKey(),
    ]);

    await installSecureChatApiMocks(page, myKey, peerKey);
    let connectionCount = 0;
    await page.routeWebSocket("**/messages/ws", (socket) => {
      const currentConnection = ++connectionCount;
      socket.onMessage(() => {
        socket.send(JSON.stringify({
          type: "messages.connected", user_id: "00000000-0000-0000-0000-000000000001",
        }));
        if (currentConnection === 1) setTimeout(() => socket.close(), 100);
      });
    });

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });
    await page.goto("/chat");
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();

    await expect.poll(() => connectionCount).toBeGreaterThanOrEqual(2);
    await expect(page.getByText(/Verbunden|В сети/i)).toBeVisible({ timeout: 5_000 });
  });

  test("staff can send an attachment with a caption", async ({
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

    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();

    await page.locator("form input[type='file']").setInputFiles({
      name: "secure-result.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 attachment-browser"),
    });
    await page
      .getByPlaceholder(/Nachricht eingeben/i)
      .fill("Attachment browser hello");

    const uploadRequest = page.waitForRequest((request) =>
      request.method() === "POST" &&
      request.url().includes(`/api/v1/messages/${peerId}/upload`),
    );
    await page.locator("form button[type='submit']").click();
    await uploadRequest;

    await expect(page.getByRole("button", { name: "Herunterladen: secure-result.pdf", exact: true })).toBeVisible();
    await expect(page.getByTestId("chat-message-history").getByText("Attachment browser hello")).toBeVisible();

    const downloadRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes(`/api/v1/messages/file/${attachmentKey}`),
    );
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Herunterladen: secure-result.pdf", exact: true }).click();
    await downloadRequest;
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("secure-result.pdf");
    expect(await readFile((await download.path())!)).toEqual(Buffer.from("%PDF-1.4 attachment-browser"));
  });

  test("patient can chat with the assigned care team", async ({
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
      holdsOldDeviceKey: false,
    });

    await page.goto("/login");
    await page.locator("#email").fill("patient@gmed.de");
    await page.locator("#password").fill("patient123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto("/chat");
    await page.getByRole("button", { name: /Assigned Care Manager/i }).click();

    await expect(page.getByText(SERVER_ENCRYPTION_LABEL)).toBeVisible();

    await page
      .getByPlaceholder(/Nachricht eingeben/i)
      .fill("Patient update for the care team");
    await page.locator("form button[type='submit']").click();
    await expect(
      page.getByTestId("chat-message-history").getByText("Patient update for the care team"),
    ).toBeVisible();

    await page.locator("form input[type='file']").setInputFiles({
      name: "patient-note.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 patient-attachment-browser"),
    });
    await page
      .getByPlaceholder(/Nachricht eingeben/i)
      .fill("Please see the attached note.");

    const uploadRequest = page.waitForRequest((request) =>
      request.method() === "POST" &&
      request.url().includes(`/api/v1/messages/${peerId}/upload`),
    );
    await page.locator("form button[type='submit']").click();
    await uploadRequest;

    await expect(page.getByRole("button", { name: "Herunterladen: patient-note.pdf", exact: true })).toBeVisible();
    await expect(
      page.getByTestId("chat-message-history").getByText("Please see the attached note."),
    ).toBeVisible();

    const downloadRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes(`/api/v1/messages/file/${attachmentKey}`),
    );
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Herunterladen: patient-note.pdf", exact: true }).click();
    await downloadRequest;
    const download = await downloadEvent;
    expect(await readFile((await download.path())!)).toEqual(Buffer.from("%PDF-1.4 patient-attachment-browser"));
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
