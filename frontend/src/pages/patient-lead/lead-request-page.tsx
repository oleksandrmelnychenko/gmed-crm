import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Clock, LoaderCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Banner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { formatAppDate } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { setPortalAccountLabel } from "@/lib/portal-account-label";
import { isLeadPortalUser } from "@/lib/staff-route-access";
import { cn } from "@/lib/utils";

import {
  LEAD_REQUEST_ACCESS_CHANGED,
  fetchMyLeadRequest,
  fetchMyLeadRequestList,
  saveCabinetLanguage,
  type LeadRequest,
} from "./lead-request-api";
import { ServerConflictContext, useServerConflictRegistry } from "./lead-request-server-sync";
import { FollowUpStep } from "./lead-request-follow-up";
import { DisclosureStep } from "./lead-request-disclosure-step";
import {
  AutosaveFlushContext,
  AutosaveSavedContext,
  CabinetGoToContext,
  createRequestQueue,
  type AutosaveFlush,
  type CabinetGoTo,
  type RequestQueue,
} from "./lead-request-parts";
import { findCabinetTarget, revealCabinetTarget, type CabinetTarget } from "./lead-request-field-target";
import { SendStep } from "./lead-request-send-step";
import {
  BillingStep,
  ContactStep,
  DeclarationsStep,
  DocumentsStep,
  IdentityStep,
  PersonStep,
  type StepNav,
  type StepProps,
} from "./lead-request-step-forms";
import {
  initialStep,
  missingByStep,
  stepDone,
  stepMissingCount,
  visibleSteps,
  type StepId,
} from "./lead-request-steps";
import {
  LEAD_CABINET_LANGS,
  asLeadCabinetLang,
  leadRequestText,
  resolveLeadCabinetLang,
  type LeadCabinetLang,
  type LeadRequestText,
} from "./lead-request-text";

/**
 * Lead cabinet (owner decision 2026-10-03): the prospective patient — or a
 * parent for a minor — enters the personal data, uploads documents and sends
 * the request to the manager. Nothing else of the patient portal is shown.
 * Since the trigger flow (2026-10-07) the form is a stepper of short steps in
 * a wider layout, with the follow-up blocks as a step of their own.
 */
const CABINET_LANG_STORAGE_KEY = "gmed_lead_cabinet_lang";

