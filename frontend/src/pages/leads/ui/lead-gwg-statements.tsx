import type { ReactNode } from "react";

import { StatusBadge } from "@/components/ui-shell";
import { Badge } from "@/components/ui/badge";
import { countryNameForDisplay } from "@/components/ui/country-select";
import { appDateKey, formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import type { LeadPayerLinkState } from "../data/lead-payer-link-api";
import type {
  LeadIdentityDocument,
  LeadPortalBilling,
  LeadPortalIntake,
  LeadGwgIdentification,
  LeadPortalEnhancedDetails,
  LeadPortalPayerLink,
  LeadRepresentative,
} from "../data/lead-portal-intake-api";
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
  paymentRouteByPayerLine,
  representationStatements,
  representationWarningText,
  representativeAddress,
  representativeName,
  representativeRoleLabel,
  salutationLabel,
  enhancedDetailsShown,
  enhancedFundsProofMissing,
  type BillingStatement,
  type GwgPayerStatement,
  type RepresentationStatements,
  type Tx,
} from "../model/lead-gwg-statements";
import {
  fundsProofMissing,
  payerCheckLevelLine,
  payerPrivacyLine,
  payerQuestionnaireGroups,
  type PayerStatementRow,
} from "../model/lead-payer-link";
import { statedFundsSourceLabel, statedFundsSourcesLabel } from "../model/lead-payer";
import { identityDocumentEnteredLine } from "../model/lead-identity-document-data";
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
      {/* Long German labels ("Staatsangehörigkeit") wrap inside a narrow column. */}
      <dt
        className={cn(
          "break-words text-[11px] font-medium text-muted-foreground",
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
            {/* The question is switched off in the cabinet (owner 2026-10-09): only an old answer shows. */}
            {statements.underGuardianship !== null && statements.underGuardianship !== undefined ? (
              <Statement
                label={tx("Находится под законной опекой (rechtliche Betreuung)", "Steht unter rechtlicher Betreuung")}
                sentence
                warning={statements.underGuardianship === true}
                testId="lead-gwg-under-guardianship"
              >
                {answerLabel(statements.underGuardianship, tx)}
              </Statement>
            ) : null}
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
  payerLink,
  tx,
  lang,
}: {
  billing: LeadPortalBilling;
  updatedAt: string | null;
  /** The payer link in short: whether and when the payer stated section 8; null on an older server. */
  payerLink: LeadPortalPayerLink | null;
  tx: Tx;
  lang: string;
}) {
  const payerAnswered = Boolean(payerLink?.submitted_at);
  const statements = billingStatements(billing, tx, lang, payerAnswered);
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
          {paymentRouteByPayerLine(payerLink, tx)}
        </p>
      ) : null}
      {statements.payment.length > 0 ? (
        <dl className={cn("grid gap-x-6 gap-y-3", STATEMENT_COLUMNS)}>
          {statements.payment.map((statement) => (
            <BillingStatementRow
              key={statement.key}
              statement={statement}
              className={statement.key === "via_third_party" ? "col-span-full" : undefined}
            />
          ))}
        </dl>
      ) : null}
      {statements.complianceLine ? (
        <p data-testid="lead-gwg-billing-flag" className={cn("text-xs font-medium leading-5", WARNING_TEXT)}>
          {statements.complianceLine}
        </p>
      ) : null}
    </div>
  );
}

function stayReasonLabel(value: string | null | undefined, tx: Tx): string {
  switch (value) {
    case "work":
      return tx("работа", "Arbeit");
    case "study":
      return tx("учёба", "Studium");
    case "family":
      return tx("семья", "Familie");
    case "other":
      return tx("другое", "Sonstiges");
    default:
      return value ?? "";
  }
}

function sanctionsLinkKindLabel(value: string | null | undefined, tx: Tx): string {
  switch (value) {
    case "family":
      return tx("семейная", "familiär");
    case "business":
      return tx("деловая", "geschäftlich");
    case "ownership":
      return tx("участие / владение", "Beteiligung / Eigentum");
    case "other":
      return tx("другое", "Sonstiges");
    default:
      return value ?? "";
  }
}

/**
 * The lead's answers to the follow-up blocks of the risk assessment (trigger
 * flow 2026-10-07): F stay and former citizenships, B since when the payer is
 * known, H PEP details, J the sanctions link. Only blocks with an answer are
 * shown; nothing for a lead who was not asked. Read-only.
 */
