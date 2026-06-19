import { describe, expect, it } from "vitest";

import {
  reconcileTranslationWorkspaceDraftAfterSave,
  translationWorkspaceDraftFromRequest,
} from "./translation-workspace";
import type { TranslationRequest, TranslationWorkspaceDraft } from "./types";

const draft: TranslationWorkspaceDraft = {
  assignedTo: "user-old",
  note: "note before",
  sourceLanguage: "de",
  sourceText: "source before",
  translatedText: "translation before",
};

describe("translationWorkspaceDraftFromRequest", () => {
  it("normalizes nullable request fields into editable draft strings", () => {
    expect(
      translationWorkspaceDraftFromRequest({
        assigned_to: null,
        note: null,
        source_language: null,
        source_text: null,
        translated_text: null,
      } as TranslationRequest),
    ).toEqual({
      assignedTo: null,
      note: "",
      sourceLanguage: "",
      sourceText: "",
      translatedText: "",
    });
  });
});

describe("reconcileTranslationWorkspaceDraftAfterSave", () => {
  it("keeps unsaved workspace text when an assignee-only update returns", () => {
    const liveDraft: TranslationWorkspaceDraft = {
      ...draft,
      sourceText: "unsaved local source",
      translatedText: "unsaved local translation",
    };

    expect(
      reconcileTranslationWorkspaceDraftAfterSave({
        draftAtDispatch: liveDraft,
        liveDraft,
        serverDraft: {
          assignedTo: "user-new",
          note: "",
          sourceLanguage: "",
          sourceText: "stale server source",
          translatedText: "stale server translation",
        },
        includeWorkspaceFields: false,
      }),
    ).toEqual({
      ...liveDraft,
      assignedTo: "user-new",
    });
  });

  it("hydrates saved workspace fields but preserves edits made while the request was in flight", () => {
    expect(
      reconcileTranslationWorkspaceDraftAfterSave({
        draftAtDispatch: draft,
        liveDraft: {
          ...draft,
          translatedText: "edited during save",
        },
        serverDraft: {
          assignedTo: "user-new",
          note: "note saved",
          sourceLanguage: "uk",
          sourceText: "source saved",
          translatedText: "translation saved",
        },
        includeWorkspaceFields: true,
      }),
    ).toEqual({
      assignedTo: "user-new",
      note: "note saved",
      sourceLanguage: "uk",
      sourceText: "source saved",
      translatedText: "edited during save",
    });
  });
});
