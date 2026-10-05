import type { ReactNode } from "react";

import { countryNameForDisplay } from "@/components/ui/country-select";
import { appDateKey, formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import type { LeadPortalIntake } from "../data/lead-portal-intake-api";
import {
  answerLabel,
  contactChannelsLabel,
  EMPTY_STATEMENT,
  gwgLegalAnswers,
  hasGwgStatements,
  idDocumentTypeLabel,
  idDocumentValidity,
  ownAccountStatement,
  salutationLabel,
  type GwgPayerStatement,
  type Tx,
} from "../model/lead-gwg-statements";
import { PatientFieldBadge } from "./lead-wizard-portal-intake";

const WARNING_TEXT = "text-amber-700 dark:text-amber-300";

/** One group of statements: a caption and its facts as a definition list. */
function StatementGroup({ title, columns, children }: { title: string; columns: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold text-foreground">{title}</h4>
      <dl className={cn("grid gap-x-6 gap-y-3", columns)}>{children}</dl>
    </div>
  );
}

/**
 * One statement: small caption above, value below ("—" when empty). A caption
 * that is a whole question (`sentence`) keeps its normal case.
 */
function Statement({
  label,
  className,
  testId,
  warning = false,
  sentence = false,
  children,
}: {
  label: string;
  className?: string;
  testId?: string;
  warning?: boolean;
  sentence?: boolean;
  children?: ReactNode;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className={cn("min-w-0", className)} data-testid={testId} data-warning={warning ? "true" : undefined}>
      <dt
        className={cn(
          "text-[11px] font-medium text-muted-foreground",
          sentence ? "leading-snug" : "uppercase tracking-[0.06em]",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 break-words text-[13px] font-medium leading-snug",
          warning ? WARNING_TEXT : "text-foreground",
        )}
      >
        {empty ? EMPTY_STATEMENT : children}
      </dd>
    </div>
  );
}

/**
 * "Данные от пациента" in the GwG section of the wizard: what the lead stated
 * in the cabinet, for staff to check before they sign the identification
 * sheet. Read-only and without requests of its own; nothing is shown until
 * the portal state is loaded, nor to a role the server keeps the statements
 * from.
 */
export function LeadGwgStatements({
  intake,
  payer,
  tx,
  lang,
  today = appDateKey(),
}: {
  intake: LeadPortalIntake | null;
  /** The payer declaration ("who pays"): own economic interest and the beneficial owner. */
  payer: GwgPayerStatement | null | undefined;
  tx: Tx;
  lang: string;
  /** The Berlin date ("YYYY-MM-DD") the identity document must still be valid on. */
  today?: string;
}) {
  if (!intake || intake.identification_hidden) return null;
  const identification = intake.identification;
  const title = tx("Данные от пациента", "Angaben des Patienten");

  if (!identification || !hasGwgStatements(intake)) {
    return (
      <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/10 p-3" data-testid="lead-gwg-statements">
        <div className="text-xs font-semibold text-foreground">{title}</div>
        <p className="text-xs text-muted-foreground" data-testid="lead-gwg-statements-empty">
          {tx(
            "Пациент ещё не заполнил эти данные в кабинете",
            "Der Patient hat diese Angaben im Portal noch nicht gemacht",
          )}
        </p>
      </div>
    );
  }

  const country = (code: string | null) => countryNameForDisplay(code, lang);
  const validity = idDocumentValidity(identification.id_valid_until, today);
  const ownAccount = ownAccountStatement(payer);
  const legalAnswers = gwgLegalAnswers(identification, tx, lang);

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3" data-testid="lead-gwg-statements">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground">{title}</span>
        <PatientFieldBadge marker={{ at: intake.identification_updated_at, access_kind: null }} tx={tx} />
      </div>

      <StatementGroup title={tx("Личность", "Person")} columns="grid-cols-2 sm:grid-cols-3">
        <Statement label={tx("Обращение", "Anrede")}>{salutationLabel(identification.salutation, tx)}</Statement>
        <Statement label={tx("Прежние имена", "Frühere Namen")}>{identification.former_names}</Statement>
        <Statement label={tx("Место рождения", "Geburtsort")}>{identification.birth_place}</Statement>
        <Statement label={tx("Страна рождения", "Geburtsland")}>{country(identification.birth_country)}</Statement>
        <Statement label={tx("Страна обычного пребывания (если другая)", "Gewöhnlicher Aufenthalt (falls abweichend)")}>
          {country(identification.habitual_residence_country)}
        </Statement>
        <Statement label={tx("Каналы связи", "Kontaktwege")}>
          {contactChannelsLabel(identification.contact_channels, tx)}
        </Statement>
      </StatementGroup>

      <StatementGroup title={tx("Документ, удостоверяющий личность", "Ausweisdokument")} columns="grid-cols-2 sm:grid-cols-3">
        <Statement label={tx("Вид документа", "Art des Dokuments")}>
          {idDocumentTypeLabel(identification.id_document_type, tx)}
        </Statement>
        <Statement label={tx("Номер", "Nummer")}>{identification.id_document_number}</Statement>
        <Statement label={tx("Кем выдан", "Ausstellende Behörde")}>{identification.id_issuing_authority}</Statement>
        <Statement label={tx("Страна выдачи", "Ausstellungsland")}>{country(identification.id_issuing_country)}</Statement>
        <Statement label={tx("Дата выдачи", "Ausgestellt am")}>{formatAppDate(identification.id_issued_on)}</Statement>
        <Statement label={tx("Действителен до", "Gültig bis")} warning={validity !== "valid"} testId="lead-gwg-id-valid-until">
          {validity === "missing"
            ? tx("не указано", "nicht angegeben")
            : validity === "expired"
              ? `${formatAppDate(identification.id_valid_until)} · ${tx("срок истёк", "abgelaufen")}`
              : formatAppDate(identification.id_valid_until)}
        </Statement>
        <Statement label={tx("Загруженные файлы", "Hochgeladene Dateien")} className="col-span-full" testId="lead-gwg-identity-documents">
          {intake.identity_documents.length > 0 ? (
            <ul className="space-y-0.5">
              {intake.identity_documents.map((document) => (
                <li key={document.id}>
                  {document.file_name || EMPTY_STATEMENT}
                  <span className="font-normal text-muted-foreground">
                    {document.uploaded_at ? ` · ${formatAppDate(document.uploaded_at)}` : ""}
                    {document.reviewed ? ` · ${tx("просмотрен", "geprüft")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Statement>
      </StatementGroup>

      <StatementGroup
        title={tx("Экономический интерес (раздел «Кто платит»)", "Wirtschaftliches Interesse (Abschnitt „Wer zahlt“)")}
        columns="grid-cols-1 sm:grid-cols-3"
      >
        <Statement
          label={tx("В собственных экономических интересах", "Im eigenen wirtschaftlichen Interesse")}
          warning={ownAccount.answer === false}
          testId="lead-gwg-own-account"
        >
          {answerLabel(ownAccount.answer, tx)}
        </Statement>
        {ownAccount.answer === false ? (
          <Statement label={tx("В чьих интересах", "Wirtschaftlich Berechtigter")} className="sm:col-span-2">
            {ownAccount.beneficialOwner}
          </Statement>
        ) : null}
        <Statement label={tx("Почему платит третье лицо", "Hintergrund der Zahlung durch Dritte")} className="col-span-full">
          {identification.payment_background}
        </Statement>
      </StatementGroup>

      <StatementGroup title={tx("Юридические вопросы", "Rechtliche Fragen")} columns="grid-cols-1 sm:grid-cols-2">
        {legalAnswers.map((item) => (
          <Statement
            key={item.key}
            label={item.question}
            sentence
            warning={item.answer === true}
            testId={`lead-gwg-answer-${item.key}`}
          >
            <span className={item.answer === true ? "font-semibold" : undefined}>{answerLabel(item.answer, tx)}</span>
            {item.details ? <span className="mt-0.5 block whitespace-pre-line">{item.details}</span> : null}
          </Statement>
        ))}
      </StatementGroup>

      <p className="text-xs text-muted-foreground" data-testid="lead-gwg-declared-correct">
        {identification.declared_correct_at
          ? `${tx("Подтвердил правильность:", "Richtigkeit bestätigt am")} ${formatAppDateTime(identification.declared_correct_at)}`
          : `${tx("Подтвердил правильность:", "Richtigkeit bestätigt:")} ${tx("ещё нет", "noch nicht")}`}
      </p>
    </div>
  );
}
