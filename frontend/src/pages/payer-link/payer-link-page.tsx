import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { GmedWordmark } from "@/components/gmed-wordmark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { payerSignaturePackageOf } from "@/pages/patient-lead/lead-request-payer-questionnaire-model";
import { LEAD_CABINET_LANGS, asLeadCabinetLang, type LeadCabinetLang } from "@/pages/patient-lead/lead-request-text";

import {
  PayerLinkError,
  createPayerLinkClient,
  type PayerLinkInfo,
  type PayerQuestionnaire,
  type PayerVerified,
} from "./payer-link-api";
import { PayerCodeStep } from "./payer-link-code-step";
import { PayerLinkForm, type LinkProblem } from "./payer-link-form";
import {
  LINK_STORAGE_KEY,
  PayerSecrets,
  SESSION_STORAGE_KEY,
  browserSessionStorage,
  captureLinkToken,
  isFatalKind,
  payerErrorKind,
  payerErrorMessage,
  type FatalKind,
  type PayerErrorKind,
} from "./payer-link-session";
import { Notice } from "./payer-link-parts";
import { payerLinkText } from "./payer-link-text";

/**
 * The payer's own page (contract phase 3a, 5.1): reached by the link in the
 * invitation e-mail, `/payer#<token>`, without an account. The token is taken
 * out of the address at once and kept for this tab only; the questionnaire
 * opens after a code mailed to the payer. Nothing of the staff app (session,
 * menu, `/me`) is used here.
 */

const PAYER_PATH = "/payer";

let secretsOfTab: PayerSecrets | null = null;

/** The secrets of this tab, created on first use (the storage may throw in a private window). */
function tabSecrets(): PayerSecrets {
  secretsOfTab ??= new PayerSecrets(browserSessionStorage());
  return secretsOfTab;
}

/**
 * Reads the token from `#<token>`, keeps it, and replaces the address by
 * `/payer` so the token is neither in the history nor in a bookmark nor in a
 * referrer. Safe to run twice (strict mode): the second run finds the stored token.
 */
function takeLinkFromAddress(secrets: PayerSecrets): string | null {
  if (typeof window === "undefined") return secrets.get(LINK_STORAGE_KEY);
  const { hash, search, pathname } = window.location;
  const token = captureLinkToken(hash, secrets);
  if (hash || search || pathname !== PAYER_PATH) {
    try {
      window.history.replaceState(window.history.state, "", PAYER_PATH);
    } catch {
      // An address that cannot be replaced still shows the page; the token is kept anyway.
    }
  }
  return token;
}

function browserLang(): LeadCabinetLang {
  if (typeof navigator === "undefined") return "de";
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const lang = asLeadCabinetLang(candidate);
    if (lang) return lang;
  }
  return "de";
}

/** Why the payer is at the code step again; the message is written in the language shown. */
type CodeNotice = "session_expired";

type View =
  | { kind: "loading" }
  | { kind: "fatal"; reason: FatalKind }
  | { kind: "failed"; reason: PayerErrorKind }
  | { kind: "code"; info: PayerLinkInfo; notice: CodeNotice | null }
  | { kind: "form"; info: PayerLinkInfo; questionnaire: PayerQuestionnaire };

/** The link this page works with; `generation` counts the links opened in this tab. */
type OpenLink = { token: string | null; generation: number };

