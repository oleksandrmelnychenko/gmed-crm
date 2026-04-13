import { apiFetch } from "@/lib/api";

export const CHAT_E2E_ALGORITHM = "p256-hkdf-aes256gcm-v1";
export const CHAT_E2E_PREVIEW = "[Encrypted message]";
export const CHAT_E2E_UNAVAILABLE = "[Encrypted message unavailable on this device]";

const STORAGE_KEY = "gmed_chat_e2e_keyring_v1";
const HKDF_INFO = new TextEncoder().encode("gmed-chat-e2e-v1");

export interface MessageKeyRecord {
  algorithm: string;
  fingerprint: string;
  publicKey: string;
  privateKeyJwk: JsonWebKey;
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

type MessageKeyRing = {
  activeFingerprint: string | null;
  keys: Record<string, MessageKeyRecord>;
};

function emptyKeyRing(): MessageKeyRing {
  return {
    activeFingerprint: null,
    keys: {},
  };
}

function readKeyRing(): MessageKeyRing {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyKeyRing();
    const parsed = JSON.parse(raw) as MessageKeyRing;
    if (!parsed || typeof parsed !== "object" || !parsed.keys) {
      return emptyKeyRing();
    }
    return {
      activeFingerprint:
        typeof parsed.activeFingerprint === "string" ? parsed.activeFingerprint : null,
      keys: parsed.keys,
    };
  } catch {
    return emptyKeyRing();
  }
}

function writeKeyRing(ring: MessageKeyRing) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ring));
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

async function generateLocalMessageKey(): Promise<MessageKeyRecord> {
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
  const fingerprint = await fingerprintPublicKey(publicKeyBytes);

  return {
    algorithm: CHAT_E2E_ALGORITHM,
    fingerprint,
    publicKey: bytesToBase64(publicKeyBytes),
    privateKeyJwk,
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
  privateKeyJwk: JsonWebKey,
  peerPublicKeyBase64: string,
  salt: Uint8Array,
  usage: KeyUsage,
) {
  const privateKey = await importPrivateKey(privateKeyJwk);
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

export async function ensureServerMessageKey(): Promise<MessageKeyRecord> {
  let ring = readKeyRing();
  let active =
    (ring.activeFingerprint && ring.keys[ring.activeFingerprint]) || null;
  if (!active) {
    active = await generateLocalMessageKey();
    ring = {
      activeFingerprint: active.fingerprint,
      keys: {
        ...ring.keys,
        [active.fingerprint]: active,
      },
    };
    writeKeyRing(ring);
  }

  const serverKey = await apiFetch<MessageKeyEnvelope>("/messages/e2e-key", {
    method: "POST",
    body: JSON.stringify({
      algorithm: active.algorithm,
      public_key: active.publicKey,
    }),
  });

  if (serverKey.fingerprint !== active.fingerprint) {
    throw new Error("Server message key fingerprint mismatch");
  }

  return active;
}

export function getLocalMessageKey(fingerprint?: string | null) {
  const ring = readKeyRing();
  if (!fingerprint) {
    return ring.activeFingerprint ? ring.keys[ring.activeFingerprint] ?? null : null;
  }
  return ring.keys[fingerprint] ?? null;
}

export async function fetchPeerMessageKey(
  userId: string,
  fingerprint?: string | null,
): Promise<MessageKeyEnvelope | null> {
  const query = fingerprint ? `?fingerprint=${encodeURIComponent(fingerprint)}` : "";
  try {
    return await apiFetch<MessageKeyEnvelope>(`/messages/e2e-key/${userId}${query}`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes("not found") || message.includes("404")) {
      return null;
    }
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
    senderKey.privateKeyJwk,
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

  const salt = base64ToBytes(envelope.e2e_salt);
  const nonce = base64ToBytes(envelope.e2e_nonce);
  const ciphertext = base64ToBytes(envelope.e2e_ciphertext);
  const aesKey = await deriveMessageKey(
    myKey.privateKeyJwk,
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
  return new TextDecoder().decode(plaintext);
}
