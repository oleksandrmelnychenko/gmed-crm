import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  NOTES_COPY,
  canManageNote,
  canWriteNotes,
  noteErrorMessage,
  noteVisibilityChoices,
  noteVisibilityLabel,
} from "./page";

const roleName = (role: string) =>
  ({ patient_manager: "Менеджер пациентов", sales: "Отдел продаж", billing: "Бухгалтерия" })[role] ?? role;

describe("visibility choices are read from the author's point of view (QA E3-02)", () => {
  const salesNote = {
    created_by: "sales-1",
    created_by_role: "sales",
    visibility: "private" as const,
    visible_role: null,
  };

  it("labels the CEO's choices for someone else's note as the author's audience", () => {
    expect(noteVisibilityChoices(salesNote, "ceo-1", NOTES_COPY.ru, roleName)).toEqual({
      private: "Только автор",
      role: "Роль автора: Отдел продаж",
      staff: "Все сотрудники",
    });
    expect(noteVisibilityChoices(salesNote, "ceo-1", NOTES_COPY.de, () => "Vertrieb")).toEqual({
      private: "Nur Autor:in",
      role: "Rolle der Autor:in: Vertrieb",
      staff: "Alle Mitarbeitenden",
    });
  });

  it("keeps the role a note was shared with", () => {
    // The author moved to billing; the note stays shared with sales until changed.
    expect(
      noteVisibilityChoices(
        { ...salesNote, created_by_role: "billing", visibility: "role", visible_role: "sales" },
        "ceo-1",
        NOTES_COPY.ru,
        roleName,
      ).role,
    ).toBe("Роль автора: Отдел продаж");
  });

  it("shows the author the choices of the form", () => {
    expect(noteVisibilityChoices(salesNote, "sales-1", NOTES_COPY.ru, roleName)).toEqual(NOTES_COPY.ru.visibilityOwn);
    expect(noteVisibilityChoices(null, "sales-1", NOTES_COPY.ru, roleName)).toEqual(NOTES_COPY.ru.visibilityOwn);
  });
});

describe("who writes notes (QA E3-03)", () => {
  it("lets the CEO Assistant only read", () => {
    expect(canWriteNotes("ceo_assistant")).toBe(false);
    expect(canWriteNotes("sales")).toBe(true);
    expect(canWriteNotes(undefined)).toBe(false);
    expect(canManageNote({ created_by: "a-1" }, { id: "a-1", role: "ceo_assistant" })).toBe(false);
  });

  it("lets only the author or the CEO archive and restore", () => {
    const note = { created_by: "pm-1" };
    expect(canManageNote(note, { id: "pm-1", role: "patient_manager" })).toBe(true);
    expect(canManageNote(note, { id: "ceo-1", role: "ceo" })).toBe(true);
    expect(canManageNote(note, { id: "billing-1", role: "billing" })).toBe(false);
    expect(canManageNote(null, { id: "pm-1", role: "patient_manager" })).toBe(false);
  });
});

describe("internal note visibility (owner decision 2026-10-12)", () => {
  it("shows the author the choices of the form", () => {
    const own = { created_by: "u-1", visible_role: null };
    expect(noteVisibilityLabel({ ...own, visibility: "private" }, "u-1", NOTES_COPY.ru, roleName)).toBe(
      "Только я",
    );
    expect(noteVisibilityLabel({ ...own, visibility: "role" }, "u-1", NOTES_COPY.ru, roleName)).toBe("Моя роль");
    expect(noteVisibilityLabel({ ...own, visibility: "staff" }, "u-1", NOTES_COPY.de, roleName)).toBe(
      "Alle Mitarbeitenden",
    );
    expect(NOTES_COPY.de.visibilityOwn).toEqual({
      private: "Nur ich",
      role: "Meine Rolle",
      staff: "Alle Mitarbeitenden",
    });
  });

  it("tells everyone else whose note it is", () => {
    expect(
      noteVisibilityLabel(
        { created_by: "u-1", visibility: "private", visible_role: null },
        "ceo-1",
        NOTES_COPY.ru,
        roleName,
      ),
    ).toBe("Только автор");
    expect(
      noteVisibilityLabel(
        { created_by: "u-1", visibility: "role", visible_role: "patient_manager" },
        "u-2",
        NOTES_COPY.ru,
        roleName,
      ),
    ).toBe("Роль: Менеджер пациентов");
    // Notes of an older server were visible to all staff.
    expect(noteVisibilityLabel({ created_by: "u-1" }, "u-2", NOTES_COPY.de, roleName)).toBe("Alle Mitarbeitenden");
  });

  it("explains refusals in the UI language", () => {
    const refused = (code: string) => new ApiRequestError(code, { status: 403, code, body: { error: code } });
    expect(noteErrorMessage(refused("note_visibility_author_only"), NOTES_COPY.ru)).toBe(
      "Видимость меняет только автор заметки.",
    );
    expect(noteErrorMessage(refused("Note not found"), NOTES_COPY.de)).toContain("nicht für Sie freigegeben");
    expect(noteErrorMessage(refused("note_read_only_role"), NOTES_COPY.ru)).toBe(
      "Ваша роль может только просматривать заметки.",
    );
    expect(noteErrorMessage(refused("note_archive_author_only"), NOTES_COPY.de)).toContain("nur die Person");
    expect(noteErrorMessage(new Error(""), NOTES_COPY.ru)).toBe(NOTES_COPY.ru.error);
  });
});
