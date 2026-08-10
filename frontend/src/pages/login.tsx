import {
  useEffect,
  useReducer,
  useRef,
  type FormEvent,
  type SetStateAction,
} from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpLeft,
  CircleDollarSign,
  Clock,
  Eye,
  EyeOff,
  Globe,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth, PendingLoginError } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { getBuildLoginDefaults } from "@/pages/login-defaults";
import { resolveRequestedLoginLanguage } from "@/pages/login-language";
import "./login.css";

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
  showPassword: boolean;
};

type LoginStatePatch =
  | Partial<LoginState>
  | ((current: LoginState) => Partial<LoginState>);

function createLoginState(): LoginState {
  const defaults = getBuildLoginDefaults();

  return {
    email: defaults.email,
    password: defaults.password,
    error: "",
    loading: false,
    fieldErrors: {},
    pendingLogin: null,
    showPassword: false,
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
    showPassword,
  } = loginState;
  const { lang, setLang: switchLang, t: tr } = useLang();
  const appliedLanguageParam = useRef<string | null>(null);

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

  const requestedLanguage = new URLSearchParams(location.search).get("lang");

  useEffect(() => {
    if (appliedLanguageParam.current === requestedLanguage) return;

    appliedLanguageParam.current = requestedLanguage;
    const nextLanguage = resolveRequestedLoginLanguage(requestedLanguage);
    if (!nextLanguage) return;

    if (nextLanguage !== lang) {
      switchLang(nextLanguage);
    }
  }, [lang, requestedLanguage, switchLang]);

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
    <main className="gmed-login-page">
      <section className="gmed-login-shell">
        <a className="gmed-login-brand" href="https://gmed-health.com/" aria-label={tr.login_back_home}>
          <img src="/gmed-logo.png" alt={`GMED ${tr.login_brand_tagline}`} />
        </a>
        <p className="gmed-login-tagline">{tr.login_brand_tagline}</p>

        <div className="gmed-login-card">
          <form onSubmit={handleSubmit} className="gmed-login-form" noValidate>
            <div className="gmed-login-heading">
              <h1>{tr.login_title}</h1>
              <p>{tr.login_sign_in_subtitle}</p>
            </div>

            <div className="gmed-login-field">
              <label className="gmed-login-sr-only" htmlFor="email">{tr.login_email}</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={tr.login_email}
                value={email}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
                onChange={(event) =>
                  dispatchLoginState((current) => ({
                    email: event.target.value,
                    fieldErrors: { ...current.fieldErrors, email: undefined },
                  }))
                }
                className={fieldErrors.email ? "gmed-login-input is-error" : "gmed-login-input"}
              />
              <FieldError id="login-email-error" message={fieldErrors.email} />
            </div>

            <div className="gmed-login-field">
              <label className="gmed-login-sr-only" htmlFor="password">{tr.login_password}</label>
              <div className="gmed-login-password">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder={tr.login_password}
                  value={password}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
                  onChange={(event) =>
                    dispatchLoginState((current) => ({
                      password: event.target.value,
                      fieldErrors: { ...current.fieldErrors, password: undefined },
                    }))
                  }
                  className={fieldErrors.password ? "gmed-login-input is-error" : "gmed-login-input"}
                />
                <button
                  type="button"
                  className="gmed-login-password-toggle"
                  aria-label={showPassword ? tr.login_hide_password : tr.login_show_password}
                  onClick={() => dispatchLoginState((current) => ({ showPassword: !current.showPassword }))}
                >
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
              <FieldError id="login-password-error" message={fieldErrors.password} />
            </div>

            {error ? (
              <div className="gmed-login-error" role="alert">
                <AlertCircle aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}

            <button className="gmed-login-submit" type="submit" disabled={loading}>
              <span>{loading ? tr.login_loading : tr.login_submit}</span>
              <ArrowRight aria-hidden="true" />
            </button>
          </form>

          <a className="gmed-login-home" href="https://gmed-health.com/">
            <ArrowUpLeft aria-hidden="true" />
            <span>{tr.login_back_home}</span>
          </a>
          <p className="gmed-login-security">{tr.login_confidentiality_notice}</p>

          <div className="gmed-login-mollie">
            <a
              className="gmed-login-mollie-button"
              href="https://www.mollie.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <CircleDollarSign aria-hidden="true" />
              <span>{tr.login_pay_with_mollie}</span>
            </a>
            <p>
              {tr.login_secure_payments}{" "}
              <a href="https://www.mollie.com/" target="_blank" rel="noopener noreferrer">
                Mollie
              </a>
            </p>
          </div>

          <button type="button" onClick={toggleLang} className="gmed-login-language">
            <Globe aria-hidden="true" />
            {tr.common_lang_native}
          </button>

          {pendingLogin && (
            <div className="gmed-login-mfa">
              {pendingLogin.status === "rejected" ? (
                <div className="flex flex-col items-center gap-4 px-8 text-center">
                  <div className="flex size-16 items-center justify-center rounded-2xl bg-red-50">
                    <AlertCircle className="size-8 text-red-500" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-950">{tr.login_mfa_rejected_title}</h3>
                  <p className="max-w-xs text-sm text-slate-500">{tr.login_mfa_rejected_msg}</p>
                  <Button variant="outline" className="mt-2 rounded-xl" onClick={() => setPendingLogin(null)}>
                    {tr.common_back}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 px-8 text-center">
                  <div className="flex size-16 items-center justify-center rounded-2xl bg-sky-50">
                    <Clock className="size-8 animate-pulse text-sky-500" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-950">{tr.mfa_pending}</h3>
                  <p className="max-w-xs text-sm text-slate-500">{tr.login_mfa_pending_msg}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="size-2 animate-pulse rounded-full bg-sky-400" />
                    <span className="text-xs text-slate-400">{tr.login_mfa_checking}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="mt-2 text-slate-400" onClick={() => setPendingLogin(null)}>
                    {tr.common_cancel}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="gmed-login-field-error">{message}</span>
  );
}
