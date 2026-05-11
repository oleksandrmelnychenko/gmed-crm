import {
  type Lang,
  type Translations,
} from "@/lib/i18n";

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

export function roleCanOpenLearning(role?: string) {
  return role !== undefined && role !== "patient";
}

export function roleCanCreate(role?: string) {
  return role === "ceo" || role === "patient_manager" || role === "teamlead_interpreter";
}

export function roleCanReview(role?: string) {
  return role === "ceo" || role === "patient_manager";
}

export function formatDate(value: string | null | undefined, lang: Lang, translations: Translations) {
  if (!value) return translations.sops_date_not_set;
  try {
    return SOP_DATE_TIME_FORMATTERS[lang].format(new Date(value));
  } catch {
    return value;
  }
}

export function reviewQueueCopy(role: string | undefined, translations: Translations) {
  if (role === "patient_manager") {
    return {
      metric: translations.sops_review_queue_metric_pm,
      title: translations.sops_review_queue_title_pm,
      description: translations.sops_review_queue_description_pm,
    };
  }

  return {
    metric: translations.sops_review_queue_metric_ceo,
    title: translations.sops_review_queue_title_ceo,
    description: translations.sops_review_queue_description_ceo,
  };
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
