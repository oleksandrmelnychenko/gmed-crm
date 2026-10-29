import { useState } from "react";
import { CalendarDays, Info, Lock, Mail, Pencil, Phone, Trash2, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiRequestError } from "@/lib/api";
import { normalizeScopeCodes, staffScopeSummary } from "@/lib/consent-recipient-scope";

import { correctLeadTrustedPerson } from "../data/lead-portal-intake-api";
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

/** Institutions have no date of birth (server: `consent_choices::is_institution`). */
const INSTITUTION_RELATIONS = new Set(["family_doctor", "clinic"]);

/** Where a cabinet person sits in the cabinet list, for staff corrections. */
export type CabinetPersonEditTarget = {
  leadId: string;
  index: number;
  /** The person as the cabinet list stores it (the server compares it). */
  stored: CabinetPerson;
  onChanged: () => void;
};

function correctionError(error: unknown, tx: Tx): string {
  const code = error instanceof ApiRequestError ? error.code ?? (error.body as { code?: string } | null)?.code : undefined;
  const field = error instanceof ApiRequestError ? (error.body as { field?: string } | null)?.field : undefined;
  if (code === "trusted_person_changed") return tx("Запись изменилась — обновите мастер и повторите.", "Der Eintrag wurde geändert – laden Sie den Assistenten neu und wiederholen Sie es.");
  if (code === "correction_reason_required") return tx("Укажите причину.", "Geben Sie einen Grund an.");
  if (code === "nothing_changed") return tx("Ничего не изменено.", "Nichts geändert.");
  if (field === "phone") return tx("Укажите телефон, с которого человек будет звонить.", "Geben Sie die Telefonnummer an, von der die Person anruft.");
  if (field === "birth_date") return tx("Укажите дату рождения.", "Geben Sie das Geburtsdatum an.");
  if (field === "contact") return tx("Контакт — номер телефона или e-mail.", "Der Kontakt ist eine Telefonnummer oder E-Mail-Adresse.");
  if (field === "name") return tx("Проверьте имя.", "Prüfen Sie den Namen.");
  return tx("Не удалось сохранить.", "Speichern fehlgeschlagen.");
}

/**
 * Staff correct the data of a person the client named (name, phone, date of
 * birth) or remove the person when the client withdraws the consent for them,
 * always with a reason (owner decision 2026-10-29). Who is named and what may
 * be told stays the client's choice.
 */
