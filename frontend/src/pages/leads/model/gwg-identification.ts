import { ApiRequestError } from "@/lib/api";
import type { DocumentItem } from "@/pages/documents/model/types";

/**
 * The GwG identification sheet ("Dokumentationsbogen für natürliche
 * Personen") of a lead: one for the patient and one for a third-party payer.
 * A minor has no sheet of his own — each legal representative gets one. The
 * server fills the sheet from the lead; the only choice is whose sheet it is.
 */
export const GWG_IDENTIFICATION_TEMPLATE = "gwg_identification";

/** A legal representative of a minor: `representative:<id of the trusted contact>`. */
export type GwgRepresentativeSubject = `representative:${string}`;

export type GwgSheetSubject = "contract_partner" | "payer" | GwgRepresentativeSubject;

type Tx = (ru: string, de: string) => string;

const REPRESENTATIVE_PREFIX = "representative:";

export function gwgRepresentativeSubject(representativeId: string): GwgRepresentativeSubject {
  return `${REPRESENTATIVE_PREFIX}${representativeId}`;
}

function isRepresentativeSubject(value: unknown): value is GwgRepresentativeSubject {
  return typeof value === "string" && value.startsWith(REPRESENTATIVE_PREFIX) && value.length > REPRESENTATIVE_PREFIX.length;
}

/** Whose sheet a stored document is; older or foreign documents count as the patient's. */
export function gwgSheetSubject(document: Pick<DocumentItem, "generated_bindings">): GwgSheetSubject {
  const binding = document.generated_bindings?.gwg_identification;
  const subject = binding && typeof binding === "object" ? (binding as { subject?: unknown }).subject : null;
  if (isRepresentativeSubject(subject)) return subject;
  return subject === "payer" ? "payer" : "contract_partner";
}

/** The current sheet of that person, which a new one replaces as the next version. */
export function currentGwgSheet(
  documents: readonly DocumentItem[],
  subject: GwgSheetSubject,
): DocumentItem | undefined {
  return documents
    .filter((document) =>
      document.generated_template_id === GWG_IDENTIFICATION_TEMPLATE
      && !document.file_deleted_at
      && document.is_latest_version !== false
      && gwgSheetSubject(document) === subject)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
}

/** The document name of a sheet that is not the patient's own. */
function gwgSheetAutoName(subject: GwgSheetSubject, personName: string | null | undefined): string | undefined {
  if (subject === "payer") return "Dokumentationsbogen natürliche Personen – Kostenübernehmer";
  if (!isRepresentativeSubject(subject)) return undefined;
  const name = personName?.trim();
  return name ? `Dokumentationsbogen natürliche Personen – ${name}` : undefined;
}

/** Request body of `POST /documents/generate` for the sheet of a lead. */
export function gwgSheetRequest(input: {
  leadId: string;
  subject: GwgSheetSubject;
  /** The name of the legal representative the sheet is for; it names the document. */
  personName?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  replaceDocumentId?: string | null;
}): Record<string, unknown> {
  return {
    template_id: GWG_IDENTIFICATION_TEMPLATE,
    lead_id: input.leadId,
    order_id: input.orderId ?? undefined,
    replace_document_id: input.replaceDocumentId ?? undefined,
    language: "de",
    document_language: "de",
    document_direction: "outgoing",
    document_variant: "original",
    access_category: "patient",
    status: "active",
    auto_name: gwgSheetAutoName(input.subject, input.personName),
    bindings: {
      order_number: input.orderNumber ?? undefined,
      gwg_identification: { subject: input.subject },
    },
  };
}

/**
 * Document types of the lead-cabinet uploads for a person who acts for the
 * lead: the identity document and the proof of authority of a representative.
 * They are deliberately not `identity`: a parent's passport is not the child's
 * identity document.
 */
const REPRESENTATIVE_UPLOAD_ARTS = new Set(["representative_identity", "representative_authority"]);

export function isRepresentativeUploadArt(art: string | null | undefined): boolean {
  return REPRESENTATIVE_UPLOAD_ARTS.has((art ?? "").trim().toLowerCase());
}

