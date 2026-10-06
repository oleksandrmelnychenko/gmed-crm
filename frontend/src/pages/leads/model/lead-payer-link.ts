/**
 * The payer's own link in the staff wizard (contract phase 3a, section 6):
 * the status line, what may be done now and why not, the error texts, the
 * check level and the payer's answers as rows of "Данные от пациента".
 */
import { countryNameForDisplay } from "@/components/ui/country-select";
import { ApiRequestError } from "@/lib/api";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";

import {
  PAYER_LINK_BLOCKED_REASONS,
  type LeadPayerLinkState,
  type PayerBeneficialOwner,
  type PayerLinkInfo,
  type PayerQuestionnaireDocument,
  type StaffPayerQuestionnaire,
} from "../data/lead-payer-link-api";
import { enhancedCheckReasonLabel } from "./enhanced-check";
import {
  answerLabel,
  contactChannelsLabel,
  gwgLegalAnswers,
  idDocumentTypeLabel,
  idDocumentValidity,
  representativeAddress,
  salutationLabel,
} from "./lead-gwg-statements";
import { loginEmailErrorMessage } from "./lead-portal-access";
import {
  PAYER_RELATIONSHIP_KINDS,
  SOURCE_OF_FUNDS,
  payerRelationshipKindLabel,
  payerTypeLabel,
  sourceOfFundsLabel,
  type PayerType,
  type Tx,
} from "./lead-payer";

export type { Tx };

/**
 * Whether a `lead.portal_updated` change touches the payer link: the payer's
 * own writes (`payer_link`), the lead's submit (the link may be sent now) and
 * "who pays" (another payer revokes the link).
 */
export function payerLinkChanged(change: unknown): boolean {
  return change === "payer_link" || change === "submitted" || change === "payer";
}

/** Statuses of a link the payer can still open: it can be resent or revoked. */
const ACTIVE_STATUSES: readonly string[] = ["sent", "opened", "verified", "locked", "submitted"];

export function payerLinkActive(link: PayerLinkInfo | null | undefined): boolean {
  return Boolean(link && ACTIVE_STATUSES.includes(link.status));
}

/** Why a link was revoked, as the status line says it. */
export function payerLinkRevokeReasonLabel(reason: string | null | undefined, tx: Tx): string {
  switch (reason) {
    case "resent":
      return tx("отправлена новая ссылка", "neuer Link gesendet");
    case "staff_revoked":
      return tx("отозвана сотрудником", "von GMED widerrufen");
    case "payer_changed":
      return tx("плательщик изменён", "Zahler geändert");
    case "email_changed":
      return tx("изменён e-mail плательщика", "E-Mail des Zahlers geändert");
    case "lead_converted":
      return tx("лид переведён в пациенты", "Lead wurde umgewandelt");
    case "email_failed":
      return tx("письмо не удалось отправить", "E-Mail konnte nicht gesendet werden");
    default:
      return reason ?? "";
  }
}

export type PayerLinkStatusLine = {
  /** The badge: what the link is now. */
  label: string;
  tone: "info" | "success" | "neutral" | "error" | "warning";
  /** The facts with their times, DD.MM.YYYY HH:mm (Berlin). */
  text: string;
};

function capitalised(value: string): string {
  return value ? value.charAt(0).toLocaleUpperCase() + value.slice(1) : value;
}

/**
 * The status of the newest link: the state as a badge, and one line with
 * when it was sent to which address (and by whom), opened, confirmed,
 * answered, until when it is valid, or why it was revoked. `submittedAt` is
 * the time the payer sent the answers (from the questionnaire).
 */
