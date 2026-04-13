import { webcrypto } from "node:crypto";

import { expect, test, type Page, type Route } from "@playwright/test";

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
    const separatorIndex = part.indexOf("\r\n\r\n");
    if (separatorIndex === -1) continue;

    const headers = part.slice(0, separatorIndex);
    const rawBody = part.slice(separatorIndex + 4).replace(/\r\n$/, "");
    const fieldName = headers.match(/name="([^"]+)"/i)?.[1];
    if (!fieldName) continue;

    if (fieldName === "file") {
      fileName = headers.match(/filename="([^"]+)"/i)?.[1] ?? null;
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
  },
) {
  const myId = options?.meId ?? "00000000-0000-0000-0000-000000000001";
  const peerId = options?.peerId ?? "00000000-0000-0000-0000-000000000777";
  const attachmentKey = "secure-attachment-key-1";
  const meRole = options?.meRole ?? "ceo";
  const meName = options?.meName ?? "Admin GMED";
  const meEmail = options?.meEmail ?? "admin@gmed.de";
  const peerName = options?.peerName ?? "Dr Secure Peer";
  const peerEmail = options?.peerEmail ?? "peer@gmed.de";
  const peerRole = options?.peerRole ?? "patient_manager";
  let messages = [
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
  let latestAttachmentBytes = Buffer.from("secure-attachment-placeholder");

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

    if (path === `/messages/e2e-key/${peerId}`) {
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
      return json(route, messages);
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
        e2e_algorithm?: string;
        e2e_ciphertext?: string;
        e2e_nonce?: string;
        e2e_salt?: string;
        sender_key_fingerprint?: string;
        recipient_key_fingerprint?: string;
      };
      messages = [
        ...messages,
        {
          id: "00000000-0000-0000-0000-000000001002",
          from_user: myId,
          to_user: peerId,
          message: null,
          is_e2e: true,
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
      return json(route, { ok: true });
    }

    if (
      path === `/messages/${peerId}/upload` &&
      route.request().method() === "POST"
    ) {
      const multipart = parseMultipart(route);
      latestAttachmentBytes = multipart.fileBytes;
      messages = [
        ...messages,
        {
          id: "00000000-0000-0000-0000-000000001003",
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
      return json(route, { ok: true, attachment_key: attachmentKey });
    }

    if (path === `/messages/file/${attachmentKey}`) {
      return route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: latestAttachmentBytes,
      });
    }

    return json(route, []);
  });
}

test.describe("chat secure flows", () => {
  test("staff can send a secure text message in browser E2E", async ({
    page,
  }) => {
    const myKey = await generateLocalMessageKey();
    const peerKey = await generateLocalMessageKey();

    await installSecureChatApiMocks(page, myKey, peerKey);

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto("/chat");
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();

    await expect(
      page.getByText(/End-to-end encrypted chat/i),
    ).toBeVisible();

    await page.getByPlaceholder(/Nachricht eingeben/i).fill("Secure browser hello");
    await page.locator("form button[type='submit']").click();

    await expect(page.getByText("Secure browser hello")).toBeVisible();
  });

  test("staff can send a secure attachment in browser E2E", async ({
    page,
  }) => {
    const peerId = "00000000-0000-0000-0000-000000000777";
    const attachmentKey = "secure-attachment-key-1";
    const myKey = await generateLocalMessageKey();
    const peerKey = await generateLocalMessageKey();

    await installSecureChatApiMocks(page, myKey, peerKey);

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto("/chat");
    await page.getByRole("button", { name: /Dr Secure Peer/i }).click();

    await expect(
      page.getByText(/End-to-end encrypted chat/i),
    ).toBeVisible();

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

    await expect(page.getByText("secure-result.pdf")).toBeVisible();
    await expect(page.getByText("Secure attachment browser hello")).toBeVisible();

    const downloadRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes(`/api/v1/messages/file/${attachmentKey}`),
    );
    await page.getByRole("button", { name: /secure-result\.pdf/i }).click();
    await downloadRequest;
  });

  test("patient can use secure chat with assigned care team in browser E2E", async ({
    page,
  }) => {
    const peerId = "00000000-0000-0000-0000-000000000778";
    const attachmentKey = "secure-attachment-key-1";
    const myKey = await generateLocalMessageKey();
    const peerKey = await generateLocalMessageKey();

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

    await expect(
      page.getByText(/End-to-end encrypted chat/i),
    ).toBeVisible();

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

    await expect(page.getByText("patient-secure-note.pdf")).toBeVisible();
    await expect(
      page.getByText("Please see the attached secure note."),
    ).toBeVisible();

    const downloadRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes(`/api/v1/messages/file/${attachmentKey}`),
    );
    await page.getByRole("button", { name: /patient-secure-note\.pdf/i }).click();
    await downloadRequest;
  });

  test("patient portal chat clears unread state and only exposes allowed peers", async ({
    page,
  }) => {
    const peerId = "00000000-0000-0000-0000-000000000779";
    const hiddenPeerName = "Unrelated Billing";
    const myKey = await generateLocalMessageKey();
    const peerKey = await generateLocalMessageKey();

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

    const assignedSearchRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes("/api/v1/messages/allowed-peers?search=Assigned"),
    );
    await pickerSearch.fill("Assigned");
    await assignedSearchRequest;
    await expect(
      picker.getByRole("button", { name: /Assigned Care Manager/i }),
    ).toBeVisible();

    const hiddenSearchRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes("/api/v1/messages/allowed-peers?search=Billing"),
    );
    await pickerSearch.fill("Billing");
    await hiddenSearchRequest;
    await expect(
      picker.getByRole("button", { name: /Assigned Care Manager/i }),
    ).toHaveCount(0);
    await expect(picker.getByText(hiddenPeerName)).toHaveCount(0);
  });
});
