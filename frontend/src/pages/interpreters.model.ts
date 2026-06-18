export type InterpreterListFilters = {
  search?: string;
  status?: string;
  contractType?: string;
};

export type InterpreterLanguageRecord = {
  id: string;
  language_code: string;
  language_label: string | null;
  proficiency: string;
  cefr_level: string | null;
  specialization: string | null;
  is_active: boolean;
};

export type InterpreterLanguageForm = {
  languageCode: string;
  languageLabel: string;
  proficiency: string;
  cefrLevel: string;
  specialization: string;
};

export type InterpreterAccountEligibility = {
  contractType?: string;
  employmentKind?: string;
};

export type InterpreterAccountDraft = InterpreterAccountEligibility & {
  createUserAccount: boolean;
};

export function buildInterpreterListPath(filters: InterpreterListFilters = {}) {
  const params = new URLSearchParams();
  const search = filters.search?.trim();
  if (search) params.set("search", search);
  if (filters.status) params.set("status", filters.status);
  if (filters.contractType) {
    params.set("contract_type", filters.contractType);
  }

  const query = params.toString();
  return `/interpreters${query ? `?${query}` : ""}`;
}

export function canCreateInterpreterUserAccount(
  draft: InterpreterAccountEligibility,
) {
  return draft.employmentKind === "internal";
}

export function normalizeInterpreterAccountDraft<T extends InterpreterAccountDraft>(
  draft: T,
): T {
  if (canCreateInterpreterUserAccount(draft)) return draft;
  return { ...draft, createUserAccount: false };
}

export function buildInterpreterLanguagesPath(interpreterId: string) {
  return `/interpreters/${interpreterId}/languages`;
}

export function buildInterpreterProfileDocumentsPath(interpreterId: string) {
  return `/interpreters/${interpreterId}/profile/documents`;
}

export function buildInterpreterProfileDocumentDownloadPath(
  interpreterId: string,
  documentId: string,
) {
  return `/interpreters/${interpreterId}/profile/documents/${documentId}/download`;
}

export function emptyInterpreterLanguage(): InterpreterLanguageForm {
  return {
    languageCode: "",
    languageLabel: "",
    proficiency: "working",
    cefrLevel: "",
    specialization: "",
  };
}

export function interpreterLanguageRecordToForm(
  language: InterpreterLanguageRecord,
): InterpreterLanguageForm {
  return {
    languageCode: language.language_code,
    languageLabel: language.language_label || "",
    proficiency: language.proficiency || "working",
    cefrLevel: language.cefr_level || "",
    specialization: language.specialization || "",
  };
}

export function interpreterLanguagesToPayload(
  languages: InterpreterLanguageForm[],
) {
  const seen = new Set<string>();

  return languages.flatMap((language) => {
    const languageCode = language.languageCode.trim().toLowerCase();
    if (!languageCode || seen.has(languageCode)) return [];
    seen.add(languageCode);

    return [
      {
        languageCode,
        languageLabel: language.languageLabel.trim(),
        proficiency: language.proficiency || "working",
        cefrLevel: language.cefrLevel.trim().toUpperCase(),
        specialization: language.specialization.trim(),
      },
    ];
  });
}
