import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(
    async (
      path: string,
      init?: {
        body?: string;
      },
    ) => {
      if (path === "/messages/e2e-key" && !init?.body) {
        throw new Error("404 not found");
      }
      const body = JSON.parse(init?.body ?? "{}") as {
        algorithm: string;
        public_key: string;
      };
      const binary = atob(body.public_key);
      const publicKey = new Uint8Array(binary.length);
      for (let idx = 0; idx < binary.length; idx += 1) {
        publicKey[idx] = binary.charCodeAt(idx);
      }
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", publicKey),
      );
      const fingerprint = Array.from(digest)
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");

      return {
        id: crypto.randomUUID(),
        user_id: path.includes("peer-user") ? "peer-user" : "owner-user",
        fingerprint,
        algorithm: body.algorithm,
        public_key: body.public_key,
        is_active: true,
        created_at: new Date().toISOString(),
      };
    },
  ),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
}));

import {
  CHAT_E2E_ALGORITHM,
  decryptAttachmentFromPeer,
  decryptMessageFromPeer,
  encryptAttachmentForPeer,
  encryptMessageForPeer,
  ensureServerMessageKey,
  fetchPeerMessageKey,
  getLocalMessageKey,
  PeerMessageKeyChangedError,
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

async function makeKeyRecord(seed: Uint8Array): Promise<{
  local: MessageKeyRecord;
  envelope: MessageKeyEnvelope;
  privateKeyJwk: JsonWebKey;
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
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", publicKey),
  );
  const fingerprint = Array.from(digest)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const publicKeyBase64 = btoa(String.fromCharCode(...publicKey));
  const createdAt = new Date(Date.UTC(2026, 3, seed[0] ?? 0, 10, 0, 0)).toISOString();

  return {
    privateKeyJwk,
    local: {
      ownerUserId: `owner-${seed[0] ?? 0}`,
      algorithm: CHAT_E2E_ALGORITHM,
      fingerprint,
      publicKey: publicKeyBase64,
      privateKey,
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
  apiFetchMock.mockClear();
});

describe("secure chat server key setup", () => {
  it("deduplicates concurrent first-run key registration", async () => {
    const [first, second] = await Promise.all([
      ensureServerMessageKey("owner-user"),
      ensureServerMessageKey("owner-user"),
    ]);

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(
      apiFetchMock.mock.calls.filter(([, init]) => Boolean(init?.body)),
    ).toHaveLength(1);

    expect(first.privateKey.extractable).toBe(false);
    expect(await getLocalMessageKey("owner-user", first.fingerprint)).toBeTruthy();
    expect(localStorage.getItem("gmed_chat_e2e_keyring_v1")).toBeNull();
  });

  it("reuses a matching server registration without rotating or posting it again", async () => {
    const local = await ensureServerMessageKey("owner-user");
    apiFetchMock.mockClear();
    apiFetchMock.mockResolvedValueOnce({
      id: "existing", user_id: "owner-user", algorithm: local.algorithm,
      public_key: local.publicKey, fingerprint: local.fingerprint,
      is_active: true, created_at: local.createdAt,
    });
    const reused = await ensureServerMessageKey("owner-user");
    expect(reused.fingerprint).toBe(local.fingerprint);
    expect(apiFetchMock.mock.calls.filter(([, init]) => Boolean(init?.body))).toHaveLength(0);
  });
});

describe("secure chat legacy key preservation", () => {
  function installLegacyKeys(keys: Awaited<ReturnType<typeof makeKeyRecord>>[]) {
    localStorage.setItem("gmed_chat_e2e_keyring_v1", JSON.stringify({
      activeFingerprint: keys.at(-1)!.local.fingerprint,
      keys: Object.fromEntries(keys.map(({ local, privateKeyJwk }) => [local.fingerprint, {
        algorithm: local.algorithm, fingerprint: local.fingerprint, publicKey: local.publicKey,
        createdAt: local.createdAt, privateKeyJwk,
      }])),
    }));
  }

  it("migrates inactive history as well as the active key and can decrypt both", async () => {
    const [old, active, peer] = await Promise.all([21, 22, 23].map(seed => makeKeyRecord(new Uint8Array([seed]))));
    const owner = "migration-history-owner";
    old.envelope = { ...old.envelope, user_id: owner, is_active: false };
    active.envelope.user_id = owner;
    installLegacyKeys([old, active]);
    apiFetchMock.mockResolvedValueOnce(active.envelope).mockResolvedValueOnce(old.envelope);

    expect((await ensureServerMessageKey(owner)).fingerprint).toBe(active.local.fingerprint);
    for (const original of [old, active]) {
      const key = (await getLocalMessageKey(owner, original.local.fingerprint))!;
      expect(key.privateKey.extractable).toBe(false);
      const encrypted = await encryptMessageForPeer("Preserved history", peer.local, original.envelope);
      expect(await decryptMessageFromPeer(encrypted, key, peer.envelope)).toBe("Preserved history");
    }
    expect(localStorage.getItem("gmed_chat_e2e_keyring_v1")).toBeNull();
    expect(apiFetchMock.mock.calls.filter(([, init]) => Boolean(init?.body))).toHaveLength(0);
  });

  it("migrates remaining history even when this account already has a secure key", async () => {
    const [active, old] = await Promise.all([24, 25].map(seed => makeKeyRecord(new Uint8Array([seed]))));
    const owner = "migration-existing-owner";
    active.envelope.user_id = owner;
    old.envelope = { ...old.envelope, user_id: owner, is_active: false };
    installLegacyKeys([active]);
    apiFetchMock.mockResolvedValueOnce(active.envelope);
    await ensureServerMessageKey(owner);
    installLegacyKeys([old]);
    apiFetchMock.mockResolvedValueOnce(active.envelope).mockResolvedValueOnce(old.envelope);

    expect((await ensureServerMessageKey(owner)).fingerprint).toBe(active.local.fingerprint);
    expect(await getLocalMessageKey(owner, old.local.fingerprint)).not.toBeNull();
    expect(localStorage.getItem("gmed_chat_e2e_keyring_v1")).toBeNull();
  });

  it("does not import or delete another account's legacy keys", async () => {
    const [active, foreign] = await Promise.all([26, 27].map(seed => makeKeyRecord(new Uint8Array([seed]))));
    const owner = "migration-isolated-owner";
    active.envelope.user_id = owner;
    installLegacyKeys([active, foreign]);
    apiFetchMock.mockResolvedValueOnce(active.envelope).mockRejectedValueOnce(new Error("404 not found"));

    await ensureServerMessageKey(owner);
    expect(await getLocalMessageKey(owner, foreign.local.fingerprint)).toBeNull();
    const remaining = JSON.parse(localStorage.getItem("gmed_chat_e2e_keyring_v1")!);
    expect(Object.keys(remaining.keys)).toEqual([foreign.local.fingerprint]);
  });

  it("preserves unverified keys on lookup failure and retries without creating a replacement", async () => {
    const [old, remote] = await Promise.all([28, 29].map(seed => makeKeyRecord(new Uint8Array([seed]))));
    const owner = "migration-retry-owner";
    old.envelope = { ...old.envelope, user_id: owner, is_active: false };
    remote.envelope.user_id = owner;
    installLegacyKeys([old]);
    const original = localStorage.getItem("gmed_chat_e2e_keyring_v1");
    apiFetchMock.mockResolvedValueOnce(remote.envelope).mockRejectedValueOnce(new Error("Offline"));
    await expect(ensureServerMessageKey(owner)).rejects.toThrow("Offline");
    expect(localStorage.getItem("gmed_chat_e2e_keyring_v1")).toBe(original);
    expect(apiFetchMock.mock.calls.filter(([, init]) => Boolean(init?.body))).toHaveLength(0);

    apiFetchMock.mockResolvedValueOnce(remote.envelope).mockResolvedValueOnce(old.envelope)
      .mockResolvedValueOnce({ ...old.envelope, is_active: true });
    expect((await ensureServerMessageKey(owner)).fingerprint).toBe(old.local.fingerprint);
    expect(localStorage.getItem("gmed_chat_e2e_keyring_v1")).toBeNull();
  });

  it("keeps the original material when private key import fails", async () => {
    const active = await makeKeyRecord(new Uint8Array([30]));
    const owner = "migration-invalid-owner";
    active.envelope.user_id = owner;
    installLegacyKeys([{ ...active, privateKeyJwk: {} }]);
    const original = localStorage.getItem("gmed_chat_e2e_keyring_v1");
    apiFetchMock.mockResolvedValueOnce(active.envelope);
    await expect(ensureServerMessageKey(owner)).rejects.toThrow();
    expect(localStorage.getItem("gmed_chat_e2e_keyring_v1")).toBe(original);
    expect(await getLocalMessageKey(owner, active.local.fingerprint)).toBeNull();
    expect(apiFetchMock.mock.calls.filter(([, init]) => Boolean(init?.body))).toHaveLength(0);
  });

  it("keeps an already verified device usable while historical-key verification is offline", async () => {
    const [active, old] = await Promise.all([33, 34].map(seed => makeKeyRecord(new Uint8Array([seed]))));
    const owner = "migration-available-owner";
    active.envelope.user_id = owner;
    installLegacyKeys([active]);
    apiFetchMock.mockResolvedValueOnce(active.envelope);
    await ensureServerMessageKey(owner);
    installLegacyKeys([old]);
    const original = localStorage.getItem("gmed_chat_e2e_keyring_v1");
    apiFetchMock.mockResolvedValueOnce(active.envelope).mockRejectedValueOnce(new Error("Offline"));
    expect((await ensureServerMessageKey(owner)).fingerprint).toBe(active.local.fingerprint);
    expect(localStorage.getItem("gmed_chat_e2e_keyring_v1")).toBe(original);
    expect(apiFetchMock.mock.calls.filter(([, init]) => Boolean(init?.body))).toHaveLength(0);
  });

  it("uses the current server key available locally without reactivating stale local metadata", async () => {
    const [old, active] = await Promise.all([31, 32].map(seed => makeKeyRecord(new Uint8Array([seed]))));
    const owner = "migration-current-owner";
    old.envelope.user_id = owner;
    active.envelope.user_id = owner;
    installLegacyKeys([old]);
    apiFetchMock.mockResolvedValueOnce(old.envelope);
    await ensureServerMessageKey(owner);
    installLegacyKeys([active]);
    apiFetchMock.mockResolvedValueOnce(active.envelope);
    expect((await ensureServerMessageKey(owner)).fingerprint).toBe(active.local.fingerprint);
    expect((await getLocalMessageKey(owner))?.fingerprint).toBe(active.local.fingerprint);
    expect(await getLocalMessageKey(owner, old.local.fingerprint)).not.toBeNull();
    expect(apiFetchMock.mock.calls.filter(([, init]) => Boolean(init?.body))).toHaveLength(0);
  });
});

describe("chat E2E attachments", () => {
  it("encrypts and decrypts attachment payloads for a peer", async () => {
    const [sender, recipient] = await Promise.all([
      makeKeyRecord(new Uint8Array([1])),
      makeKeyRecord(new Uint8Array([2])),
    ]);
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

describe("secure chat account isolation", () => {
  it("does not expose one account's device key through another account", async () => {
    const ownerKey = await ensureServerMessageKey("owner-user");
    expect(await getLocalMessageKey("different-user", ownerKey.fingerprint)).toBeNull();
  });
});

describe("secure chat peer identity confirmation", () => {
  it("does not pin a third key when the confirmed candidate changed in flight", async () => {
    const [first, second, third] = await Promise.all([
      makeKeyRecord(new Uint8Array([11])),
      makeKeyRecord(new Uint8Array([12])),
      makeKeyRecord(new Uint8Array([13])),
    ]);
    first.envelope.user_id = "peer-user";
    second.envelope.user_id = "peer-user";
    third.envelope.user_id = "peer-user";

    apiFetchMock.mockResolvedValueOnce(first.envelope);
    await expect(fetchPeerMessageKey("owner-user", "peer-user")).resolves.toEqual(
      first.envelope,
    );

    apiFetchMock.mockResolvedValueOnce(second.envelope);
    await expect(fetchPeerMessageKey("owner-user", "peer-user")).rejects.toBeInstanceOf(
      PeerMessageKeyChangedError,
    );

    apiFetchMock.mockResolvedValueOnce(third.envelope);
    await expect(
      fetchPeerMessageKey(
        "owner-user",
        "peer-user",
        null,
        second.envelope.fingerprint,
      ),
    ).rejects.toMatchObject({
      candidate: third.envelope,
    });

    apiFetchMock.mockResolvedValueOnce(third.envelope);
    await expect(fetchPeerMessageKey("owner-user", "peer-user")).rejects.toMatchObject({
      previousFingerprint: first.envelope.fingerprint,
      candidate: third.envelope,
    });
  });
});
