import { CalendarDays, Info, Lock, Mail, Phone, UserRound } from "lucide-react";

import { StatusChip } from "@/components/ui/status-chip";
import { normalizeScopeCodes, staffScopeSummary } from "@/lib/consent-recipient-scope";

import type { CabinetPerson } from "../model/lead-people";
import { recipientScopeLabel, type ConsentRecipientRelation } from "../model/lead-portal-consents";
import { PARENT_ROLE_CHIP_CLASS } from "./trusted-contact-role";

type Tx = (ru: string, de: string) => string;

function germanDocumentDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value.trim();
}

export function cabinetRelationLabel(relation: string, tx: Tx): string {
  const labels: Record<ConsentRecipientRelation, string> = {
    spouse: tx("супруг(а) / партнёр", "Ehe-/Lebenspartner/in"),
    child: tx("ребёнок", "Kind"),
    relative: tx("родственник", "Angehörige/r"),
    friend: tx("друг / знакомый", "Freund/in / Bekannte/r"),
    family_doctor: tx("семейный врач", "Hausarzt/Hausärztin"),
    clinic: tx("клиника / учреждение", "Klinik/Einrichtung"),
    other: tx("другое", "Sonstige"),
  };
  return labels[relation as ConsentRecipientRelation] ?? labels.other;
}

/** The badge of a person the client named in the cabinet. */
export function CabinetRecipientBadge({ tx }: { tx: Tx }) {
  return (
    <StatusChip tone="info" className="whitespace-normal" data-testid="person-cabinet-badge">
      <Lock aria-hidden="true" />
      {tx("Получатель информации · выбор клиента", "Auskunftsberechtigt · Wahl des Kunden")}
    </StatusChip>
  );
}

/** What the client stated for the person: phone, birth date, scope (read-only). */
export function CabinetPersonDetails({ person, tx, lang }: { person: CabinetPerson; tx: Tx; lang: string }) {
  const scope = recipientScopeLabel(person, lang === "de" ? "de" : "ru");
  const codes = normalizeScopeCodes(person.scope_codes);
  const scopes = codes.length > 0 ? codes.map((code) => staffScopeSummary([code], lang)) : scope ? [scope] : [];
  const phone = person.phone?.trim();
  const contact = person.contact?.trim();
  return (
    <div className="mt-2 space-y-2 text-xs text-foreground" data-testid="person-cabinet-details">
      {person.birth_date || phone || contact ? <div className="flex flex-wrap items-center gap-2">
        {person.birth_date ? <StatusChip tone="info"><CalendarDays aria-hidden="true" />{germanDocumentDate(person.birth_date)}</StatusChip> : null}
        {contact ? <StatusChip tone="warning" className="whitespace-normal">
          {contact.includes("@") ? <Mail aria-hidden="true" /> : <Phone aria-hidden="true" />}
          <span className="min-w-0 break-all">{contact}</span>
        </StatusChip> : null}
        {phone && phone !== contact ? <StatusChip tone="warning"><Phone aria-hidden="true" />{phone}</StatusChip> : null}
      </div> : null}
      <div className="flex flex-wrap items-center gap-2" aria-label={tx("Объём информации", "Auskunftsumfang")}>
        <span className="font-mono text-xs text-foreground/80">{tx("Объём информации:", "Auskunftsumfang:")}</span>
        {scopes.length ? scopes.map((label) => <StatusChip key={label} tone="info" className="whitespace-normal">{label}</StatusChip>)
          : <StatusChip>{tx("не указан", "nicht angegeben")}</StatusChip>}
      </div>
    </div>
  );
}

/** A person only the client named: shown, never edited by staff. */
export function CabinetPersonRow({ person, tx, lang }: { person: CabinetPerson; tx: Tx; lang: string }) {
  return (
    <li className="min-w-0 rounded-xl border border-border/60 bg-card p-3" data-testid="person-cabinet-row">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <UserRound aria-hidden="true" className="size-4 shrink-0 text-foreground" />
          <span className="min-w-0 break-words text-sm font-semibold text-foreground">{person.name}</span>
          <StatusChip className={PARENT_ROLE_CHIP_CLASS}>{cabinetRelationLabel(person.relation, tx)}</StatusChip>
          <CabinetRecipientBadge tx={tx} />
        </div>
        <CabinetPersonDetails person={person} tx={tx} lang={lang} />
        <StatusChip tone="warning" className="mt-2 items-start rounded-lg px-2.5 py-1.5 whitespace-normal">
          <Info aria-hidden="true" className="mt-0.5" />
          <span>{tx("Указал клиент в кабинете — изменить может только он.", "Vom Kunden im Kundenkabinett angegeben – nur er kann es ändern.")}</span>
        </StatusChip>
      </div>
    </li>
  );
}
