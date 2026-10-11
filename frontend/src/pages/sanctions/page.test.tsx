import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import type { ListBirthDate, SanctionsHit } from "./api";
import { HitCard } from "./page";

// Rendered outside the browser, the staff language is Russian.
const ru = t("ru");

const subject = {
  first_name: "Anna",
  middle_name: null,
  last_name: "Muster",
  date_of_birth: "1961-03-14",
  citizenships: ["DE"],
  organisation: false,
  relation: null,
};

function hit(birthDates: ListBirthDate[], dob: SanctionsHit["match_details"]["dob"]): SanctionsHit {
  return {
    id: "hit-1",
    subject_kind: "lead_patient",
    lead_id: null,
    patient_id: null,
    patient_number: null,
    lead_status: null,
    owner_name: null,
    subject_snapshot: subject,
    current_subject: null,
    list_logical_id: "1",
    list_entry: {
      logical_id: "1",
      subject_type: "person",
      names: [{ whole_name: "Testomir KORNEEV" }],
      birth_dates: birthDates,
      citizenships: ["RU"],
      regulations: [],
    },
    list_version_date: "2026-10-01",
    score: 0.91,
    match_details: { dob },
    status: "open",
    still_matches: true,
    last_screened_at: "2026-10-11T08:00:00Z",
    decided_at: null,
    decided_by_name: null,
    decision_reason: null,
    created_at: "2026-10-11T08:00:00Z",
  };
}

/** The card's text as copied or read aloud: tags gone, nothing added. */
function cardText(value: SanctionsHit): string {
  return renderToStaticMarkup(<HitCard hit={value} onDecided={() => undefined} />).replace(/<[^>]*>/g, "");
}

describe("sanctions hit card", () => {
  it("keeps a space before the birth date comparison (QA 2026-10-11 N-07)", () => {
    expect(cardText(hit([{ year: 1978, circa: true }], "unknown"))).toContain(
      "прибл. 1978 (нет даты для сравнения)",
    );
    expect(
      cardText(hit([{ date: "1961-03-14", place: "Testgrad", country: "RU" }], "exact")),
    ).toContain("14.03.1961 (Testgrad, RU) (дата совпадает)");
  });

  it("shows the comparison alone, without a leading space, when the list has no birth date", () => {
    // Label (dt) and value (dd) follow each other in the markup.
    expect(cardText(hit([], "unknown"))).toContain(`${ru.sanctions_field_dob}(нет даты для сравнения)`);
  });
});
