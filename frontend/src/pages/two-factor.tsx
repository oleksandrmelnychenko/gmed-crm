import { useCallback, useEffect, useState } from "react";

import { QrCodeImage } from "@/components/qr-code-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner, PageHeader, Section } from "@/components/ui-shell";
import { apiFetch, clearApiCache, refreshAuthSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { twoFactorErrorMessage } from "@/pages/two-factor-errors";

type TotpStatus = { enrolled: boolean; required: boolean };
type Enrolment = { secret: string; otpauth_uri: string; issuer: string; account: string };

export function fetchTotpStatus() {
  return apiFetch<TotpStatus>("/me/totp", { cache: "no-store" });
}

/**
 * Standalone page kept as an alias of the "Two-factor" section on /account.
 */
export function TwoFactorPage() {
  const { t } = useLang();
  const l = useCallback((key: string) => t.uiText[key] ?? key, [t]);
  return (
    <div className="space-y-4">
      <PageHeader title={l("twofactor_title")} description={l("twofactor_subtitle")} />
      <TwoFactorSection />
    </div>
  );
}

/**
 * Self-service enrolment of an authenticator app: a QR code drawn in the
 * browser (the otpauth URI carries the secret and is never sent elsewhere),
 * the otpauth link for the app on the same device and the manual key.
 * After a change the session is refreshed, so a role that must use a second
 * factor leaves (or enters) the enrolment-only session at once.
 */
export function TwoFactorSection({
  onEnrolled,
  hideRequiredBanner = false,
}: {
  onEnrolled?: () => void;
  /** The enrolment gate says "mandatory" in its intro already (QA E2-07). */
  hideRequiredBanner?: boolean;
} = {}) {
  const { t } = useLang();
  const { refreshUser } = useAuth();
  const l = useCallback((key: string) => t.uiText[key] ?? key, [t]);
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setStatus(await fetchTotpStatus());
    } catch (cause) {
      setError(twoFactorErrorMessage(cause, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      clearApiCache();
      await load();
    } catch (cause) {
      // Server refusals in the UI language, never "Sign in again" & co.
      setError(twoFactorErrorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      setEnrolment(await apiFetch<Enrolment>("/me/totp/setup", { method: "POST" }));
      setCode("");
    });

  const confirm = () =>
    run(async () => {
      await apiFetch("/me/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
      setEnrolment(null);
      setCode("");
      setNotice(l("twofactor_confirmed"));
      // A new access token without the enrolment-only restriction.
      await refreshAuthSession();
      await refreshUser().catch(() => null);
      onEnrolled?.();
    });

  const disable = () =>
    run(async () => {
      await apiFetch("/me/totp/disable", { method: "POST", body: JSON.stringify({ code }) });
      setCode("");
      // A role that must use a factor is sent to the setup at once.
      await refreshAuthSession();
      await refreshUser().catch(() => null);
    });

  const codeInput = (
    <Input
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 ]*"
      maxLength={7}
      className="h-9 w-40 rounded-lg bg-field font-mono"
      placeholder="123 456"
      aria-label={l("twofactor_code")}
      value={code}
      onChange={(event) => setCode(event.target.value)}
    />
  );

  return (
    <div className="space-y-4" data-testid="twofactor-section">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
      {status?.required && !status.enrolled && !hideRequiredBanner ? (
        <Banner tone="warning" withIcon>{l("twofactor_required_banner")}</Banner>
      ) : null}

      <Section title={l("twofactor_title")}>
        {status === null ? null : status.enrolled ? (
          <div className="space-y-3" data-testid="twofactor-active">
            <p className="text-sm">{l("twofactor_status_active")}</p>
            <p className="text-xs text-muted-foreground">{l("twofactor_disable_hint")}</p>
            <div className="flex flex-wrap items-center gap-2">
              {codeInput}
              <Button type="button" variant="outline" className="h-9 rounded-lg" disabled={busy || code.trim().length < 6} onClick={() => void disable()}>
                {l("twofactor_disable")}
              </Button>
            </div>
          </div>
        ) : enrolment ? (
          <div className="space-y-4" data-testid="twofactor-enrolment">
            <p className="text-sm">{l("twofactor_step_scan")}</p>
            <div className="flex flex-wrap items-start gap-4">
              <QrCodeImage value={enrolment.otpauth_uri} label={t.twofactor_qr_alt} />
              <p className="max-w-xs text-xs text-muted-foreground">{t.twofactor_qr_hint}</p>
            </div>
            <a
              className="inline-block rounded-lg border border-border bg-card px-3 py-2 text-sm underline"
              href={enrolment.otpauth_uri}
            >
              {l("twofactor_open_in_app")}
            </a>
            <p className="text-xs text-muted-foreground">
              {l("twofactor_manual_key")}:{" "}
              <code className="select-all rounded bg-muted px-1.5 py-0.5 font-mono text-sm tracking-wider">
                {enrolment.secret.replace(/(.{4})/g, "$1 ").trim()}
              </code>{" "}
              · {enrolment.issuer} · {enrolment.account}
            </p>
            <p className="text-sm">{l("twofactor_step_confirm")}</p>
            <div className="flex flex-wrap items-center gap-2">
              {codeInput}
              <Button type="button" className="h-9 rounded-lg" disabled={busy || code.trim().length < 6} onClick={() => void confirm()}>
                {l("twofactor_confirm")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3" data-testid="twofactor-inactive">
            <p className="text-sm">{l("twofactor_status_inactive")}</p>
            <Button type="button" className="h-9 rounded-lg" disabled={busy} onClick={() => void start()}>
              {l("twofactor_start")}
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}
