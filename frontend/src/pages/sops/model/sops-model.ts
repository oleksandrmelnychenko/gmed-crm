import { formatAppDateTime } from "@/lib/app-time-zone";
import { type Translations } from "@/lib/i18n";
import { hasCapability, type Actor } from "@/lib/permissions";

import type { SopFormState } from "./types";

export function emptyForm(): SopFormState {
  return {
    title: "",
    category: "sop",
    summary: "",
    bodyMarkdown: "",
    requiresAck: false,
    targetRoles: [],
    targetUserIds: [],
  };
}

export function roleCanOpenLearning(actor?: Actor) {
  return hasCapability(actor, "sops.view");
}

export function roleCanCreate(actor?: Actor) {
  return hasCapability(actor, "sops.create");
}

export function roleCanReview(actor?: Actor) {
  return hasCapability(actor, "sops.review");
}

/** "DD.MM.YYYY HH:mm" Berlin time in every language. */
export function formatDate(value: string | null | undefined, translations: Translations) {
  if (!value) return translations.sops_date_not_set;
  return formatAppDateTime(value) || value;
}

export function formDescription(role: string | undefined, translations: Translations) {
  if (role === "ceo") {
    return translations.sops_form_description_ceo;
  }
  if (role === "patient_manager") {
    return translations.sops_form_description_patient_manager;
  }
  return translations.sops_form_description_teamlead;
}
