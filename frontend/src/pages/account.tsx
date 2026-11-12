import { PortalDateChip } from "@/components/ui/portal-date-chip";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { StaffLink } from "@/components/staff-link";
import { CheckCircle2, Info, KeyRound, LogOut, Monitor, Save, ShieldCheck, Smartphone, UserRound, type LucideIcon } from "lucide-react";

import { AccountSectionHeading } from "@/components/account-section-heading";
import { AppearanceSettings } from "@/components/appearance-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { StatusChip } from "@/components/ui/status-chip";
import { Banner, Field, PageHeader, SuccessBanner } from "@/components/ui-shell";
import {
  describeSessionDevice,
  isConsoleLang,
  mapPasswordChangeError,
  sortSessions,
  validatePasswordForm,
  validateProfileForm,
  type AccountProfile,
  type AccountSession,
  type ProfileFormErrorKey,
  type ProfileLanguage,
} from "@/lib/account";
import { apiFetch, clearApiCache } from "@/lib/api";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { isLeadPortalUser } from "@/lib/staff-route-access";
import { publishLeadCabinetLang, storeLeadCabinetLang, useInterfaceLang } from "@/pages/patient-lead/lead-cabinet-language";
import { leadAccountText } from "@/pages/patient-lead/lead-shell-text";
import { TwoFactorSection } from "@/pages/two-factor";

function useUiText() {
  const { t, lang } = useLang();
  // The lead cabinet's account page speaks the cabinet language, EN and UA
  // included (QA 2026-11-12, B S3-1: it was German there).
  const { user } = useAuth();
  const cabinetLang = useInterfaceLang();
  const leadCabinet = isLeadPortalUser(user);
  const l = useCallback(
    (key: string) => (leadCabinet ? leadAccountText(cabinetLang, key) : null) ?? t.uiText[key] ?? key,
    [cabinetLang, leadCabinet, t],
  );
  return { l, lang, t };
}

