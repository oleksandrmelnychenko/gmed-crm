import { apiFetch } from "@/lib/api";
import { uiText } from "@/lib/i18n";

export const CHAT_E2E_ALGORITHM = "p256-hkdf-aes256gcm-v1";
export const CHAT_E2E_PREVIEW = uiText("chat_e2e_preview");
export const CHAT_E2E_UNAVAILABLE = uiText("chat_e2e_unavailable");

const LEGACY_STORAGE_KEY = "gmed_chat_e2e_keyring_v1";
const PEER_PIN_STORAGE_PREFIX = "gmed_chat_e2e_peer_pins_v1:";
const KEY_DATABASE_NAME = "gmed-chat-e2e-v2";
const KEY_DATABASE_VERSION = 1;
const KEY_STORE = "message-keys";
const META_STORE = "key-meta";
const HKDF_INFO = new TextEncoder().encode("gmed-chat-e2e-v1");
const ensureServerMessageKeyPromises = new Map<string, Promise<MessageKeyRecord>>();

export interface MessageKeyRecord {
  ownerUserId: string;
  algorithm: string;
  fingerprint: string;
  publicKey: string;
  privateKey: CryptoKey;
  createdAt: string;
}

export interface MessageKeyEnvelope {
  id: string;
  user_id: string;
  fingerprint: string;
  algorithm: string;
  public_key: string;
  is_active: boolean;
  created_at: string;
}

export interface E2EMessageEnvelope {
  is_e2e?: boolean;
  e2e_algorithm?: string | null;
  e2e_ciphertext?: string | null;
  e2e_nonce?: string | null;
  e2e_salt?: string | null;
  sender_key_fingerprint?: string | null;
  recipient_key_fingerprint?: string | null;
}

export interface E2EAttachmentEnvelope {
  attachment_is_e2e?: boolean;
  attachment_e2e_algorithm?: string | null;
  attachment_e2e_nonce?: string | null;
  attachment_e2e_salt?: string | null;
  sender_key_fingerprint?: string | null;
  recipient_key_fingerprint?: string | null;
}

type StoredKeyMeta = {
  ownerUserId: string;
  activeFingerprint: string | null;
};

type LegacyMessageKeyRecord = Omit<MessageKeyRecord, "ownerUserId" | "privateKey"> & {
  privateKeyJwk: JsonWebKey;
};

type LegacyMessageKeyRing = {
  activeFingerprint: string | null;
  keys: Record<string, LegacyMessageKeyRecord>;
};

const memoryKeys = new Map<string, MessageKeyRecord>();
const memoryMeta = new Map<string, StoredKeyMeta>();

function keyId(ownerUserId: string, fingerprint: string) {
  return `${ownerUserId}:${fingerprint}`;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Secure key storage failed"));
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Secure key storage failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Secure key storage aborted"));
  });
}

async function openKeyDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  const request = indexedDB.open(KEY_DATABASE_NAME, KEY_DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(KEY_STORE)) {
      database.createObjectStore(KEY_STORE, { keyPath: ["ownerUserId", "fingerprint"] });
    }
    if (!database.objectStoreNames.contains(META_STORE)) {
      database.createObjectStore(META_STORE, { keyPath: "ownerUserId" });
    }
  };
  return requestResult(request);
}

async function getStoredKey(ownerUserId: string, fingerprint: string) {
  const database = await openKeyDatabase();
  if (!database) return memoryKeys.get(keyId(ownerUserId, fingerprint)) ?? null;
  try {
    const transaction = database.transaction(KEY_STORE, "readonly");
    const result = await requestResult(
      transaction.objectStore(KEY_STORE).get([ownerUserId, fingerprint]),
    );
    return (result as MessageKeyRecord | undefined) ?? null;
  } finally {
    database.close();
  }
}

async function getStoredMeta(ownerUserId: string) {
  const database = await openKeyDatabase();
  if (!database) return memoryMeta.get(ownerUserId) ?? null;
  try {
    const transaction = database.transaction(META_STORE, "readonly");
    const result = await requestResult(transaction.objectStore(META_STORE).get(ownerUserId));
    return (result as StoredKeyMeta | undefined) ?? null;
  } finally {
    database.close();
  }
}

