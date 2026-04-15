import { useState, useEffect, type FormEvent } from "react";
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
      className="h-8 w-8 text-primary"
      fill="none"
    >
      <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" fill="currentColor" />
    </svg>
  );
}

export function LoginPage() {
  const { user, login, checkPending } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("admin@gmed.de");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<"pending" | "rejected" | null>(null);
  const { lang, setLang: switchLang, t: tr } = useLang();

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
  const nextLangNative = lang === "de" ? "Русский" : "Deutsch";

  const validate = (): boolean => {
    const errors: { email?: string; password?: string } = {};
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

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPendingId(null);
    setPendingStatus(null);

    if (!validate()) return;

    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (err instanceof PendingLoginError) {
        setPendingId(err.pendingId);
        setPendingStatus("pending");
      } else {
        setError(err instanceof Error ? err.message : tr.login_error_unknown);
      }
    } finally {
      setLoading(false);
    }
  };

  // Poll pending login status
  useEffect(() => {
    if (!pendingId || pendingStatus !== "pending") return;

    const interval = setInterval(async () => {
      const status = await checkPending(pendingId);
      if (status === "approved") {
        setPendingId(null);
        setPendingStatus(null);
        navigate(redirectTo, { replace: true });
      } else if (status === "rejected") {
        setPendingStatus("rejected");
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [pendingId, pendingStatus, checkPending, navigate, redirectTo]);

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#f4f7fb_0%,#eef2f7_36%,#ffffff_100%)] text-foreground">
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-10 xl:p-12">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-semibold text-slate-950">{tr.login_title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {tr.login_sign_in_subtitle}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-700">
            <LogoMark />
          </div>
        </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2.5">
                <label htmlFor="email" className="text-sm font-medium text-slate-700">
                  {tr.login_email}
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@gmed.de"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setFieldErrors((p) => ({ ...p, email: undefined })); }}
                  className={`h-12 w-full rounded-xl border bg-white px-4 text-sm text-slate-950 outline-none transition-all duration-200 ${
                    fieldErrors.email
                      ? "border-red-400 ring-4 ring-red-100"
                      : "border-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  }`}
                />
                <FieldError message={fieldErrors.email} />
              </div>

              <div className="space-y-2.5">
                <label htmlFor="password" className="text-sm font-medium text-slate-700">
                  {tr.login_password}
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setFieldErrors((p) => ({ ...p, password: undefined })); }}
                  className={`h-12 w-full rounded-xl border bg-white px-4 text-sm text-slate-950 outline-none transition-all duration-200 ${
                    fieldErrors.password
                      ? "border-red-400 ring-4 ring-red-100"
                      : "border-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
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
                className="h-12 w-full rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                disabled={loading}
              >
                <span>{loading ? tr.login_loading : tr.login_submit}</span>
                <ArrowRight className="size-4" />
              </Button>
            </form>

            <div className="mt-5 flex justify-center">
              <button
                onClick={toggleLang}
                aria-label={nextLangNative}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Globe className="size-3.5" />
                {nextLangNative}
              </button>
            </div>

            {/* Pending MFA overlay */}
            {pendingId && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-[2rem] bg-white/95 backdrop-blur animate-in fade-in duration-300">
                {pendingStatus === "rejected" ? (
                  <div className="flex flex-col items-center gap-4 px-8 text-center">
                    <div className="flex items-center justify-center size-16 rounded-2xl bg-red-50">
                      <AlertCircle className="size-8 text-red-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-950">
                      {tr.login_mfa_rejected_title}
                    </h3>
                    <p className="text-sm text-slate-500 max-w-xs">
                      {tr.login_mfa_rejected_msg}
                    </p>
                    <Button
                      variant="outline"
                      className="mt-2 rounded-xl"
                      onClick={() => { setPendingId(null); setPendingStatus(null); }}
                    >
                      {tr.common_back}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4 px-8 text-center">
                    <div className="flex items-center justify-center size-16 rounded-2xl bg-sky-50">
                      <Clock className="size-8 text-sky-500 animate-pulse" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-950">
                      {tr.mfa_pending}
                    </h3>
                    <p className="text-sm text-slate-500 max-w-xs">
                      {tr.login_mfa_pending_msg}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="size-2 rounded-full bg-sky-400 animate-pulse" />
                      <span className="text-xs text-slate-400">
                        {tr.login_mfa_checking}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-slate-400"
                      onClick={() => { setPendingId(null); setPendingStatus(null); }}
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
