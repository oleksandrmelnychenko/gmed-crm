import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Clock, LoaderCircle } from "lucide-react";

import { Banner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { formatAppDate } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { setPortalAccountLabel } from "@/lib/portal-account-label";
import { cn } from "@/lib/utils";

import { fetchMyLeadRequests, type LeadRequest } from "./lead-request-api";
import { FollowUpStep } from "./lead-request-follow-up";
import { useRequestQueue, type RequestQueue } from "./lead-request-parts";
import { SendStep } from "./lead-request-send-step";
import {
  BillingStep,
  ContactStep,
  DeclarationsStep,
  DocumentsStep,
  IdentityStep,
  PayerStep,
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
  const { lang: portalLang, setLang: setPortalLang } = useLang();
  const { user } = useAuth();
  const accountLang = user?.preferred_language ?? null;
  const userId = user?.id ?? null;
  // The cabinet also speaks UA and EN (owner request 2026-10-04): an explicit
  // choice is remembered, otherwise the language the person entered for the
  // request is used, then the portal language.
  const [chosenLang, setChosenLang] = useState<LeadCabinetLang | null>(storedCabinetLang);
  const [requestLang, setRequestLang] = useState<LeadCabinetLang | null>(null);
  const lang = resolveLeadCabinetLang(chosenLang, requestLang, portalLang);
  const text = leadRequestText(lang);
  const [requests, setRequests] = useState<LeadRequest[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

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
    },
    [setPortalLang],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const loaded = await fetchMyLeadRequests();
      setRequestLang(asLeadCabinetLang(loaded[0]?.personal_data.primary_language));
      setRequests(loaded);
      setSelected((current) =>
        current && loaded.some((request) => request.lead_id === current) ? current : loaded[0]?.lead_id ?? null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
        <p className="text-sm text-muted-foreground">{text.noRequest}</p>
      </LeadCabinetFrame>
    );
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
              onClick={() => setSelected(item.lead_id)}
            >
              {[item.personal_data.first_name, item.personal_data.last_name].filter(Boolean).join(" ")}
            </button>
          ))}
        </div>
      ) : null}
      <LeadRequestView key={request.lead_id} request={request} text={text} lang={lang} onChange={replaceRequest} />
    </LeadCabinetFrame>
  );
}

function LeadCabinetFrame({
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
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  onChange: (request: LeadRequest) => void;
}) {
  const guardian = request.access_kind === "guardian";
  const [chosenStep, setChosenStep] = useState<StepId>(() => initialStep(request));
  // One queue for the writes of all steps: the last answer shown is the newest state.
  const enqueue: RequestQueue = useRequestQueue();
  const deadline = request.retention_deadline_at ? formatAppDate(request.retention_deadline_at) : "";
  const steps = visibleSteps(request);
  // "Ergänzende Angaben" exists only while the server opened blocks.
  const step: StepId = steps.includes(chosenStep) ? chosenStep : "person";
  const missing = missingByStep(request);
  const position = steps.indexOf(step);
  const topRef = useRef<HTMLElement | null>(null);
  const languageSwitch = useContext(CabinetLanguageContext);
  useEffect(() => languageSwitch?.claim(), [languageSwitch?.claim]);

  // The steps whose "next" showed what is missing, and whether the summary of step "send"
  // was opened: only those carry the amber count badges (QA 2026-10-10: none before "next").
  const [missingShownSteps, setMissingShownSteps] = useState<ReadonlySet<StepId>>(() => new Set());
  const [sendOpened, setSendOpened] = useState(() => initialStep(request) === "send");
  const showMissingOf = useCallback((id: StepId) => {
    setMissingShownSteps((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);
  const badgesFor = useCallback(
    // A request sent once was checked as a whole: its badges show. The follow-up
    // step is sent on its own: its badge only after "next" or "send" on it (QA 2026-10-10).
    (id: StepId) =>
      id === "follow_up"
        ? missingShownSteps.has(id)
        : sendOpened || Boolean(request.submitted_at) || missingShownSteps.has(id),
    [missingShownSteps, request.submitted_at, sendOpened],
  );

  const go = useCallback((next: StepId) => {
    setChosenStep(next);
    if (next === "send") setSendOpened(true);
    // A long step was left at its bottom: the next one starts at its top.
    const top = topRef.current;
    if (top && top.getBoundingClientRect().top < 0) {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      top.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    }
  }, []);

  const nav: StepNav = {
    index: position + 1,
    total: steps.length,
    onBack: position > 0 ? () => go(steps[position - 1]) : null,
    onNext: position < steps.length - 1 ? () => go(steps[position + 1]) : null,
    missingShown: missingShownSteps.has(step),
    onShowMissing: () => showMissingOf(step),
  };
  const props: StepProps = { request, text, lang, enqueue, onChange, missing: missing[step], nav };

  return (
    // `overflow-clip`, not `hidden`: a hidden box would be the scroll container of the sticky step footer.
    <article ref={topRef} className="flex min-h-[calc(100dvh-9rem)] flex-col overflow-clip rounded-xl border border-border bg-card shadow-sm" data-testid="lead-request">
      {/* The title and the deadline share one line (wrapping on a phone). */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-4 sm:px-5">
        <h1 className="text-lg font-semibold leading-tight">
          {guardian
            ? `${text.titleGuardian}: ${[request.personal_data.first_name, request.personal_data.last_name].filter(Boolean).join(" ")}`
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
        <div
          key={step}
          className="min-w-0 bg-muted/40 px-4 pt-5 sm:px-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200 lg:flex lg:flex-col lg:[&>section]:flex lg:[&>section]:flex-1 lg:[&>section]:flex-col"
          data-testid="lead-request-step"
          data-current-step={step}
        >
          {step === "person" ? <PersonStep {...props} /> : null}
          {step === "contact" ? <ContactStep {...props} /> : null}
          {step === "identity" ? <IdentityStep {...props} /> : null}
          {step === "payer" ? <PayerStep {...props} /> : null}
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
              missingShown={nav.missingShown}
              onShowMissing={nav.onShowMissing}
              index={nav.index}
              total={nav.total}
            />
          ) : null}
          {step === "documents" ? <DocumentsStep {...props} /> : null}
          {step === "send" ? (
            <SendStep
              request={request}
              text={text}
              lang={lang}
              enqueue={enqueue}
              onChange={onChange}
              onEdit={go}
              index={nav.index}
              total={nav.total}
            />
          ) : null}
        </div>
      </div>
    </article>
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
                  ? "bg-muted font-semibold text-foreground lg:before:absolute lg:before:left-0 lg:before:top-1.5 lg:before:bottom-1.5 lg:before:w-[3px] lg:before:rounded-r-full lg:before:bg-[var(--brand)]"
                  : "text-foreground hover:bg-muted/60",
              )}
              onClick={() => onSelect(id)}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] leading-none",
                  selected
                    ? "bg-[var(--brand)] text-white"
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