async function storeMessageKey(record: MessageKeyRecord, makeActive: boolean) {
  const database = await openKeyDatabase();
  const meta: StoredKeyMeta = {
    ownerUserId: record.ownerUserId,
    activeFingerprint: makeActive
      ? record.fingerprint
      : (await getStoredMeta(record.ownerUserId))?.activeFingerprint ?? null,
  };
  if (!database) {
    memoryKeys.set(keyId(record.ownerUserId, record.fingerprint), record);
    memoryMeta.set(record.ownerUserId, meta);
    return;
  }
  try {
    const transaction = database.transaction([KEY_STORE, META_STORE], "readwrite");
    transaction.objectStore(KEY_STORE).put(record);
    transaction.objectStore(META_STORE).put(meta);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let idx = 0; idx < binary.length; idx += 1) {
    bytes[idx] = binary.charCodeAt(idx);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function fingerprintPublicKey(publicKeyBytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", toBufferSource(publicKeyBytes));
  return bytesToHex(new Uint8Array(digest));
}

async function generateLocalMessageKey(ownerUserId: string): Promise<MessageKeyRecord> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"],
  );
  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("spki", keyPair.publicKey),
  );
  const privateKeyJwk = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.privateKey,
  )) as JsonWebKey;
  const privateKey = await importPrivateKey(privateKeyJwk);
  const fingerprint = await fingerprintPublicKey(publicKeyBytes);

  return {
    ownerUserId,
    algorithm: CHAT_E2E_ALGORITHM,
    fingerprint,
    publicKey: bytesToBase64(publicKeyBytes),
    privateKey,
    createdAt: new Date().toISOString(),
  };
}

async function importPrivateKey(privateKeyJwk: JsonWebKey) {
  return crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false,
    ["deriveBits"],
  );
}

async function importPublicKey(publicKeyBase64: string) {
  return crypto.subtle.importKey(
    "spki",
    base64ToBytes(publicKeyBase64),
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false,
    [],
  );
}

async function deriveMessageKey(
  privateKey: CryptoKey,
  peerPublicKeyBase64: string,
  salt: Uint8Array,
  usage: KeyUsage,
) {
  const peerPublicKey = await importPublicKey(peerPublicKeyBase64);
  const sharedBits = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: peerPublicKey,
    },
    privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toBufferSource(salt),
      info: HKDF_INFO,
    },
    hkdfKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    [usage],
  );
}

