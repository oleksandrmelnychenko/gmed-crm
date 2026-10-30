import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, CircleAlert, Download, FileText } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
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
  PatientFieldMarker,
  LeadRepresentative,
} from "../data/lead-portal-intake-api";
import {
  answerLabel,
  billingStatements,
  contactChannelsLabel,
  declaredFollowUpDetails,
  EMPTY_STATEMENT,
  gwgLegalAnswers,
  hasBillingStatements,
  hasGwgStatements,
  idDocumentTypeLabel,
  idDocumentValidity,
  ownAccountStatement,
  payerOrganisationStatements,
  paymentRouteByPayerLine,
  representationStatements,
  representationWarningText,
  representativeAddress,
  representativeName,
  representativeRoleLabel,
  salutationLabel,
  enhancedDetailsShown,
  enhancedFundsProofMissing,
  gwgStatementsTitle,
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
import { PatientFieldBadge, useMarkerKind } from "./lead-wizard-portal-intake";
import { PARENT_ROLE_CHIP_CLASS } from "./trusted-contact-role";
import { uploadMoveTargets, type UploadMoveTarget } from "../model/upload-move";
import type { ClientFormSection } from "../model/lead-client-form-steps";
import { ClientFormEditButton } from "./lead-client-form-dialog";

const WARNING_TEXT = "text-amber-700 dark:text-amber-300";
const STATEMENT_COLUMNS = "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
const STATEMENT_CARD_COLUMNS = "grid-cols-1 @sm/statement:grid-cols-2 @3xl/statement:grid-cols-3";
const STATEMENT_CARD = "@container/statement min-w-0 space-y-3 rounded-xl border border-border/60 bg-card p-3";
const STATEMENT_SECTION = "space-y-2.5 border-t border-border/50 pt-3";

function StatementHeading({ children, edit }: { children: ReactNode; edit?: ClientFormSection }) {
  const heading = (
    <h4 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold leading-5 text-foreground">
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
      <span className="min-w-0 break-words">{children}</span>
    </h4>
  );
  if (!edit) return heading;
  // Staff change the client's answers in the client's form (owner 2026-10-29).
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      {heading}
      <ClientFormEditButton section={edit} />
    </div>
  );
}

