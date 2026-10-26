import { Building2, CalendarDays, ChevronDown, FileText, History, Info, Languages, UserRound, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { StatusChip } from "@/components/ui/status-chip";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { normalizeScopeCodes, staffScopeSummary } from "@/lib/consent-recipient-scope";
import type { LeadPortalIntake } from "../data/lead-portal-intake-api";
import {
  PORTAL_CONSENT_CHANNELS,
  PORTAL_CONSENT_OPTIONS,
  recipientScopeLabel,
  type ConsentRecipientRelation,
  type LeadPortalConsentRecipient,
  type PortalConsentChoiceKey,
} from "../model/lead-portal-consents";

type Tx = (ru: string, de: string) => string;

function RecipientScopeChips({ person, tx }: { person: LeadPortalConsentRecipient; tx: Tx }) {
  const codes = normalizeScopeCodes(person.scope_codes);
  const legacy = recipientScopeLabel(person, tx("ru", "de"));
  const labels = codes.length > 0
    ? codes.map((code) => staffScopeSummary([code], tx("ru", "de")))
    : legacy ? [legacy] : [];
  return labels.length > 0
    ? labels.map((label) => <StatusChip key={label} tone="info">{label}</StatusChip>)
    : <StatusChip tone="neutral">{tx("Не указан", "Nicht angegeben")}</StatusChip>;
}

function ConsentDetails({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <details className="group border-t border-border/60" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-b-xl px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <History aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">{title}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2 px-4 pb-4 text-sm leading-5 text-foreground [overflow-wrap:anywhere]">{children}</div>
    </details>
  );
}

/**
 * Date of birth (DD.MM.YYYY) and the phone a trusted person calls from — staff check a caller by
 * both (owner 2026-10-26) — then a legacy contact as given.
 */
function recipientFacts(person: LeadPortalConsentRecipient, tx: Tx): string {
  const born = /^(\d{4})-(\d{2})-(\d{2})$/.exec(person.birth_date ?? "");
  return [
    born ? `${tx("род.", "geb.")} ${born[3]}.${born[2]}.${born[1]}` : null,
    person.phone ? `${tx("тел.", "Tel.")} ${person.phone}` : null,
    person.contact,
  ].filter(Boolean).map((fact) => ` · ${fact}`).join("");
}

function RecipientCards({ persons, relationLabels, tx, testId }: {
  persons: LeadPortalConsentRecipient[];
  relationLabels: Record<ConsentRecipientRelation, string>;
  tx: Tx;
  testId?: string;
}) {
  return (
    <ul className="grid gap-3 @2xl:grid-cols-2" data-testid={testId}>
      {persons.map((person, index) => (
        <li key={index} className="min-w-0 space-y-3 rounded-lg border border-border/60 bg-card p-3.5 [overflow-wrap:anywhere]">
          <div className="flex items-start gap-2.5">
            <UsersRound aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
              <p className="text-sm font-semibold leading-5 text-foreground">{person.name}</p>
              <StatusChip className="border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200">
                {relationLabels[person.relation as ConsentRecipientRelation] ?? relationLabels.other}
              </StatusChip>
            </div>
          </div>
          {recipientFacts(person, tx) ? <div className="space-y-1 text-sm leading-5" data-testid="portal-trusted-person-facts">
            <p className="text-foreground">{recipientFacts(person, tx).replace(/^ · /, "")}</p>
          </div> : null}
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5 text-sm leading-5 text-foreground">
            <span>{tx("Объём информации:", "Auskunftsumfang:")}</span>
            <RecipientScopeChips person={person} tx={tx} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Read-only cabinet choices; staff never change or preset the person's consent. */
export function PortalConsentChoiceView({ intake, tx }: { intake: LeadPortalIntake | null; tx: Tx }) {
  const form = intake?.consent_form;
  const disclosure = intake?.disclosure;
  const persons = intake?.trusted_persons ?? [];
  if (!intake || intake.identification_hidden || (!form && !disclosure && persons.length === 0)) return null;
  const labels: Record<PortalConsentChoiceKey, string> = {
    agency_processing: tx("GMED: получение, обработка, хранение и передача данных", "GMED: Daten einholen, verarbeiten, speichern und übermitteln"),
    doctors_to_agency: tx("Лечащие врачи и учреждения: передача документов GMED", "Behandelnde Ärzte und Einrichtungen: Unterlagen an GMED übermitteln"),
    data_system: tx("Хранение и обработка в системе GMED", "Speicherung und Verarbeitung im EDV-System von GMED"),
    named_recipients: tx("Передача лицам и учреждениям, указанным в форме", "Übermittlung an im Formular genannte Personen und Einrichtungen"),
    channel_email: "E-Mail", channel_threema: "Threema", channel_whatsapp: "WhatsApp", channel_telegram: "Telegram",
  };
  const relationLabels: Record<ConsentRecipientRelation, string> = {
    spouse: tx("супруг(а) / партнёр", "Ehe-/Lebenspartner/in"),
    child: tx("ребёнок", "Kind"),
    relative: tx("родственник", "Angehörige/r"),
    friend: tx("друг / знакомый", "Freund/in / Bekannte/r"),
    family_doctor: tx("семейный врач", "Hausarzt/Hausärztin"),
    clinic: tx("клиника / учреждение", "Klinik/Einrichtung"),
    other: tx("другое", "Sonstige"),
  };
  const who = form?.chosen_by_name
    ?? (form?.access_kind === "guardian" ? tx("Родитель / представитель", "Elternteil / Vertretung")
      : form?.access_kind === "self" ? tx("Пациент", "Patient/in") : tx("Не указан", "Nicht angegeben"));
  const disclosureRole = disclosure?.access_kind === "guardian" ? tx("Родитель / представитель", "Elternteil / Vertretung")
    : disclosure?.access_kind === "self" ? tx("Пациент", "Patient/in") : null;
  const disclosureWho = disclosure?.chosen_by_name ?? disclosureRole ?? tx("Не указан", "Nicht angegeben");
  const disclosureAllowed = disclosure?.allow_disclosure === true && disclosure.consent_given === true;
  // Not answered counts as "no" (owner decision 2026-10-22), unless an older choice named recipients.
  const disclosureDefaultNo = !disclosure && form?.choices?.named_recipients !== true;
  const disclosureDenied = disclosure?.allow_disclosure === false || disclosureDefaultNo;
  const choice = (key: PortalConsentChoiceKey) => {
    const answer = form?.choices?.[key];
    return (
      <StatusChip tone={answer === true ? "success" : answer === false ? "neutral" : "warning"}>
        {answer === true ? tx("Разрешено", "Erlaubt") : answer === false ? tx("Не разрешено", "Nicht erlaubt") : tx("Не отвечено", "Nicht beantwortet")}
      </StatusChip>
    );
  };
  return (
    <div className="@container/consents rounded-xl bg-muted/30 p-2 sm:p-3">
    <div className="grid items-start gap-4 @5xl/consents:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
    <section className="@container min-w-0 rounded-xl border border-border/60 bg-card" data-testid="portal-disclosure" aria-label={tx("Информация третьим лицам", "Auskunft an Dritte")}>
      <div className="space-y-1 border-b border-border/60 px-4 py-3.5">
        <AdminSectionTitle className="text-sm">{tx("Информация третьим лицам", "Auskunft an Dritte")}</AdminSectionTitle>
      </div>
      <div className="space-y-4 p-4">
      {/* Optional (owner 2026-10-19): an explicit "No" is the person's own valid
          answer, shown neutrally and never as a missing consent; the separate
          disclosure consent exists only after a "Yes". */}
      <dl className="grid gap-3 @md:grid-cols-2">
        <div className="flex min-w-0 flex-col items-start gap-2 rounded-lg bg-muted/35 p-3 text-sm leading-5">
          <dt className="font-medium">{tx("Предоставлять информацию третьим лицам", "Auskunft an Dritte")}</dt>
          <dd><StatusChip tone={disclosureAllowed ? "success" : disclosureDenied ? "neutral" : "warning"} data-testid="portal-disclosure-decision">
            {disclosure?.allow_disclosure === true ? tx("Да", "Ja")
              : disclosureDefaultNo ? tx("Нет — не отвечено, по умолчанию", "Nein – nicht beantwortet, Standard")
              : disclosureDenied ? tx("Нет — не разрешено", "Nein – nicht erlaubt") : tx("Не отвечено", "Nicht beantwortet")}
          </StatusChip></dd>
        </div>
        {disclosureDenied ? null : <div className="flex min-w-0 flex-col items-start gap-2 rounded-lg bg-muted/35 p-3 text-sm leading-5">
          <dt className="font-medium">{tx("Согласие на передачу данных получателям информации", "Einwilligung zur Weitergabe an Auskunftsberechtigte")}</dt>
          <dd><StatusChip tone={disclosureAllowed ? "success" : "warning"} data-testid="portal-disclosure-consent">
            {disclosure?.consent_given === true ? tx("Дано", "Erteilt") : disclosure?.consent_given === false ? tx("Не дано", "Nicht erteilt") : tx("Не зафиксировано", "Nicht dokumentiert")}
          </StatusChip></dd>
        </div>}
      </dl>
      {disclosureDenied ? <p className="flex items-start gap-2 text-sm leading-5 text-foreground" data-testid="portal-disclosure-optional">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
        {disclosureDefaultNo
          ? tx("Клиент не ответил: по умолчанию информация третьим лицам не предоставляется; в форме согласия пункт о передаче указанным лицам остаётся не отмеченным.",
            "Nicht beantwortet: standardmäßig keine Auskunft an Dritte; in der Einverständniserklärung bleibt die Übermittlung an genannte Personen unangekreuzt.")
          : tx("Выбор клиента: информацию третьим лицам не предоставлять. Это допустимый ответ — отдельное согласие не нужно, оформление он не блокирует; в форме согласия пункт о передаче указанным лицам остаётся не отмеченным.",
            "Wahl des Kunden: keine Auskunft an Dritte. Das ist eine gültige Antwort – eine gesonderte Einwilligung ist nicht nötig, sie blockiert nichts; in der Einverständniserklärung bleibt die Übermittlung an genannte Personen unangekreuzt.")}
        </span>
      </p> : null}
      {/* The persons themselves are listed once, in «Лица и учреждения» (owner 2026-10-26). */}
      {persons.length > 0 ? <p className="text-xs leading-5 text-muted-foreground" data-testid="portal-trusted-persons-pointer">
        {tx("Получатели информации", "Auskunftsberechtigte")} · {persons.length} — {tx("в списке «Лица и учреждения» ниже", "in der Liste „Personen und Einrichtungen“ unten")}
      </p> : null}
      </div>
      {disclosure ? <ConsentDetails title={tx("Кто подтвердил · версия и текст согласия", "Bestätigung · Version und Einwilligungstext")} testId="portal-disclosure-receipt">
        <div className="flex flex-wrap items-center gap-1.5" data-testid="portal-disclosure-audit">
          <StatusChip tone="warning" className="whitespace-normal">
            <UserRound aria-hidden="true" />
            <span>{disclosureWho}{disclosure.chosen_by_name && disclosureRole ? ` (${disclosureRole})` : ""}</span>
          </StatusChip>
          <StatusChip tone="info">
            <CalendarDays aria-hidden="true" />
            {disclosure.chosen_at
              ? <time dateTime={disclosure.chosen_at} className="tabular-nums">{formatAppDateTime(disclosure.chosen_at)}</time>
              : tx("дата не указана", "Datum nicht angegeben")}
          </StatusChip>
          {disclosure.version ? <StatusChip className="border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200">
            <FileText aria-hidden="true" />
            <span>{tx("версия", "Version")} {disclosure.version}</span>
          </StatusChip> : null}
          {disclosure.language ? <StatusChip>
            <Languages aria-hidden="true" />
            {disclosure.language.toUpperCase()}
          </StatusChip> : null}
        </div>
        {disclosure.company_name ? <p className="flex items-start gap-1.5 text-xs leading-5 text-foreground/75">
          <Building2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{disclosure.company_name}</span>
        </p> : null}
        {disclosure.consent_text ? <details className="group/consent-text overflow-hidden rounded-lg border border-border/60 bg-muted/20">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <FileText aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{tx("Текст согласия", "Einwilligungstext")}</span>
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-open/consent-text:rotate-180" />
          </summary>
          <p className="whitespace-pre-wrap break-words border-t border-border/50 bg-card px-3 py-2.5 text-[13px] leading-relaxed text-foreground">{disclosure.consent_text}</p>
        </details> : null}
      </ConsentDetails> : <p className="border-t border-border/60 px-4 py-3 text-sm leading-5 text-foreground">{tx("Отдельное решение и согласие на предоставление информации ещё не зафиксированы.", "Eine gesonderte Entscheidung und Einwilligung zur Auskunft sind noch nicht dokumentiert.")}</p>}
    </section>
    {form ? <section className="@container min-w-0 rounded-xl border border-border/60 bg-card" data-testid="portal-consent-choices" aria-label={tx("Передача данных · Anlage 1", "Datenübermittlung · Anlage 1")}>
      <div className="space-y-1 border-b border-border/60 px-4 py-3.5">
        <AdminSectionTitle className="text-sm">{tx("Передача данных · Anlage 1", "Datenübermittlung · Anlage 1")}</AdminSectionTitle>
      </div>
      <div className="space-y-5 p-4">
      {!form.choices ? <p className="rounded-lg bg-muted/35 p-3 text-sm text-foreground">{tx("Выбор ещё не сохранён в кабинете", "Noch keine Auswahl im Kundenkabinett gespeichert")}</p> : null}
      <dl className="divide-y divide-border/60">
        {PORTAL_CONSENT_OPTIONS.map((key) => (
          <div key={key} className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2 py-3 first:pt-0 last:pb-0">
            <dt className="flex min-w-0 max-w-full items-start gap-2 text-sm leading-5">
              <FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-foreground" />
              <span>{labels[key]}</span>
            </dt>
            <dd className="contents">
              <div className="max-w-full">{choice(key)}</div>
              {key === "named_recipients" && form.recipients.length > 0 ? (
                <details className="group/recipients min-w-0 basis-full @lg:pl-5.5">
                  <summary className="flex w-fit max-w-full cursor-pointer list-none items-center gap-2 rounded-md py-1 text-sm font-medium text-foreground hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-open/recipients:rotate-180" />
                    <span>{tx("Получатели в этой версии формы", "Empfänger in dieser Formularversion")} · {form.recipients.length}</span>
                  </summary>
                  <div className="pt-3"><RecipientCards persons={form.recipients} relationLabels={relationLabels} tx={tx} testId="portal-consent-recipients" /></div>
                </details>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-3 border-t border-border/60 pt-4">
        <h4 className="text-sm font-semibold">{tx("Каналы передачи данных", "Kommunikationswege zur Datenübermittlung")}</h4>
        <dl className="grid gap-2 @sm:grid-cols-2 @3xl:grid-cols-4">
          {PORTAL_CONSENT_CHANNELS.map((key) => (
            <div key={key} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg bg-muted/35 px-3 py-2 text-sm">
              <dt className="font-medium">{labels[key]}</dt><dd>{choice(key)}</dd>
            </div>
          ))}
        </dl>
      </div>
      </div>
      <ConsentDetails title={tx("Кто и когда сохранил выбор", "Wer die Auswahl wann gespeichert hat")}>
      {form.choices ? (
        <div className="flex flex-wrap items-center gap-2 text-sm leading-5 text-foreground" data-testid="portal-consent-chooser">
          <span>{tx("Последнее изменение:", "Zuletzt geändert:")}</span>
          <StatusChip tone="warning" className="whitespace-normal">
            <UserRound aria-hidden="true" />
            <span>{who}{form.chosen_by_role ? ` (${form.chosen_by_role})` : ""}</span>
          </StatusChip>
          <StatusChip tone="info">
            <CalendarDays aria-hidden="true" />
            {form.chosen_at
              ? <time dateTime={form.chosen_at} className="tabular-nums">{formatAppDateTime(form.chosen_at)}</time>
              : tx("дата не указана", "Datum nicht angegeben")}
          </StatusChip>
          {form.version ? <StatusChip className="border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200">
            <FileText aria-hidden="true" />
            <span>{tx("версия", "Version")} {form.version}</span>
          </StatusChip> : null}
        </div>
      ) : <p className="text-sm text-foreground">{tx("Выбор ещё не сохранён в кабинете", "Noch keine Auswahl im Kundenkabinett gespeichert")}</p>}
      </ConsentDetails>
    </section> : null}
    </div>
    </div>
  );
}