function LeadGwgFollowUpAnswers({
  identification,
  tx,
  lang,
}: {
  identification: LeadGwgIdentification;
  tx: Tx;
  lang: string;
}) {
  const country = (code: string | null | undefined) => countryNameForDisplay(code ?? null, lang);
  const stay = [
    identification.residence_since,
    identification.other_residences,
    identification.stay_reason,
    identification.stay_reason_details,
  ].some(Boolean) || (identification.former_citizenships?.length ?? 0) > 0;
  const pep = [
    identification.pep_office,
    identification.pep_country,
    identification.pep_period,
    identification.pep_relationship,
    identification.pep_wealth_origin,
  ].some(Boolean);
  const sanctions = [
    identification.sanctions_link_name,
    identification.sanctions_link_kind,
    identification.sanctions_link_since_extent,
  ].some(Boolean);
  if (!stay && !pep && !sanctions && !identification.relationship_since) return null;
  return (
    <div className="space-y-3" data-testid="lead-gwg-follow-up-answers">
      {stay ? (
        <StatementGroup title={tx("Проживание и гражданства (доп. сведения)", "Aufenthalt und Staatsangehörigkeiten (ergänzend)")} columns={STATEMENT_COLUMNS}>
          <Statement label={tx("Проживает там с", "Wohnhaft dort seit")} testId="lead-gwg-residence-since">{identification.residence_since}</Statement>
          <Statement label={tx("Другие места проживания", "Weitere Wohnsitze")}>{identification.other_residences}</Statement>
          <Statement label={tx("Прежние гражданства", "Frühere Staatsangehörigkeiten")}>
            {(identification.former_citizenships ?? []).map((code) => country(code)).join(", ")}
          </Statement>
          <Statement label={tx("Причина пребывания", "Aufenthaltsgrund")} className="sm:col-span-2">
            {[stayReasonLabel(identification.stay_reason, tx), identification.stay_reason_details].filter(Boolean).join(" — ")}
          </Statement>
        </StatementGroup>
      ) : null}
      {identification.relationship_since ? (
        <StatementGroup title={tx("Отношение к плательщику (доп. сведения)", "Beziehung zum Zahler (ergänzend)")} columns={STATEMENT_COLUMNS}>
          <Statement label={tx("Знакомы с", "Bekannt seit")} testId="lead-gwg-relationship-since">{identification.relationship_since}</Statement>
        </StatementGroup>
      ) : null}
      {pep ? (
        <StatementGroup title={tx("PEP: подробности", "PEP: Einzelheiten")} columns={STATEMENT_COLUMNS}>
          <Statement label={tx("Должность", "Amt / Funktion")} testId="lead-gwg-pep-office">{identification.pep_office}</Statement>
          <Statement label={tx("Страна", "Land")}>{country(identification.pep_country)}</Statement>
          <Statement label={tx("Период", "Zeitraum")}>{identification.pep_period}</Statement>
          <Statement label={tx("Кем приходится PEP", "Beziehung zur PEP")}>{identification.pep_relationship}</Statement>
          <Statement label={tx("Происхождение состояния", "Herkunft des Vermögens")} className="sm:col-span-2">
            {identification.pep_wealth_origin ? <span className="whitespace-pre-line">{identification.pep_wealth_origin}</span> : null}
          </Statement>
        </StatementGroup>
      ) : null}
      {sanctions ? (
        <StatementGroup title={tx("Связи с санкционными лицами: подробности", "Sanktionsbezug: Einzelheiten")} columns={STATEMENT_COLUMNS}>
          <Statement label={tx("Лицо или организация", "Person oder Organisation")} testId="lead-gwg-sanctions-link-name">
            {identification.sanctions_link_name}
          </Statement>
          <Statement label={tx("Вид связи", "Art der Verbindung")}>{sanctionsLinkKindLabel(identification.sanctions_link_kind, tx)}</Statement>
          <Statement label={tx("С какого времени и в каком объёме", "Seit wann, in welchem Umfang")}>
            {identification.sanctions_link_since_extent}
          </Statement>
        </StatementGroup>
      ) : null}
    </div>
  );
}