export function payerLinkStatusLine(
  link: PayerLinkInfo,
  submittedAt: string | null | undefined,
  tx: Tx,
): PayerLinkStatusLine {
  const at = (value: string | null | undefined) => (value ? formatAppDateTime(value) : "");
  const sentFact = link.sent_at
    ? [
        tx(`отправлена ${at(link.sent_at)}`, `gesendet am ${at(link.sent_at)}`),
        link.email ? tx(` на ${link.email}`, ` an ${link.email}`) : "",
        link.sent_by_name ? ` (${link.sent_by_name})` : "",
      ].join("")
    : "";
  const validUntil = link.expires_at
    ? tx(`действует до ${formatAppDate(link.expires_at)}`, `gültig bis ${formatAppDate(link.expires_at)}`)
    : "";
  let label: string;
  let tone: PayerLinkStatusLine["tone"];
  let facts: string[];
  switch (link.status) {
    case "sent":
      label = tx("Отправлена", "Gesendet");
      tone = "info";
      facts = [sentFact, validUntil];
      break;
    case "opened":
      label = tx("Открыта", "Geöffnet");
      tone = "info";
      facts = [
        link.opened_at ? tx(`открыта ${at(link.opened_at)}`, `geöffnet am ${at(link.opened_at)}`) : tx("открыта", "geöffnet"),
        sentFact,
        validUntil,
      ];
      break;
    case "verified":
      label = tx("E-mail подтверждён", "E-Mail bestätigt");
      tone = "info";
      facts = [
        link.verified_at
          ? tx(`код подтверждён ${at(link.verified_at)}`, `Code bestätigt am ${at(link.verified_at)}`)
          : tx("код подтверждён", "Code bestätigt"),
        sentFact,
        validUntil,
      ];
      break;
    case "submitted":
      label = tx("Анкета получена", "Angaben eingegangen");
      tone = "success";
      facts = [
        submittedAt
          ? tx(`анкета получена ${at(submittedAt)}`, `Angaben eingegangen am ${at(submittedAt)}`)
          : tx("анкета получена", "Angaben eingegangen"),
        sentFact,
      ];
      break;
    case "expired":
      label = tx("Срок истёк", "Abgelaufen");
      tone = "neutral";
      facts = [
        link.expires_at
          ? tx(`срок истёк ${at(link.expires_at)}`, `abgelaufen am ${at(link.expires_at)}`)
          : tx("срок истёк", "abgelaufen"),
        sentFact,
      ];
      break;
    case "revoked":
      label = tx("Отозвана", "Widerrufen");
      tone = "neutral";
      facts = [
        [
          link.revoked_at ? tx(`отозвана ${at(link.revoked_at)}`, `widerrufen am ${at(link.revoked_at)}`) : tx("отозвана", "widerrufen"),
          link.revoked_reason ? ` — ${payerLinkRevokeReasonLabel(link.revoked_reason, tx)}` : "",
        ].join(""),
        sentFact,
      ];
      break;
    case "locked":
      label = tx("Заблокирована", "Gesperrt");
      tone = "error";
      facts = [
        tx("заблокирована: слишком много неверных кодов", "gesperrt: zu viele falsche Codes"),
        sentFact,
      ];
      break;
  }
  // The e-mail that failed is the reason of an `email_failed` revocation already.
  if (link.last_email_status === "failed" && link.revoked_reason !== "email_failed") {
    facts.push(tx("последнее письмо не доставлено", "letzte E-Mail nicht zugestellt"));
    if (tone !== "error") tone = "warning";
  }
  const text = facts.filter(Boolean).join(" · ");
  return { label, tone, text: capitalised(text) };
}

/** Why the link cannot be sent now, as a sentence. */
export function payerLinkBlockedReasonText(reason: string | null | undefined, tx: Tx): string {
  switch (reason) {
    case "request_not_submitted":
      return tx(
        "Ссылку можно отправить, когда пациент отправит заявку в кабинете",
        "Der Link kann gesendet werden, sobald der Patient die Anfrage im Portal gesendet hat",
      );
    case "no_third_party":
      return tx(
        "Ссылка нужна только для плательщика — третьего лица; сначала сохраните раздел «Кто платит»",
        "Der Link ist nur für einen dritten Zahler vorgesehen; zuerst „Wer zahlt“ speichern",
      );
    case "contact_consent_missing":
      return tx(
        "Пациент ещё не дал согласие на контакт с плательщиком",
        "Das Einverständnis des Patienten zur Kontaktaufnahme mit dem Zahler fehlt noch",
      );
    case "payer_email_missing":
      return tx(
        "Укажите корректный e-mail плательщика и сохраните раздел",
        "Bitte eine gültige E-Mail-Adresse des Zahlers eintragen und speichern",
      );
    case "payer_has_cabinet_login":
      return payerLinkCabinetNote(tx);
    case "lead_converted":
      return tx(
        "Лид уже переведён в пациенты: ссылку отправить нельзя",
        "Der Lead wurde bereits umgewandelt: Es kann kein Link mehr gesendet werden",
      );
    default:
      return tx("Ссылку сейчас отправить нельзя", "Der Link kann derzeit nicht gesendet werden");
  }
}

