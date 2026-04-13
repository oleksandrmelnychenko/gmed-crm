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
) {
  const myId = "00000000-0000-0000-0000-000000000001";
  const peerId = "00000000-0000-0000-0000-000000000777";

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

  const buildConversations = () => [
    {
      user_id: peerId,
      name: "Dr Secure Peer",
      email: "peer@gmed.de",
      role: "patient_manager",
      last_message:
        messages.length > 0
          ? messages[messages.length - 1]?.message ?? "[Encrypted message]"
          : "",
      last_at:
        messages.length > 0
          ? messages[messages.length - 1]?.created_at ?? "2026-04-13T09:00:00Z"
          : "2026-04-13T09:00:00Z",
      is_read: true,
      last_read_at: "2026-04-13T09:00:00Z",
      is_mine: false,
      unread: 0,
      is_e2e: true,
    },
  ];

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
        email: "admin@gmed.de",
        name: "Admin GMED",
        role: "ceo",
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
});