function storedCabinetLang(): LeadCabinetLang | null {
  try {
    return asLeadCabinetLang(window.localStorage.getItem(CABINET_LANG_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function LeadRequestPage() {
  const [, setSearchParams] = useSearchParams();
  const { lang: portalLang, setLang: setPortalLang } = useLang();
  const { user, refreshUser } = useAuth();
  const accountLang = user?.preferred_language ?? null;
  const userId = user?.id ?? null;
  const leadMode = isLeadPortalUser(user);
  // The cabinet also speaks UA and EN (owner request 2026-10-04): an explicit
  // choice is remembered, otherwise the language the person entered for the
  // request is used, then the portal language.
  const [chosenLang, setChosenLang] = useState<LeadCabinetLang | null>(storedCabinetLang);
  const [requestLang, setRequestLang] = useState<LeadCabinetLang | null>(null);
  // A UA/EN choice saved on the account also holds on another device.
  const lang = resolveLeadCabinetLang(chosenLang ?? asLeadCabinetLang(accountLang), requestLang, portalLang);
  const text = leadRequestText(lang);
  const [requests, setRequests] = useState<LeadRequest[] | null>(null);
  // The own login of a minor whose parents have access reaches no request (QA 2026-10-12, A3-01).
  const [ownAccessClosed, setOwnAccessClosed] = useState(false);
  // A parent's access ended because the child came of age (QA 2026-10-23).
  const [guardianAccessEnded, setGuardianAccessEnded] = useState(false);
  const [guardianAccessEndedByCustody, setGuardianAccessEndedByCustody] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get("lead"));
  const [error, setError] = useState("");
  // Switching requests must not replace a queue whose uploads are still running.
  const [sessions] = useState(() => new Map<string, { enqueue: RequestQueue; flushers: Set<AutosaveFlush>; saved: () => void }>());
  const [saveBlocked, setSaveBlocked] = useState(false);
  const saveBlockedRef = useRef(false);
  saveBlockedRef.current = saveBlocked;
  const leaving = useRef(false);
  // The corrected entry saved itself: the notice that it could not be saved
  // goes once every part of the step is saved, without another step change.
  const savedAfterBlock = useCallback((leadId: string) => {
    if (!saveBlockedRef.current || leaving.current) return;
    const flushers = Array.from(sessions.get(leadId)?.flushers ?? []);
    void Promise.all(flushers.map((flush) => flush.save())).then((results) => {
      if (results.every(Boolean) && !leaving.current) setSaveBlocked(false);
    });
  }, [sessions]);
  const switchAfterSave = useCallback(async (leadId: string, action: () => void, onBlocked?: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    try {
      const flushers = sessions.get(leadId)?.flushers ?? new Set<AutosaveFlush>();
      for (;;) {
        const versions = new Map(Array.from(flushers, (flush) => [flush, flush.version()] as const));
        const results = await Promise.all(Array.from(versions.keys(), (flush) => flush.save()));
        if (!results.every(Boolean)) {
          setSaveBlocked(true);
          onBlocked?.();
          break;
        }
        // A different section may have changed while a slower save was running.
        // Include it (and newly mounted sections) before unmounting the step.
        if (Array.from(flushers).some((flush) => !versions.has(flush) || versions.get(flush) !== flush.version())) continue;
        setSaveBlocked(false);
        action();
        break;
      }
    } finally {
      leaving.current = false;
    }
  }, [sessions]);

  const chooseLang = useCallback(
    (next: LeadCabinetLang) => {
      setChosenLang(next);
      try {
        window.localStorage.setItem(CABINET_LANG_STORAGE_KEY, next);
      } catch {
        // The choice then lasts for this visit only.
      }
      // The rest of the portal (menu, account) speaks DE and RU.
      if (next === "de" || next === "ru") setPortalLang(next);
      // Kept on the account for the e-mails to this person (owner decision
      // 2026-10-24); best effort, the cabinet works without it.
      void saveCabinetLanguage(next).catch(() => undefined);
    },
    [setPortalLang],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const {
        requests: loaded,
        ownAccessClosed: closed,
        guardianAccessEnded: ended,
        guardianAccessEndedReason: endedReason,
      } = await fetchMyLeadRequestList();
      setRequestLang(asLeadCabinetLang(loaded[0]?.personal_data.primary_language));
      setOwnAccessClosed(closed);
      setGuardianAccessEnded(ended);
      setGuardianAccessEndedByCustody(endedReason === "custody_changed");
      setRequests(loaded);
      setSelected((current) =>
        current && loaded.some((request) => request.lead_id === current) ? current : loaded[0]?.lead_id ?? null,
      );
      // No request (left): staff may just have taken it over as a patient
      // record. The account then reaches the patient portal, which `/me`
      // says; the app switches to it on its own (H6, 2026-10-20).
      if (loaded.length === 0) void refreshUser().catch(() => { /* The page stays as it is. */ });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [refreshUser]);

  // Loaded again when the account changes between the cabinet and the patient portal.
  useEffect(() => {
    void load();
  }, [load, leadMode]);

  // A parent's login that fills in requests for a child only (and is no
  // patient of its own): the side bar names it "parent / legal
  // representative" instead of "patient".
  const ownPatient = user?.portal_mode === "patient";
  useEffect(() => {
    if (!userId || !requests) return;
    const guardianOnly =
      !ownPatient && requests.length > 0 && requests.every((request) => request.access_kind === "guardian");
    setPortalAccountLabel(userId, guardianOnly ? text.accountLabelGuardian : null);
  }, [ownPatient, requests, text, userId]);

  // First visit of a request in German or Russian: the whole portal takes that
  // language once, unless the account already has a language of its own (a
  // patient with the full portal); afterwards the person's own choice counts.
  useEffect(() => {
    if (chosenLang || accountLang) return;
    if (requestLang === "de" || requestLang === "ru") chooseLang(requestLang);
  }, [accountLang, chosenLang, requestLang, chooseLang]);

  const replaceRequest = useCallback((next: LeadRequest) => {
    setRequests((current) =>
      current ? current.map((request) => (request.lead_id === next.lead_id ? next : request)) : current,
    );
  }, []);

  if (error) {
    return (
      <LeadCabinetFrame lang={lang} onLang={chooseLang}>
        <Banner tone="error">{text.loadFailed}</Banner>
        <Button type="button" variant="outline" onClick={() => void load()}>
          {text.retry}
        </Button>
      </LeadCabinetFrame>
    );
  }
  if (!requests) {
    return (
      <LeadCabinetFrame lang={lang} onLang={chooseLang}>
        <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        </div>
      </LeadCabinetFrame>
    );
  }
  const request = requests.find((item) => item.lead_id === selected) ?? null;
  if (!request) {
    return (
      <LeadCabinetFrame lang={lang} onLang={chooseLang}>
        <h1 className="text-xl font-semibold">{text.title}</h1>
        <p
          className="text-sm text-muted-foreground"
          data-testid={ownAccessClosed ? "lead-request-guardian-only" : guardianAccessEnded ? "lead-request-guardian-access-ended" : undefined}
        >
          {ownAccessClosed
            ? text.guardianOnly
            : guardianAccessEnded
              ? guardianAccessEndedByCustody
                ? text.guardianAccessEndedNeutral
                : text.guardianAccessEnded
              : text.noRequest}
        </p>
        {/* The account has the patient portal (the request became a patient record): the way there. */}
        {!ownAccessClosed && !leadMode && user?.role === "patient" ? (
          <div className="space-y-3" data-testid="lead-request-patient-portal">
            <p className="text-sm">{text.noRequestPortal}</p>
            <Button type="button" onClick={() => window.location.assign("/")}>
              {text.openPatientPortal}
            </Button>
          </div>
        ) : null}
      </LeadCabinetFrame>
    );
  }

  let session = sessions.get(request.lead_id);
  if (!session) {
    const leadId = request.lead_id;
    session = { enqueue: createRequestQueue(), flushers: new Set(), saved: () => savedAfterBlock(leadId) };
    sessions.set(request.lead_id, session);
  }
  return (
    <LeadCabinetFrame lang={lang} onLang={chooseLang}>
      {requests.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={text.requestFor}>
          {requests.map((item) => (
            <button
              key={item.lead_id}
              type="button"
              role="tab"
              aria-selected={item.lead_id === request.lead_id}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm",
                item.lead_id === request.lead_id
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "border-border text-muted-foreground",
              )}
              onClick={() => { void switchAfterSave(request.lead_id, () => {
                setSelected(item.lead_id);
                setSearchParams((current) => {
                  const params = new URLSearchParams(current);
                  params.set("lead", item.lead_id);
                  return params;
                }, { replace: true });
              }); }}
            >
              {[item.personal_data.first_name, item.personal_data.last_name].filter(Boolean).join(" ")}
            </button>
          ))}
        </div>
      ) : null}
      {saveBlocked ? <div role="alert" data-testid="lead-request-save-blocked"><Banner tone="error">{text.saveBeforeLeaving}</Banner></div> : null}
      <AutosaveFlushContext.Provider value={session.flushers}>
        <AutosaveSavedContext.Provider value={session.saved}>
          <LeadRequestView key={request.lead_id} request={request} text={text} lang={lang} enqueue={session.enqueue} switchAfterSave={switchAfterSave} onChange={replaceRequest} onAccessLost={load} />
        </AutosaveSavedContext.Provider>
      </AutosaveFlushContext.Provider>
    </LeadCabinetFrame>
  );
}