/** The note for a paying parent with a cabinet login: the questionnaire is in that cabinet. */
export function payerLinkCabinetNote(tx: Tx): string {
  return tx(
    "Плательщик — родитель с доступом в кабинет: анкета в его кабинете",
    "Zahler ist Elternteil mit Portalzugang: Fragebogen im Portal",
  );
}

/**
 * E-mail sending is not set up: the wording of the lead row's "send access by
 * e-mail" dialog, without its hint to pass the access on by message.
 */
export function payerLinkMailMissingText(tx: Tx): string {
  return tx(
    "Отправка e-mail не настроена. Mittaro подключается в разделе «API-подключения» → «E-Mail».",
    "Der E-Mail-Versand ist nicht eingerichtet. Mittaro wird unter „API-Verbindungen“ → „E-Mail“ verbunden.",
  );
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const body = error.body;
  if (body && typeof body.code === "string") return body.code;
  if (body && typeof body.error === "string") return body.error;
  return typeof error.code === "string" ? error.code : null;
}

/**
 * The localized reason a write of the payer link failed: a 409 with a
 * blocked reason, a submitted questionnaire without "reopen", a refused
 * amount, a mail error. `null` for anything else (the caller's fallback).
 */
export function payerLinkErrorText(error: unknown, tx: Tx): string | null {
  const code = errorCode(error);
  if (!code) return null;
  if ((PAYER_LINK_BLOCKED_REASONS as readonly string[]).includes(code)) return payerLinkBlockedReasonText(code, tx);
  switch (code) {
    case "payer_already_submitted":
      return tx(
        "Плательщик уже отправил анкету: для новой ссылки отметьте «Открыть анкету для исправлений»",
        "Der Zahler hat die Angaben bereits gesendet: Für einen neuen Link „Zur Korrektur öffnen“ wählen",
      );
    case "invalid_field":
      return tx(
        "Проверьте сумму: число от 0, не больше двух знаков после запятой",
        "Bitte den Betrag prüfen: eine Zahl ab 0 mit höchstens zwei Nachkommastellen",
      );
    case "mail_not_configured":
      return payerLinkMailMissingText(tx);
    default:
      return loginEmailErrorMessage(error, tx("ru", "de"));
  }
}

/** What the panel offers now, and why a button is disabled. */
export type PayerLinkActions = {
  /** The paying parent answers in the cabinet: no link, a note instead. */
  cabinet: boolean;
  /** "Send" for the first link (or after the last one ended), "send again" while one is active. */
  sendKind: "send" | "resend";
  sendEnabled: boolean;
  /** The readable reason the send button is disabled; null while it is enabled. */
  sendBlockedText: string | null;
  /** The payer sent the answers: a new link needs "reopen for correction". */
  reopenOffered: boolean;
  revokeEnabled: boolean;
  /** The lead's request is in and no link went out yet: the button stands out. */
  highlight: boolean;
};

export function payerLinkActions(
  state: Pick<LeadPayerLinkState, "mode" | "can_send" | "blocked_reason" | "mail_available" | "link" | "questionnaire">,
  reopen: boolean,
  tx: Tx,
): PayerLinkActions {
  const cabinet = state.mode === "cabinet" || state.blocked_reason === "payer_has_cabinet_login";
  const active = payerLinkActive(state.link);
  const submitted = Boolean(state.questionnaire?.submitted_at) || state.link?.status === "submitted";
  const reopenOffered = !cabinet && submitted && !state.blocked_reason;
  let sendBlockedText: string | null = null;
  // The server's `can_send` is false for a blocked reason, without e-mail sending, and without leads.edit.
  if (state.blocked_reason) sendBlockedText = payerLinkBlockedReasonText(state.blocked_reason, tx);
  else if (!state.mail_available) sendBlockedText = payerLinkMailMissingText(tx);
  else if (!state.can_send) sendBlockedText = payerLinkBlockedReasonText(null, tx);
  else if (submitted && !reopen) {
    sendBlockedText = tx(
      "Анкета уже получена: чтобы отправить ссылку снова, отметьте «Открыть анкету для исправлений»",
      "Die Angaben sind eingegangen: Für einen neuen Link „Zur Korrektur öffnen“ wählen",
    );
  }
  return {
    cabinet,
    sendKind: active ? "resend" : "send",
    sendEnabled: !cabinet && sendBlockedText === null,
    sendBlockedText: cabinet ? null : sendBlockedText,
    reopenOffered,
    revokeEnabled: !cabinet && active,
    highlight: !cabinet && state.can_send && !state.link,
  };
}