/**
 * "Дополнительные сведения": the answers of the cabinet's extra step
 * (two-stage form 2026-10-07; blocks A and B of the risk assessment) — the
 * self-payer's own source of funds with the words and the proof, profession
 * and sector, and what the patient knows of a third party's funds ("со слов
 * пациента", never the payer's own declaration). The proof is required while
 * the enhanced check is; an amber line says when it is missing then.
 * Read-only.
 */
function EnhancedDetailsGroup({ details, tx }: { details: LeadPortalEnhancedDetails; tx: Tx }) {
  const answers = details.answers;
  const proofMissing = enhancedFundsProofMissing(details);
  const ownFunds = details.asks.funds || answers.funds_sources.length > 0 || Boolean(answers.funds_description)
    || details.funds_proof_documents.length > 0;
  const payerFunds = details.asks.payer_funds || Boolean(answers.payer_funds_source || answers.payer_funds_description);
  const proofLabel = `${tx("Подтверждение источника средств", "Nachweis der Mittelherkunft")} · ${
    details.asks.funds_proof ? tx("обязательно", "erforderlich") : tx("необязательно", "optional")
  }`;
  return (
    <div className="space-y-2" data-testid="lead-gwg-enhanced-details">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold text-foreground">
          {tx("Дополнительные сведения", "Zusätzliche Angaben")}
        </h4>
        {details.updated_at ? (
          <span className="inline-flex" data-testid="lead-gwg-enhanced-details-updated">
            <PatientFieldBadge marker={{ at: details.updated_at, access_kind: null }} tx={tx} />
          </span>
        ) : null}
        {details.check_required ? (
          <span className="text-[11px] text-muted-foreground" data-testid="lead-gwg-enhanced-details-check">
            {tx("усиленная проверка обязательна", "verstärkte Prüfung erforderlich")}
          </span>
        ) : null}
      </div>
      <dl className={cn("grid gap-x-6 gap-y-3", STATEMENT_COLUMNS)}>
        {ownFunds ? (
          <>
            <Statement label={tx("Источник средств (пациент платит сам)", "Herkunft der Mittel (Selbstzahler)")} testId="lead-gwg-self-funds-sources">
              {statedFundsSourcesLabel(answers.funds_sources, tx)}
            </Statement>
            <Statement label={tx("Описание", "Beschreibung")} className="sm:col-span-2" testId="lead-gwg-self-funds-description">
              {answers.funds_description ? <span className="whitespace-pre-line">{answers.funds_description}</span> : null}
            </Statement>
          </>
        ) : null}
        {details.asks.occupation || answers.occupation ? (
          <Statement label={tx("Профессия", "Beruf")} testId="lead-gwg-enhanced-occupation">{answers.occupation}</Statement>
        ) : null}
        {details.asks.sector || answers.sector ? (
          <Statement label={tx("Отрасль", "Branche")} testId="lead-gwg-enhanced-sector">{answers.sector}</Statement>
        ) : null}
        {payerFunds ? (
          <Statement
            label={tx("Средства плательщика — со слов пациента", "Mittel des Zahlers – laut Patient/in")}
            className="col-span-full"
            testId="lead-gwg-enhanced-payer-funds"
          >
            {answers.payer_funds_source || answers.payer_funds_description ? (
              <>
                {answers.payer_funds_source ? <span>{statedFundsSourceLabel(answers.payer_funds_source, tx)}</span> : null}
                {answers.payer_funds_description ? (
                  <span className="mt-0.5 block whitespace-pre-line">{answers.payer_funds_description}</span>
                ) : null}
              </>
            ) : null}
          </Statement>
        ) : null}
        {ownFunds ? (
          <Statement label={proofLabel} className="col-span-full" warning={proofMissing} testId="lead-gwg-self-funds-proof">
            {details.funds_proof_documents.length > 0 ? <UploadedFiles documents={details.funds_proof_documents} tx={tx} /> : null}
          </Statement>
        ) : null}
      </dl>
      {details.asks.payer_states_funds ? (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-gwg-enhanced-payer-states-funds">
          {tx(
            "Источник средств и подтверждение плательщик указывает сам — по своей ссылке.",
            "Herkunft der Mittel und Nachweis gibt der Zahler selbst an – über den eigenen Link.",
          )}
        </p>
      ) : null}
      {proofMissing ? (
        <p className={cn("text-xs font-medium leading-5", WARNING_TEXT)} data-testid="lead-self-funds-proof-missing">
          {tx(
            "Требуется усиленная проверка: подтверждение источника средств пациента ещё не загружено",
            "Verstärkte Prüfung erforderlich: Der Nachweis der Herkunft der Mittel des Patienten fehlt noch",
          )}
        </p>
      ) : null}
    </div>
  );
}

