import { describe, expect, it } from "vitest";

import { localizePersonnelError } from "./server-errors";

describe("localizePersonnelError", () => {
  it("translates known server and trigger messages", () => {
    expect(localizePersonnelError("Employee not found", "ru")).toBe("Сотрудник не найден.");
    expect(localizePersonnelError("Employee not found", "de")).toBe("Mitarbeitende(r) nicht gefunden.");
    expect(localizePersonnelError("Archived personnel documents cannot be changed", "ru")).toContain(
      "нельзя изменить",
    );
  });

  it("passes unknown messages through", () => {
    expect(localizePersonnelError("Something else", "ru")).toBe("Something else");
    expect(localizePersonnelError("toString", "de")).toBe("toString");
  });
});