/**
 * "Send again" while the payer has the link open (`opened`) or confirmed the
 * code (`verified`): the payer is filling in the questionnaire, and the new
 * link ends the old one and its session — staff are asked first.
 */
export function payerLinkResendAsksFirst(link: Pick<PayerLinkInfo, "status"> | null | undefined): boolean {
  return link?.status === "opened" || link?.status === "verified";
}

/** The question before such a resend. */
export function payerLinkResendQuestion(tx: Tx): string {
  return tx(
    "Плательщик сейчас заполняет анкету — старая ссылка перестанет работать. Отправить новую?",
    "Der Zahler füllt den Fragebogen gerade aus – der alte Link wird ungültig. Neuen Link senden?",
  );
}

/**
 * The expected total as typed: "12000", "12 000,50", "12.000,50" or
 * "12000.5" → "12000.50"; "" → null (cleared). `undefined` for anything that
 * is not an amount ≥ 0 with at most two decimals.
 */
export function parseEstimatedTotal(input: string): string | null | undefined {
  const compact = input.replace(/[\s']/g, "").replace(/(EUR|€)$/i, "");
  // (`\s` also takes the no-break spaces of a copied "12 000".)
  if (compact === "") return null;
  let normalized = compact;
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both: the last one is the decimal separator, the other groups thousands.
    const decimal = lastComma > lastDot ? "," : ".";
    const group = decimal === "," ? "." : ",";
    normalized = compact.split(group).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(compact) && compact.split(",").length > 2
      ? compact.split(",").join("")
      : compact.replace(",", ".");
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(compact)) {
    // "12.000" in German: a thousands separator, not 12 euros.
    normalized = compact.split(".").join("");
  }
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) return undefined;
  const [whole, fraction = ""] = normalized.split(".");
  return `${String(Number(whole))}.${fraction.padEnd(2, "0")}`;
}

/** "12000.00" as staff type it: "12000,00"; "" while none. */
export function estimatedTotalInput(value: string | null | undefined): string {
  return value ? value.replace(".", ",") : "";
}

/** "10 000" (RU) / "10.000" (DE): a number with the language's grouping (the owners' shares). */
function amountLabel(value: number, tx: Tx): string {
  return value.toLocaleString(tx("ru-RU", "de-DE"), { maximumFractionDigits: 2 });
}

/**
 * Why the check level is what it is, as a short label: the keys of the
 * enhanced check (owner rule 2026-10-07) — a black-list residence or
 * citizenship of the patient or the payer, a confirmed sanctions match, and
 * an open match as information.
 */
export function payerCheckReasonLabel(reason: string, tx: Tx): string {
  return enhancedCheckReasonLabel(reason, tx);
}

/**
 * "Prüfstufe: 2 — Wohnsitzland des Zahlers auf der Blacklist"; "" while the
 * server sends no level. Level 2 means the enhanced check is required and the
 * payer proves the source of funds; an open sanctions match is named on
 * either level.
 */
export function payerCheckLevelLine(
  level: number | null | undefined,
  reasons: readonly string[],
  tx: Tx,
): string {
  if (level !== 1 && level !== 2) return "";
  const labels = reasons.map((reason) => payerCheckReasonLabel(reason, tx));
  return `${tx("Уровень проверки: ", "Prüfstufe: ")}${level}${labels.length > 0 ? ` — ${labels.join(", ")}` : ""}`;
}