/** One answer of the payer: the value (or the files) and what the payer added to it. */
function PayerStatement({ statement, tx }: { statement: PayerStatementRow; tx: Tx }) {
  const documents = statement.documents;
  return (
    <Statement
      label={statement.label}
      className={statement.wide ? "col-span-full" : undefined}
      warning={statement.warning}
      sentence={statement.key.startsWith("answer-")}
      testId={`lead-gwg-payer-${statement.key}`}
    >
      {documents ? (
        documents.length > 0 ? <UploadedFiles documents={documents} tx={tx} /> : null
      ) : statement.value ? (
        <>
          <span className={statement.warning && statement.key.startsWith("answer-") ? "font-semibold" : undefined}>
            {statement.value}
          </span>
          {statement.details ? <span className="mt-0.5 block whitespace-pre-line">{statement.details}</span> : null}
        </>
      ) : null}
    </Statement>
  );
}

/**
 * "Angaben des Zahlers" (phase 3a, 6.2): what the third-party payer stated
 * through the own link, or the paying parent in the cabinet — person or
 * organisation, beneficial owners, identity document, relationship, source
 * of funds with the proof, the legal questions (amber on a "yes") — with the
 * check level and its reasons (level 2: the enhanced check of the owner's
 * rule 2026-10-07 is required), an amber line while level 2 lacks the proof
 * of funds, and when the payer acknowledged the privacy notice. Read-only.
 */