export function CabinetPersonActions({ target, tx }: { target: CabinetPersonEditTarget; tx: Tx }) {
  const { stored } = target;
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [name, setName] = useState(stored.name);
  const [phone, setPhone] = useState(stored.phone ?? "");
  const [birthDate, setBirthDate] = useState(stored.birth_date ?? "");
  const [contact, setContact] = useState(stored.contact ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const institution = INSTITUTION_RELATIONS.has(stored.relation);

  const open = (next: "edit" | "delete") => {
    setName(stored.name);
    setPhone(stored.phone ?? "");
    setBirthDate(stored.birth_date ?? "");
    setContact(stored.contact ?? "");
    setReason("");
    setError(null);
    setMode(next);
  };
  const close = () => { if (!busy) setMode(null); };
  const submit = async () => {
    if (!reason.trim()) {
      setError(tx("Укажите причину.", "Geben Sie einen Grund an."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const person = mode === "delete" ? null : {
        ...stored,
        name: name.trim(),
        phone: phone.trim() || null,
        birth_date: institution ? null : birthDate || null,
        contact: stored.contact ? contact.trim() || null : stored.contact,
      };
      await correctLeadTrustedPerson(target.leadId, target.index, stored, person, reason.trim());
      setMode(null);
      target.onChanged();
    } catch (reasonError) {
      setError(correctionError(reasonError, tx));
    } finally {
      setBusy(false);
    }
  };
  const fieldClass = "space-y-1.5";
  const labelClass = "block font-mono text-xs font-medium text-foreground/80";

  return (
    <>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" className="size-7 rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => open("edit")} aria-label={`${tx("Исправить данные", "Daten korrigieren")}: ${stored.name}`} title={tx("Исправить данные", "Daten korrigieren")}
          data-testid="person-cabinet-edit">
          <Pencil className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" className="size-7 rounded-full text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          onClick={() => open("delete")} aria-label={`${tx("Удалить по просьбе клиента", "Auf Wunsch des Kunden entfernen")}: ${stored.name}`} title={tx("Удалить по просьбе клиента", "Auf Wunsch des Kunden entfernen")}
          data-testid="person-cabinet-delete">
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <Dialog open={mode !== null} allowImplicitDismissal onOpenChange={(next) => { if (!next) close(); }}>
        <DialogContent className="max-w-md" data-testid="person-cabinet-correction">
          <DialogHeader>
            <DialogTitle>
              {mode === "delete"
                ? tx(`Удалить «${stored.name}»?`, `«${stored.name}» entfernen?`)
                : tx("Исправить данные", "Daten korrigieren")}
            </DialogTitle>
            <DialogDescription>
              {mode === "delete"
                ? tx("Клиент отзывает согласие на передачу информации этому человеку. Форма согласия получит новую версию.",
                  "Der Kunde widerruft die Einwilligung zur Auskunft an diese Person. Die Einverständniserklärung erhält eine neue Version.")
                : tx("Кого указать и что сообщать, решает клиент; здесь только исправление данных. Форма согласия получит новую версию.",
                  "Wen der Kunde benennt und was mitgeteilt wird, entscheidet er selbst; hier werden nur Daten korrigiert. Die Einverständniserklärung erhält eine neue Version.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {mode === "edit" ? <>
              <div className={fieldClass}>
                <label htmlFor="person-cabinet-name" className={labelClass}>{tx("Имя", "Name")}</label>
                <Input id="person-cabinet-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className={fieldClass}>
                <label htmlFor="person-cabinet-phone" className={labelClass}>{tx("Телефон, с которого звонит", "Telefonnummer für Anrufe")}</label>
                <Input id="person-cabinet-phone" type="tel" value={phone} maxLength={40} onChange={(event) => setPhone(event.target.value)} />
              </div>
              {institution ? null : <div className={fieldClass}>
                <label htmlFor="person-cabinet-birth-date" className={labelClass}>{tx("Дата рождения", "Geburtsdatum")}</label>
                <Input id="person-cabinet-birth-date" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
              </div>}
              {stored.contact ? <div className={fieldClass}>
                <label htmlFor="person-cabinet-contact" className={labelClass}>{tx("Контакт (прежний)", "Kontakt (bisher)")}</label>
                <Input id="person-cabinet-contact" value={contact} maxLength={120} onChange={(event) => setContact(event.target.value)} />
              </div> : null}
            </> : null}
            <div className={fieldClass}>
              <label htmlFor="person-cabinet-reason" className={labelClass}>{tx("Причина", "Grund")}</label>
              <textarea id="person-cabinet-reason" rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}
                placeholder={mode === "delete" ? tx("Например: клиент отозвал по телефону 29.10.", "Z. B.: Kunde hat am 29.10. telefonisch widerrufen.") : tx("Например: клиент сообщил новый номер.", "Z. B.: Kunde hat eine neue Nummer mitgeteilt.")}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
            {error ? <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>{tx("Отмена", "Abbrechen")}</Button>
            <Button type="button" variant={mode === "delete" ? "destructive" : "default"} disabled={busy} onClick={() => void submit()}
              data-testid="person-cabinet-correction-submit">
              {mode === "delete" ? tx("Удалить", "Entfernen") : tx("Сохранить", "Speichern")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A person only the client named: staff correct the data or remove the person on request. */
export function CabinetPersonRow({ person, tx, lang, edit }: { person: CabinetPerson; tx: Tx; lang: string; edit?: CabinetPersonEditTarget | null }) {
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-xl border border-border/60 bg-card p-3" data-testid="person-cabinet-row">
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
          <span>{tx("Указал клиент в кабинете", "Vom Kunden im Kundenkabinett angegeben")}</span>
        </StatusChip>
      </div>
      {edit ? <CabinetPersonActions target={edit} tx={tx} /> : null}
    </li>
  );
}
