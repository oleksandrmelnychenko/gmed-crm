import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Banner, Field, PageHeader, Section, SuccessBanner } from "@/components/ui-shell";
import {
  describeSessionDevice,
  mapPasswordChangeError,
  sortSessions,
  validatePasswordForm,
  validateProfileForm,
  type AccountProfile,
  type AccountSession,
} from "@/lib/account";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { TwoFactorSection } from "@/pages/two-factor";

function useUiText() {
  const { t, lang } = useLang();
  const l = useCallback((key: string) => t.uiText[key] ?? key, [t]);
  return { l, lang, t };
}

/**
 * Own account: profile, password, second factor, sessions. Available to every
 * staff role and to patients; the backend endpoints are role-agnostic.
 */
export function AccountPage() {
  const { l } = useUiText();
  return (
    <div className="space-y-4" data-testid="account-page">
      <PageHeader title={l("account_title")} description={l("account_subtitle")} />
      <ProfileSection />
      <Section title={l("account_password_title")}>
        <ChangePasswordForm />
      </Section>
      <Section title={l("twofactor_title")}>
        <TwoFactorSection />
      </Section>
      <SessionsSection />
    </div>
  );
}

function ProfileSection() {
  const { l, lang, setLangFromProfile } = useProfileLanguage();
  const { refreshUser } = useAuth();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<Lang>(lang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<AccountProfile>("/me/profile", { cache: "no-store" })
      .then((loaded) => {
        if (cancelled) return;
        setProfile(loaded);
        setName(loaded.name ?? "");
        setPhone(loaded.phone ?? "");
        setLanguage(loaded.preferred_language ?? lang);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
    // The saved language seeds the select once; later toggles come from the select itself.
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const problem = validateProfileForm({ name, phone });
    if (problem) {
      setError(l(problem));
      return;
    }
    setBusy(true);
    try {
      const saved = await apiFetch<AccountProfile>("/me/profile", {
        method: "PUT",
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), preferred_language: language }),
      });
      setProfile(saved);
      setLangFromProfile(saved.preferred_language);
      clearApiCache();
      await refreshUser().catch(() => null);
      setNotice(l("account_profile_saved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={l("account_profile_title")}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)} data-testid="account-profile-form">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={l("account_profile_email")} htmlFor="account-email">
            <Input id="account-email" value={profile?.email ?? ""} readOnly disabled className="h-9 rounded-lg bg-muted" />
          </Field>
          <Field label={l("account_profile_role")} htmlFor="account-role">
            <Input id="account-role" value={profile?.role ?? ""} readOnly disabled className="h-9 rounded-lg bg-muted" />
          </Field>
          <Field label={l("account_profile_name")} htmlFor="account-name" required>
            <Input
              id="account-name"
              value={name}
              maxLength={200}
              autoComplete="name"
              className="h-9 rounded-lg bg-field"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={l("account_profile_phone")} htmlFor="account-phone">
            <Input
              id="account-phone"
              value={phone}
              maxLength={40}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+49 30 1234567"
              className="h-9 rounded-lg bg-field"
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Field label={l("account_profile_language")}>
            <SelectField
              aria-label={l("account_profile_language")}
              value={language}
              options={[
                { value: "ru", label: l("account_language_ru") },
                { value: "de", label: l("account_language_de") },
              ]}
              onValueChange={(value) => setLanguage(value === "de" ? "de" : "ru")}
            />
          </Field>
        </div>
        <Button type="submit" className="h-9 rounded-lg" disabled={busy || profile === null}>
          {l("account_profile_save")}
        </Button>
      </form>
    </Section>
  );
}

function useProfileLanguage() {
  const { l, lang } = useUiText();
  const { setLang } = useLang();
  const setLangFromProfile = useCallback(
    (preferred: Lang | null | undefined) => {
      if ((preferred === "ru" || preferred === "de") && preferred !== lang) {
        setLang(preferred);
      }
    },
    [lang, setLang],
  );
  return { l, lang, setLangFromProfile };
}

/**
 * Current + new + confirm. Used on /account and on the forced-change screen;
 * `onChanged` lets the caller leave the gated state.
 */
export function ChangePasswordForm({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const { l } = useUiText();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const problem = validatePasswordForm({ currentPassword, newPassword, confirmPassword });
    if (problem) {
      setError(l(problem));
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/me/password", {
        method: "PUT",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      clearApiCache();
      setNotice(l("account_password_changed"));
      await onChanged?.();
    } catch (cause) {
      setError(l(mapPasswordChangeError(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)} data-testid="account-password-form">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={l("account_password_current")} htmlFor="account-password-current" required>
          <Input
            id="account-password-current"
            type="password"
            autoComplete="current-password"
            className="h-9 rounded-lg bg-field"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field label={l("account_password_new")} htmlFor="account-password-new" required>
          <Input
            id="account-password-new"
            type="password"
            autoComplete="new-password"
            className="h-9 rounded-lg bg-field"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        <Field label={l("account_password_confirm")} htmlFor="account-password-confirm" required>
          <Input
            id="account-password-confirm"
            type="password"
            autoComplete="new-password"
            className="h-9 rounded-lg bg-field"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">{l("account_password_policy_hint")}</p>
      <Button type="submit" className="h-9 rounded-lg" disabled={busy}>
        {l("account_password_submit")}
      </Button>
    </form>
  );
}

function SessionsSection() {
  const { l, lang } = useUiText();
  const { logout } = useAuth();
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const loaded = await apiFetch<AccountSession[]>("/auth/sessions", { cache: "no-store", forceFresh: true });
      setSessions(sortSessions(loaded));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (session: AccountSession) => {
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/auth/sessions/${session.family_id}/revoke`, { method: "POST" });
      if (session.is_current) {
        await logout();
        return;
      }
      clearApiCache();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const logoutEverywhere = async () => {
    setBusy(true);
    try {
      await apiFetch("/auth/logout-all", { method: "POST" });
    } catch {
      // The local session is cleared regardless.
    } finally {
      await logout();
    }
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleString(lang === "de" ? "de-DE" : "ru-RU", { dateStyle: "short", timeStyle: "short" });

  return (
    <Section
      title={l("account_sessions_title")}
      accessory={
        <Button type="button" variant="outline" className="h-8 rounded-lg" disabled={busy} onClick={() => void logoutEverywhere()}>
          {l("account_sessions_logout_all")}
        </Button>
      }
    >
      {error ? <Banner tone="error">{error}</Banner> : null}
      {sessions === null ? null : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{l("account_sessions_empty")}</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="account-sessions">
          {sessions.map((session) => {
            const device = describeSessionDevice(session) ?? l("account_sessions_unknown_device");
            return (
              <li key={session.family_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{device}</span>
                    {session.is_current ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        {l("account_sessions_current")}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {session.ip_address ? `${session.ip_address} · ` : ""}
                    {l("account_sessions_last_seen")}: {formatDate(session.last_activity_at)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-lg"
                  disabled={busy}
                  onClick={() => void revoke(session)}
                >
                  {session.is_current ? l("account_sessions_end_current") : l("account_sessions_revoke")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