function PatientStatementsPanel({ title, marker, tx, children }: {
  title: string;
  marker?: PatientFieldMarker;
  tx: Tx;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const contentId = useId();

  return (
    <section className="@container/patient-statements min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="lead-gwg-statements">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
        <AdminSectionTitle>{title}</AdminSectionTitle>
        {marker ? (
          <div className="order-last w-full sm:order-none sm:w-auto">
            <PatientFieldBadge marker={marker} tx={tx} />
          </div>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-foreground"
          aria-label={open ? tx("Свернуть данные пациента", "Patientenangaben einklappen") : tx("Развернуть данные пациента", "Patientenangaben ausklappen")}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? tx("Свернуть", "Einklappen") : tx("Развернуть", "Ausklappen")}
          <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      <div id={contentId} hidden={!open} className="space-y-3 border-t border-border/50 bg-muted/20 p-3" data-testid="lead-gwg-statements-content">
        {children}
      </div>
    </section>
  );
}

/** One group of statements: a caption and its facts as a definition list. */
function StatementGroup({ title, columns, children, card = false, wide = false, footer, edit }: {
  title: string; columns: string; children: ReactNode; card?: boolean; wide?: boolean; footer?: ReactNode;
  /** The block of the client's form that answers this group: an «Изменить» button opens it. */
  edit?: ClientFormSection;
}) {
  return (
    <div className={cn(card ? STATEMENT_CARD : STATEMENT_SECTION, card && wide && "col-span-full")}>
      <StatementHeading edit={edit}>{title}</StatementHeading>
      <dl className={cn("grid gap-x-4 gap-y-3", card ? STATEMENT_CARD_COLUMNS : columns)}>{children}</dl>
      {footer}
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
  hideLabel = false,
  children,
}: {
  label: string;
  className?: string;
  testId?: string;
  warning?: boolean;
  sentence?: boolean;
  hideLabel?: boolean;
  children?: ReactNode;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className={cn("min-w-0", className)} data-testid={testId} data-warning={warning ? "true" : undefined}>
      {/* Long German labels ("Staatsangehörigkeit") wrap inside a narrow column. */}
      <dt
        className={cn(
          "break-words font-mono text-xs font-medium leading-5 text-foreground/75",
          sentence && "max-w-prose",
          hideLabel && "sr-only",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 break-words text-sm font-medium leading-5",
          warning ? WARNING_TEXT : "text-foreground",
        )}
      >
        {empty ? EMPTY_STATEMENT : children}
      </dd>
    </div>
  );
}

/**
 * Staff move a cabinet file into the right slot (owner 2026-10-24); given by
 * the wizard when the role may do it. The server refuses a file already
 * taken over.
 */
type UploadMove = {
  targets: readonly UploadMoveTarget[];
  onMove: (document: LeadIdentityDocument, target: UploadMoveTarget) => void;
};
const UploadMoveContext = createContext<UploadMove | null>(null);

/** "Move to …" of one cabinet file that is not taken over yet. */
function UploadMoveSelect({ document, slot, tx }: { document: LeadIdentityDocument; slot: string; tx: Tx }) {
  const move = useContext(UploadMoveContext);
  if (!move || document.reviewed || document.uploaded_by_staff) return null;
  const targets = move.targets.filter((target) => target.value !== slot);
  if (targets.length === 0) return null;
  return (
    <select
      className="h-7 max-w-full rounded-md border border-border bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      aria-label={tx("Переместить файл", "Datei verschieben")}
      data-testid={`lead-upload-move-${document.id}`}
      value=""
      onChange={(event) => {
        const target = targets.find((item) => item.value === event.currentTarget.value);
        if (target) move.onMove(document, target);
      }}
    >
      <option value="">{tx("Переместить в…", "Verschieben nach…")}</option>
      {targets.map((target) => (
        <option key={target.value} value={target.value}>{target.label}</option>
      ))}
    </select>
  );
}

/** The uploaded files of one kind, each with the day of the upload and "reviewed". */
function UploadedFiles({ documents, tx, onDownload, slot }: {
  documents: readonly LeadIdentityDocument[];
  tx: Tx;
  onDownload?: (document: LeadIdentityDocument) => void;
  /** The cabinet slot of these files (`kind` or `kind:representativeId`): they can be moved elsewhere. */
  slot?: string;
}) {
  return (
    <ul className="min-w-0 space-y-2 break-words text-[13px] leading-5 [overflow-wrap:anywhere]">
      {documents.map((document) => (
        <li key={document.id} className="min-w-0 space-y-2 rounded-lg border border-border/60 bg-muted/15 p-2.5">
          {onDownload ? (
            <button type="button" className="inline-flex max-w-full items-start gap-2 text-left font-medium text-foreground underline decoration-border underline-offset-4 hover:text-[var(--brand)]" onClick={() => onDownload(document)}>
              <Download aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">{document.file_name || EMPTY_STATEMENT}</span>
            </button>
          ) : (
            <div className="flex min-w-0 items-start gap-2 font-medium text-foreground">
              <FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">{document.file_name || EMPTY_STATEMENT}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {document.uploaded_at ? <StatusChip tone="info"><CalendarDays aria-hidden="true" />{formatAppDate(document.uploaded_at)}</StatusChip> : null}
            {document.reviewed ? <StatusChip tone="success">{tx("просмотрен", "geprüft")}</StatusChip> : null}
          </div>
          {slot ? <UploadMoveSelect document={document} slot={slot} tx={tx} /> : null}
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
      className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5 shadow-xs"
      data-testid={`lead-gwg-representative-${person.id}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2.5">
        <span className="text-[13px] font-semibold text-foreground">{representativeName(person) || EMPTY_STATEMENT}</span>
        <StatusChip className={cn(PARENT_ROLE_CHIP_CLASS, "whitespace-normal")}>{representativeRoleLabel(person, tx)}</StatusChip>
        {person.has_login ? (
          <span className="inline-flex" data-testid="lead-gwg-representative-login">
            <StatusChip tone="info">{tx("есть доступ в кабинет", "hat Zugang zum Portal")}</StatusChip>
          </span>
        ) : null}
        {!person.has_data ? (
          <StatusChip tone="warning" className="whitespace-normal" data-testid="lead-gwg-representative-no-data">
            {tx("в кабинете ещё не заполнено", "im Portal noch nicht ausgefüllt")}
          </StatusChip>
        ) : null}
      </div>
      <dl className={cn("grid gap-x-5 gap-y-2.5", STATEMENT_COLUMNS)}>
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
          {person.identity_documents.length > 0 ? <UploadedFiles documents={person.identity_documents} tx={tx} slot={`representative_identity:${person.id}`} /> : null}
        </Statement>
        <Statement
          label={tx("Файлы: подтверждение полномочий", "Dateien: Vertretungsnachweis")}
          className="col-span-full"
          testId={`lead-gwg-representative-authority-documents-${person.id}`}
        >
          {person.authority_documents.length > 0 ? <UploadedFiles documents={person.authority_documents} tx={tx} slot={`representative_authority:${person.id}`} /> : null}
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
  card = false,
}: {
  statements: RepresentationStatements;
  updatedAt: string | null;
  tx: Tx;
  lang: string;
  today: string;
  card?: boolean;
}) {
  const minor = statements.kind === "minor";
  const representationKind = useMarkerKind("representation");
  return (
    <div className={cn(card ? STATEMENT_CARD : STATEMENT_SECTION, card && statements.persons.length > 0 && "col-span-full")} data-testid="lead-gwg-representation">
      <div className="flex flex-wrap items-center gap-2">
        <StatementHeading>
          {minor ? tx("Законные представители", "Gesetzliche Vertreter") : tx("Представительство", "Vertretung")}
        </StatementHeading>
        {updatedAt ? (
          <StatusChip tone="info" className="whitespace-normal" data-testid="lead-gwg-representation-updated">
            <CalendarDays aria-hidden="true" />
            {representationKind === "staff"
              ? `${tx("внёс сотрудник", "von Mitarbeitenden")} · ${formatAppDateTime(updatedAt)}`
              : `${tx("изменено в кабинете", "im Portal geändert")} · ${formatAppDateTime(updatedAt)}`}
          </StatusChip>
        ) : null}
        <ClientFormEditButton section="representation" className="ml-auto" />
      </div>
      <dl className={cn("grid grid-cols-1 gap-x-5 gap-y-2.5", !card && "sm:grid-cols-2")}>
        {statements.kind === "minor" ? (
          <Statement label={tx("Кто представляет ребёнка", "Wer vertritt das Kind")} hideLabel testId="lead-gwg-custody">
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
            {/* The cabinet asks it again (owner 2026-10-10): an open answer shows as "not answered".
                It is asked only after "yes" to the first question (2026-10-11): after "no" it was
                never asked, so it is left out (QA 2026-10-11, N-04) — unless an older answer exists. */}
            {statements.hasRepresentative === false && statements.underGuardianship === null ? null : (
              <Statement
                label={tx("Находится под законной опекой (rechtliche Betreuung)", "Steht unter rechtlicher Betreuung")}
                sentence
                warning={statements.underGuardianship === true}
                testId="lead-gwg-under-guardianship"
              >
                {answerLabel(statements.underGuardianship, tx)}
              </Statement>
            )}
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
function BillingStatementRow({ statement, className, source }: { statement: BillingStatement; className?: string; source?: ReactNode }) {
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
          {source ? <span className="mt-1.5 flex flex-wrap items-center gap-1.5">{source}</span> : null}
        </>
      ) : null}
    </Statement>
  );
}

function PayerOrganisationGroup({
  mask,
  marker,
  tx,
  card = false,
}: {
  mask: Parameters<typeof payerOrganisationStatements>[0];
  marker: PatientFieldMarker | null;
  tx: Tx;
  card?: boolean;
}) {
  return (
    <div className={cn(card ? STATEMENT_CARD : STATEMENT_SECTION, card && "col-span-full")} data-testid="lead-gwg-payer-organisation">
      <div className="flex flex-wrap items-center gap-2">
        <StatementHeading>
          {tx("Плательщик — данные организации из кабинета", "Zahler – Organisationsangaben aus dem Portal")}
        </StatementHeading>
        {marker ? <PatientFieldBadge marker={marker} tx={tx} /> : null}
        <ClientFormEditButton section="payer_organisation" className="ml-auto" />
      </div>
      <dl className={cn("grid gap-x-4 gap-y-3", card ? STATEMENT_CARD_COLUMNS : STATEMENT_COLUMNS)}>
        {payerOrganisationStatements(mask, tx).map((row) => (
          <Statement key={row.key} label={row.label} testId={`lead-gwg-payer-organisation-${row.key}`}>
            {row.value}
          </Statement>
        ))}
      </dl>
    </div>
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
  card = false,
  minor = false,
}: {
  billing: LeadPortalBilling;
  updatedAt: string | null;
  /** A minor's request: "the patient himself" as recipient is the answering parent. */
  minor?: boolean;
  /** The payer link in short: whether and when the payer stated section 8; null on an older server. */
  payerLink: LeadPortalPayerLink | null;
  tx: Tx;
  lang: string;
  card?: boolean;
}) {
  const payerAnswered = Boolean(payerLink?.submitted_at);
  const statements = billingStatements(billing, tx, lang, payerAnswered, minor);
  return (
    <div className={cn(card ? STATEMENT_CARD : STATEMENT_SECTION, card && "col-span-full")} data-testid="lead-gwg-billing">
      <div className="flex flex-wrap items-center gap-2">
        <StatementHeading>
          {tx("Счёт и оплата", "Rechnung und Zahlung")}
        </StatementHeading>
        {updatedAt ? (
          <span className="inline-flex" data-testid="lead-gwg-billing-updated">
            <PatientFieldBadge marker={{ at: updatedAt, access_kind: null }} markerKey="billing" tx={tx} />
          </span>
        ) : null}
        <ClientFormEditButton section="billing" className="ml-auto" />
      </div>
      <dl className={cn("grid gap-x-4 gap-y-3", card ? STATEMENT_CARD_COLUMNS : STATEMENT_COLUMNS)}>
        {statements.invoice.map((statement) => (
          <BillingStatementRow
            key={statement.key}
            statement={statement}
            source={statement.key === "invoice_recipient" && billing.recipient_updated_at ? (
              <span className="inline-flex max-w-full" data-testid="lead-gwg-recipient-updated">
                <PatientFieldBadge marker={{ at: billing.recipient_updated_at, access_kind: null }} markerKey="invoice_recipient" tx={tx} />
              </span>
            ) : undefined}
          />
        ))}
      </dl>
      {statements.byPayer ? (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-gwg-billing-by-payer">
          {paymentRouteByPayerLine(payerLink, tx)}
        </p>
      ) : null}
      {statements.payment.length > 0 ? (
        <dl className={cn("grid gap-x-4 gap-y-3 border-t border-border/50 pt-3", card ? STATEMENT_CARD_COLUMNS : STATEMENT_COLUMNS)}>
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
        <StatusChip tone="warning" className="w-full items-start rounded-xl px-3 py-2" data-testid="lead-gwg-billing-flag">
          <CircleAlert aria-hidden="true" className="mt-0.5" />
          <span>{statements.complianceLine}</span>
        </StatusChip>
      ) : null}
    </div>
  );
}

function stayReasonLabel(value: string | null | undefined, tx: Tx): string {
  switch (value) {
    case "citizenship_or_birth":
      return tx("гражданство / рождение в этой стране", "Staatsangehörigkeit / dort geboren");
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
  identification: stated,
  tx,
  lang,
  cards = false,
}: {
  identification: LeadGwgIdentification;
  tx: Tx;
  lang: string;
  cards?: boolean;
}) {
  const country = (code: string | null | undefined) => countryNameForDisplay(code ?? null, lang);
  // Blocks H and J only next to a "yes", as the Patientenformular (owner 2026-10-24).
  const identification = declaredFollowUpDetails(stated);
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
    <div className={cards ? "contents" : "space-y-3"} data-testid="lead-gwg-follow-up-answers">
      {stay ? (
        <StatementGroup card={cards} edit="follow_up" title={tx("Проживание и гражданства (доп. сведения)", "Aufenthalt und Staatsangehörigkeiten (ergänzend)")} columns={STATEMENT_COLUMNS}>
          <Statement label={tx("Проживает там с", "Wohnhaft dort seit")} testId="lead-gwg-residence-since">{identification.residence_since}</Statement>
          <Statement label={tx("Другие места проживания", "Weitere Wohnsitze")}>{identification.other_residences}</Statement>
          <Statement label={tx("Прежние гражданства", "Frühere Staatsangehörigkeiten")}>
            {(identification.former_citizenships ?? []).map((code) => country(code)).join(", ")}
          </Statement>
          <Statement label={tx("Причина пребывания", "Aufenthaltsgrund")} className={cards ? "col-span-full" : "sm:col-span-2"}>
            {[stayReasonLabel(identification.stay_reason, tx), identification.stay_reason_details].filter(Boolean).join(" — ")}
          </Statement>
        </StatementGroup>
      ) : null}
      {identification.relationship_since ? (
        <StatementGroup card={cards} edit="follow_up" title={tx("Отношение к плательщику (доп. сведения)", "Beziehung zum Zahler (ergänzend)")} columns={STATEMENT_COLUMNS}>
          <Statement label={tx("Знакомы с", "Bekannt seit")} testId="lead-gwg-relationship-since">{identification.relationship_since}</Statement>
        </StatementGroup>
      ) : null}
      {pep ? (
        <StatementGroup card={cards} edit="follow_up" title={tx("PEP: подробности", "PEP: Einzelheiten")} columns={STATEMENT_COLUMNS}>
          <Statement label={tx("Должность", "Amt / Funktion")} testId="lead-gwg-pep-office">{identification.pep_office}</Statement>
          <Statement label={tx("Страна", "Land")}>{country(identification.pep_country)}</Statement>
          <Statement label={tx("Период", "Zeitraum")}>{identification.pep_period}</Statement>
          <Statement label={tx("Кем приходится PEP", "Beziehung zur PEP")}>{identification.pep_relationship}</Statement>
          <Statement label={tx("Происхождение состояния", "Herkunft des Vermögens")} className={cards ? "col-span-full" : "sm:col-span-2"}>
            {identification.pep_wealth_origin ? <span className="whitespace-pre-line">{identification.pep_wealth_origin}</span> : null}
          </Statement>
        </StatementGroup>
      ) : null}
      {sanctions ? (
        <StatementGroup card={cards} edit="follow_up" title={tx("Связи с санкционными лицами: подробности", "Sanktionsbezug: Einzelheiten")} columns={STATEMENT_COLUMNS}>
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
 * the enhanced check is; its row turns amber while it is missing (the
 * enhanced-check section of the wizard carries the one warning line).
 * Read-only.
 */
function EnhancedDetailsGroup({ details, tx, card = false }: { details: LeadPortalEnhancedDetails; tx: Tx; card?: boolean }) {
  const answers = details.answers;
  const proofMissing = enhancedFundsProofMissing(details);
  const ownFunds = details.asks.funds || answers.funds_sources.length > 0 || Boolean(answers.funds_description)
    || details.funds_proof_documents.length > 0;
  const payerFunds = details.asks.payer_funds || Boolean(answers.payer_funds_source || answers.payer_funds_description);
  const proofLabel = `${tx("Подтверждение источника средств", "Nachweis der Mittelherkunft")} · ${
    details.asks.funds_proof ? tx("обязательно", "erforderlich") : tx("необязательно", "optional")
  }`;
  return (
    <div className={card ? STATEMENT_CARD : STATEMENT_SECTION} data-testid="lead-gwg-enhanced-details">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold text-foreground">
          {tx("Дополнительные сведения", "Zusätzliche Angaben")}
        </h4>
        {details.updated_at ? (
          <span className="inline-flex" data-testid="lead-gwg-enhanced-details-updated">
            <PatientFieldBadge marker={{ at: details.updated_at, access_kind: null }} markerKey="enhanced_details" tx={tx} />
          </span>
        ) : null}
        {details.check_required ? (
          <span className="text-[11px] text-muted-foreground" data-testid="lead-gwg-enhanced-details-check">
            {tx("усиленная проверка требуется по правилу GMED", "verstärkte Prüfung nach GMED-Regel erforderlich")}
          </span>
        ) : null}
        <ClientFormEditButton section="enhanced_details" className="ml-auto" />
      </div>
      <dl className={cn("grid gap-x-5 gap-y-2.5", card ? "grid-cols-1" : STATEMENT_COLUMNS)}>
        {ownFunds ? (
          <>
            <Statement label={tx("Источник средств (пациент платит сам)", "Herkunft der Mittel (Selbstzahler)")} testId="lead-gwg-self-funds-sources">
              {statedFundsSourcesLabel(answers.funds_sources, tx)}
            </Statement>
            <Statement label={tx("Описание", "Beschreibung")} className={card ? "col-span-full" : "sm:col-span-2"} testId="lead-gwg-self-funds-description">
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
            {details.funds_proof_documents.length > 0 ? <UploadedFiles documents={details.funds_proof_documents} tx={tx} slot="self_funds_proof" /> : null}
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
    </div>
  );
}

/** The saved proof of the payer relationship, also before any other extra answer. */
function RelationshipProofGroup({ details, tx, onDownload, fallbackRequested, card = false }: {
  details: LeadPortalEnhancedDetails | null | undefined;
  tx: Tx;
  onDownload?: (document: LeadIdentityDocument) => void;
  fallbackRequested: boolean;
  card?: boolean;
}) {
  const documents = details?.relationship_proof_documents ?? [];
  const requested = details?.relationship_proof_requested ?? fallbackRequested;
  if (!requested && documents.length === 0) return null;
  return (
    <div className={card ? STATEMENT_CARD : STATEMENT_SECTION} data-testid="lead-gwg-relationship-proof">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold text-foreground">
          {tx("Подтверждение связи с плательщиком", "Nachweis der Beziehung zum Zahler")}
        </h4>
        <ClientFormEditButton section="relationship_proof" className="ml-auto" />
      </div>
      {documents.length > 0 ? <UploadedFiles documents={documents} tx={tx} onDownload={onDownload} slot="relationship_proof" /> : (
        <StatusChip tone="warning" data-testid="lead-gwg-relationship-proof-missing">
          <CircleAlert aria-hidden="true" />
          <span>{tx("Подтверждение связи запрошено — документ ещё не загружен", "Beziehungsnachweis angefordert – noch kein Dokument hochgeladen")}</span>
        </StatusChip>
      )}
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
export function PayerAnswersGroup({
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
        <StatusChip tone="warning" className="w-full items-start rounded-xl px-3 py-2" data-testid="lead-payer-funds-proof-missing">
          <CircleAlert aria-hidden="true" className="mt-0.5" />
          <span>{tx(
            "Уровень проверки 2: подтверждение источника средств ещё не загружено",
            "Prüfstufe 2: Der Nachweis der Herkunft der Mittel fehlt noch",
          )}</span>
        </StatusChip>
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
  onMoveDocument,
  ...props
}: Parameters<typeof LeadGwgStatementsBody>[0] & {
  /** Staff may move a cabinet file into another slot (owner 2026-10-24). */
  onMoveDocument?: (document: LeadIdentityDocument, target: UploadMoveTarget) => void;
}) {
  const body = <LeadGwgStatementsBody {...props} />;
  if (!onMoveDocument || !props.intake) return body;
  return (
    <UploadMoveContext.Provider value={{ targets: uploadMoveTargets(props.intake, props.tx), onMove: onMoveDocument }}>
      {body}
    </UploadMoveContext.Provider>
  );
}

function LeadGwgStatementsBody({
  intake,
  payer,
  payerLink,
  askedBlocks = [],
  onDownloadDocument,
  tx,
  lang,
  today = appDateKey(),
}: {
  intake: LeadPortalIntake | null;
  /** The payer declaration ("who pays"): own economic interest and the beneficial owner. */
  payer: GwgPayerStatement | null | undefined;
  /** The payer link with the payer's answers; absent on an older server (nothing of it is shown). */
  payerLink?: LeadPayerLinkState | null;
  /**
   * The follow-up blocks of the risk assessment the lead is asked (open or
   * requested): K shows the birth data and L the legal questions also while
   * unanswered; otherwise only answers are shown.
   */
  askedBlocks?: readonly string[];
  /** Optional read-only file action; the caller retains its document permissions and error handling. */
  onDownloadDocument?: (document: LeadIdentityDocument) => void;
  tx: Tx;
  lang: string;
  /** The Berlin date ("YYYY-MM-DD") the identity document must still be valid on. */
  today?: string;
}) {
  if (!intake || intake.identification_hidden) return null;
  const identification = intake.identification;
  const title = gwgStatementsTitle(intake, tx);
  const cards = Boolean(identification && hasGwgStatements(intake));
  const representation = representationStatements(intake, tx);
  const representationGroup = representation ? (
    <RepresentationGroup
      card={cards}
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
  const organisationGroup = intake.payer_organisation ? (
    <PayerOrganisationGroup card={cards} mask={intake.payer_organisation} marker={intake.patient_payer} tx={tx} />
  ) : null;
  const billingGroup = intake.billing ? (
    <BillingGroup card={cards} billing={intake.billing} updatedAt={intake.billing_updated_at} payerLink={intake.payer_link} minor={intake.minor === true} tx={tx} lang={lang} />
  ) : null;

  if (!identification || !hasGwgStatements(intake)) {
    return (
      <PatientStatementsPanel key={intake.lead_id} title={title} tx={tx}>
        <ChangedSinceSubmitLine intake={intake} tx={tx} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" data-testid="lead-gwg-statements-empty">
            {tx(
              "Пациент ещё не заполнил эти данные в кабинете",
              "Der Patient hat diese Angaben im Portal noch nicht gemacht",
            )}
          </p>
          {/* Staff may fill them in for the client (owner 2026-10-29): the identity document first. */}
          <ClientFormEditButton section="identity" />
        </div>
        {/* Who represents a minor is known from the request before anybody opens the cabinet. */}
        {representation?.kind === "minor" ? <div className="pt-1.5">{representationGroup}</div> : null}
        {payerGroup ? <div className="pt-1.5">{payerGroup}</div> : null}
        {organisationGroup}
        {hasBillingStatements(intake) ? billingGroup : null}
        <RelationshipProofGroup details={intake.enhanced_details} tx={tx} onDownload={onDownloadDocument} fallbackRequested={askedBlocks.includes("B") && payer?.payer_kind === "third_party"} />
      </PatientStatementsPanel>
    );
  }

  const country = (code: string | null) => countryNameForDisplay(code, lang);
  const validity = idDocumentValidity(identification.id_valid_until, today);
  const ownAccount = ownAccountStatement(payer);
  // Birth data (block K) and the legal questions (block L) are follow-up
  // questions: a lead who was never asked them shows no "—" / "Не отвечено"
  // rows (QA 2026-10-10); an answer is always shown.
  const asked = (block: string) => askedBlocks.includes(block);
  const legalAnswers = gwgLegalAnswers(identification, tx, lang).filter(
    (item) => asked("L") || (item.answer !== null && item.answer !== undefined),
  );
  const birthRows = [
    { key: "former_names", label: tx("Фамилия при рождении", "Geburtsname"), value: identification.former_names },
    { key: "birth_place", label: tx("Место рождения", "Geburtsort"), value: identification.birth_place },
    { key: "birth_country", label: tx("Страна рождения", "Geburtsland"), value: country(identification.birth_country) },
  ].filter((item) => asked("K") || Boolean(item.value?.trim()));
  // Likewise (QA 2026-10-10): the own economic interest is block L's, why a
  // third party pays block B's (opened only for a third-party payer), and the
  // habitual residence is shown only when the lead gave one.
  const habitualResidence = country(identification.habitual_residence_country);
  const ownAccountShown = asked("L") || ownAccount.answer !== null;
  const paymentBackground = identification.payment_background?.trim() ?? "";
  const paymentBackgroundShown = asked("B") || Boolean(paymentBackground);

  return (
    <PatientStatementsPanel key={intake.lead_id} title={title} marker={{ at: intake.identification_updated_at, access_kind: null }} tx={tx}>
      <ChangedSinceSubmitLine intake={intake} tx={tx} />

      <div className="grid grid-cols-1 items-start gap-3 @3xl/patient-statements:grid-cols-2" data-testid="lead-gwg-statements-grid">
        <div className="min-w-0 space-y-3">
        {/* With the birth data (block K) the follow-up step; the salutation and the channels are step 1's. */}
        <StatementGroup card edit={birthRows.length > 0 ? "birth" : "person"} title={tx("Личность", "Person")} columns={STATEMENT_COLUMNS}>
          <Statement label={tx("Обращение", "Anrede")}>{salutationLabel(identification.salutation, tx)}</Statement>
          {birthRows.map((item) => (
            <Statement key={item.key} label={item.label} testId={`lead-gwg-${item.key}`}>{item.value}</Statement>
          ))}
          {habitualResidence ? (
            <Statement
              label={tx("Страна обычного пребывания (если другая)", "Gewöhnlicher Aufenthalt (falls abweichend)")}
              testId="lead-gwg-habitual-residence"
            >
              {habitualResidence}
            </Statement>
          ) : null}
          <Statement label={tx("Каналы связи", "Kontaktwege")}>
            {contactChannelsLabel(identification.contact_channels, tx)}
          </Statement>
        </StatementGroup>
        {representation && representation.persons.length === 0 ? representationGroup : null}
        </div>

        <StatementGroup card edit="identity" title={tx("Документ, удостоверяющий личность", "Ausweisdokument")} columns={STATEMENT_COLUMNS}
          footer={identityDocumentEnteredLine(identification, tx) || identification.id_document_unreadable ? (
            <StatusChip tone="warning" className="whitespace-normal" data-testid="lead-gwg-id-entered-by">
              {identityDocumentEnteredLine(identification, tx)}
              {identification.id_document_unreadable ? (
                <span className={cn("font-medium", WARNING_TEXT)}>
                  {identityDocumentEnteredLine(identification, tx) ? " · " : ""}
                  {tx("документ нечитаем", "Ausweis unleserlich")}
                </span>
              ) : null}
            </StatusChip>
          ) : null}
        >
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
            {intake.identity_documents.length > 0 ? <UploadedFiles documents={intake.identity_documents} tx={tx} slot="identity" /> : null}
          </Statement>
        </StatementGroup>

        {representation && representation.persons.length > 0 ? representationGroup : null}

        {ownAccountShown || paymentBackgroundShown ? (
          <StatementGroup
            card
            edit="economic_interest"
            title={tx("Экономический интерес", "Wirtschaftliches Interesse")}
            columns="grid-cols-1 sm:grid-cols-3"
          >
            {ownAccountShown ? (
              <Statement
                label={tx("В собственных экономических интересах", "Im eigenen wirtschaftlichen Interesse")}
                warning={ownAccount.answer === false}
                testId="lead-gwg-own-account"
              >
                {answerLabel(ownAccount.answer, tx)}
              </Statement>
            ) : null}
            {ownAccount.answer === false ? (
              <Statement label={tx("В чьих интересах", "Wirtschaftlich Berechtigter")} className="col-span-full">
                {ownAccount.beneficialOwner}
              </Statement>
            ) : null}
            {paymentBackgroundShown ? (
              <Statement
                label={tx("Почему платит третье лицо", "Hintergrund der Zahlung durch Dritte")}
                className="col-span-full"
                testId="lead-gwg-payment-background"
              >
                {paymentBackground}
              </Statement>
            ) : null}
          </StatementGroup>
        ) : null}

        {enhancedDetailsShown(intake.enhanced_details) ? <EnhancedDetailsGroup card details={intake.enhanced_details} tx={tx} /> : null}
        <RelationshipProofGroup card details={intake.enhanced_details} tx={tx} onDownload={onDownloadDocument} fallbackRequested={askedBlocks.includes("B") && payer?.payer_kind === "third_party"} />

        <LeadGwgFollowUpAnswers cards identification={identification} tx={tx} lang={lang} />


        {billingGroup}

        {payerGroup ? <div className="col-span-full min-w-0">{payerGroup}</div> : null}
        {organisationGroup}

        {legalAnswers.length > 0 ? (
        <StatementGroup card wide edit="legal" title={tx("Юридические вопросы", "Rechtliche Fragen")} columns="grid-cols-1 sm:grid-cols-2">
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
        ) : null}
      </div>

      <div className="border-t border-border/50 pt-3" data-testid="lead-gwg-declared-correct">
        <StatusChip tone={identification.declared_correct_at ? "info" : "neutral"} className="whitespace-normal">
          <CalendarDays aria-hidden="true" />
          <span>{identification.declared_correct_at
          ? `${tx("Подтвердил правильность:", "Richtigkeit bestätigt am")} ${formatAppDateTime(identification.declared_correct_at)}`
          : `${tx("Подтвердил правильность:", "Richtigkeit bestätigt:")} ${tx("ещё нет", "noch nicht")}`}</span>
        </StatusChip>
      </div>
    </PatientStatementsPanel>
  );
}
