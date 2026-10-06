import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn<(path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>>(
    async () => {
      throw new Error("404 not found");
    },
  ),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
}));

import * as chatE2E from "@/lib/chat-e2e";
import {
  CHAT_E2E_ALGORITHM,
  decryptAttachmentFromPeer,
  decryptMessageFromPeer,
  fetchMessageKeyByFingerprint,
  getLocalMessageKey,
  importLegacyMessageKeys,
  type MessageKeyEnvelope,
  type MessageKeyRecord,
} from "@/lib/chat-e2e";

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

function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

async function makeKeyRecord(seed: number): Promise<{
  local: MessageKeyRecord;
  envelope: MessageKeyEnvelope;
  privateKeyJwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const privateKeyJwk = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;
  const privateKey = await crypto.subtle.importKey(
    "jwk", privateKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"],
  );
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", publicKey)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const createdAt = new Date(Date.UTC(2026, 3, seed, 10, 0, 0)).toISOString();
  return {
    privateKeyJwk,
    local: {
      ownerUserId: `owner-${seed}`, algorithm: CHAT_E2E_ALGORITHM, fingerprint,
      publicKey: base64(publicKey), privateKey, createdAt,
    },
    envelope: {
      id: crypto.randomUUID(), user_id: crypto.randomUUID(), fingerprint,
      algorithm: CHAT_E2E_ALGORITHM, public_key: base64(publicKey), is_active: true, created_at: createdAt,
    },
  };
}

// The old chat encrypted in the browser; the production module no longer can.
async function encryptLikeTheOldChat(plaintext: Uint8Array, sender: MessageKeyRecord, recipient: MessageKeyEnvelope) {
  const recipientKey = await crypto.subtle.importKey(
    "spki", Uint8Array.from(atob(recipient.public_key), (char) => char.charCodeAt(0)),
    { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: recipientKey }, sender.privateKey, 256);
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("gmed-chat-e2e-v1") },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, Uint8Array.from(plaintext)));
  return { ciphertext, nonce: base64(nonce), salt: base64(salt) };
}

function installLegacyKeys(keys: Awaited<ReturnType<typeof makeKeyRecord>>[]) {
  localStorage.setItem("gmed_chat_e2e_keyring_v1", JSON.stringify({
    activeFingerprint: keys.at(-1)!.local.fingerprint,
    keys: Object.fromEntries(keys.map(({ local, privateKeyJwk }) => [local.fingerprint, {
      algorithm: local.algorithm, fingerprint: local.fingerprint, publicKey: local.publicKey,
      createdAt: local.createdAt, privateKeyJwk,
    }])),
  }));
}

function writeCalls() {
  return apiFetchMock.mock.calls.filter(([, init]) => Boolean(init?.method && init.method !== "GET"));
}

beforeEach(() => {
  installLocalStorageMock();
  localStorage.clear();
  apiFetchMock.mockClear();
});