/** Level 2 needs a proof of the source of funds; none is uploaded. */
export function fundsProofMissing(
  questionnaire: Pick<StaffPayerQuestionnaire, "check_level" | "funds_proof_required" | "funds_proof_documents"> | null | undefined,
): boolean {
  if (!questionnaire) return false;
  const required = questionnaire.check_level === 2 || questionnaire.funds_proof_required;
  return required && questionnaire.funds_proof_documents.length === 0;
}

/** A language of the payer, by its code. */
export function payerLanguageLabel(code: string | null | undefined, tx: Tx): string {
  switch (code) {
    case "de":
      return tx("немецкий", "Deutsch");
    case "en":
      return tx("английский", "Englisch");
    case "uk":
      return tx("украинский", "Ukrainisch");
    case "ru":
      return tx("русский", "Russisch");
    default:
      return code ?? "";
  }
}

const isPayerType = (value: string): value is PayerType =>
  value === "person" || value === "company" || value === "organisation" || value === "insurance";

/** One answer of the payer: label, value ("" for a dash), details, amber when staff must look at it. */
export type PayerStatementRow = {
  key: string;
  label: string;
  value: string;
  details: string;
  warning: boolean;
  /** Uploaded files of the row, by name. */
  documents?: PayerQuestionnaireDocument[];
  /** A row as wide as the group. */
  wide?: boolean;
};

export type PayerStatementGroup = {
  key: "identity" | "id_document" | "owners" | "relation" | "legal";
  title: string;
  rows: PayerStatementRow[];
};

function row(
  key: string,
  label: string,
  value: string | null | undefined,
  options: { details?: string | null } & Partial<Pick<PayerStatementRow, "warning" | "documents" | "wide">> = {},
): PayerStatementRow {
  return {
    key,
    label,
    value: value?.trim() ?? "",
    details: options.details?.trim() ?? "",
    warning: options.warning === true,
    ...(options.documents ? { documents: options.documents } : {}),
    ...(options.wide ? { wide: true } : {}),
  };
}

const joined = (...parts: Array<string | null | undefined>) =>
  parts.map((part) => part?.trim()).filter(Boolean).join(", ");

/** "Viktor Zahler · 02.03.1970, Wien · Musterweg 1, 1010 Wien, Австрия · 30 %". */
export function beneficialOwnerLine(owner: PayerBeneficialOwner, tx: Tx, lang: string): string {
  const name = [owner.first_name, owner.last_name].map((part) => part?.trim()).filter(Boolean).join(" ");
  const birth = joined(formatAppDate(owner.date_of_birth), owner.birth_place);
  const address = representativeAddress(owner, lang);
  const percent = owner.share_percent === null ? Number.NaN : Number(owner.share_percent);
  const share = Number.isFinite(percent) ? `${amountLabel(percent, tx)} %` : "";
  return [name, birth, address, share].filter(Boolean).join(" · ");
}

/**
 * A source of funds the payer chose on the link: a person's from the
 * declaration's list, a company's, organisation's or insurer's from its own
 * list (QA 2026-10-06); an unknown value as it came.
 */
export function payerFundsSourceLabel(source: string, tx: Tx): string {
  if ((SOURCE_OF_FUNDS as readonly string[]).includes(source)) {
    return sourceOfFundsLabel(source as (typeof SOURCE_OF_FUNDS)[number], tx);
  }
  const organisation: Record<string, string> = {
    business_revenue: tx("Хозяйственная деятельность / выручка", "Geschäftstätigkeit / Umsatz"),
    equity: tx("Собственный капитал", "Eigenkapital"),
    loan: tx("Заём / кредит", "Darlehen / Kredit"),
    insurance_benefit: tx("Страховая выплата", "Versicherungsleistung"),
    donation: tx("Пожертвование / грант", "Spende / Zuwendung"),
  };
  return organisation[source] ?? source;
}

/**
 * The payer's answers as the group "Angaben des Zahlers" shows them, by
 * payer type: a person with the personal data, an organisation with name,
 * seat, register and representative and — for a company, organisation or
 * insurer — the beneficial owners; then the identity document, relationship
 * and source of funds, and the legal questions (amber on a "yes").
 */
