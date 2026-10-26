import { Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import type { CabinetPerson } from "../model/lead-people";
import { recipientScopeLabel, type ConsentRecipientRelation } from "../model/lead-portal-consents";

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
    <Badge variant="outline" className="gap-1 border-border bg-muted/40 text-[10px] text-muted-foreground" data-testid="person-cabinet-badge">
      <Lock aria-hidden="true" className="size-3" />
      {tx("Получатель информации · выбор клиента", "Auskunftsberechtigt · Wahl des Kunden")}
    </Badge>
  );
}

/** What the client stated for the person: phone, birth date, scope (read-only). */
export function CabinetPersonDetails({ person, tx, lang }: { person: CabinetPerson; tx: Tx; lang: string }) {
  const scope = recipientScopeLabel(person, lang === "de" ? "de" : "ru");
  const phone = person.phone?.trim();
  const contact = person.contact?.trim();
  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="person-cabinet-details">
      {person.birth_date ? <span>{tx("род.", "geb.")} {germanDocumentDate(person.birth_date)}</span> : null}
      {phone ? <span className="break-all">Tel. {phone}</span> : contact ? <span className="break-all">{contact}</span> : null}
      <span>{tx("Объём информации:", "Auskunftsumfang:")} {scope || tx("не указан", "nicht angegeben")}</span>
    </div>
  );
}

/** A person only the client named: shown, never edited by staff. */
export function CabinetPersonRow({ person, tx, lang }: { person: CabinetPerson; tx: Tx; lang: string }) {
  return (
    <li className="flex items-start gap-3 px-3 py-3" data-testid="person-cabinet-row">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="break-words text-sm font-medium text-foreground">{person.name}</span>
          <span className="text-xs text-muted-foreground">{cabinetRelationLabel(person.relation, tx)}</span>
          <CabinetRecipientBadge tx={tx} />
        </div>
        <CabinetPersonDetails person={person} tx={tx} lang={lang} />
        <p className="mt-1 text-[11.5px] leading-tight text-muted-foreground">
          {tx("Указал клиент в кабинете — изменить может только он.", "Vom Kunden im Kundenkabinett angegeben – nur er kann es ändern.")}
        </p>
      </div>
    </li>
  );
}
