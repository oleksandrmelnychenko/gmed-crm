import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

import { StatusBadge } from "@/components/ui-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { fetchPatientPayerSummary } from "../../data/patient-payer-summary-api";
import {
  contactConsentLabel,
  contactLine,
  contractingPartyIsRepresentatives,
  contractingPartyLabel,
  conversionNote,
  defaultPayerBadgeLabel,
  identificationLines,
  invoiceRecipientSourceNote,
  isThirdPartyPayer,
  leadPath,
  minorWithoutPayerWarning,
  missingAddressWarning,
  normalizePatientPayerSummary,
  openLeadLabel,
  openRequestNote,
  payerChangedElsewhereNote,
  payerDisplayName,
  payerInformedLabel,
  payerRelationshipLabel,
  payerSummaryLoadFailure,
  postalAddressLine,
  whoPaysLabel,
  type PatientPayerSummary,
  type Tx,
} from "../../model/patient-payer-summary";

export type PatientPayerSummaryState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "loaded"; summary: PatientPayerSummary };

const TEST_ID = "patient-payer-summary";

// The look of the profile cards (`ProfileSummaryCard`, `ProfileSummaryLine`
// in patient-profile-section.tsx), without the edit affordance: the card is
// read-only.
function SummaryCard({
  title,
  state,
  children,
}: {
  title: ReactNode;
  state: PatientPayerSummaryState["status"];
  children: ReactNode;
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border border-border/70 bg-card"
      data-testid={TEST_ID}
      data-state={state}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="min-w-0 break-words text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </h3>
        </div>
      </div>
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  );
}

function SummaryLine({
  label,
  value,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  testId: string;
}) {
  return (
    <div
      className="grid min-w-0 gap-1.5 px-3.5 py-2.5 sm:grid-cols-[minmax(10rem,0.4fr)_minmax(0,1fr)] sm:items-start sm:gap-3"
      data-testid={testId}
    >
      <span className="min-w-0 break-words text-xs font-medium text-muted-foreground sm:text-[13px]">
        {label}
      </span>
      <span className="min-w-0 break-words text-sm font-medium leading-snug text-foreground">
        {value}
      </span>
    </div>
  );
}

function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-3.5 pb-1 pt-2.5 text-[11px] font-medium uppercase text-muted-foreground">
      {children}
    </p>
  );
}

function Muted({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <span className="block break-words text-[11px] font-normal leading-4 text-muted-foreground" data-testid={testId}>
      {children}
    </span>
  );
}

function Warning({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <span
      data-testid={testId}
      className="block break-words text-xs font-medium leading-4 text-amber-700 dark:text-amber-300"
    >
      {children}
    </span>
  );
}

function OpenLeadLink({ leadId, onOpenLead, tx }: { leadId: string; onOpenLead: (to: string) => void; tx: Tx }) {
  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-1 text-left text-[var(--brand)] underline-offset-2 hover:underline"
      onClick={() => onOpenLead(leadPath(leadId))}
      data-testid={`${TEST_ID}-open-lead`}
    >
      <span className="break-words">{openLeadLabel(tx)}</span>
      <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
    </button>
  );
}

// A long label wraps on a phone instead of widening the card (the wizard's
// identification block does the same).
const IDENTIFICATION_LABEL_CLASS = "h-auto min-h-5 max-w-full shrink justify-start rounded-[10px] text-left leading-4 whitespace-normal";

