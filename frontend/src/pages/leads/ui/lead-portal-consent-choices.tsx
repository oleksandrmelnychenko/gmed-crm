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
  if (!intake || intake.identification_hidden || !form) return null;
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
    family_doctor: tx("семейный врач", "Hausarzt/Hausärztin"),
    clinic: tx("клиника / учреждение", "Klinik/Einrichtung"),
    other: tx("другое", "Sonstige"),
  };
  const who = form.chosen_by_name
    ?? (form.access_kind === "guardian" ? tx("Родитель / представитель", "Elternteil / Vertretung")
      : form.access_kind === "self" ? tx("Пациент", "Patient/in") : tx("Не указан", "Nicht angegeben"));
  const choice = (key: PortalConsentChoiceKey) => {
    const answer = form.choices?.[key];
    return (
      <StatusChip tone={answer === true ? "success" : "neutral"}>
        {answer === true ? tx("Разрешено", "Erlaubt") : answer === false ? tx("Не разрешено", "Nicht erlaubt") : tx("Не отвечено", "Nicht beantwortet")}
      </StatusChip>
    );
  };
  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-card p-3.5" data-testid="portal-consent-choices">
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
    </div>
  );
}
