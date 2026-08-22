import { Capacitor, registerPlugin } from "@capacitor/core";

export const ACCESS_TOKEN_KEY = "gmed_access_token";
export const REFRESH_TOKEN_KEY = "gmed_refresh_token";

type AuthSession = {
  accessToken: string | null;
  refreshToken: string | null;
};

interface GmedSecureStoragePlugin {
  getSession(): Promise<{ accessToken?: string; refreshToken?: string }>;
  setSession(options: { accessToken: string; refreshToken: string }): Promise<void>;
  clearSession(): Promise<void>;
}

const SecureStorage = registerPlugin<GmedSecureStoragePlugin>("GmedSecureStorage");

let nativeSession: AuthSession = {
  accessToken: null,
  refreshToken: null,
};

function usesAndroidKeystore() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function readLegacyBrowserSession(): AuthSession {
  if (typeof localStorage === "undefined") {
    return { accessToken: null, refreshToken: null };
  }
  return {
    accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
  };
}

function clearLegacyBrowserSession() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export async function initializeAuthStorage() {
  if (!usesAndroidKeystore()) return;

  let stored: { accessToken?: string; refreshToken?: string };
  try {
    stored = await SecureStorage.getSession();
  } catch {
    // Fail closed on a corrupt/restored Keystore entry. The native plugin has
    // already removed the unreadable ciphertext, so start with a logged-out UI.
    nativeSession = { accessToken: null, refreshToken: null };
    clearLegacyBrowserSession();
    return;
  }
  const accessToken = stored.accessToken ?? null;
  const refreshToken = stored.refreshToken ?? null;

  if (accessToken && refreshToken) {
    nativeSession = { accessToken, refreshToken };
    clearLegacyBrowserSession();
    return;
  }

  // One-time migration for debug installs created before Keystore storage existed.
  const legacy = readLegacyBrowserSession();
  clearLegacyBrowserSession();
  if (legacy.accessToken && legacy.refreshToken) {
    await SecureStorage.setSession({
      accessToken: legacy.accessToken,
      refreshToken: legacy.refreshToken,
    });
    nativeSession = legacy;
    return;
  }

  nativeSession = { accessToken: null, refreshToken: null };
}

export function getStoredAccessToken() {
  if (usesAndroidKeystore()) return nativeSession.accessToken;
  return typeof localStorage === "undefined"
    ? null
    : localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getStoredRefreshToken() {
  if (usesAndroidKeystore()) return nativeSession.refreshToken;
  return typeof localStorage === "undefined"
    ? null
    : localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function hasStoredAuthTokens() {
  return Boolean(getStoredAccessToken() || getStoredRefreshToken());
}

export async function persistAuthTokens(accessToken: string, refreshToken: string) {
  if (usesAndroidKeystore()) {
    await SecureStorage.setSession({ accessToken, refreshToken });
    nativeSession = { accessToken, refreshToken };
    clearLegacyBrowserSession();
    return;
  }

  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export async function clearPersistedAuthTokens() {
  if (usesAndroidKeystore()) {
    // Clear memory immediately so no request can reuse a logged-out session.
    nativeSession = { accessToken: null, refreshToken: null };
    clearLegacyBrowserSession();
    await SecureStorage.clearSession();
    return;
  }

  clearLegacyBrowserSession();
}