function LoadedCard({
  summary,
  lang,
  canOpenLead,
  onOpenLead,
}: {
  summary: PatientPayerSummary;
  lang: Lang;
  canOpenLead: boolean;
  onOpenLead: (to: string) => void;
}) {
  const tx: Tx = (ru, de) => (lang === "de" ? de : ru);
  const { declaration, contracting_party: party, invoice_recipient: recipient, identification, source, open_request: openRequest } = summary;
  const thirdParty = isThirdPartyPayer(declaration) ? declaration : null;
  const addressWarning = recipient ? missingAddressWarning(recipient, tx) : null;
  const identificationRows = identification ? identificationLines(identification, tx) : [];

  return (
    <SummaryCard title={tx("Плательщик", "Zahler")} state="loaded">
      <SummaryLine
        label={tx("Кто платит", "Wer zahlt")}
        value={whoPaysLabel(declaration, tx)}
        testId={`${TEST_ID}-who-pays`}
      />
      {openRequest ? (
        <div className="px-3.5 py-2.5" data-testid={`${TEST_ID}-open-request`}>
          <p className="text-xs font-medium leading-5 text-sky-700 dark:text-sky-300">
            {openRequestNote(tx)}
          </p>
          {canOpenLead ? <OpenLeadLink leadId={openRequest.lead_id} onOpenLead={onOpenLead} tx={tx} /> : null}
        </div>
      ) : null}
      {thirdParty ? (
        <>
          <SummaryLine
            label={tx("Имя / организация", "Name / Organisation")}
            value={payerDisplayName(thirdParty)}
            testId={`${TEST_ID}-name`}
          />
          <SummaryLine
            label={tx("Отношение к пациенту", "Verhältnis zum Patienten")}
            value={payerRelationshipLabel(thirdParty, tx)}
            testId={`${TEST_ID}-relationship`}
          />
          <SummaryLine
            label={tx("Адрес", "Adresse")}
            value={postalAddressLine(thirdParty, lang)}
            testId={`${TEST_ID}-address`}
          />
          <SummaryLine
            label={tx("Контакт", "Kontakt")}
            value={contactLine(thirdParty)}
            testId={`${TEST_ID}-contact`}
          />
          <SummaryLine
            label={tx("Согласие на контакт с плательщиком", "Einwilligung zur Kontaktaufnahme")}
            value={contactConsentLabel(thirdParty, tx)}
            testId={`${TEST_ID}-contact-consent`}
          />
          <SummaryLine
            label={tx("Плательщик проинформирован (Art. 14 DSGVO)", "Zahler informiert (Art. 14 DSGVO)")}
            value={payerInformedLabel(thirdParty, tx)}
            testId={`${TEST_ID}-informed`}
          />
        </>
      ) : null}
      {party ? (
        <SummaryLine
          label={tx("Сторона договора", "Vertragspartei")}
          testId={`${TEST_ID}-contracting-party`}
          value={(
            <span className="flex min-w-0 flex-col gap-1">
              <span>{contractingPartyLabel(party, tx)}</span>
              {contractingPartyIsRepresentatives(party) || party.representatives.length > 0
                ? party.representatives.map((representative, index) => (
                    <span
                      key={representative.relation_id ?? `${representative.name}-${index}`}
                      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-normal"
                      data-testid={`${TEST_ID}-representative`}
                    >
                      <span className="font-medium">{representative.name || "—"}</span>
                      {representative.address ? <Muted>{representative.address}</Muted> : null}
                      {representative.is_default_payer ? (
                        <Badge
                          variant="outline"
                          className="h-5 rounded-full border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700"
                          data-testid={`${TEST_ID}-default-payer`}
                        >
                          {defaultPayerBadgeLabel(tx)}
                        </Badge>
                      ) : null}
                    </span>
                  ))
                : null}
            </span>
          )}
        />
      ) : null}
      {recipient ? (
        <SummaryLine
          label={tx("Получатель счёта", "Rechnungsempfänger")}
          testId={`${TEST_ID}-recipient`}
          value={(
            <span className="flex min-w-0 flex-col gap-0.5">
              <span>{recipient.name ?? "—"}</span>
              <span className="font-normal">{postalAddressLine(recipient, lang)}</span>
              {recipient.email ? <span className="font-normal">{recipient.email}</span> : null}
              <Muted testId={`${TEST_ID}-recipient-source`}>{invoiceRecipientSourceNote(recipient.source, tx)}</Muted>
              {addressWarning ? <Warning testId={`${TEST_ID}-recipient-address-warning`}>{addressWarning}</Warning> : null}
              {recipient.minor_without_payer ? (
                <Warning testId={`${TEST_ID}-recipient-minor-warning`}>{minorWithoutPayerWarning(tx)}</Warning>
              ) : null}
            </span>
          )}
        />
      ) : null}
      {identification ? (
        <div data-testid={`${TEST_ID}-identification`}>
          <GroupHeading>{tx("Идентификация", "Identifizierung")}</GroupHeading>
          <ul className="space-y-2 px-3.5 pb-2.5">
            {identificationRows.map((row) => (
              <li
                key={row.subject}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5"
                data-testid={`${TEST_ID}-identification-${row.subject}`}
              >
                <span className="w-full min-w-0 break-words text-[13px] font-medium text-foreground">
                  {row.name}
                  {row.detail ? <span className="font-normal text-muted-foreground">{` · ${row.detail}`}</span> : null}
                </span>
                <span className="inline-flex min-w-0 max-w-full" data-tone={row.signature.tone}>
                  <StatusBadge tone={row.signature.tone} className={IDENTIFICATION_LABEL_CLASS}>{row.signature.text}</StatusBadge>
                </span>
                <span className="inline-flex min-w-0 max-w-full" data-tone={row.payment.tone}>
                  <StatusBadge tone={row.payment.tone} className={IDENTIFICATION_LABEL_CLASS}>{row.payment.text}</StatusBadge>
                </span>
                {row.note ? <Warning testId={`${TEST_ID}-identification-note-${row.subject}`}>{row.note}</Warning> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="space-y-1 px-3.5 py-2.5" data-testid={`${TEST_ID}-footer`}>
        {source ? (
          <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground">
            <span className="break-words">{conversionNote(source, tx)}</span>
            {canOpenLead ? <OpenLeadLink leadId={source.lead_id} onOpenLead={onOpenLead} tx={tx} /> : null}
          </p>
        ) : null}
        <p className="text-xs leading-5 text-muted-foreground">{payerChangedElsewhereNote(tx)}</p>
      </div>
    </SummaryCard>
  );
}

/**
 * The card for a known state: a skeleton while loading, nothing when the
 * role may not see the patient's finances (403), a retry on any other
 * failure, the six line groups once loaded.
 */
export function PatientPayerSummaryCardView({
  state,
  lang,
  canOpenLead,
  onOpenLead,
  onRetry,
}: {
  state: PatientPayerSummaryState;
  lang: Lang;
  canOpenLead: boolean;
  onOpenLead: (to: string) => void;
  onRetry: () => void;
}) {
  const tx: Tx = (ru, de) => (lang === "de" ? de : ru);
  if (state.status === "forbidden") return null;
  if (state.status === "loading") {
    return (
      <SummaryCard title={tx("Плательщик", "Zahler")} state="loading">
        <div role="status" aria-busy="true" aria-label={tx("Загрузка", "Wird geladen")} className="space-y-3 px-3.5 py-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="grid gap-1.5 sm:grid-cols-[minmax(10rem,0.4fr)_minmax(0,1fr)] sm:gap-3">
              <span className={cn("h-3 animate-pulse rounded bg-muted", index === 1 ? "w-28" : "w-24")} />
              <span className={cn("h-3 animate-pulse rounded bg-muted", index === 2 ? "w-2/3" : "w-1/2")} />
            </div>
          ))}
        </div>
      </SummaryCard>
    );
  }
  if (state.status === "error") {
    return (
      <SummaryCard title={tx("Плательщик", "Zahler")} state="error">
        <div className="flex min-w-0 flex-wrap items-center gap-3 px-3.5 py-3">
          <p role="alert" className="min-w-0 flex-1 break-words text-sm text-destructive">
            {tx("Не удалось загрузить данные плательщика", "Zahlerdaten konnten nicht geladen werden")}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {tx("Повторить", "Erneut versuchen")}
          </Button>
        </div>
      </SummaryCard>
    );
  }
  return (
    <LoadedCard summary={state.summary} lang={lang} canOpenLead={canOpenLead} onOpenLead={onOpenLead} />
  );
}

/**
 * "Плательщик" in the profile tab: loads `GET /patients/{id}/payer-summary`
 * on mount and again whenever `reloadKey` (the page's patient detail)
 * changes. The link to the request needs `leads.view`; the server decides
 * everything else (a 403 hides the card without an error).
 */
export function PatientPayerSummaryCard({
  patientId,
  staffGo,
  reloadKey,
}: {
  patientId: string;
  staffGo: (to: string) => void;
  reloadKey?: unknown;
}) {
  const { lang } = useLang();
  const { user } = useAuth();
  const canOpenLead = hasCapability(user, "leads.view");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ patientId: string; value: PatientPayerSummaryState }>({
    patientId,
    value: { status: "loading" },
  });

  useEffect(() => {
    let active = true;
    setState({ patientId, value: { status: "loading" } });
    void fetchPatientPayerSummary(patientId, { forceFresh: true })
      .then((payload) => {
        if (!active) return;
        const summary = normalizePatientPayerSummary(payload);
        setState({ patientId, value: summary ? { status: "loaded", summary } : { status: "error" } });
      })
      .catch((error: unknown) => {
        if (active) setState({ patientId, value: { status: payerSummaryLoadFailure(error) } });
      });
    return () => {
      active = false;
    };
  }, [attempt, patientId, reloadKey]);

  const value: PatientPayerSummaryState = state.patientId === patientId ? state.value : { status: "loading" };

  return (
    <PatientPayerSummaryCardView
      state={value}
      lang={lang}
      canOpenLead={canOpenLead}
      onOpenLead={staffGo}
      onRetry={() => setAttempt((current) => current + 1)}
    />
  );
}