export function LeadCabinetFrame({
  lang,
  onLang,
  children,
}: {
  lang: LeadCabinetLang;
  onLang: (lang: LeadCabinetLang) => void;
  children: ReactNode;
}) {
  // A request card shows the switch in its header (owner 2026-10-09); without one it stays on top.
  const [claimed, setClaimed] = useState(0);
  const claim = useCallback(() => {
    setClaimed((count) => count + 1);
    return () => setClaimed((count) => count - 1);
  }, []);
  const switchContext = useMemo(() => ({ lang, onLang, claim }), [lang, onLang, claim]);
  return (
    <CabinetLanguageContext.Provider value={switchContext}>
      <div className="mx-auto w-full max-w-[96rem] space-y-5 pb-16" data-testid="lead-cabinet">
        {claimed === 0 ? (
          <div className="flex justify-end">
            <CabinetLanguageSwitch lang={lang} onLang={onLang} />
          </div>
        ) : null}
        {children}
      </div>
    </CabinetLanguageContext.Provider>
  );
}

type CabinetLanguageSwitchContext = {
  lang: LeadCabinetLang;
  onLang: (lang: LeadCabinetLang) => void;
  claim: () => () => void;
};

const CabinetLanguageContext = createContext<CabinetLanguageSwitchContext | null>(null);