export function payerQuestionnaireGroups(
  questionnaire: StaffPayerQuestionnaire,
  tx: Tx,
  lang: string,
  today: string,
): PayerStatementGroup[] {
  const answers = questionnaire.answers;
  const country = (code: string | null) => countryNameForDisplay(code, lang);
  const organisation = questionnaire.payer_type !== "person";
  const email = questionnaire.email
    ? `${questionnaire.email}${questionnaire.email_confirmed_at ? tx(` · подтверждён ${formatAppDateTime(questionnaire.email_confirmed_at)}`, ` · bestätigt am ${formatAppDateTime(questionnaire.email_confirmed_at)}`) : ""}`
    : "";
  const address = representativeAddress(answers, lang);

  const identity: PayerStatementRow[] = organisation
    ? [
        row("payer_type", tx("Тип плательщика", "Art des Zahlers"), isPayerType(questionnaire.payer_type) ? payerTypeLabel(questionnaire.payer_type, tx) : questionnaire.payer_type),
        row("organisation_name", tx("Название", "Name"), answers.organisation_name),
        row("seat", tx("Юридический адрес", "Sitz"), address),
        row("register_court", tx("Регистрационный суд", "Registergericht"), answers.register_court),
        row("register_number", tx("Регистрационный номер", "Registernummer"), answers.register_number),
        row(
          "representative",
          tx("Законный представитель", "Gesetzliche/r Vertreter/in"),
          [answers.representative_first_name, answers.representative_last_name].filter(Boolean).join(" "),
          { details: answers.representative_role },
        ),
        row("email", tx("E-mail", "E-Mail"), email),
        row("phone", tx("Телефон", "Telefon"), answers.phone),
        row("language", tx("Язык", "Sprache"), payerLanguageLabel(answers.language, tx)),
      ]
    : [
        row("salutation", tx("Обращение", "Anrede"), salutationLabel(answers.salutation, tx)),
        row("name", tx("Имя и фамилия", "Name"), [answers.first_name, answers.last_name].filter(Boolean).join(" ")),
        row("former_names", tx("Прежние имена", "Frühere Namen"), answers.former_names),
        row("date_of_birth", tx("Дата рождения", "Geburtsdatum"), formatAppDate(answers.date_of_birth)),
        row("birth_place", tx("Место рождения", "Geburtsort"), joined(answers.birth_place, country(answers.birth_country))),
        row("citizenships", tx("Гражданство", "Staatsangehörigkeit"), joined(...answers.citizenships.map((code) => country(code)))),
        row("address", tx("Адрес", "Anschrift"), address),
        row(
          "habitual_residence_country",
          tx("Страна обычного пребывания (если другая)", "Gewöhnlicher Aufenthalt (falls abweichend)"),
          country(answers.habitual_residence_country),
        ),
        row("email", tx("E-mail", "E-Mail"), email),
        row("phone", tx("Телефон", "Telefon"), answers.phone),
        row("language", tx("Язык", "Sprache"), payerLanguageLabel(answers.language, tx)),
      ];

  const validity = idDocumentValidity(answers.id_valid_until, today);
  const idDocument: PayerStatementRow[] = [
    row("id_document_type", tx("Вид документа", "Art des Dokuments"), idDocumentTypeLabel(answers.id_document_type, tx)),
    row("id_document_number", tx("Номер", "Nummer"), answers.id_document_number),
    row("id_issuing_authority", tx("Кем выдан", "Ausstellende Behörde"), joined(answers.id_issuing_authority, country(answers.id_issuing_country))),
    row("id_issued_on", tx("Дата выдачи", "Ausgestellt am"), formatAppDate(answers.id_issued_on)),
    row(
      "id_valid_until",
      tx("Действителен до", "Gültig bis"),
      validity === "missing"
        ? tx("не указано", "nicht angegeben")
        : validity === "expired"
          ? `${formatAppDate(answers.id_valid_until)} · ${tx("срок истёк", "abgelaufen")}`
          : formatAppDate(answers.id_valid_until),
      { warning: validity !== "valid" },
    ),
    row("identity_documents", tx("Загруженные файлы", "Hochgeladene Dateien"), "", {
      documents: questionnaire.identity_documents,
      wide: true,
    }),
  ];

  const relationshipKind = (PAYER_RELATIONSHIP_KINDS as readonly string[]).includes(answers.relationship_kind ?? "")
    ? payerRelationshipKindLabel(answers.relationship_kind as (typeof PAYER_RELATIONSHIP_KINDS)[number], tx)
    : answers.relationship_kind ?? "";
  const sources = answers.funds_sources.map((source) => payerFundsSourceLabel(source, tx)).join(", ");
  const relation: PayerStatementRow[] = [
    row("relationship", tx("Кем приходится пациенту", "Beziehung zum Patienten"), relationshipKind, {
      details: answers.relationship_kind === "other" || !answers.relationship_kind ? answers.relationship : null,
    }),
    organisation
      ? row("industry", tx("Отрасль", "Branche"), answers.industry)
      : row("occupation", tx("Профессия / занятость", "Beruf"), answers.occupation),
    row("funds_sources", tx("Источник средств", "Herkunft der Mittel"), sources, {
      details: answers.funds_description,
      wide: true,
    }),
    row(
      "funds_proof_documents",
      questionnaire.funds_proof_required
        ? tx("Подтверждение источника средств (обязательно)", "Nachweis der Herkunft der Mittel (erforderlich)")
        : tx("Подтверждение источника средств", "Nachweis der Herkunft der Mittel"),
      "",
      { documents: questionnaire.funds_proof_documents, wide: true, warning: fundsProofMissing(questionnaire) },
    ),
  ];

  const legal: PayerStatementRow[] = gwgLegalAnswers(answers, tx, lang).map((item) =>
    row(`answer-${item.key}`, item.question, answerLabel(item.answer, tx), {
      details: item.details,
      warning: item.answer === true,
    }),
  );

  const groups: PayerStatementGroup[] = [
    { key: "identity", title: organisation ? tx("Организация", "Organisation") : tx("Личность", "Person"), rows: identity },
    {
      key: "id_document",
      title: organisation
        ? tx("Документ представителя", "Ausweis der vertretungsberechtigten Person")
        : tx("Документ, удостоверяющий личность", "Ausweisdokument"),
      rows: idDocument,
    },
  ];
  if (organisation) {
    const owners = answers.beneficial_owners.map((owner, index) =>
      row(`owner-${index + 1}`, tx(`Бенефициар ${index + 1}`, `Wirtschaftlich Berechtigte/r ${index + 1}`), beneficialOwnerLine(owner, tx, lang), { wide: true }),
    );
    if (answers.beneficial_owners_none) {
      owners.push(
        row(
          "owners-none",
          tx("Бенефициары", "Wirtschaftlich Berechtigte"),
          tx("нет физического лица с долей более 25 %", "keine natürliche Person mit mehr als 25 %"),
          { wide: true },
        ),
      );
    }
    if (owners.length === 0) {
      owners.push(row("owners-none", tx("Бенефициары", "Wirtschaftlich Berechtigte"), "", { wide: true }));
    }
    groups.push({ key: "owners", title: tx("Бенефициары", "Wirtschaftlich Berechtigte"), rows: owners });
  }
  groups.push(
    { key: "relation", title: tx("Отношение и источник средств", "Beziehung und Herkunft der Mittel"), rows: relation },
    { key: "legal", title: tx("Юридические вопросы", "Rechtliche Fragen"), rows: legal },
  );
  return groups;
}

/** "Подтверждено 06.10.2026 12:10 · версия … · IP …"; "" while the payer has not acknowledged the notice. */
export function payerPrivacyLine(questionnaire: Pick<StaffPayerQuestionnaire, "privacy">, tx: Tx): string {
  const privacy = questionnaire.privacy;
  if (!privacy.acknowledged_at) return "";
  const channels = contactChannelsLabel(privacy.contact_channels, tx);
  return [
    `${tx("Уведомление о защите данных принято", "Datenschutzhinweis bestätigt am")} ${formatAppDateTime(privacy.acknowledged_at)}`,
    privacy.text_version ? `${tx("версия", "Version")} ${privacy.text_version}` : "",
    privacy.ip ? `IP ${privacy.ip}` : "",
    channels ? `${tx("каналы связи", "Kontaktwege")}: ${channels}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