async function decryptEnvelopeBytes(
  ciphertextBase64: string,
  nonceBase64: string,
  saltBase64: string,
  algorithm: string,
  myKey: MessageKeyRecord,
  peerKey: MessageKeyEnvelope,
) {
  if (algorithm !== CHAT_E2E_ALGORITHM) {
    throw new Error("Unsupported E2E algorithm");
  }

  const salt = base64ToBytes(saltBase64);
  const nonce = base64ToBytes(nonceBase64);
  const ciphertext = base64ToBytes(ciphertextBase64);
  const aesKey = await deriveMessageKey(
    myKey.privateKey,
    peerKey.public_key,
    salt,
    "decrypt",
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce,
    },
    aesKey,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

function isNotFoundError(error: unknown) {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("not found") || message.includes("404");
}

async function validateMessageKeyEnvelope(
  envelope: MessageKeyEnvelope,
  expectedUserId: string,
  requireActive: boolean,
) {
  if (
    !envelope ||
    envelope.user_id !== expectedUserId ||
    envelope.algorithm !== CHAT_E2E_ALGORITHM ||
    typeof envelope.public_key !== "string" ||
    typeof envelope.fingerprint !== "string" ||
    (requireActive && envelope.is_active !== true)
  ) {
    throw new Error("Invalid server message key identity");
  }
  const computedFingerprint = await fingerprintPublicKey(
    base64ToBytes(envelope.public_key),
  );
  if (computedFingerprint !== envelope.fingerprint) {
    throw new Error("Server message key fingerprint mismatch");
  }
  return envelope;
}

async function fetchMyServerMessageKey(ownerUserId: string) {
  try {
    const envelope = await apiFetch<MessageKeyEnvelope>("/messages/e2e-key");
    return await validateMessageKeyEnvelope(envelope, ownerUserId, true);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function migrateLegacyMessageKey(
  ownerUserId: string,
  serverKey: MessageKeyEnvelope | null,
) {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw || !serverKey) return null;

  try {
    const ring = JSON.parse(raw) as LegacyMessageKeyRing;
    const legacy = ring.keys?.[serverKey.fingerprint];
    if (
      !legacy ||
      legacy.fingerprint !== serverKey.fingerprint ||
      legacy.publicKey !== serverKey.public_key ||
      legacy.algorithm !== CHAT_E2E_ALGORITHM
    ) {
      return null;
    }
    const computedFingerprint = await fingerprintPublicKey(
      base64ToBytes(legacy.publicKey),
    );
    if (computedFingerprint !== legacy.fingerprint) return null;
    const migrated: MessageKeyRecord = {
      ownerUserId,
      algorithm: legacy.algorithm,
      fingerprint: legacy.fingerprint,
      publicKey: legacy.publicKey,
      privateKey: await importPrivateKey(legacy.privateKeyJwk),
      createdAt: legacy.createdAt,
    };
    await storeMessageKey(migrated, true);
    return migrated;
  } catch {
    return null;
  }
}

async function ensureServerMessageKeyOnce(ownerUserId: string): Promise<MessageKeyRecord> {
  if (!ownerUserId) throw new Error("Authenticated user is required for secure chat");

  const serverExisting = await fetchMyServerMessageKey(ownerUserId);
  const meta = await getStoredMeta(ownerUserId);
  let active = meta?.activeFingerprint
    ? await getStoredKey(ownerUserId, meta.activeFingerprint)
    : null;
  if (!active && serverExisting) {
    active = await getStoredKey(ownerUserId, serverExisting.fingerprint);
  }
  if (!active) {
    active = await migrateLegacyMessageKey(ownerUserId, serverExisting);
  } else {
    // Plaintext v1 material must not survive once a user-bound key is available.
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage may be disabled; the secure IndexedDB key remains authoritative.
    }
  }
  if (!active) {
    active = await generateLocalMessageKey(ownerUserId);
    await storeMessageKey(active, true);
  }

  if (serverExisting?.fingerprint === active.fingerprint &&
      serverExisting.public_key === active.publicKey) return active;

  const serverKey = await apiFetch<MessageKeyEnvelope>("/messages/e2e-key", {
    method: "POST",
    body: JSON.stringify({
      algorithm: active.algorithm,
      public_key: active.publicKey,
    }),
  });
  await validateMessageKeyEnvelope(serverKey, ownerUserId, true);
  if (
    serverKey.fingerprint !== active.fingerprint ||
    serverKey.public_key !== active.publicKey
  ) {
    throw new Error("Server message key does not match this device");
  }
  await storeMessageKey(active, true);
  return active;
}

export async function ensureServerMessageKey(ownerUserId: string) {
  const pending = ensureServerMessageKeyPromises.get(ownerUserId);
  if (pending) return pending;

  // Coordinate first-time setup across tabs sharing the same IndexedDB store.
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const promise = locks
    ? locks.request(`gmed-chat-key:${ownerUserId}`, () => ensureServerMessageKeyOnce(ownerUserId))
    : ensureServerMessageKeyOnce(ownerUserId);
  ensureServerMessageKeyPromises.set(ownerUserId, promise);
  try {
    return await promise;
  } finally {
    ensureServerMessageKeyPromises.delete(ownerUserId);
  }
}

export async function getLocalMessageKey(
  ownerUserId: string,
  fingerprint?: string | null,
) {
  if (!ownerUserId) return null;
  if (fingerprint) return getStoredKey(ownerUserId, fingerprint);
  const meta = await getStoredMeta(ownerUserId);
  return meta?.activeFingerprint
    ? getStoredKey(ownerUserId, meta.activeFingerprint)
    : null;
}

type PeerPins = Record<string, string>;

function readPeerPins(ownerUserId: string): PeerPins {
  try {
    const value = JSON.parse(
      localStorage.getItem(`${PEER_PIN_STORAGE_PREFIX}${ownerUserId}`) ?? "{}",
    ) as unknown;
    return value && typeof value === "object" ? (value as PeerPins) : {};
  } catch {
    return {};
  }
}

function writePeerPin(ownerUserId: string, peerUserId: string, fingerprint: string) {
  const pins = readPeerPins(ownerUserId);
  localStorage.setItem(
    `${PEER_PIN_STORAGE_PREFIX}${ownerUserId}`,
    JSON.stringify({ ...pins, [peerUserId]: fingerprint }),
  );
}

export class PeerMessageKeyChangedError extends Error {
  readonly previousFingerprint: string;
  readonly candidate: MessageKeyEnvelope;

  constructor(
    previousFingerprint: string,
    candidate: MessageKeyEnvelope,
  ) {
    super("Peer secure-chat identity changed");
    this.name = "PeerMessageKeyChangedError";
    this.previousFingerprint = previousFingerprint;
    this.candidate = candidate;
  }
}

export async function fetchPeerMessageKey(
  ownerUserId: string,
  peerUserId: string,
  fingerprint?: string | null,
  expectedChangedFingerprint?: string | null,
): Promise<MessageKeyEnvelope | null> {
  const query = fingerprint ? `?fingerprint=${encodeURIComponent(fingerprint)}` : "";
  try {
    const raw = await apiFetch<MessageKeyEnvelope>(
      `/messages/e2e-key/${peerUserId}${query}`,
      { cache: "no-store" },
    );
    const envelope = await validateMessageKeyEnvelope(raw, peerUserId, !fingerprint);
    if (!fingerprint) {
      const previous = readPeerPins(ownerUserId)[peerUserId];
      const expected = expectedChangedFingerprint?.trim();
      if (expected && envelope.fingerprint !== expected) {
        throw new PeerMessageKeyChangedError(previous ?? expected, envelope);
      }
      if (previous && previous !== envelope.fingerprint && !expected) {
        throw new PeerMessageKeyChangedError(previous, envelope);
      }
      if (!previous || expected === envelope.fingerprint) {
        writePeerPin(ownerUserId, peerUserId, envelope.fingerprint);
      }
    }
    return envelope;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function encryptMessageForPeer(
  plaintext: string,
  senderKey: MessageKeyRecord,
  recipientKey: MessageKeyEnvelope,
) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveMessageKey(
    senderKey.privateKey,
    recipientKey.public_key,
    salt,
    "encrypt",
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
      },
      aesKey,
      new TextEncoder().encode(plaintext),
    ),
  );

  return {
    e2e_algorithm: CHAT_E2E_ALGORITHM,
    e2e_ciphertext: bytesToBase64(ciphertext),
    e2e_nonce: bytesToBase64(nonce),
    e2e_salt: bytesToBase64(salt),
    sender_key_fingerprint: senderKey.fingerprint,
    recipient_key_fingerprint: recipientKey.fingerprint,
  };
}