export function PayerLinkPage() {
  const secrets = tabSecrets();
  // Before anything is shown: the token leaves the address.
  const [link, setLink] = useState<OpenLink>(() => ({ token: takeLinkFromAddress(secrets), generation: 0 }));
  const [view, setView] = useState<View>(() =>
    link.token ? { kind: "loading" } : { kind: "fatal", reason: "link_incomplete" },
  );
  const [chosenLang, setChosenLang] = useState<LeadCabinetLang | null>(null);
  const [linkLang, setLinkLang] = useState<LeadCabinetLang | null>(null);
  const [fallbackLang] = useState(browserLang);
  const lang = chosenLang ?? linkLang ?? fallbackLang;
  const text = payerLinkText(lang);
  // What answers late for a link this tab has left behind changes nothing.
  const generationRef = useRef(link.generation);
  generationRef.current = link.generation;

  const client = useMemo(
    () =>
      createPayerLinkClient({
        link: () => secrets.get(LINK_STORAGE_KEY),
        session: () => secrets.get(SESSION_STORAGE_KEY),
      }),
    [secrets],
  );

  const fail = useCallback(
    (cause: unknown, info: PayerLinkInfo | null) => {
      const error = cause instanceof PayerLinkError ? cause : null;
      const kind = error ? payerErrorKind(error.status, error.code) : "other";
      if (isFatalKind(kind)) {
        secrets.set(SESSION_STORAGE_KEY, null);
        setView({ kind: "fatal", reason: kind });
        return;
      }
      if (kind === "session" && info) {
        secrets.set(SESSION_STORAGE_KEY, null);
        setView({ kind: "code", info, notice: "session_expired" });
        return;
      }
      setView({ kind: "failed", reason: kind });
    },
    [secrets],
  );

  const load = useCallback(async () => {
    const generation = generationRef.current;
    const current = () => generation === generationRef.current;
    let info: PayerLinkInfo | null = null;
    try {
      const withSession = Boolean(secrets.get(SESSION_STORAGE_KEY));
      try {
        info = await client.info(withSession);
      } catch (cause) {
        // A stale session must not hide the link: ask again without it.
        if (!(withSession && cause instanceof PayerLinkError && payerErrorKind(cause.status, cause.code) === "session")) throw cause;
        if (!current()) return;
        secrets.set(SESSION_STORAGE_KEY, null);
        info = await client.info(false);
      }
      if (!current()) return;
      setLinkLang(asLeadCabinetLang(info.language));
      if (info.session_valid && secrets.get(SESSION_STORAGE_KEY)) {
        const questionnaire = await client.questionnaire();
        if (!current()) return;
        setView({ kind: "form", info, questionnaire });
      } else {
        secrets.set(SESSION_STORAGE_KEY, null);
        setView({ kind: "code", info, notice: null });
      }
    } catch (cause) {
      if (current()) fail(cause, info);
    }
  }, [client, fail, secrets]);

  // Loaded once per link, also under strict mode's second mount (opening the
  // link is recorded by the server); "try again" loads on request.
  const loadedGeneration = useRef<number | null>(null);
  useEffect(() => {
    if (!link.token || loadedGeneration.current === link.generation) return;
    loadedGeneration.current = link.generation;
    void load();
  }, [link, load]);

  // Another link opened in this tab changes only the fragment: the page takes
  // it like a fresh visit — the new token is kept, the old session goes.
  useEffect(() => {
    const opened = () => {
      if (!window.location.hash) return;
      const before = secrets.get(LINK_STORAGE_KEY);
      const token = takeLinkFromAddress(secrets);
      if (token && token === before) return;
      if (!token) {
        // A cut-off link: the one opened before is not used any more either.
        secrets.set(LINK_STORAGE_KEY, null);
        secrets.set(SESSION_STORAGE_KEY, null);
      }
      // At once, not with the next render: a late answer for the old link is ignored from now on.
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      setLinkLang(null);
      setLink({ token, generation });
      setView(token ? { kind: "loading" } : { kind: "fatal", reason: "link_incomplete" });
    };
    window.addEventListener("hashchange", opened);
    return () => window.removeEventListener("hashchange", opened);
  }, [secrets]);

  // The callbacks of the steps answer for the link they were shown for: one
  // that comes back after another link was opened in this tab is dropped.
  const generation = link.generation;
  const stale = useCallback(() => generation !== generationRef.current, [generation]);

  const verified = useCallback(
    (result: PayerVerified) => {
      if (stale()) return;
      secrets.set(SESSION_STORAGE_KEY, result.session);
      setView((current) =>
        current.kind === "code" ? { kind: "form", info: current.info, questionnaire: result.questionnaire } : current,
      );
      // Details sent before: where the documents for signing stand is asked for
      // once more, now with the session (the answer before the code may leave it out).
      if (result.questionnaire.state === "submitted" && result.questionnaire.signature_package === undefined) {
        client
          .info(true)
          .then((info) => {
            if (!stale()) setView((current) => (current.kind === "form" ? { ...current, info } : current));
          })
          .catch(() => {
            // The thanks are shown without it; the next visit asks again.
          });
      }
    },
    [client, secrets, stale],
  );

  const codeFatal = useCallback(
    (reason: FatalKind) => {
      if (stale()) return;
      secrets.set(SESSION_STORAGE_KEY, null);
      setView({ kind: "fatal", reason });
    },
    [secrets, stale],
  );

  const questionnaireChanged = useCallback(
    (questionnaire: PayerQuestionnaire) => {
      if (stale()) return;
      setView((current) => (current.kind === "form" ? { ...current, questionnaire } : current));
    },
    [stale],
  );

  const linkProblem = useCallback(
    (problem: LinkProblem) => {
      if (stale()) return;
      secrets.set(SESSION_STORAGE_KEY, null);
      if (problem === "session") {
        setView((current) =>
          current.kind === "form"
            ? {
                kind: "code",
                info: { ...current.info, code_sent_at: null, session_valid: false, state: current.questionnaire.state === "submitted" ? "submitted" : current.info.state },
                notice: "session_expired",
              }
            : current,
        );
        return;
      }
      setView({ kind: "fatal", reason: problem });
    },
    [secrets, stale],
  );

  const fatalMessage = (reason: FatalKind) => payerErrorMessage(reason, text);

  let body: ReactNode;
  switch (view.kind) {
    case "loading":
      body = (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground" role="status">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {text.loading}
        </div>
      );
      break;
    case "fatal":
      body = (
        <div className="space-y-3" data-testid="payer-link-fatal" data-reason={view.reason}>
          <h1 className="text-xl font-semibold leading-tight">{text.pageTitle}</h1>
          <Notice tone="error" role="alert">
            {fatalMessage(view.reason)}
          </Notice>
        </div>
      );
      break;
    case "failed":
      body = (
        <div className="space-y-3" data-testid="payer-link-failed">
          <h1 className="text-xl font-semibold leading-tight">{text.pageTitle}</h1>
          <Notice tone="error" role="alert">
            {text.loadFailed} {payerErrorMessage(view.reason, text)}
          </Notice>
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => {
              setView({ kind: "loading" });
              void load();
            }}
          >
            {text.retry}
          </Button>
        </div>
      );
      break;
    case "code":
      body = (
        <PayerCodeStep
          // A new notice (session ended) starts the step afresh.
          key={view.notice ?? "start"}
          info={view.info}
          text={text}
          client={client}
          notice={view.notice === "session_expired" ? text.sessionExpired : null}
          onVerified={verified}
          onFatal={codeFatal}
        />
      );
      break;
    case "form":
      body = (
        <div className="space-y-5">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold leading-tight">{text.pageTitle}</h1>
            <p className="text-sm leading-6 text-muted-foreground">{text.namedYou(view.questionnaire.patient_name)}</p>
          </div>
          <PayerLinkForm
            questionnaire={view.questionnaire}
            client={client}
            text={text}
            lang={lang}
            signature={payerSignaturePackageOf(view.questionnaire, view.info)}
            onQuestionnaire={questionnaireChanged}
            onLinkProblem={linkProblem}
          />
        </div>
      );
      break;
  }

  return (
    <div lang={lang} className="min-h-dvh bg-background text-foreground" data-testid="payer-link-page">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <span className="inline-flex shrink-0 items-center">
            <GmedWordmark className="h-6 w-auto text-[#04060c] dark:text-foreground" />
            <span className="sr-only">GMED</span>
          </span>
          <LanguageSwitch lang={lang} label={text.language} onChange={setChosenLang} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-16">
        {/* Another link opened in this tab starts every step afresh. */}
        <div key={generation} className="rounded-2xl border border-border bg-card px-4 py-5 shadow-sm sm:px-6 sm:py-6">
          {body}
        </div>
      </main>
    </div>
  );
}

function LanguageSwitch({ lang, label, onChange }: { lang: LeadCabinetLang; label: string; onChange: (lang: LeadCabinetLang) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg border border-border bg-card p-0.5" data-testid="payer-link-language">
      {LEAD_CABINET_LANGS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={lang === option.value}
          title={option.name}
          lang={option.value}
          className={cn(
            "min-w-9 rounded-md px-2 py-1 text-xs font-medium transition-colors",
            lang === option.value ? "bg-[var(--brand)] text-white" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
