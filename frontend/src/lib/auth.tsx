import { createContext, use, useEffect, useReducer, type ReactNode } from "react";

import {
  AUTH_SESSION_EXPIRED_EVENT,
  buildApiUrl,
  clearApiCache,
  fetchWithApiTimeout,
} from "@/lib/api";
import { clearSecurePersistedState } from "@/lib/secure-persist";

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkPending: (pendingId: string) => Promise<PendingLoginStatus>;
}

type PendingLoginStatus = "pending" | "approved" | "rejected" | "error";

interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface PendingLoginResponse {
  status: "mfa_pending";
  pending_id: string;
  message?: string;
}

export class PendingLoginError extends Error {
  pendingId: string;
  constructor(pendingId: string, message?: string) {
    super(message ?? "Login requires admin approval");
    this.pendingId = pendingId;
  }
}

interface ApiErrorBody {
  error?: string;
  message?: string;
  status?: string;
}

type AuthState = {
  user: User | null;
  loading: boolean;
};

type AuthStatePatch =
  | Partial<AuthState>
  | ((current: AuthState) => Partial<AuthState>);

const AuthContext = createContext<AuthContextValue | null>(null);

const ACCESS_TOKEN_KEY = "gmed_access_token";
const REFRESH_TOKEN_KEY = "gmed_refresh_token";

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be inside AuthProvider");
  }
  return ctx;
}

function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function saveTokens(tokens: AuthTokens) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  clearApiCache();
}

function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  clearApiCache();
  clearSecurePersistedState();
}

function isPendingLoginResponse(
  value: AuthTokens | PendingLoginResponse
): value is PendingLoginResponse {
  return "status" in value && value.status === "mfa_pending";
}

async function parseError(response: Response) {
  const body = await response.json().catch(() => null) as ApiErrorBody | null;

  const message =
    body?.message ??
    body?.error ??
    `${response.status} ${response.statusText || "Request failed"}`;

  throw new Error(message);
}

async function fetchJson<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string | null
): Promise<T> {
  const headers = new Headers(init.headers);

  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetchWithApiTimeout(buildApiUrl(path), {
    ...init,
    headers,
  });

  if (!response.ok) {
    await parseError(response);
  }

  return (await response.json()) as T;
}

async function fetchMe(accessToken: string) {
  return fetchJson<User>("/me", { method: "GET" }, accessToken);
}

async function refreshSession() {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    return null;
  }

  const tokens = await fetchJson<AuthTokens>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  saveTokens(tokens);
  return tokens.access_token;
}

function createAuthState(): AuthState {
  return {
    user: null,
    loading: true,
  };
}

function authStateReducer(state: AuthState, patch: AuthStatePatch): AuthState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, dispatchAuthState] = useReducer(
    authStateReducer,
    undefined,
    createAuthState,
  );
  const { user, loading } = authState;

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const accessToken = getAccessToken();

      if (!accessToken) {
        if (!cancelled) {
          dispatchAuthState({ loading: false });
        }
        return;
      }

      let nextUser: User | null = null;

      try {
        nextUser = await fetchMe(accessToken);
      } catch {
        try {
          const refreshedAccessToken = await refreshSession();
          if (!refreshedAccessToken) {
            throw new Error("Missing refresh token");
          }

          nextUser = await fetchMe(refreshedAccessToken);
        } catch {
          clearTokens();
          nextUser = null;
        }
      }

      if (!cancelled) {
        dispatchAuthState({ user: nextUser, loading: false });
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      clearTokens();
      dispatchAuthState({ user: null, loading: false });
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  const login = async (email: string, password: string) => {
    const result = await fetchJson<AuthTokens | PendingLoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (isPendingLoginResponse(result)) {
      throw new PendingLoginError(result.pending_id, result.message);
    }

    saveTokens(result);
    const me = await fetchMe(result.access_token);
    dispatchAuthState({ user: me });
  };

  const checkPending = async (pendingId: string): Promise<PendingLoginStatus> => {
    try {
      const result = await fetchJson<{ status: string; access_token?: string; refresh_token?: string }>(
        `/auth/pending/${pendingId}`,
        { method: "GET" },
      );
      if (result.status === "approved" && result.access_token && result.refresh_token) {
        saveTokens({ access_token: result.access_token, refresh_token: result.refresh_token, token_type: "Bearer", expires_in: 900 });
        const me = await fetchMe(result.access_token);
        dispatchAuthState({ user: me });
        return "approved";
      }
      if (result.status === "rejected") return "rejected";
      return "pending";
    } catch {
      return "error";
    }
  };

  const logout = async () => {
    const accessToken = getAccessToken();

    try {
      await fetchWithApiTimeout(buildApiUrl("/auth/logout"), {
        method: "POST",
        headers: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
      });
    } catch {
      // Ignore network errors on logout and clear local session anyway.
    } finally {
      clearTokens();
      dispatchAuthState({ user: null });
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, checkPending }}>
      {children}
    </AuthContext.Provider>
  );
}