function AccountSection({ title, icon: Icon, accessory, children }: { title: string; icon: LucideIcon; accessory?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <AccountSectionHeading icon={Icon} title={title} />
        {accessory}
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

/**
 * Own account: profile, password, second factor, sessions. Available to every
 * staff role and to patients; the backend endpoints are role-agnostic.
 */
export function AccountPage() {
  const { l } = useUiText();
  const { t } = useLang();
  const { user } = useAuth();
  // The lead cabinet keeps the account to profile and language. A lead signs
  // in with the password the manager issued and does not change it here
  // (owner decision 2026-10-05); a lost one is replaced by staff.
  const leadCabinet = isLeadPortalUser(user);
  // A password change ends the other sessions: the list reloads (QA 2026-11-12, B S3-8).
  const [sessionsVersion, setSessionsVersion] = useState(0);
  return (
    <div className={user?.role === "patient" ? "w-full min-w-0 space-y-3 [&_label]:font-mono [&_label]:text-xs" : "space-y-3"} data-testid="account-page">
      <PageHeader title={l("account_title")} description={l("account_subtitle")} />
      <div className="space-y-3">
        <div className={leadCabinet ? "min-w-0" : "grid items-start gap-3 xl:grid-cols-2"}>
          <ProfileSection />
          {leadCabinet ? null : (
            <AccountSection title={l("account_password_title")} icon={KeyRound}>
              <ChangePasswordForm compact onChanged={() => setSessionsVersion((current) => current + 1)} />
            </AccountSection>
          )}
        </div>
        {/* Leads pick their theme and colours too (owner 2026-11-03). */}
        <AppearanceSettings />
        {leadCabinet ? null : (
          <>
            <AccountSection title={l("twofactor_title")} icon={ShieldCheck}>
              <TwoFactorSection embedded />
            </AccountSection>
            <SessionsSection version={sessionsVersion} />
          </>
        )}
        {/* Staff reach the legal notice from their account (owner 2026-11-12); the portal and
            the lead cabinet keep their own sidebar link. */}
        {leadCabinet || user?.role === "patient" ? null : (
          <p className="px-1 text-xs text-muted-foreground">
            <StaffLink to="/legal" className="underline underline-offset-2 hover:text-foreground">{t.nav_legal_notice}</StaffLink>
          </p>
        )}
      </div>
    </div>
  );
}

/** The four languages of the lead cabinet, each named in itself. */
const LEAD_CABINET_LANGUAGE_OPTIONS: readonly { value: ProfileLanguage; label: string }[] = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
  { value: "uk", label: "Українська" },
  { value: "ru", label: "Русский" },
];

function ProfileSection() {
  const { l, lang, setLangFromProfile } = useProfileLanguage();
  const { t } = useLang();
  // The role name as the sidebar says it, not the role code (QA 2026-11-12).
  const roleNames = t as unknown as Record<string, string | undefined>;
  const { user, refreshUser } = useAuth();
  const portalUser = user?.role === "patient";
  // The lead cabinet speaks DE, EN, UA and RU: its account offers the same
  // four, not the console's two (QA 2026-11-10).
  const leadCabinet = isLeadPortalUser(user);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // What the select was set to since the page showed `lang`: a switch of the
  // interface language elsewhere (the header) makes the select follow it
  // again instead of naming the language saved earlier (QA 2026-11-10).
  const [picked, setPicked] = useState<{ value: ProfileLanguage; under: Lang } | null>(null);
  // A UA/EN language from the lead cabinet is kept unless the select is used.
  const [keptLanguage, setKeptLanguage] = useState<ProfileLanguage | null>(null);
  const [busy, setBusy] = useState(false);
  // Messages are kept as keys and worded when shown, so a saved language
  // switch does not leave "saved" in the language before it.
  const [problem, setProblem] = useState<ProfileFormErrorKey | "">("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const pickedLanguage = picked && picked.under === lang ? picked.value : null;
  const language: ProfileLanguage = pickedLanguage ?? (leadCabinet ? keptLanguage : null) ?? lang;

  useEffect(() => {
    let cancelled = false;
    apiFetch<AccountProfile>("/me/profile", { cache: "no-store" })
      .then((loaded) => {
        if (cancelled) return;
        setProfile(loaded);
        setName(loaded.name ?? "");
        setPhone(loaded.phone ?? "");
        setKeptLanguage(isConsoleLang(loaded.preferred_language) ? null : loaded.preferred_language ?? null);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The name can change behind the user's back (a lead renamed by staff): the
  // page follows it unless the field is being edited.
  useRealtimeSubscription(["user.updated"], (event) => {
    if (!user || event.entity_id !== user.id || profile === null) return;
    apiFetch<AccountProfile>("/me/profile", { cache: "no-store", forceFresh: true })
      .then((fresh) => {
        setProfile(fresh);
        setName((current) => (current === (profile.name ?? "") ? (fresh.name ?? "") : current));
      })
      .catch(() => undefined);
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaved(false);
    const formProblem = validateProfileForm({ name, phone });
    setProblem(formProblem ?? "");
    if (formProblem) return;
    setBusy(true);
    try {
      const stored = await apiFetch<AccountProfile>("/me/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          // The select as shown; an untouched UA/EN of a former lead is kept.
          preferred_language: pickedLanguage ?? keptLanguage ?? lang,
        }),
      });
      setProfile(stored);
      setPicked(null);
      setKeptLanguage(isConsoleLang(stored.preferred_language) ? null : stored.preferred_language ?? null);
      setLangFromProfile(stored.preferred_language);
      // The cabinet around the page follows the language chosen here.
      if (leadCabinet && user?.id && stored.preferred_language) {
        storeLeadCabinetLang(user.id, stored.preferred_language);
        publishLeadCabinetLang(user.id, stored.preferred_language);
      }
      clearApiCache();
      await refreshUser().catch(() => null);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountSection title={l("account_profile_title")} icon={UserRound}>
      <form className="space-y-3" onSubmit={(event) => void submit(event)} data-testid="account-profile-form">
        {problem || error ? <Banner tone="error">{problem ? l(problem) : error}</Banner> : null}
        {saved ? <SuccessBanner>{l("account_profile_saved")}</SuccessBanner> : null}
        <div className={`grid gap-3 rounded-lg border border-border bg-muted/30 p-3${portalUser ? "" : " sm:grid-cols-2"}`}>
          <Field label={l("account_profile_email")} htmlFor="account-email">
            <Input id="account-email" value={profile?.email ?? ""} readOnly title={profile?.email || undefined} className="h-9 text-ellipsis rounded-lg border-border bg-muted/40 px-3 text-foreground" />
          </Field>
          {/* A raw role code means nothing to a lead, parent or patient. */}
          {portalUser ? null : (
            <Field label={l("account_profile_role")} htmlFor="account-role">
              <Input id="account-role" value={profile?.role ? (roleNames[`role_${profile.role}`] ?? profile.role) : ""} readOnly disabled className="h-9 rounded-lg border-transparent bg-transparent px-3 text-sm text-foreground disabled:opacity-100" />
            </Field>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
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
              // A neutral hint, lighter than a value: a full sample number read as a stored one
              // (QA 2026-11-10, A-4).
              placeholder="+49 …"
              className="h-9 rounded-lg bg-field placeholder:text-muted-foreground/60"
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Field label={l("account_profile_language")}>
            <SelectField
              aria-label={l("account_profile_language")}
              value={language}
              options={
                leadCabinet
                  ? LEAD_CABINET_LANGUAGE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
                  : [
                      { value: "ru", label: l("account_language_ru") },
                      { value: "de", label: l("account_language_de") },
                    ]
              }
              onValueChange={(value) => {
                const next = LEAD_CABINET_LANGUAGE_OPTIONS.find((option) => option.value === value)?.value;
                if (!next || (!leadCabinet && !isConsoleLang(next))) return;
                setKeptLanguage(null);
                setPicked({ value: next, under: lang });
              }}
            />
          </Field>
        </div>
        <div className="flex justify-end border-t border-border/70 pt-3">
          <Button type="submit" size="sm" className="h-8 rounded-lg gap-1.5 text-xs" disabled={busy || profile === null}>
            <Save className="size-3.5" aria-hidden="true" />
            {l("account_profile_save")}
          </Button>
        </div>
      </form>
    </AccountSection>
  );
}

function useProfileLanguage() {
  const { l, lang } = useUiText();
  const { setLang } = useLang();
  const setLangFromProfile = useCallback(
    (preferred: ProfileLanguage | null | undefined) => {
      if (isConsoleLang(preferred) && preferred !== lang) {
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
export function ChangePasswordForm({
  onChanged,
  compact = false,
  currentLabelKey = "account_password_current",
}: {
  onChanged?: () => void | Promise<void>;
  compact?: boolean;
  /** The first field's label: "one-time password" on the forced-change screen after a reset. */
  currentLabelKey?: string;
}) {
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
    <form className="space-y-3" onSubmit={(event) => void submit(event)} data-testid="account-password-form">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      <div className={compact ? "grid gap-3" : "grid gap-3 md:grid-cols-3"}>
        <Field label={l(currentLabelKey)} htmlFor="account-password-current" required>
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
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <p>{l("account_password_policy_hint")}</p>
      </div>
      <div className="flex justify-end border-t border-border/70 pt-3">
        <Button type="submit" size="sm" className="h-8 rounded-lg gap-1.5 text-xs" disabled={busy}>
          <KeyRound className="size-3.5" aria-hidden="true" />
          {l("account_password_submit")}
        </Button>
      </div>
    </form>
  );
}

function SessionsSection({ version }: { version: number }) {
  const { l } = useUiText();
  const { logout, user } = useAuth();
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
  }, [load, version]);

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

  const formatDate = (value: string) => formatAppDateTime(value) || value;

  return (
    <AccountSection
      title={l("account_sessions_title")}
      icon={Monitor}
      accessory={
        <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg gap-1.5 text-xs" disabled={busy} onClick={() => void logoutEverywhere()}>
          <LogOut className="size-3.5" aria-hidden="true" />
          {l("account_sessions_logout_all")}
        </Button>
      }
    >
      {error ? <Banner tone="error">{error}</Banner> : null}
      {sessions === null ? null : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{l("account_sessions_empty")}</p>
      ) : (
        <ul className="space-y-3" data-testid="account-sessions">
          {sessions.map((session) => {
            const device = describeSessionDevice(session) ?? l("account_sessions_unknown_device");
            const DeviceIcon = /iOS|Android/.test(device) ? Smartphone : Monitor;
            return (
              <li key={session.family_id} className="grid min-w-0 gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-center">
                <div className="hidden size-8 items-center justify-center text-foreground sm:flex">
                  <DeviceIcon className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 space-y-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="min-w-0 break-words">{device}</span>
                    {session.is_current ? (
                      <StatusChip tone="success">
                        <CheckCircle2 aria-hidden="true" />
                        {l("account_sessions_current")}
                      </StatusChip>
                    ) : null}
                  </p>
                  <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-2 text-xs">
                    {session.ip_address ? <div className="space-y-0.5">
                      <dt className="font-mono text-[10px] text-muted-foreground">IP</dt>
                      <dd className="break-all font-mono tabular-nums">{session.ip_address}</dd>
                    </div> : null}
                    <div className="space-y-0.5">
                      <dt className="font-mono text-[10px] text-muted-foreground">{l("account_sessions_last_seen")}</dt>
                      <dd className="font-mono tabular-nums">{user?.role === "patient" ? <PortalDateChip timestamp={session.last_activity_at} /> : formatDate(session.last_activity_at)}</dd>
                    </div>
                  </dl>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-fit rounded-lg gap-1.5 bg-card text-xs"
                  disabled={busy}
                  onClick={() => void revoke(session)}
                >
                  <LogOut className="size-3.5" aria-hidden="true" />
                  {session.is_current ? l("account_sessions_end_current") : l("account_sessions_revoke")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </AccountSection>
  );
}