describe("legacy end-to-end chat reader", () => {
  it("can no longer create, register or encrypt with a device key", () => {
    const exported = Object.keys(chatE2E);
    for (const removed of [
      "ensureServerMessageKey", "encryptMessageForPeer", "encryptAttachmentForPeer", "fetchPeerMessageKey",
    ]) {
      expect(exported).not.toContain(removed);
    }
  });

  it("does nothing on a device that never used the end-to-end chat", async () => {
    await importLegacyMessageKeys("fresh-device-owner");
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(await getLocalMessageKey("fresh-device-owner", "a".repeat(64))).toBeNull();
  });

  it("imports active and historical keys of this account and opens their messages", async () => {
    const [old, active, peer] = await Promise.all([21, 22, 23].map(makeKeyRecord));
    const owner = "legacy-history-owner";
    old.envelope = { ...old.envelope, user_id: owner, is_active: false };
    active.envelope.user_id = owner;
    installLegacyKeys([old, active]);
    apiFetchMock.mockResolvedValueOnce(old.envelope).mockResolvedValueOnce(active.envelope);

    await importLegacyMessageKeys(owner);
    for (const original of [old, active]) {
      const key = (await getLocalMessageKey(owner, original.local.fingerprint))!;
      expect(key.privateKey.extractable).toBe(false);
      const sealed = await encryptLikeTheOldChat(new TextEncoder().encode("Preserved history"), peer.local, original.envelope);
      expect(await decryptMessageFromPeer({
        e2e_algorithm: CHAT_E2E_ALGORITHM, e2e_ciphertext: base64(sealed.ciphertext),
        e2e_nonce: sealed.nonce, e2e_salt: sealed.salt,
      }, key, peer.envelope)).toBe("Preserved history");
    }
    expect(localStorage.getItem("gmed_chat_e2e_keyring_v1")).toBeNull();
    expect(writeCalls()).toHaveLength(0);
  });

  it("does not import or delete another account's legacy keys", async () => {
    const [own, foreign] = await Promise.all([26, 27].map(makeKeyRecord));
    const owner = "legacy-isolated-owner";
    own.envelope.user_id = owner;
    installLegacyKeys([own, foreign]);
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.includes(own.local.fingerprint)) return own.envelope;
      throw new Error("404 not found");
    });
    try {
      await importLegacyMessageKeys(owner);
    } finally {
      apiFetchMock.mockReset();
      apiFetchMock.mockImplementation(async () => { throw new Error("404 not found"); });
    }
    expect(await getLocalMessageKey(owner, own.local.fingerprint)).not.toBeNull();
    expect(await getLocalMessageKey(owner, foreign.local.fingerprint)).toBeNull();
    const remaining = JSON.parse(localStorage.getItem("gmed_chat_e2e_keyring_v1")!);
    expect(Object.keys(remaining.keys)).toEqual([foreign.local.fingerprint]);
  });

  it("keeps the only copy when verification is offline and retries on the next call", async () => {
    const old = await makeKeyRecord(28);
    const owner = "legacy-retry-owner";
    old.envelope = { ...old.envelope, user_id: owner, is_active: false };
    installLegacyKeys([old]);
    const original = localStorage.getItem("gmed_chat_e2e_keyring_v1");
    apiFetchMock.mockRejectedValueOnce(new Error("Offline"));
    await expect(importLegacyMessageKeys(owner)).rejects.toThrow("Offline");
    expect(localStorage.getItem("gmed_chat_e2e_keyring_v1")).toBe(original);

    apiFetchMock.mockResolvedValueOnce(old.envelope);
    await importLegacyMessageKeys(owner);
    expect(await getLocalMessageKey(owner, old.local.fingerprint)).not.toBeNull();
    expect(localStorage.getItem("gmed_chat_e2e_keyring_v1")).toBeNull();
    expect(writeCalls()).toHaveLength(0);
  });

  it("keeps the original material when the private key cannot be imported", async () => {
    const active = await makeKeyRecord(30);
    const owner = "legacy-invalid-owner";
    active.envelope.user_id = owner;
    installLegacyKeys([{ ...active, privateKeyJwk: {} }]);
    const original = localStorage.getItem("gmed_chat_e2e_keyring_v1");
    apiFetchMock.mockResolvedValueOnce(active.envelope);
    await expect(importLegacyMessageKeys(owner)).rejects.toThrow();
    expect(localStorage.getItem("gmed_chat_e2e_keyring_v1")).toBe(original);
    expect(await getLocalMessageKey(owner, active.local.fingerprint)).toBeNull();
  });

  it("opens an old end-to-end attachment with the recipient's key", async () => {
    const [sender, recipient] = await Promise.all([1, 2].map(makeKeyRecord));
    const sealed = await encryptLikeTheOldChat(new TextEncoder().encode("secure attachment bytes"), sender.local, recipient.envelope);
    const decrypted = await decryptAttachmentFromPeer({
      attachment_is_e2e: true, attachment_e2e_algorithm: CHAT_E2E_ALGORITHM,
      attachment_e2e_nonce: sealed.nonce, attachment_e2e_salt: sealed.salt,
    }, sealed.ciphertext, recipient.local, sender.envelope);
    expect(new TextDecoder().decode(decrypted)).toBe("secure attachment bytes");
  });

  it("rejects a server key whose fingerprint does not match its public key", async () => {
    const [genuine, other] = await Promise.all([40, 41].map(makeKeyRecord));
    genuine.envelope.user_id = "peer-user";
    apiFetchMock.mockResolvedValueOnce({ ...genuine.envelope, public_key: other.envelope.public_key });
    await expect(fetchMessageKeyByFingerprint("peer-user", genuine.local.fingerprint)).rejects.toThrow(/fingerprint/);
    apiFetchMock.mockResolvedValueOnce(genuine.envelope);
    await expect(fetchMessageKeyByFingerprint("peer-user", genuine.local.fingerprint)).resolves.toEqual(genuine.envelope);
    expect(apiFetchMock.mock.calls.at(-1)?.[0]).toBe(
      `/messages/e2e-key/peer-user?fingerprint=${genuine.local.fingerprint}`,
    );
  });

  it("does not expose one account's device key through another account", async () => {
    const own = await makeKeyRecord(50);
    const owner = "legacy-account-owner";
    own.envelope.user_id = owner;
    installLegacyKeys([own]);
    apiFetchMock.mockResolvedValueOnce(own.envelope);
    await importLegacyMessageKeys(owner);
    expect(await getLocalMessageKey(owner, own.local.fingerprint)).not.toBeNull();
    expect(await getLocalMessageKey("different-user", own.local.fingerprint)).toBeNull();
  });
});
