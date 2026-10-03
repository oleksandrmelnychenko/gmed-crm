/**
 * Sanctions screening pieces shared by the lead wizard, the leads list, the
 * admin settings and the CEO review page.
 */
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { CircleCheck, LoaderCircle, ShieldAlert } from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Banner, Field, StatusBadge, textareaClass } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAppDate } from "@/lib/app-time-zone";
import { formatUiText, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  sanctionsApi,
  type LeadSanctionsFlag,
  type LeadSanctionsStatus,
  type LiveCheckInput,
  type LiveCheckResult,
} from "./api";
import {
  LIVE_CHECK_DEBOUNCE_MS,
  leadBanners,
  leadFlagBadge,
  liveCheckKey,
  reasonIsValid,
} from "./model";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Fired after a live check found a possible match, so banners reload. */
const SANCTIONS_CHANGED_EVENT = "gmed:sanctions-changed";

function announceSanctionsChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SANCTIONS_CHANGED_EVENT));
}

/** A reason dialog for the CEO's decisions (mandatory, at least 10 characters). */
export function SanctionsReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  children,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  children?: ReactNode;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLang();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
      setError("");
    }
  }, [open]);

  const valid = reasonIsValid(reason);

  const submit = async () => {
    if (!valid) {
      setError(t.sanctions_reason_too_short);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (submitError) {
      setError(errorText(submitError, t.common_error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)} dirty={Boolean(reason)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label={t.sanctions_reason} htmlFor={reasonId} required>
            <textarea
              id={reasonId}
              className={cn(textareaClass, "min-h-24")}
              value={reason}
              maxLength={2000}
              disabled={busy}
              aria-describedby={`${reasonId}-hint`}
              aria-invalid={Boolean(error) && !valid}
              onChange={(event) => setReason(event.target.value)}
            />
            <p id={`${reasonId}-hint`} className="text-xs text-muted-foreground">
              {t.sanctions_reason_hint}
            </p>
          </Field>
          {error ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t.common_cancel}
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy || !valid}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type LiveCheckState =
  | { phase: "idle" }
  | { phase: "checking"; key: string }
  | { phase: "done"; key: string; result: LiveCheckResult }
  | { phase: "error"; key: string };

/**
 * Debounced live check of a name. Typing is never blocked; an outdated answer
 * is dropped.
 */
export function useSanctionsLiveCheck(input: LiveCheckInput | null): LiveCheckState {
  const key = liveCheckKey(input);
  const [state, setState] = useState<LiveCheckState>({ phase: "idle" });

  useEffect(() => {
    if (!input || !key) {
      setState({ phase: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ phase: "checking", key });
      sanctionsApi
        .check(input, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setState({ phase: "done", key, result });
        })
        .catch((checkError: unknown) => {
          if (controller.signal.aborted) return;
          // Read-only roles may not run the check: show nothing.
          const forbidden = (checkError as { status?: number } | null)?.status === 403;
          setState(forbidden ? { phase: "idle" } : { phase: "error", key });
        });
    }, LIVE_CHECK_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `key` covers every screened field of `input`.
  }, [key]);

  return state;
}

/** One line under the name fields of wizard step 1. */
export function SanctionsLiveCheckNotice({
  input,
  className,
}: {
  input: LiveCheckInput | null;
  className?: string;
}) {
  const { t } = useLang();
  const state = useSanctionsLiveCheck(input);
  const possible = state.phase === "done" && state.result.status === "possible_match";

  useEffect(() => {
    // The server screened the saved lead with the check; the banner reloads.
    if (possible) announceSanctionsChange();
  }, [possible]);

  if (state.phase === "idle") return null;
  let tone = "text-muted-foreground";
  let icon: ReactNode = <LoaderCircle className="size-3.5 animate-spin" aria-hidden />;
  let text = t.sanctions_live_checking;
  if (state.phase === "error") {
    icon = <ShieldAlert className="size-3.5" aria-hidden />;
    text = t.sanctions_live_error;
  } else if (state.phase === "done") {
    if (state.result.status === "clear") {
      tone = "text-emerald-700";
      icon = <CircleCheck className="size-3.5" aria-hidden />;
      text = formatUiText(t.sanctions_live_clear, {
        date: state.result.list_version_date ? formatAppDate(state.result.list_version_date) : "—",
      });
    } else if (state.result.status === "possible_match") {
      tone = "rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800";
      icon = <ShieldAlert className="size-3.5" aria-hidden />;
      text = t.sanctions_live_possible;
    } else {
      tone = "text-amber-700";
      icon = <ShieldAlert className="size-3.5" aria-hidden />;
      text = t.sanctions_live_unavailable;
    }
  }
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="sanctions-live-check"
      className={cn("flex items-center gap-1.5 text-xs leading-5", tone, className)}
    >
      {icon}
      <span>{text}</span>
    </p>
  );
}

/**
 * Sanctions and blocked-country banners of a lead, with the CEO's lift of
 * the country block. Reloads when `refreshKey` changes.
 */
export function SanctionsLeadBanner({
  leadId,
  refreshKey,
  className,
}: {
  leadId: string | null;
  refreshKey?: unknown;
  className?: string;
}) {
  const { t, lang } = useLang();
  const [status, setStatus] = useState<LeadSanctionsStatus | null>(null);
  const [liftOpen, setLiftOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const load = useCallback(() => {
    if (!leadId) {
      setStatus(null);
      return () => undefined;
    }
    let cancelled = false;
    sanctionsApi
      .leadStatus(leadId)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  useEffect(() => load(), [load, refreshKey]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const reload = () => {
      cleanup?.();
      cleanup = load();
    };
    window.addEventListener(SANCTIONS_CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener(SANCTIONS_CHANGED_EVENT, reload);
      cleanup?.();
    };
  }, [load]);

  const banners = leadBanners(status, t, lang);
  if (!status || banners.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)} data-testid="sanctions-lead-banner">
      {banners.map((banner) => (
        <Banner
          key={banner.kind}
          tone={banner.kind === "confirmed" ? "error" : "warning"}
          withIcon
        >
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">{banner.text}</span>
            {(banner.kind === "review" || banner.kind === "confirmed") && status.can_review ? (
              <StaffLink to="/sanctions" className="shrink-0 text-xs font-semibold underline underline-offset-2">
                {t.sanctions_banner_open_review}
              </StaffLink>
            ) : null}
            {banner.kind === "country" && status.can_lift_country_block ? (
              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setLiftOpen(true)}>
                {t.sanctions_country_lift}
              </Button>
            ) : null}
            {banner.kind === "country_lifted" && status.can_lift_country_block && status.country.lift ? (
              <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={() => setRevokeOpen(true)}>
                {t.sanctions_country_revoke}
              </Button>
            ) : null}
          </div>
        </Banner>
      ))}
      {status.can_lift_country_block && leadId ? (
        <>
          <SanctionsReasonDialog
            open={liftOpen}
            title={t.sanctions_country_lift_title}
            description={t.sanctions_country_lift_hint}
            confirmLabel={t.sanctions_country_lift}
            onConfirm={async (reason) => {
              await sanctionsApi.liftLeadCountryBlock(leadId, reason);
              announceSanctionsChange();
            }}
            onClose={() => setLiftOpen(false)}
          />
          <SanctionsReasonDialog
            open={revokeOpen}
            title={t.sanctions_country_revoke_title}
            confirmLabel={t.sanctions_country_revoke}
            destructive
            onConfirm={async (reason) => {
              if (status.country.lift) {
                await sanctionsApi.revokeCountryLift(status.country.lift.id, reason);
              }
              announceSanctionsChange();
            }}
            onClose={() => setRevokeOpen(false)}
          />
        </>
      ) : null}
    </div>
  );
}

/** Loads the leads-list flags once per `refreshKey`. */
export function useLeadSanctionsFlags(enabled: boolean, refreshKey?: unknown) {
  const [flags, setFlags] = useState<Map<string, LeadSanctionsFlag["flag"]>>(() => new Map());
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    sanctionsApi
      .leadFlags()
      .then((items) => {
        if (!cancelled) setFlags(new Map(items.map((item) => [item.lead_id, item.flag])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey]);
  return flags;
}

/** Badge of a lead in the leads list. */
export function LeadSanctionsBadge({ flag }: { flag: LeadSanctionsFlag["flag"] | undefined }) {
  const { t } = useLang();
  if (!flag) return null;
  const badge = leadFlagBadge(flag, t);
  return (
    <StatusBadge tone={badge.tone} className="shrink-0">
      {badge.label}
    </StatusBadge>
  );
}
