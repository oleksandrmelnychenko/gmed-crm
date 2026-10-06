import { apiFetch } from "@/lib/api";
import { uiText, type Lang } from "@/lib/i18n";

/**
 * Reader for the chat's former end-to-end encryption.
 *
 * End-to-end encryption was given up by the owner's decision of 2026-10-07:
 * messages and attachments are now encrypted at rest with the server's keys
 * and are readable on every device right after login. This module only opens
 * old end-to-end messages in a browser that still holds the device key it
 * created at the time, so the chat can hand them back to the server once
 * (see `pages/chat/model/e2e-rescue.ts`). It never creates or registers a
 * device key and cannot encrypt anything.
 */

export const CHAT_E2E_ALGORITHM = "p256-hkdf-aes256gcm-v1";

/** List preview of an old end-to-end message while it is being opened. */
export function chatE2EPreviewText(lang?: Lang) {
  return uiText("chat_e2e_preview", lang);
}

/** Placeholder for an old end-to-end message this browser cannot open. */
export function chatE2EUnavailableText(lang?: Lang) {
  return uiText("chat_e2e_unavailable", lang);
}

const LEGACY_STORAGE_KEY = "gmed_chat_e2e_keyring_v1";
const KEY_DATABASE_NAME = "gmed-chat-e2e-v2";
const KEY_DATABASE_VERSION = 1;
const KEY_STORE = "message-keys";
const META_STORE = "key-meta";
const HKDF_INFO = new TextEncoder().encode("gmed-chat-e2e-v1");

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

type LegacyMessageKeyRecord = Omit<MessageKeyRecord, "ownerUserId" | "privateKey"> & {
  privateKeyJwk: JsonWebKey;
};

type LegacyMessageKeyRing = {
  activeFingerprint: string | null;
  keys: Record<string, LegacyMessageKeyRecord>;
};

const memoryKeys = new Map<string, MessageKeyRecord>();
const legacyImports = new Map<string, Promise<void>>();

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
  // Same schema as the end-to-end chat used, so existing device keys open.
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

async function storeMessageKey(record: MessageKeyRecord) {
  const database = await openKeyDatabase();
  if (!database) {
    memoryKeys.set(keyId(record.ownerUserId, record.fingerprint), record);
    return;
  }
  try {
    const transaction = database.transaction(KEY_STORE, "readwrite");
    transaction.objectStore(KEY_STORE).put(record);
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

async function importPrivateKey(privateKeyJwk: JsonWebKey) {
  return crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}

async function importPublicKey(publicKeyBase64: string) {
  return crypto.subtle.importKey(
    "spki",
    base64ToBytes(publicKeyBase64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

async function deriveDecryptionKey(
  privateKey: CryptoKey,
  peerPublicKeyBase64: string,
  salt: Uint8Array,
) {
  const peerPublicKey = await importPublicKey(peerPublicKeyBase64);
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: toBufferSource(salt), info: HKDF_INFO },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
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
  const aesKey = await deriveDecryptionKey(
    myKey.privateKey,
    peerKey.public_key,
    base64ToBytes(saltBase64),
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(nonceBase64) },
    aesKey,
    base64ToBytes(ciphertextBase64),
  );
  return new Uint8Array(plaintext);
}

function isNotFoundError(error: unknown) {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("not found") || message.includes("404");
}

async function validateMessageKeyEnvelope(envelope: MessageKeyEnvelope, expectedUserId: string) {
  if (
    !envelope ||
    envelope.user_id !== expectedUserId ||
    envelope.algorithm !== CHAT_E2E_ALGORITHM ||
    typeof envelope.public_key !== "string" ||
    typeof envelope.fingerprint !== "string"
  ) {
    throw new Error("Invalid server message key identity");
  }
  const computedFingerprint = await fingerprintPublicKey(base64ToBytes(envelope.public_key));
  if (computedFingerprint !== envelope.fingerprint) {
    throw new Error("Server message key fingerprint mismatch");
  }
  return envelope;
}

/**
 * Looks up the public half of a device key that was registered for `userId`.
 * Historical keys are immutable, so a lookup by fingerprint is all an old
 * message needs. Returns null when the server has no such key.
 */
export async function fetchMessageKeyByFingerprint(
  userId: string,
  fingerprint: string,
): Promise<MessageKeyEnvelope | null> {
  try {
    const envelope = await apiFetch<MessageKeyEnvelope>(
      `/messages/e2e-key/${encodeURIComponent(userId)}?fingerprint=${encodeURIComponent(fingerprint)}`,
      { cache: "no-store" },
    );
    await validateMessageKeyEnvelope(envelope, userId);
    if (envelope.fingerprint !== fingerprint) {
      throw new Error("Server message key fingerprint mismatch");
    }
    return envelope;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function importLegacyMessageKeysOnce(ownerUserId: string) {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  let ring: LegacyMessageKeyRing;
  try {
    ring = JSON.parse(raw) as LegacyMessageKeyRing;
    if (!ring?.keys || typeof ring.keys !== "object" || Array.isArray(ring.keys)) return;
  } catch {
    return;
  }

  const remaining = { ...ring.keys };
  let importError: unknown;
  for (const [fingerprint, legacy] of Object.entries(ring.keys)) {
    try {
      if (!legacy || legacy.fingerprint !== fingerprint || legacy.algorithm !== CHAT_E2E_ALGORITHM ||
          await fingerprintPublicKey(base64ToBytes(legacy.publicKey)) !== fingerprint) continue;
      // The first key ring was not bound to an account: import a key only
      // when the server registered it for this account.
      const registered = await fetchMessageKeyByFingerprint(ownerUserId, fingerprint);
      if (!registered || registered.public_key !== legacy.publicKey) continue;
      await storeMessageKey({
        ownerUserId,
        algorithm: legacy.algorithm,
        fingerprint,
        publicKey: legacy.publicKey,
        privateKey: await importPrivateKey(legacy.privateKeyJwk),
        createdAt: legacy.createdAt,
      });
      delete remaining[fingerprint];
    } catch (error) {
      // Keep the only copy when verification or durable storage fails.
      importError = error;
    }
  }
  try {
    if (localStorage.getItem(LEGACY_STORAGE_KEY) === raw) {
      if (Object.keys(remaining).length === 0) localStorage.removeItem(LEGACY_STORAGE_KEY);
      else localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ ...ring, keys: remaining }));
    }
  } catch {
    // Imported copies are already durable; cleanup is retried on the next import.
  }
  if (importError) throw importError;
}

/**
 * Moves device keys of the first chat version from local storage into the
 * protected key store, so their old messages can still be opened. Runs once
 * per account and page session; a failed import is retried on the next call.
 */
export function importLegacyMessageKeys(ownerUserId: string) {
  if (!ownerUserId) return Promise.resolve();
  const pending = legacyImports.get(ownerUserId);
  if (pending) return pending;
  const promise = importLegacyMessageKeysOnce(ownerUserId).catch((error: unknown) => {
    legacyImports.delete(ownerUserId);
    throw error;
  });
  legacyImports.set(ownerUserId, promise);
  return promise;
}

/** The private device key this browser holds for an old message, if any. */
export async function getLocalMessageKey(ownerUserId: string, fingerprint: string | null | undefined) {
  if (!ownerUserId || !fingerprint) return null;
  return getStoredKey(ownerUserId, fingerprint);
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
  return decryptEnvelopeBytes(
    bytesToBase64(ciphertext),
    envelope.attachment_e2e_nonce,
    envelope.attachment_e2e_salt,
    envelope.attachment_e2e_algorithm,
    myKey,
    peerKey,
  );
}
