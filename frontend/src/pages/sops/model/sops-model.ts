import {
  type Lang,
  type Translations,
} from "@/lib/i18n";
import { hasCapability, type Actor } from "@/lib/permissions";

import type { SopFormState } from "./types";

const SOP_DATE_TIME_FORMATTERS = {
  de: new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
  ru: new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
} satisfies Record<Lang, Intl.DateTimeFormat>;

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

export function formatDate(value: string | null | undefined, lang: Lang, translations: Translations) {
  if (!value) return translations.sops_date_not_set;
  try {
    return SOP_DATE_TIME_FORMATTERS[lang].format(new Date(value));
  } catch {
    return value;
  }
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