function PayerAnswersGroup({
  state,
  tx,
  lang,
  today,
}: {
  state: LeadPayerLinkState;
  tx: Tx;
  lang: string;
  today: string;
}) {
  const questionnaire = state.questionnaire;
  if (!questionnaire) return null;
  const groups = payerQuestionnaireGroups(questionnaire, tx, lang, today);
  const level = payerCheckLevelLine(questionnaire.check_level, questionnaire.check_reasons, tx);
  const privacy = payerPrivacyLine(questionnaire, tx);
  return (
    <div className="space-y-2.5 rounded-md border border-border/60 bg-background/50 p-2.5" data-testid="lead-gwg-payer">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="text-xs font-semibold text-foreground">{tx("Анкета плательщика", "Angaben des Zahlers")}</h4>
        {questionnaire.submitted_at ? (
          <Badge
            variant="outline"
            data-testid="lead-gwg-payer-badge"
            className="h-5 rounded-full border-violet-200 bg-violet-50 px-1.5 text-[10.5px] font-medium text-violet-800"
          >
            {tx(
              `от плательщика · ${formatAppDateTime(questionnaire.submitted_at)}`,
              `vom Zahler am ${formatAppDateTime(questionnaire.submitted_at)}`,
            )}
          </Badge>
        ) : (
          <span className="text-[11px] text-muted-foreground" data-testid="lead-gwg-payer-draft">
            {tx("плательщик ещё не отправил анкету", "vom Zahler noch nicht gesendet")}
          </span>
        )}
        {questionnaire.source === "cabinet" ? (
          <span className="text-[11px] text-muted-foreground">
            {tx("в кабинете родителя", "im Portal des Elternteils")}
          </span>
        ) : null}
      </div>
      {groups.map((group) => (
        <StatementGroup
          key={group.key}
          title={group.title}
          columns={group.key === "legal" ? "grid-cols-1 sm:grid-cols-2" : STATEMENT_COLUMNS}
        >
          {group.rows.map((row) => (
            <PayerStatement key={row.key} statement={row} tx={tx} />
          ))}
        </StatementGroup>
      ))}
      {level ? (
        <p
          className={cn(
            "text-xs font-medium leading-5",
            questionnaire.check_level === 2 ? WARNING_TEXT : "text-muted-foreground",
          )}
          data-testid="lead-gwg-payer-check-level"
          data-level={questionnaire.check_level ?? undefined}
        >
          {level}
        </p>
      ) : null}
      {fundsProofMissing(questionnaire) ? (
        <p className={cn("text-xs font-medium leading-5", WARNING_TEXT)} data-testid="lead-payer-funds-proof-missing">
          {tx(
            "Уровень проверки 2: подтверждение источника средств ещё не загружено",
            "Prüfstufe 2: Der Nachweis der Herkunft der Mittel fehlt noch",
          )}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-gwg-payer-privacy">
        {privacy ||
          tx(
            "Плательщик ещё не подтвердил уведомление о защите данных",
            "Der Zahler hat den Datenschutzhinweis noch nicht bestätigt",
          )}
      </p>
    </div>
  );
}

/**
 * The lead changed answers after sending and has not sent them again: what
 * the block shows is not what the lead confirmed. Nothing on an older server.
 */
function ChangedSinceSubmitLine({ intake, tx }: { intake: LeadPortalIntake; tx: Tx }) {
  if (intake.changed_since_submit !== true) return null;
  return (
    <p className={cn("text-xs font-medium leading-5", WARNING_TEXT)} role="status" data-testid="lead-gwg-changed-since-submit">
      {tx(
        "Пациент изменил данные после отправки — ещё не отправлено повторно",
        "Die Patientin / der Patient hat Angaben nach dem Senden geändert – noch nicht erneut gesendet",
      )}
    </p>
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
 * server sends them; the third-party payer's own answers (phase 3a) come
 * after them, from the payer link the wizard loads.
 */
export function LeadGwgStatements({
  intake,
  payer,
  payerLink,
  tx,
  lang,
  today = appDateKey(),
}: {
  intake: LeadPortalIntake | null;
  /** The payer declaration ("who pays"): own economic interest and the beneficial owner. */
  payer: GwgPayerStatement | null | undefined;
  /** The payer link with the payer's answers; absent on an older server (nothing of it is shown). */
  payerLink?: LeadPayerLinkState | null;
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
  const payerGroup = payerLink?.questionnaire ? (
    <PayerAnswersGroup state={payerLink} tx={tx} lang={lang} today={today} />
  ) : null;

  if (!identification || !hasGwgStatements(intake)) {
    return (
      <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/10 p-3" data-testid="lead-gwg-statements">
        <div className="text-xs font-semibold text-foreground">{title}</div>
        <ChangedSinceSubmitLine intake={intake} tx={tx} />
        <p className="text-xs text-muted-foreground" data-testid="lead-gwg-statements-empty">
          {tx(
            "Пациент ещё не заполнил эти данные в кабинете",
            "Der Patient hat diese Angaben im Portal noch nicht gemacht",
          )}
        </p>
        {/* Who represents a minor is known from the request before anybody opens the cabinet. */}
        {representation?.kind === "minor" ? <div className="pt-1.5">{representationGroup}</div> : null}
        {payerGroup ? <div className="pt-1.5">{payerGroup}</div> : null}
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
      <ChangedSinceSubmitLine intake={intake} tx={tx} />

      <StatementGroup title={tx("Личность", "Person")} columns={STATEMENT_COLUMNS}>
        <Statement label={tx("Обращение", "Anrede")}>{salutationLabel(identification.salutation, tx)}</Statement>
        <Statement label={tx("Фамилия при рождении", "Geburtsname")}>{identification.former_names}</Statement>
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
      {/* Since 2026-10-07 the document data are entered by staff from the scan. */}
      {identityDocumentEnteredLine(identification, tx) || identification.id_document_unreadable ? (
        <p className="-mt-1.5 text-[11px] text-muted-foreground" data-testid="lead-gwg-id-entered-by">
          {identityDocumentEnteredLine(identification, tx)}
          {identification.id_document_unreadable ? (
            <span className={cn("font-medium", WARNING_TEXT)}>
              {identityDocumentEnteredLine(identification, tx) ? " · " : ""}
              {tx("документ нечитаем", "Ausweis unleserlich")}
            </span>
          ) : null}
        </p>
      ) : null}

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

      {enhancedDetailsShown(intake.enhanced_details) ? <EnhancedDetailsGroup details={intake.enhanced_details} tx={tx} /> : null}

      <LeadGwgFollowUpAnswers identification={identification} tx={tx} lang={lang} />


      {intake.billing ? (
        <BillingGroup
          billing={intake.billing}
          updatedAt={intake.billing_updated_at}
          payerLink={intake.payer_link}
          tx={tx}
          lang={lang}
        />
      ) : null}

      {payerGroup}

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