export type GwgSheetButton = {
  subject: GwgSheetSubject;
  /** The legal representative the sheet is for; "" for the patient and the payer. */
  personName: string;
};

/**
 * Which sheets the wizard offers. Adult: the patient's and, for a third-party
 * payer who is a natural person, the payer's. Minor: one per legal
 * representative and none for the child; the payer's own sheet is left out
 * when the payer is one of the representatives (the same person gets one
 * sheet), with a note that says so.
 */
export type GwgSheetPlan = {
  buttons: GwgSheetButton[];
  /** A minor without a parent or guardian on file: no sheet can be made yet. */
  lacksRepresentative: boolean;
  /** The payer is a company, an organisation or an insurer: no sheet for natural persons. */
  payerIsOrganisation: boolean;
  /** The name of the representative the payer is the same person as; null otherwise. */
  payerSamePersonName: string | null;
};

export function gwgSheetPlan(input: {
  minor: boolean;
  representatives: ReadonlyArray<{ id: string; name: string }>;
  /** The payer declaration: who pays and, for a third party, what the payer is. */
  payer: { payer_kind?: string | null; payer_type?: string | null } | null | undefined;
  /** The name of the representative the payer is the same person as (identification status). */
  payerSamePersonName?: string | null;
  /**
   * The identification status has not answered yet, so it is not known whether
   * the payer of a minor is one of the representatives: the payer's sheet is
   * not offered until it is.
   */
  payerSamePersonUnknown?: boolean;
}): GwgSheetPlan {
  const buttons: GwgSheetButton[] = input.minor
    ? input.representatives.map((person) => ({
        subject: gwgRepresentativeSubject(person.id),
        personName: person.name.trim(),
      }))
    : [{ subject: "contract_partner", personName: "" }];
  const thirdParty = input.payer?.payer_kind === "third_party";
  // A declaration stored before the payer type existed is a private person.
  const payerIsOrganisation = thirdParty && (input.payer?.payer_type ?? "person") !== "person";
  const privatePayer = thirdParty && !payerIsOrganisation;
  const samePerson = privatePayer && input.minor ? input.payerSamePersonName ?? null : null;
  const undecided = input.minor && input.payerSamePersonUnknown === true;
  if (privatePayer && samePerson === null && !undecided) {
    buttons.push({ subject: "payer", personName: "" });
  }
  return {
    buttons,
    lacksRepresentative: input.minor && input.representatives.length === 0,
    payerIsOrganisation,
    payerSamePersonName: samePerson,
  };
}

/**
 * A refusal of the server to make a sheet, as one localized sentence; `null`
 * for other errors. The server names the reason in `error` and `code`.
 */
export function gwgSheetErrorText(error: unknown, tx: Tx): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const codes = [error.body?.code, error.body?.error, error.code];
  if (codes.includes("minor_sheet_per_representative")) {
    return tx(
      "Пациент несовершеннолетний: лист формируется на каждого законного представителя, а не на ребёнка. Обновите страницу и выберите представителя",
      "Der Patient ist minderjährig: Der Bogen wird je gesetzlicher Vertreterin / gesetzlichem Vertreter erstellt, nicht für das Kind. Bitte die Seite aktualisieren und die Vertretung auswählen",
    );
  }
  if (codes.includes("representative_sheet_not_available")) {
    return tx(
      "Для этого человека лист сформировать нельзя: он не числится законным представителем несовершеннолетнего. Проверьте раздел «Родитель или законный представитель»",
      "Für diese Person kann kein Bogen erstellt werden: Sie ist nicht als gesetzliche Vertretung eines Minderjährigen erfasst. Bitte den Abschnitt „Elternteil oder gesetzlicher Vertreter“ prüfen",
    );
  }
  if (codes.includes("payer_is_not_a_natural_person")) {
    return tx(
      "Для организации лист для физических лиц не формируется",
      "Für Organisationen wird der Bogen für natürliche Personen nicht erstellt",
    );
  }
  return null;
}