export async function encryptAttachmentForPeer(
  bytes: Uint8Array,
  senderKey: MessageKeyRecord,
  recipientKey: MessageKeyEnvelope,
) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveMessageKey(
    senderKey.privateKey,
    recipientKey.public_key,
    salt,
    "encrypt",
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
      },
      aesKey,
      toBufferSource(bytes),
    ),
  );

  return {
    ciphertext,
    attachment_e2e_algorithm: CHAT_E2E_ALGORITHM,
    attachment_e2e_nonce: bytesToBase64(nonce),
    attachment_e2e_salt: bytesToBase64(salt),
    sender_key_fingerprint: senderKey.fingerprint,
    recipient_key_fingerprint: recipientKey.fingerprint,
  };
}

export async function decryptMessageFromPeer(
  envelope: E2EMessageEnvelope,
  myKey: MessageKeyRecord,
  peerKey: MessageKeyEnvelope,
) {
  if (
    !envelope.e2e_ciphertext ||
    !envelope.e2e_nonce ||
    !envelope.e2e_salt ||
    !envelope.e2e_algorithm
  ) {
    throw new Error("Incomplete E2E envelope");
  }
  if (envelope.e2e_algorithm !== CHAT_E2E_ALGORITHM) {
    throw new Error("Unsupported E2E algorithm");
  }

  const plaintext = await decryptEnvelopeBytes(
    envelope.e2e_ciphertext,
    envelope.e2e_nonce,
    envelope.e2e_salt,
    envelope.e2e_algorithm,
    myKey,
    peerKey,
  );
  return new TextDecoder().decode(plaintext);
}

export async function decryptAttachmentFromPeer(
  envelope: E2EAttachmentEnvelope,
  ciphertext: Uint8Array,
  myKey: MessageKeyRecord,
  peerKey: MessageKeyEnvelope,
) {
  if (!(ciphertext instanceof Uint8Array) || ciphertext.length === 0) {
    throw new Error("Missing E2E attachment ciphertext");
  }
  if (
    !envelope.attachment_e2e_algorithm ||
    !envelope.attachment_e2e_nonce ||
    !envelope.attachment_e2e_salt
  ) {
    throw new Error("Incomplete E2E attachment envelope");
  }

  const plaintext = await decryptEnvelopeBytes(
    bytesToBase64(ciphertext),
    envelope.attachment_e2e_nonce,
    envelope.attachment_e2e_salt,
    envelope.attachment_e2e_algorithm,
    myKey,
    peerKey,
  );
  return plaintext;
}
