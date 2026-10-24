import type { StaffPayerQuestionnaire } from "../data/lead-payer-link-api";
import type { LeadIdentityDocument, LeadPortalIntake, LeadRepresentative } from "../data/lead-portal-intake-api";
import { representativeName, representativeRoleLabel } from "./lead-gwg-statements";
import type { Tx } from "./lead-payer";

/** One identity copy (or proof of authority) as the lead detail lists it. */
export type IdentityDocumentFile = {
  id: string;
  file_name: string;
  uploaded_at: string | null;
  /** Staff took the file over (the lead's and a representative's) or reviewed it (the payer's). */
  reviewed: boolean;
  /** Who uploaded it: the cabinet (the lead or a parent), staff in the wizard, the payer through the own link. */
  origin: "cabinet" | "staff" | "payer_link";
};

/** The identity copies of one person: the lead, a representative, the payer. */
export type IdentityDocumentGroup = {
  key: string;
  kind: "patient" | "representative" | "payer";
  title: string;
  /** The role of a representative (mother, agent, …); empty otherwise. */
  subtitle: string;
  files: IdentityDocumentFile[];
  /** A representative's proofs of authority (power of attorney, custody order, …). */
  authority: IdentityDocumentFile[];
};

function leadFile(file: LeadIdentityDocument): IdentityDocumentFile {
  return {
    id: file.id,
    file_name: file.file_name,
    uploaded_at: file.uploaded_at,
    reviewed: file.reviewed,
    origin: file.uploaded_by_staff ? "staff" : "cabinet",
  };
}

function payerFile(file: StaffPayerQuestionnaire["identity_documents"][number]): IdentityDocumentFile {
  return {
    id: file.id,
    file_name: file.file_name,
    uploaded_at: file.uploaded_at,
    reviewed: file.reviewed,
    origin: "payer_link",
  };
}

function representativeTitle(person: LeadRepresentative, tx: Tx): string {
  return representativeName(person) || representativeRoleLabel(person, tx);
}

/**
 * The identity copies of the lead and of everyone around the request, as the
 * lead detail lists them for every role the server sends them to (owner
 * decision 2026-10-24: Sales opens the identity scans it uploads; QA A-2 /
 * C-10: Sales had no way to them). The lead's own group comes first and
 * always, also empty; a representative's group comes with the person; the
 * payer's group only with a file of the payer's own link.
 */
export function identityDocumentGroups(
  intake: LeadPortalIntake | null,
  payer: StaffPayerQuestionnaire | null | undefined,
  tx: Tx,
): IdentityDocumentGroup[] {
  const groups: IdentityDocumentGroup[] = [{
    key: "patient",
    kind: "patient",
    title: tx("Пациент", "Patient"),
    subtitle: "",
    files: (intake?.identity_documents ?? []).map(leadFile),
    authority: [],
  }];
  for (const person of intake?.representation?.representatives ?? []) {
    groups.push({
      key: `representative-${person.id}`,
      kind: "representative",
      title: representativeTitle(person, tx),
      subtitle: representativeName(person) ? representativeRoleLabel(person, tx) : "",
      files: person.identity_documents.map(leadFile),
      authority: person.authority_documents.map(leadFile),
    });
  }
  const payerFiles = payer?.identity_documents ?? [];
  if (payerFiles.length > 0) {
    const payerName = [payer?.answers.first_name, payer?.answers.last_name]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");
    groups.push({
      key: "payer",
      kind: "payer",
      title: payerName || tx("Плательщик", "Zahler/in"),
      subtitle: payerName ? tx("Плательщик", "Zahler/in") : "",
      files: payerFiles.map(payerFile),
      authority: [],
    });
  }
  return groups;
}

/** How many files the groups hold, for the section's count. */
export function identityDocumentCount(groups: readonly IdentityDocumentGroup[]): number {
  return groups.reduce((total, group) => total + group.files.length + group.authority.length, 0);
}

/** Who uploaded the file, in words. */
export function identityDocumentOriginLabel(origin: IdentityDocumentFile["origin"], tx: Tx): string {
  switch (origin) {
    case "staff":
      return tx("Загружено сотрудником", "Von GMED hochgeladen");
    case "payer_link":
      return tx("По ссылке плательщика", "Über den Link des Zahlers");
    default:
      return tx("Из кабинета", "Aus dem Kundenkabinett");
  }
}
