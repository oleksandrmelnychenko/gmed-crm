import type { ReactNode } from "react";

import { StatusBadge } from "@/components/ui-shell";
import { countryNameForDisplay } from "@/components/ui/country-select";
import { appDateKey, formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import type { LeadIdentityDocument, LeadPortalBilling, LeadPortalIntake, LeadRepresentative } from "../data/lead-portal-intake-api";
import {
  answerLabel,
  billingStatements,
  contactChannelsLabel,
  EMPTY_STATEMENT,
  gwgLegalAnswers,
  hasGwgStatements,
  idDocumentTypeLabel,
  idDocumentValidity,
  ownAccountStatement,
  paymentRouteByPayerNote,
  representationStatements,
  representationWarningText,
  representativeAddress,
  representativeName,
  representativeRoleLabel,
  salutationLabel,
  type BillingStatement,
  type GwgPayerStatement,
  type RepresentationStatements,
  type Tx,
} from "../model/lead-gwg-statements";
import { PatientFieldBadge } from "./lead-wizard-portal-intake";

const WARNING_TEXT = "text-amber-700 dark:text-amber-300";
const STATEMENT_COLUMNS = "grid-cols-2 sm:grid-cols-3";

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

/** The uploaded files of one kind, each with the day of the upload and "reviewed". */
function UploadedFiles({ documents, tx }: { documents: readonly LeadIdentityDocument[]; tx: Tx }) {
  return (
    <ul className="space-y-0.5">
      {documents.map((document) => (
        <li key={document.id}>
          {document.file_name || EMPTY_STATEMENT}
          <span className="font-normal text-muted-foreground">
            {document.uploaded_at ? ` · ${formatAppDate(document.uploaded_at)}` : ""}
            {document.reviewed ? ` · ${tx("просмотрен", "geprüft")}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One person who acts for the lead: who it is, contact, identity document and files. */
function RepresentativeStatements({
  person,
  tx,
  lang,
  today,
}: {
  person: LeadRepresentative;
  tx: Tx;
  lang: string;
  today: string;
}) {
  const country = (code: string | null) => countryNameForDisplay(code, lang);
  const joined = (...parts: Array<string | null>) => parts.filter(Boolean).join(", ");
  const validity = idDocumentValidity(person.id_valid_until, today);
  return (
    <div
      className="space-y-2 rounded-md border border-border/60 bg-background/50 p-2.5"
      data-testid={`lead-gwg-representative-${person.id}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-semibold text-foreground">{representativeName(person) || EMPTY_STATEMENT}</span>
        <span className="text-xs text-muted-foreground">{representativeRoleLabel(person, tx)}</span>
        {person.has_login ? (
          <span className="inline-flex" data-testid="lead-gwg-representative-login">
            <StatusBadge tone="info">{tx("есть доступ в кабинет", "hat Zugang zum Portal")}</StatusBadge>
          </span>
        ) : null}
        {!person.has_data ? (
          <span className="text-[11px] text-muted-foreground" data-testid="lead-gwg-representative-no-data">
            {tx("в кабинете ещё не заполнено", "im Portal noch nicht ausgefüllt")}
          </span>
        ) : null}
      </div>
      <dl className={cn("grid gap-x-6 gap-y-3", STATEMENT_COLUMNS)}>
        <Statement label={tx("Дата рождения", "Geburtsdatum")}>{formatAppDate(person.date_of_birth)}</Statement>
        <Statement label={tx("Место рождения", "Geburtsort")}>
          {joined(person.birth_place, country(person.birth_country))}
        </Statement>
        <Statement label={tx("Гражданство", "Staatsangehörigkeit")}>
          {joined(...person.citizenships.map((code) => country(code)))}
        </Statement>
        <Statement label={tx("Адрес", "Anschrift")}>{representativeAddress(person, lang)}</Statement>
        <Statement label={tx("E-mail", "E-Mail")}>
          {person.email ? <span className="break-all">{person.email}</span> : null}
        </Statement>
        <Statement label={tx("Телефон", "Telefon")}>{person.phone}</Statement>
        <Statement label={tx("Вид документа", "Art des Dokuments")}>
          {idDocumentTypeLabel(person.id_document_type, tx)}
        </Statement>
        <Statement label={tx("Номер", "Nummer")}>{person.id_document_number}</Statement>
        <Statement label={tx("Кем выдан", "Ausstellende Behörde")}>
          {joined(person.id_issuing_authority, country(person.id_issuing_country))}
        </Statement>
        <Statement label={tx("Дата выдачи", "Ausgestellt am")}>{formatAppDate(person.id_issued_on)}</Statement>
        <Statement
          label={tx("Действителен до", "Gültig bis")}
          warning={validity !== "valid"}
          testId={`lead-gwg-representative-valid-until-${person.id}`}
        >
          {validity === "missing"
            ? tx("не указано", "nicht angegeben")
            : validity === "expired"
              ? `${formatAppDate(person.id_valid_until)} · ${tx("срок истёк", "abgelaufen")}`
              : formatAppDate(person.id_valid_until)}
        </Statement>
        <Statement
          label={tx("Файлы: документ, удостоверяющий личность", "Dateien: Ausweis")}
          className="col-span-full"
          testId={`lead-gwg-representative-identity-documents-${person.id}`}
        >
          {person.identity_documents.length > 0 ? <UploadedFiles documents={person.identity_documents} tx={tx} /> : null}
        </Statement>
        <Statement
          label={tx("Файлы: подтверждение полномочий", "Dateien: Vertretungsnachweis")}
          className="col-span-full"
          testId={`lead-gwg-representative-authority-documents-${person.id}`}
        >
          {person.authority_documents.length > 0 ? <UploadedFiles documents={person.authority_documents} tx={tx} /> : null}
        </Statement>
      </dl>
    </div>
  );
}

/**
 * Who acts for the lead: for a minor the custody and the legal
 * representatives (with a warning when their number does not fit the
 * custody, or nobody is on file); for an adult the two answers and the
 * persons a "yes" names.
 */
function RepresentationGroup({
  statements,
  updatedAt,
  tx,
  lang,
  today,
}: {
  statements: RepresentationStatements;
  updatedAt: string | null;
  tx: Tx;
  lang: string;
  today: string;
}) {
  const minor = statements.kind === "minor";
  return (
    <div className="space-y-2" data-testid="lead-gwg-representation">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h4 className="text-xs font-semibold text-foreground">
          {minor ? tx("Законные представители", "Gesetzliche Vertreter") : tx("Представительство", "Vertretung")}
        </h4>
        {updatedAt ? (
          <span className="text-[11px] text-muted-foreground" data-testid="lead-gwg-representation-updated">
            {`${tx("изменено в кабинете", "im Portal geändert")} · ${formatAppDateTime(updatedAt)}`}
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {statements.kind === "minor" ? (
          <Statement label={tx("Кто представляет ребёнка", "Wer vertritt das Kind")} testId="lead-gwg-custody">
            {statements.custody}
          </Statement>
        ) : (
          <>
            <Statement
              label={tx(
                "За пациента действует представитель или уполномоченное лицо",
                "Für den Patienten handelt eine Vertreterin / ein Vertreter oder eine bevollmächtigte Person",
              )}
              sentence
              warning={statements.hasRepresentative === true}
              testId="lead-gwg-has-representative"
            >
              {answerLabel(statements.hasRepresentative, tx)}
            </Statement>
            <Statement
              label={tx("Находится под законной опекой (rechtliche Betreuung)", "Steht unter rechtlicher Betreuung")}
              sentence
              warning={statements.underGuardianship === true}
              testId="lead-gwg-under-guardianship"
            >
              {answerLabel(statements.underGuardianship, tx)}
            </Statement>
          </>
        )}
      </dl>
      {statements.kind === "minor"
        ? statements.warnings.map((warning) => (
            <p
              key={warning}
              className={cn("text-xs font-medium leading-5", WARNING_TEXT)}
              data-testid="lead-gwg-representation-warning"
              data-warning={warning}
            >
              {representationWarningText(warning, tx)}
            </p>
          ))
        : null}
      {statements.persons.map((person) => (
        <RepresentativeStatements key={person.id} person={person} tx={tx} lang={lang} today={today} />
      ))}
    </div>
  );
}

/** One row of sections 7–8: the answer, what the lead added to it, amber when staff must look at it. */
function BillingStatementRow({ statement, className }: { statement: BillingStatement; className?: string }) {
  return (
    <Statement
      label={statement.label}
      className={className}
      warning={statement.warning}
      testId={`lead-gwg-billing-${statement.key}`}
    >
      {statement.value ? (
        <>
          <span className={cn(statement.warning && "font-semibold", statement.key === "invoice_email" && "break-all")}>
            {statement.value}
          </span>
          {statement.details ? <span className="mt-0.5 block whitespace-pre-line">{statement.details}</span> : null}
        </>
      ) : null}
    </Statement>
  );
}

/**
 * Invoice recipient and payment route (sections 7–8 of the form): where the
 * invoice goes as the lead chose it, the staff fields USt-IdNr. /
 * Steuernummer when set, and how the payment is made — or, for a third-party
 * payer, the note that the payer states it himself. Cash, crypto, another
 * method and a payment through a third party are amber and named in the
 * compliance line; they force nothing, staff decide.
 */
function BillingGroup({
  billing,
  updatedAt,
  tx,
  lang,
}: {
  billing: LeadPortalBilling;
  updatedAt: string | null;
  tx: Tx;
  lang: string;
}) {
  const statements = billingStatements(billing, tx, lang);
  return (
    <div className="space-y-2" data-testid="lead-gwg-billing">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold text-foreground">
          {tx("Счёт и оплата (разделы 7–8 анкеты)", "Rechnung und Zahlung (Abschnitte 7–8)")}
        </h4>
        {updatedAt ? (
          <span className="inline-flex" data-testid="lead-gwg-billing-updated">
            <PatientFieldBadge marker={{ at: updatedAt, access_kind: null }} tx={tx} />
          </span>
        ) : null}
      </div>
      <dl className={cn("grid gap-x-6 gap-y-3", STATEMENT_COLUMNS)}>
        {statements.invoice.map((statement) => (
          <BillingStatementRow key={statement.key} statement={statement} />
        ))}
      </dl>
      {statements.byPayer ? (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-gwg-billing-by-payer">
          {paymentRouteByPayerNote(tx)}
        </p>
      ) : (
        <dl className={cn("grid gap-x-6 gap-y-3", STATEMENT_COLUMNS)}>
          {statements.payment.map((statement) => (
            <BillingStatementRow
              key={statement.key}
              statement={statement}
              className={statement.key === "via_third_party" ? "col-span-full" : undefined}
            />
          ))}
        </dl>
      )}
      {statements.complianceLine ? (
        <p data-testid="lead-gwg-billing-flag" className={cn("text-xs font-medium leading-5", WARNING_TEXT)}>
          {statements.complianceLine}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Данные от пациента" in the GwG section of the wizard: what the lead stated
 * in the cabinet, for staff to check before they sign the identification
 * sheet. Read-only and without requests of its own; nothing is shown until
 * the portal state is loaded, nor to a role the server keeps the statements
 * from. The representation is its own group after the identity document; the
 * legal representatives of a minor are listed even while the lead entered
 * nothing, because they are known from the request. Invoice recipient and
 * payment route (sections 7–8) follow the economic interest, while the
 * server sends them.
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
  const representation = representationStatements(intake, tx);
  const representationGroup = representation ? (
    <RepresentationGroup
      statements={representation}
      updatedAt={intake.representation_updated_at}
      tx={tx}
      lang={lang}
      today={today}
    />
  ) : null;

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
        {/* Who represents a minor is known from the request before anybody opens the cabinet. */}
        {representation?.kind === "minor" ? <div className="pt-1.5">{representationGroup}</div> : null}
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

      <StatementGroup title={tx("Личность", "Person")} columns={STATEMENT_COLUMNS}>
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

      <StatementGroup title={tx("Документ, удостоверяющий личность", "Ausweisdokument")} columns={STATEMENT_COLUMNS}>
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
          {intake.identity_documents.length > 0 ? <UploadedFiles documents={intake.identity_documents} tx={tx} /> : null}
        </Statement>
      </StatementGroup>

      {representationGroup}

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

      {intake.billing ? (
        <BillingGroup billing={intake.billing} updatedAt={intake.billing_updated_at} tx={tx} lang={lang} />
      ) : null}

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
