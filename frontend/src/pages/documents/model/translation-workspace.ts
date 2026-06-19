import type { TranslationRequest, TranslationWorkspaceDraft } from "./types";

export function translationWorkspaceDraftFromRequest(
  request: TranslationRequest,
): TranslationWorkspaceDraft {
  return {
    assignedTo: request.assigned_to ?? null,
    note: request.note ?? "",
    sourceLanguage: request.source_language ?? "",
    sourceText: request.source_text ?? "",
    translatedText: request.translated_text ?? "",
  };
}

export function reconcileTranslationWorkspaceDraftAfterSave({
  draftAtDispatch,
  liveDraft,
  serverDraft,
  includeWorkspaceFields,
}: {
  draftAtDispatch: TranslationWorkspaceDraft;
  liveDraft?: TranslationWorkspaceDraft;
  serverDraft: TranslationWorkspaceDraft;
  includeWorkspaceFields: boolean;
}): TranslationWorkspaceDraft {
  if (!includeWorkspaceFields) {
    return {
      ...(liveDraft ?? draftAtDispatch),
      assignedTo: serverDraft.assignedTo,
    };
  }

  if (!liveDraft) {
    return serverDraft;
  }

  return {
    assignedTo: serverDraft.assignedTo,
    note: liveDraft.note !== draftAtDispatch.note ? liveDraft.note : serverDraft.note,
    sourceLanguage:
      liveDraft.sourceLanguage !== draftAtDispatch.sourceLanguage
        ? liveDraft.sourceLanguage
        : serverDraft.sourceLanguage,
    sourceText:
      liveDraft.sourceText !== draftAtDispatch.sourceText
        ? liveDraft.sourceText
        : serverDraft.sourceText,
    translatedText:
      liveDraft.translatedText !== draftAtDispatch.translatedText
        ? liveDraft.translatedText
        : serverDraft.translatedText,
  };
}