/** DE / EN / UA / RU of the cabinet. */
function CabinetLanguageSwitch({ lang, onLang }: { lang: LeadCabinetLang; onLang: (lang: LeadCabinetLang) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label={leadRequestText(lang).language}
      className="inline-flex rounded-lg border border-border bg-card p-0.5"
      data-testid="lead-cabinet-language"
    >
      {LEAD_CABINET_LANGS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={lang === option.value}
          title={option.name}
          lang={option.value}
          className={cn(
            "min-w-10 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            lang === option.value
              ? "bg-[var(--brand)] text-white"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          onClick={() => onLang(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function LeadRequestView({
  request,
  text,
  lang,
  onChange,
  onAccessLost,
  enqueue,
  switchAfterSave,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  onChange: (request: LeadRequest) => void;
  onAccessLost: () => Promise<void>;
  enqueue: RequestQueue;
  switchAfterSave: (leadId: string, action: () => void, onBlocked?: () => void) => Promise<void>;
}) {
  const guardian = request.access_kind === "guardian";
  const patientName = [request.personal_data.first_name, request.personal_data.last_name].filter(Boolean).join(" ");
  const latestRequest = useRef(request);
  useLayoutEffect(() => { latestRequest.current = request; }, [request]);
  const updateRequest = useCallback((next: LeadRequest) => {
    latestRequest.current = next;
    onChange(next);
  }, [onChange]);
  // Both parents may edit at once (owner decision 2026-10-23): the request is
  // read again when the tab is shown again, the window gets the focus or the
  // other parent's save arrives as `lead.portal_updated`. Through the write
  // queue, so it never overtakes a save; the forms keep what is being typed.
  const conflictRegistry = useServerConflictRegistry(guardian ? text.serverChangedByParent : text.serverChangedField);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const refresh = useRef({ running: false, again: false, last: 0 });
  const refreshFromServer = useCallback(function reread(cause: "focus" | "event") {
    const state = refresh.current;
    if (state.running) {
      state.again = true;
      return;
    }
    // The focus and the visibility change come together: one read for both.
    if (cause === "focus" && Date.now() - state.last < 1000) return;
    state.running = true;
    state.last = Date.now();
    const leadId = latestRequest.current.lead_id;
    void enqueue(() => fetchMyLeadRequest(leadId))
      .then((fresh) => {
        if (fresh.lead_id === latestRequest.current.lead_id && JSON.stringify(fresh) !== JSON.stringify(latestRequest.current)) {
          updateRequest(fresh);
        }
      })
      .catch(() => { /* The next focus or event reads it again. */ })
      .finally(() => {
        state.running = false;
        if (state.again) {
          state.again = false;
          reread("event");
        }
      });
  }, [enqueue, updateRequest]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refreshFromServer("focus"); };
    const onFocus = () => refreshFromServer("focus");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshFromServer]);
  useRealtimeSubscription(["lead.portal_updated"], (event) => {
    if (event.entity_id !== latestRequest.current.lead_id) return;
    // The own saves already answered with the request.
    if (userId && event.actor_user_id === userId) return;
    refreshFromServer("event");
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStep = searchParams.get("step");
  const [chosenStep, setChosenStep] = useState<StepId>(() => visibleSteps(request).find((step) => step === requestedStep) ?? initialStep(request));
  useEffect(() => {
    const reload = () => { void onAccessLost(); };
    window.addEventListener(LEAD_REQUEST_ACCESS_CHANGED, reload);
    return () => window.removeEventListener(LEAD_REQUEST_ACCESS_CHANGED, reload);
  }, [onAccessLost]);
  const deadline = request.retention_deadline_at ? formatAppDate(request.retention_deadline_at) : "";
  const steps = visibleSteps(request);
  // "Ergänzende Angaben" exists only while the server opened blocks.
  const step: StepId = steps.includes(chosenStep) ? chosenStep : "send";
  const missing = missingByStep(request);
  const position = steps.indexOf(step);
  const topRef = useRef<HTMLElement | null>(null);
  const languageSwitch = useContext(CabinetLanguageContext);
  useEffect(() => languageSwitch?.claim(), [languageSwitch?.claim]);

  // Base-step badges appear after "next" or opening the summary. Live country
  // questions expose their pending count as soon as the server opens them.
  const [missingShownSteps, setMissingShownSteps] = useState<ReadonlySet<StepId>>(() => new Set());
  const [sendOpened, setSendOpened] = useState(() => initialStep(request) === "send");
  // The first "next" on any step shows the badges of every step (owner decision 2026-10-22):
  // on step 1 the lead already sees that step 2 still needs its documents.
  const [nextPressed, setNextPressed] = useState(false);
  const showMissingOf = useCallback((id: StepId) => {
    setMissingShownSteps((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);
  const badgesFor = useCallback(
    // A request sent once was checked as a whole: its base-step badges show.
    // Staff follow-up is sent separately; live country questions show their pending count immediately.
    (id: StepId) =>
      nextPressed || missingShownSteps.has(id) || (id === "follow_up"
        ? request.follow_up?.before_submit === true
        : sendOpened || Boolean(request.submitted_at)),
    [missingShownSteps, nextPressed, request.submitted_at, request.follow_up?.before_submit, sendOpened],
  );

  // The section or field a link points to (a box of another step, a missing item, the summary):
  // revealed once its step is on screen. Set in the same render as the step it belongs to; a part
  // that renders a moment later (a loaded section) is waited for a few frames.
  const stepRef = useRef<HTMLDivElement | null>(null);
  const [pendingTarget, setPendingTarget] = useState<CabinetTarget | null>(null);
  useEffect(() => {
    if (!pendingTarget) return;
    let frame = 0;
    let tries = 0;
    const reveal = () => {
      const found = findCabinetTarget(pendingTarget, stepRef.current ?? document);
      if (found) {
        revealCabinetTarget(found);
        return;
      }
      if (++tries < 20) frame = window.requestAnimationFrame(reveal);
    };
    reveal();
    return () => window.cancelAnimationFrame(frame);
  }, [pendingTarget]);

  const go = useCallback((next: StepId, validateCurrent = false, target?: CabinetTarget) => {
    if (validateCurrent) setNextPressed(true);
    // A link into the step on screen needs no saving and no step change: it only shows the field.
    if (next === step && target) {
      setPendingTarget({ ...target });
      return;
    }
    void switchAfterSave(request.lead_id, () => {
      // All sections have now saved. The pre-save render can still list fields
      // the user just completed, especially in Insurance & Invoice.
      if (validateCurrent && !missingShownSteps.has(step) && stepMissingCount(latestRequest.current, step) > 0) {
        showMissingOf(step);
        return;
      }
      setChosenStep(next);
      setSearchParams((current) => {
        const params = new URLSearchParams(current);
        params.set("lead", request.lead_id);
        params.set("step", next);
        return params;
      }, { replace: true });
      if (next === "send") setSendOpened(true);
      if (target?.anchor || target?.field) {
        // A fresh object: the same section asked for again scrolls again.
        setPendingTarget({ ...target });
        return;
      }
      // A long step was left at its bottom: the next one starts at its top.
      const top = topRef.current;
      if (top && top.getBoundingClientRect().top < 0) {
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        top.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
      }
    }, () => {
      // An incomplete local draft may never reach server validation. Next must
      // still reveal its required fields while preserving the unsaved values.
      if (validateCurrent) showMissingOf(step);
      // The step stays because an entry could not be saved: show that entry (its
      // message), not only the banner above the card, which may be out of sight.
      const problem = stepRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]');
      if (problem) revealCabinetTarget({ element: problem, field: true });
      else window.requestAnimationFrame(() => document.querySelector('[data-testid="lead-request-save-blocked"]')?.scrollIntoView?.({ block: "nearest" }));
    });
  }, [switchAfterSave, request.lead_id, setSearchParams, missingShownSteps, step, showMissingOf]);

  const nav: StepNav = {
    index: position + 1,
    total: steps.length,
    onBack: position > 0 ? () => go(steps[position - 1]) : null,
    onNext: position < steps.length - 1 ? () => go(steps[position + 1], true) : null,
    missingShown: missingShownSteps.has(step),
    onShowMissing: () => showMissingOf(step),
  };
  const props: StepProps = { request, text, lang, enqueue, onChange: updateRequest, missing: missing[step], nav };
  const goTo: CabinetGoTo = (next, target) => go(next, false, target);

  return (
    <ServerConflictContext.Provider value={conflictRegistry}>
      {/* `overflow-clip`, not `hidden`: a hidden box would be the scroll container of the sticky step footer. */}
      <article ref={topRef} className="flex min-h-[calc(100dvh-9rem)] flex-col overflow-clip rounded-xl border border-border bg-card shadow-sm" data-testid="lead-request">
        {/* The title and the deadline share one line (wrapping on a phone). */}
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-4 sm:px-5">
          <h1 className="text-lg font-semibold leading-tight">
            {/* "Request for your child" only for a minor; an adult's representative reads "Request for <name>". */}
            {guardian
              ? request.minor
                ? `${text.titleGuardian}: ${patientName}`
                : `${text.requestFor} ${patientName}`
              : text.title}
          </h1>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {deadline && !request.submitted_at ? (
              <div
                className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                data-testid="lead-request-deadline"
              >
                <Clock aria-hidden="true" className="size-4 shrink-0" />
                <p className="font-medium">{text.deadline(deadline)}</p>
              </div>
            ) : null}
            {languageSwitch ? <CabinetLanguageSwitch lang={languageSwitch.lang} onLang={languageSwitch.onLang} /> : null}
          </div>
        </header>

        <div className="flex-1 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
          <StepNavBar
            request={request}
            text={text}
            steps={steps}
            current={step}
            missing={missing}
            badgesFor={badgesFor}
            onSelect={go}
          />
          {/* A short step keeps its footer at the bottom of the column; a new step fades in instead of jumping. */}
          <CabinetGoToContext.Provider value={goTo}>
          <div
            key={step}
            ref={stepRef}
            className="min-w-0 bg-muted/40 px-4 pt-5 sm:px-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200 lg:flex lg:flex-col lg:[&>section]:flex lg:[&>section]:flex-1 lg:[&>section]:flex-col"
            data-testid="lead-request-step"
            data-current-step={step}
          >
            {step === "person" ? <PersonStep {...props} /> : null}
            {step === "contact" ? <ContactStep {...props} /> : null}
            {step === "identity" ? <IdentityStep {...props} /> : null}
            {step === "billing" ? <BillingStep {...props} /> : null}
            {step === "declarations" ? <DeclarationsStep {...props} /> : null}
            {step === "follow_up" ? (
              <FollowUpStep
                request={request}
                text={text}
                lang={lang}
                enqueue={enqueue}
                onChange={onChange}
                onBack={() => nav.onBack?.()}
                onNext={() => nav.onNext?.()}
                missingShown={nav.missingShown || (!request.submitted_at && sendOpened)}
                onShowMissing={nav.onShowMissing}
                index={nav.index}
                total={nav.total}
              />
            ) : null}
            {step === "documents" ? <DocumentsStep {...props} /> : null}
            {step === "disclosure" ? <DisclosureStep {...props} /> : null}
            {step === "send" ? (
              <SendStep
                request={request}
                text={text}
                lang={lang}
                enqueue={enqueue}
                onChange={onChange}
                onEdit={goTo}
                index={nav.index}
                total={nav.total}
              />
            ) : null}
          </div>
          </CabinetGoToContext.Provider>
        </div>
      </article>
    </ServerConflictContext.Provider>
  );
}

/**
 * The step tabs (contract 6): on a computer a column beside the form, on a
 * tablet a wrapping row, on a phone a row of numbered dots with the current step's
 * name below — one step at a time, no horizontal scrolling of the page. A
 * tab whose "next" showed what is missing (or every tab once the summary was
 * opened) carries a badge with the count of what its step still misses; a
 * complete step carries a check. Every step can be opened at any time.
 */
function StepNavBar({
  request,
  text,
  steps,
  current,
  missing,
  badgesFor,
  onSelect,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  steps: StepId[];
  current: StepId;
  missing: Record<StepId, string[]>;
  badgesFor: (step: StepId) => boolean;
  onSelect: (step: StepId) => void;
}) {
  const position = steps.indexOf(current);
  return (
    <nav
      aria-label={text.stepsLabel}
      className="border-b border-border px-3 py-2.5 sm:px-4 lg:border-b-0 lg:border-r lg:px-3 lg:py-4"
      data-testid="lead-request-steps"
    >
      <div
        role="tablist"
        aria-label={text.stepsLabel}
        className={cn(
          "flex items-center gap-0.5 sm:gap-1 lg:sticky lg:top-4 lg:flex-col lg:items-stretch lg:gap-0.5",
          // A phone shows the dots side by side over the whole width; a tablet wraps the named tabs
          // onto a second line instead of cutting or scrolling them (QA 2026-10-10).
          "max-sm:justify-between sm:flex-wrap lg:flex-nowrap",
        )}
      >
        {steps.map((id, index) => {
          const selected = id === current;
          const count = id === "send" || !badgesFor(id) ? 0 : stepMissingCount(request, id, missing);
          const done = stepDone(request, id, missing);
          return (
            <button
              key={id}
              type="button"
              role="tab"
              data-step={id}
              aria-selected={selected}
              aria-current={selected ? "step" : undefined}
              className={cn(
                "relative flex shrink-0 items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs font-medium",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5 lg:w-full lg:py-2",
                selected
                  ? "bg-[var(--brand)] font-semibold text-white"
                  : "text-foreground hover:bg-muted/60",
              )}
              onClick={() => onSelect(id)}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] leading-none",
                  selected
                    ? "bg-white/20 text-white"
                    : done
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {done && !selected ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className="whitespace-nowrap max-sm:sr-only lg:min-w-0 lg:flex-1 lg:whitespace-normal lg:leading-snug">
                {text.steps[id]}
              </span>
              {count > 0 ? (
                <>
                  <span
                    aria-hidden="true"
                    data-testid="lead-request-step-badge"
                    className={cn(
                      "inline-flex min-w-4 items-center justify-center rounded-full px-1 py-0.5 font-mono text-[10px] leading-none",
                      "max-sm:absolute max-sm:-right-0.5 max-sm:-top-0.5",
                      "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
                    )}
                  >
                    {count}
                  </span>
                  <span className="sr-only">{text.stepMissingBadge(count)}</span>
                </>
              ) : done ? (
                <span className="sr-only">{text.stepComplete}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {/* On a phone the dots carry no names: the current step is named below them. */}
      <p className="mt-2 text-xs text-muted-foreground sm:hidden" data-testid="lead-request-step-title">
        {text.stepOf(position + 1, steps.length)} · <span className="font-semibold text-foreground">{text.steps[current]}</span>
      </p>
    </nav>
  );
}
