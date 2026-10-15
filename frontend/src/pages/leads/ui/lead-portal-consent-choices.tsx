import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { StatusChip } from "@/components/ui/status-chip";
import { formatAppDateTime } from "@/lib/app-time-zone";
import type { LeadPortalIntake } from "../data/lead-portal-intake-api";
import {
  PORTAL_CONSENT_CHANNELS,
  PORTAL_CONSENT_OPTIONS,
  type ConsentRecipientRelation,
  type PortalConsentChoiceKey,
} from "../model/lead-portal-consents";

type Tx = (ru: string, de: string) => string;

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
  const choice = (key: PortalConsentChoiceKey) => {
    const answer = form?.choices?.[key];
    return (
      <StatusChip tone={answer === true ? "success" : answer === false ? "neutral" : "warning"}>
        {answer === true ? tx("Разрешено", "Erlaubt") : answer === false ? tx("Не разрешено", "Nicht erlaubt") : tx("Не отвечено", "Nicht beantwortet")}
      </StatusChip>
    );
  };
  return (
    <>
    <div className="space-y-3 rounded-xl border border-border/50 bg-card p-3.5" data-testid="portal-disclosure">
      <AdminSectionTitle>{tx("Информация третьим лицам", "Auskunft an Dritte")}</AdminSectionTitle>
      <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <dt>{tx("Разрешение на предоставление информации", "Auskunft erlaubt")}</dt>
          <dd><StatusChip tone={disclosureAllowed ? "success" : "warning"} data-testid="portal-disclosure-decision">
            {disclosure?.allow_disclosure === true ? tx("Да", "Ja") : disclosure?.allow_disclosure === false ? tx("Нет", "Nein") : tx("Не отвечено", "Nicht beantwortet")}
          </StatusChip></dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <dt>{tx("Согласие на передачу данных", "Einwilligung zur Datenweitergabe")}</dt>
          <dd><StatusChip tone={disclosureAllowed ? "success" : "warning"} data-testid="portal-disclosure-consent">
            {disclosure?.consent_given === true ? tx("Дано", "Erteilt") : disclosure?.consent_given === false ? tx("Не дано", "Nicht erteilt") : tx("Не зафиксировано", "Nicht dokumentiert")}
          </StatusChip></dd>
        </div>
      </dl>
      {disclosure ? <div className="space-y-1 text-xs leading-5 text-muted-foreground" data-testid="portal-disclosure-receipt">
        <p>{tx("Выбор зафиксирован:", "Entscheidung dokumentiert:")} {disclosureWho}{disclosure.chosen_by_name && disclosureRole ? ` (${disclosureRole})` : ""} · {disclosure.chosen_at ? formatAppDateTime(disclosure.chosen_at) : tx("дата не указана", "Datum nicht angegeben")}</p>
        {disclosure.company_name || disclosure.version || disclosure.language ? <p className="break-words">
          {[disclosure.company_name, disclosure.version ? `${tx("версия", "Version")} ${disclosure.version}` : null, disclosure.language?.toUpperCase()].filter(Boolean).join(" · ")}
        </p> : null}
        {disclosure.consent_text ? <details className="pt-1">
          <summary className="w-fit cursor-pointer font-medium text-foreground">{tx("Текст согласия", "Einwilligungstext")}</summary>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/25 p-3">{disclosure.consent_text}</p>
        </details> : null}
      </div> : <p className="text-xs leading-5 text-muted-foreground">{tx("Отдельное решение и согласие на предоставление информации ещё не зафиксированы.", "Eine gesonderte Entscheidung und Einwilligung zur Auskunft sind noch nicht dokumentiert.")}</p>}
      {persons.length > 0 ? <div className="space-y-2 border-t border-border/50 pt-3" data-testid="portal-trusted-persons">
        <h4 className="text-xs font-medium">{tx("Доверенные лица (из кабинета)", "Vertrauenspersonen (aus dem Kundenkabinett)")}</h4>
        <p className="text-xs text-muted-foreground">{tx("Только получение информации. Не могут действовать от имени пациента или подписывать документы. Передача данных возможна только с соответствующим согласием.", "Nur für Auskünfte. Keine Vertretung und keine Unterschrift im Namen des Patienten. Die Datenübermittlung setzt eine entsprechende Einwilligung voraus.")}</p>
        <ul className="space-y-2 text-sm">{persons.map((person, index) => <li key={index} className="break-words leading-5">
          <span className="font-medium">{person.name}</span>{" · "}{relationLabels[person.relation as ConsentRecipientRelation] ?? relationLabels.other}{person.contact ? ` · ${person.contact}` : ""}
          <p className="text-xs text-muted-foreground">{tx("Объём информации:", "Auskunftsumfang:")} {person.scope || tx("Не указан", "Nicht angegeben")}</p>
        </li>)}</ul>
      </div> : null}
    </div>
    {form ? <div className="space-y-3 rounded-xl border border-border/50 bg-card p-3.5" data-testid="portal-consent-choices">
      <AdminSectionTitle>{tx("Выбор клиента: передача данных (Anlage 1)", "Auswahl im Kundenkabinett: Datenübermittlung (Anlage 1)")}</AdminSectionTitle>
      {form.choices ? (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="portal-consent-chooser">
          {tx("Последнее изменение:", "Zuletzt geändert:")} {who}{form.chosen_by_role ? ` (${form.chosen_by_role})` : ""} · {form.chosen_at ? formatAppDateTime(form.chosen_at) : tx("дата не указана", "Datum nicht angegeben")}
          {form.version ? ` · ${tx("версия", "Version")} ${form.version}` : ""}
        </p>
      ) : <p className="text-xs text-muted-foreground">{tx("Выбор ещё не сохранён в кабинете", "Noch keine Auswahl im Kundenkabinett gespeichert")}</p>}
      <dl className="divide-y divide-border/50">
        {PORTAL_CONSENT_OPTIONS.map((key) => (
          <div key={key} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 py-2 text-xs">
            <dt className="min-w-0 flex-1 leading-5">{labels[key]}</dt><dd>{choice(key)}</dd>
            {key === "named_recipients" && form.recipients.length > 0 ? (
              <ul className="w-full space-y-1 pl-3 text-muted-foreground" data-testid="portal-consent-recipients">
                {form.recipients.map((recipient, index) => (
                  <li key={index} className="leading-5">
                    <span className="text-foreground">{recipient.name}</span>
                    {" · "}{relationLabels[recipient.relation as ConsentRecipientRelation] ?? relationLabels.other}
                    {recipient.contact ? ` · ${recipient.contact}` : ""}
                    {recipient.scope ? <p className="break-words">{tx("Объём информации:", "Auskunftsumfang:")} {recipient.scope}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </dl>
      <div className="space-y-2 border-t border-border/50 pt-3">
        <span className="text-xs text-muted-foreground">{tx("Каналы передачи данных", "Kommunikationswege zur Datenübermittlung")}</span>
        <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
          {PORTAL_CONSENT_CHANNELS.map((key) => (
            <div key={key} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <dt>{labels[key]}</dt><dd>{choice(key)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div> : null}
    </>
  );
}
