import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import { NOTES_COPY, noteErrorMessage, noteVisibilityLabel } from "./page";

const roleName = (role: string) => (role === "patient_manager" ? "Менеджер пациентов" : role);

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
    expect(noteErrorMessage(new Error(""), NOTES_COPY.ru)).toBe(NOTES_COPY.ru.error);
  });
});
