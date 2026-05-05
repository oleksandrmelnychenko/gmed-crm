import {
  formatEnumLabelFromKeys,
  type Lang,
  type TranslationKey,
  type Translations,
} from "@/lib/i18n";

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

const SOP_CATEGORY_LABEL_KEYS = {
  sop: "sops_category_sop",
  handbook: "sops_category_handbook",
  training: "sops_category_training",
} as const satisfies Partial<Record<string, TranslationKey>>;

const SOP_APPROVAL_ROLE_LABEL_KEYS = {
  ceo: "sops_approval_role_ceo",
  patient_manager: "sops_approval_role_patient_manager",
} as const satisfies Partial<Record<string, TranslationKey>>;

export function categoryLabel(value: string, translations: Translations) {
  return formatEnumLabelFromKeys(value, SOP_CATEGORY_LABEL_KEYS, translations);
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
    return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function approvalRoleLabel(value: string | null | undefined, translations: Translations) {
  return formatEnumLabelFromKeys(value, SOP_APPROVAL_ROLE_LABEL_KEYS, translations);
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
