import {
  useEffect,
  useReducer,
  type FormEvent,
  type SetStateAction,
} from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Globe, AlertCircle, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth, PendingLoginError } from "@/lib/auth";
import { useLang } from "@/lib/i18n";

function LogoMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 76 65"
      className="size-8 text-primary"
      fill="none"
    >
      <path d="M37.53 0 75.05 65H0L37.53 0Z" fill="currentColor" />
    </svg>
  );
}

type LoginFieldErrors = {
  email?: string;
  password?: string;
};

type PendingLoginState = {
  id: string;
  status: "pending" | "rejected";
} | null;

type LoginState = {
  email: string;
  password: string;
  error: string;
  loading: boolean;
  fieldErrors: LoginFieldErrors;
  pendingLogin: PendingLoginState;
};

type LoginStatePatch =
  | Partial<LoginState>
  | ((current: LoginState) => Partial<LoginState>);

function createLoginState(): LoginState {
  return {
    email: "admin@gmed.de",
    password: "admin123",
    error: "",
    loading: false,
    fieldErrors: {},
    pendingLogin: null,
  };
}

function loginReducer(state: LoginState, patch: LoginStatePatch): LoginState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

export function LoginPage() {
  const { user, login, checkPending } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loginState, dispatchLoginState] = useReducer(
    loginReducer,
    undefined,
    createLoginState,
  );
  const {
    email,
    password,
    error,
    loading,
    fieldErrors,
    pendingLogin,
  } = loginState;
  const { lang, setLang: switchLang, t: tr } = useLang();

  const setPendingLogin = (nextValue: SetStateAction<PendingLoginState>) => {
    dispatchLoginState((current) => ({
      pendingLogin:
        typeof nextValue === "function"
          ? nextValue(current.pendingLogin)
          : nextValue,
    }));
  };

  const redirectTo =
    typeof location.state === "object" &&
    location.state &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/";

  const toggleLang = () => {
    switchLang(lang === "de" ? "ru" : "de");
  };

  const validate = (): boolean => {
    const errors: LoginFieldErrors = {};
    const trimmed = email.trim();

    if (!trimmed) {
      errors.email = tr.login_error_email_required;
    } else if (
      trimmed.length > 320 ||
      !trimmed.includes("@") ||
      !trimmed.includes(".")
    ) {
      errors.email = tr.login_error_email_invalid;
    }

    if (!password) {
      errors.password = tr.login_error_password_required;
    } else if (password.length < 8) {
      errors.password = tr.login_error_password_short;
    } else if (password.length > 256) {
      errors.password = tr.login_error_password_long;
    }

    dispatchLoginState({ fieldErrors: errors });
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatchLoginState({
      error: "",
      pendingLogin: null,
    });

    if (!validate()) return;

    dispatchLoginState({ loading: true });
    try {
      await login(email.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (err instanceof PendingLoginError) {
        dispatchLoginState({
          pendingLogin: { id: err.pendingId, status: "pending" },
        });
      } else {
        dispatchLoginState({
          error: err instanceof Error ? err.message : tr.login_error_unknown,
        });
      }
    } finally {
      dispatchLoginState({ loading: false });
    }
  };

  // Poll pending login status
  useEffect(() => {
    if (!pendingLogin || pendingLogin.status !== "pending") return;

    let cancelled = false;

    const pollPendingLogin = async () => {
      if (cancelled) return;
      const status = await checkPending(pendingLogin.id);
      if (!cancelled) {
        if (status === "approved") {
          dispatchLoginState({ pendingLogin: null });
          navigate(redirectTo, { replace: true });
        } else if (status === "rejected") {
          dispatchLoginState((current) => ({
            pendingLogin: current.pendingLogin
              ? { ...current.pendingLogin, status: "rejected" }
              : current.pendingLogin,
          }));
        } else if (status === "error") {
          dispatchLoginState({
            pendingLogin: null,
            error: tr.login_error_unknown,
          });
        }
      }
    };

    void pollPendingLogin();
    const interval = setInterval(() => {
      void pollPendingLogin();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pendingLogin, checkPending, navigate, redirectTo, tr.login_error_unknown]);

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#f4f7fb_0%,#eef2f7_36%,#ffffff_100%)] text-foreground">
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-10 xl:p-12">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-semibold text-zinc-950">{tr.login_title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              {tr.login_sign_in_subtitle}
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-zinc-700">
            <LogoMark />
          </div>
        </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2.5">
                <label htmlFor="email" className="text-sm font-medium text-zinc-700">
                  {tr.login_email}
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@gmed.de"
                  value={email}
                  onChange={(e) =>
                    dispatchLoginState((current) => ({
                      email: e.target.value,
                      fieldErrors: { ...current.fieldErrors, email: undefined },
                    }))
                  }
                  className={`h-12 w-full rounded-xl border bg-white px-4 text-sm text-zinc-950 outline-none transition-all duration-200 ${
                    fieldErrors.email
                      ? "border-red-400 ring-4 ring-red-100"
                      : "border-zinc-300 focus:border-ring focus:ring-2 focus:ring-ring/30"
                  }`}
                />
                <FieldError message={fieldErrors.email} />
              </div>

              <div className="space-y-2.5">
                <label htmlFor="password" className="text-sm font-medium text-zinc-700">
                  {tr.login_password}
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) =>
                    dispatchLoginState((current) => ({
                      password: e.target.value,
                      fieldErrors: { ...current.fieldErrors, password: undefined },
                    }))
                  }
                  className={`h-12 w-full rounded-xl border bg-white px-4 text-sm text-zinc-950 outline-none transition-all duration-200 ${
                    fieldErrors.password
                      ? "border-red-400 ring-4 ring-red-100"
                      : "border-zinc-300 focus:border-ring focus:ring-2 focus:ring-ring/30"
                  }`}
                />
                <FieldError message={fieldErrors.password} />
              </div>

              {error ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-red-300 bg-white px-4 py-3 text-sm text-red-600 animate-in fade-in slide-in-from-top-1 duration-200">
                  <AlertCircle className="size-4 shrink-0" />
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                size="lg"
                className="h-12 w-full rounded-xl bg-zinc-950 text-white hover:bg-zinc-800"
                disabled={loading}
              >
                <span>{loading ? tr.login_loading : tr.login_submit}</span>
                <ArrowRight className="size-4" />
              </Button>
            </form>

            <div className="mt-5 flex justify-center">
              <button
                onClick={toggleLang}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Globe className="size-3.5" />
                {tr.common_lang_native}
              </button>
            </div>

            {/* Pending MFA overlay */}
            {pendingLogin && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-[2rem] bg-white/95 backdrop-blur animate-in fade-in duration-300">
                {pendingLogin.status === "rejected" ? (
                  <div className="flex flex-col items-center gap-4 px-8 text-center">
                    <div className="flex items-center justify-center size-16 rounded-2xl bg-red-50">
                      <AlertCircle className="size-8 text-red-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-zinc-950">
                      {tr.login_mfa_rejected_title}
                    </h3>
                    <p className="text-sm text-zinc-500 max-w-xs">
                      {tr.login_mfa_rejected_msg}
                    </p>
                    <Button
                      variant="outline"
                      className="mt-2 rounded-xl"
                      onClick={() => setPendingLogin(null)}
                    >
                      {tr.common_back}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4 px-8 text-center">
                    <div className="flex items-center justify-center size-16 rounded-2xl bg-sky-50">
                      <Clock className="size-8 text-sky-500 animate-pulse" />
                    </div>
                    <h3 className="text-lg font-semibold text-zinc-950">
                      {tr.mfa_pending}
                    </h3>
                    <p className="text-sm text-zinc-500 max-w-xs">
                      {tr.login_mfa_pending_msg}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="size-2 rounded-full bg-sky-400 animate-pulse" />
                      <span className="text-xs text-zinc-400">
                        {tr.login_mfa_checking}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-zinc-400"
                      onClick={() => setPendingLogin(null)}
                    >
                      {tr.common_cancel}
                    </Button>
                  </div>
                )}
              </div>
            )}
      </div>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="flex items-center gap-1.5 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
      <AlertCircle className="size-3.5 text-red-500 shrink-0" />
      <span className="text-xs text-red-500">{message}</span>
    </div>
  );
}
