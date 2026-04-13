import { beforeEach, describe, expect, it } from "vitest";

import {
  CHAT_E2E_ALGORITHM,
  decryptAttachmentFromPeer,
  encryptAttachmentForPeer,
  exportKeyRingBackup,
  importKeyRingBackup,
  type MessageKeyEnvelope,
  type MessageKeyRecord,
} from "@/lib/chat-e2e";

const STORAGE_KEY = "gmed_chat_e2e_keyring_v1";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
  });
}

async function makeKeyRecord(seed: Uint8Array): Promise<{
  local: MessageKeyRecord;
  envelope: MessageKeyEnvelope;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"],
  );
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const privateKeyJwk = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", publicKey),
  );
  const fingerprint = Array.from(digest)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const publicKeyBase64 = btoa(String.fromCharCode(...publicKey));
  const createdAt = new Date(Date.UTC(2026, 3, seed[0] ?? 0, 10, 0, 0)).toISOString();

  return {
    local: {
      algorithm: CHAT_E2E_ALGORITHM,
      fingerprint,
      publicKey: publicKeyBase64,
      privateKeyJwk,
      createdAt,
    },
    envelope: {
      id: crypto.randomUUID(),
      user_id: crypto.randomUUID(),
      fingerprint,
      algorithm: CHAT_E2E_ALGORITHM,
      public_key: publicKeyBase64,
      is_active: true,
      created_at: createdAt,
    },
  };
}

beforeEach(() => {
  installLocalStorageMock();
  localStorage.clear();
});

describe("chat E2E attachments", () => {
  it("encrypts and decrypts attachment payloads for a peer", async () => {
    const sender = await makeKeyRecord(new Uint8Array([1]));
    const recipient = await makeKeyRecord(new Uint8Array([2]));
    const plaintext = new TextEncoder().encode("secure attachment bytes");

    const encrypted = await encryptAttachmentForPeer(
      plaintext,
      sender.local,
      recipient.envelope,
    );
    const decrypted = await decryptAttachmentFromPeer(
      {
        attachment_is_e2e: true,
        attachment_e2e_algorithm: encrypted.attachment_e2e_algorithm,
        attachment_e2e_nonce: encrypted.attachment_e2e_nonce,
        attachment_e2e_salt: encrypted.attachment_e2e_salt,
        sender_key_fingerprint: sender.local.fingerprint,
        recipient_key_fingerprint: recipient.local.fingerprint,
      },
      encrypted.ciphertext,
      recipient.local,
      sender.envelope,
    );

    expect(new TextDecoder().decode(decrypted)).toBe("secure attachment bytes");
  });
});

describe("secure chat key backups", () => {
  it("exports and restores the local keyring with a passphrase", async () => {
    const first = await makeKeyRecord(new Uint8Array([3]));
    const second = await makeKeyRecord(new Uint8Array([4]));
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeFingerprint: second.local.fingerprint,
        keys: {
          [first.local.fingerprint]: first.local,
          [second.local.fingerprint]: second.local,
        },
      }),
    );

    const backup = await exportKeyRingBackup("passphrase-123");
    localStorage.clear();

    const restored = await importKeyRingBackup(backup, "passphrase-123");
    expect(restored.importedKeys).toBe(2);
    expect(restored.activeFingerprint).toBe(second.local.fingerprint);

    const ring = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as {
      activeFingerprint?: string;
      keys?: Record<string, MessageKeyRecord>;
    };
    expect(ring.activeFingerprint).toBe(second.local.fingerprint);
    expect(Object.keys(ring.keys ?? {})).toEqual(
      expect.arrayContaining([first.local.fingerprint, second.local.fingerprint]),
    );
  });
});
