import { describe, expect, it } from "vitest";

import { getPatientRoleLabel } from "../../model/list-formatters";
import { isoDateToGerman, relationCitizenshipsLabel } from "./patient-relations-tab";

describe("contact identity data on the patient card (QA round 14)", () => {
  it("shows the contact's citizenships as country names and the birth date as DD.MM.YYYY", () => {
    expect(relationCitizenshipsLabel({ citizenships: ["PL", "AT"] }, "ru")).toBe("Польша, Австрия");
    expect(relationCitizenshipsLabel({ citizenships: ["PL", "AT"] }, "de")).toBe("Polen, Österreich");
    expect(relationCitizenshipsLabel({ citizenships: null }, "ru")).toBe("");
    expect(isoDateToGerman("1972-07-05")).toBe("05.07.1972");
  });

  it("translates a curator's role instead of «Неизвестное значение»", () => {
    const dictionary = { role_ceo: "Генеральный директор", common_unknown_value: "Неизвестное значение", common_unknown: "—" };
    expect(getPatientRoleLabel("ceo", dictionary)).toBe("Генеральный директор");
    expect(getPatientRoleLabel("robot", dictionary)).toBe("Неизвестное значение");
  });
});
