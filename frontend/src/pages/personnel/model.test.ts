import { describe, expect, it } from "vitest";

import { STATUS_TONE } from "@/components/record-workspace/primitives/status-tones";
import { personnelDe, personnelRu } from "@/lib/i18n/catalogs/personnel";

import {
  COMPLETENESS_CODES,
  EMPTY_EMPLOYEE_FORM,
  PERSONNEL_EVENT_ACTIONS,
  addMonths,
  canOfferDeletion,
  completenessCellClass,
  completenessCellSymbol,
  completenessCellTone,
  countCompleteness,
  documentTableRows,
  formatFileSize,
  defaultMonthRange,
  employeeRequestBody,
  employmentRangeValid,
  eventActionKey,
  fileNameQuery,
  filterEmployees,
  formatDocumentPeriod,
  formatEmploymentPeriod,
  formatMonth,
  groupByCategory,
  groupDocumentVersions,
  isArchiveTargetComplete,
  monthOptions,
  monthRange,
  personnelMimeType,
  resolvePersonnelTab,
  validatePersonnelFile,
} from "./model";

const doc = (
  id: string,
  overrides: Partial<{
    category: string;
    version_root_id: string;
    version_number: number;
    period: string | null;
    document_date: string | null;
    archived_at: string;
  }> = {},
) => ({
  id,
  category: "stundenzettel",
  version_root_id: id,
  version_number: 1,
  period: "2026-05" as string | null,
  document_date: null as string | null,
  archived_at: "2026-06-03T08:00:00Z",
  ...overrides,
});

describe("months", () => {
  it("shifts months across year boundaries", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(addMonths("2026-05", -17)).toBe("2024-12");
    expect(addMonths("not-a-month", 1)).toBe("not-a-month");
  });

  it("formats months as MM.YYYY", () => {
    expect(formatMonth("2026-05")).toBe("05.2026");
    expect(formatMonth(null)).toBe("");
  });

  it("builds inclusive ranges and rejects reversed ones", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthRange("2026-03", "2026-02")).toEqual([]);
    expect(monthRange("2026-13", "2027-01")).toEqual([]);
    expect(monthRange("2020-01", "2026-12", 3)).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("lists month choices newest first", () => {
    expect(monthOptions("2026-02", 2, 1)).toEqual(["2026-03", "2026-02", "2026-01", "2025-12"]);
  });

  it("defaults the completeness range to the last six months in Berlin time", () => {
    // 31.12.2026 23:30 UTC is already January in Berlin.
    expect(defaultMonthRange(Date.UTC(2026, 11, 31, 23, 30))).toEqual({ from: "2026-08", to: "2027-01" });
  });
});

describe("document versions", () => {
  it("groups versions by root, newest version first", () => {
    const groups = groupDocumentVersions([
      doc("a1", { version_root_id: "a1" }),
      doc("a2", { version_root_id: "a1", version_number: 2, archived_at: "2026-06-10T08:00:00Z" }),
      doc("b1", { period: "2026-04" }),
      doc("a3", { version_root_id: "a1", version_number: 3, archived_at: "2026-06-20T08:00:00Z" }),
    ]);
    expect(groups.map((group) => group.current.id)).toEqual(["a3", "b1"]);
    expect(groups[0].history.map((version) => version.id)).toEqual(["a2", "a1"]);
    expect(groups[1].history).toEqual([]);
  });

  it("orders groups by period or date, then by archive time", () => {
    const groups = groupDocumentVersions([
      doc("old", { period: null, document_date: "2025-01-15", category: "arbeitsvertrag" }),
      doc("may-early", { archived_at: "2026-06-01T08:00:00Z" }),
      doc("may-late", { archived_at: "2026-06-05T08:00:00Z" }),
      doc("june", { period: "2026-06" }),
    ]);
    expect(groups.map((group) => group.current.id)).toEqual(["june", "may-late", "may-early", "old"]);
  });

  it("groups by category in API order with unknown categories last", () => {
    const groups = groupDocumentVersions([
      doc("x", { category: "unknown" }),
      doc("s", { category: "stundenzettel" }),
      doc("v", { category: "arbeitsvertrag" }),
    ]);
    const sections = groupByCategory(groups, ["arbeitsvertrag", "stundenzettel", "urlaub"]);
    expect(sections.map((section) => section.category)).toEqual(["arbeitsvertrag", "stundenzettel", "unknown"]);
  });

  it("formats the period of monthly and dated documents", () => {
    expect(formatDocumentPeriod({ period: "2026-05", document_date: null })).toBe("05.2026");
    expect(formatDocumentPeriod({ period: null, document_date: "2026-03-07" })).toBe("07.03.2026");
  });
});

describe("retention and deletion", () => {
  const base = { retention_until: "2026-09-30", legal_hold: false, deleted_at: null };
  const options = { canRetention: true, deletionEnabled: true, today: "2026-10-01" };

  it("offers deletion only after retention, with the switch on and no legal hold", () => {
    expect(canOfferDeletion(base, options)).toBe(true);
    expect(canOfferDeletion({ ...base, retention_until: "2026-10-01" }, options)).toBe(false);
    expect(canOfferDeletion({ ...base, legal_hold: true }, options)).toBe(false);
    expect(canOfferDeletion(base, { ...options, deletionEnabled: false })).toBe(false);
    expect(canOfferDeletion(base, { ...options, canRetention: false })).toBe(false);
    expect(canOfferDeletion({ ...base, retention_until: null }, options)).toBe(false);
  });
});

describe("archive target", () => {
  it("builds the file-name query for new documents and corrections", () => {
    expect(fileNameQuery({ category: "stundenzettel", period: "2026-05" }, "image/png")).toBe(
      "category=stundenzettel&period=2026-05&mime_type=image%2Fpng",
    );
    expect(fileNameQuery({ category: "urlaub", documentDate: "2026-07-01" })).toBe(
      "category=urlaub&document_date=2026-07-01",
    );
    expect(fileNameQuery({ category: "urlaub", supersedesId: "doc-1", correctionReason: "x" })).toBe(
      "supersedes_id=doc-1",
    );
  });

  it("requires a month or date matching the category, or a reasoned correction", () => {
    expect(isArchiveTargetComplete({ category: "stundenzettel", period: "2026-05" }, true)).toBe(true);
    expect(isArchiveTargetComplete({ category: "stundenzettel", documentDate: "2026-05-01" }, true)).toBe(false);
    expect(isArchiveTargetComplete({ category: "urlaub", documentDate: "2026-05-01" }, false)).toBe(true);
    expect(isArchiveTargetComplete({ category: "", period: "2026-05" }, true)).toBe(false);
    expect(isArchiveTargetComplete({ category: "", supersedesId: "d", correctionReason: " " }, true)).toBe(false);
    expect(isArchiveTargetComplete({ category: "", supersedesId: "d", correctionReason: "Tippfehler" }, true)).toBe(true);
  });
});

describe("files", () => {
  it("accepts only the § 8 BVV formats", () => {
    expect(personnelMimeType({ name: "Scan100.PDF" })).toBe("application/pdf");
    expect(personnelMimeType({ name: "foto.jpeg" })).toBe("image/jpeg");
    expect(personnelMimeType({ name: "scan.tif" })).toBe("image/tiff");
    expect(personnelMimeType({ name: "noext", type: "image/png" })).toBe("image/png");
    expect(personnelMimeType({ name: "brief.docx", type: "application/msword" })).toBeNull();
    expect(validatePersonnelFile({ name: "a.pdf", size: 10 })).toBeNull();
    expect(validatePersonnelFile({ name: "a.zip", size: 10 })).toBe("unsupported");
    expect(validatePersonnelFile({ name: "a.pdf", size: 0 })).toBe("too_large");
    expect(validatePersonnelFile({ name: "a.pdf", size: 25 * 1024 * 1024 + 1 })).toBe("too_large");
  });
});

describe("employees", () => {
  const rows = [
    { display_name: "Frau Gabriele Mustermann", personnel_number: "1001", user_name: null, is_active: true },
    { display_name: "Herr Max Beispiel", personnel_number: null, user_name: "max@gmed.test", is_active: false },
  ];

  it("filters by status and searches name, number and account", () => {
    expect(filterEmployees(rows, "active", "")).toHaveLength(1);
    expect(filterEmployees(rows, "former", "")[0].display_name).toBe("Herr Max Beispiel");
    expect(filterEmployees(rows, "all", "1001")).toHaveLength(1);
    expect(filterEmployees(rows, "all", "MAX@")).toHaveLength(1);
    expect(filterEmployees(rows, "active", "beispiel")).toHaveLength(0);
  });

  it("formats the employment period", () => {
    expect(formatEmploymentPeriod("2024-04-01", "2026-03-31", "seit")).toBe("01.04.2024 – 31.03.2026");
    expect(formatEmploymentPeriod("2024-04-01", null, "seit")).toBe("seit 01.04.2024");
    expect(formatEmploymentPeriod(null, null, "seit")).toBe("");
  });

  it("sends filled fields on create and only changes on update", () => {
    const form = { ...EMPTY_EMPLOYEE_FORM, first_name: " Gabriele ", last_name: "Mustermann", salutation: "frau" as const };
    expect(employeeRequestBody(form)).toEqual({
      salutation: "frau",
      first_name: "Gabriele",
      last_name: "Mustermann",
    });
    const original = { ...form, first_name: "Gabriele", personnel_number: "1001", user_id: "u1" };
    expect(employeeRequestBody({ ...original, personnel_number: "", employment_end: "2026-12-31" }, original)).toEqual({
      personnel_number: "",
      employment_end: "2026-12-31",
    });
    expect(employeeRequestBody(original, original)).toEqual({});
  });

  it("rejects an employment end before the start", () => {
    expect(employmentRangeValid({ employment_start: "2026-01-01", employment_end: "2025-12-31" })).toBe(false);
    expect(employmentRangeValid({ employment_start: "2026-01-01", employment_end: "" })).toBe(true);
  });
});

describe("completeness and journal", () => {
  it("maps every cell status to a colour and a symbol", () => {
    expect(completenessCellTone("present")).toBe("success");
    expect(completenessCellTone("late")).toBe("warning");
    expect(completenessCellTone("missing")).toBe("error");
    expect(completenessCellTone("open")).toBe("info");
    expect(completenessCellTone("not_employed")).toBe("neutral");
    expect(completenessCellClass("present")).toBe(STATUS_TONE.success);
    expect(completenessCellClass("whatever")).toBe(completenessCellClass("not_employed"));
    expect(completenessCellSymbol("missing")).toBe("✗");
    expect(completenessCellSymbol(undefined)).toBe("–");
  });

  it("counts cells by status", () => {
    const counts = countCompleteness([
      { cells: { "2026-05": { stundenzettel: "present", entgeltabrechnung: "missing" } } },
      { cells: { "2026-05": { stundenzettel: "late", entgeltabrechnung: "missing" } } },
    ]);
    expect(counts).toMatchObject({ present: 1, late: 1, missing: 2, open: 0 });
  });

  it("translates known journal actions only", () => {
    expect(eventActionKey("document_version")).toBe("personnel_event_document_version");
    expect(eventActionKey("something_new")).toBeNull();
  });

  it("falls back to the first allowed tab", () => {
    expect(resolvePersonnelTab("intake", ["employees", "intake"])).toBe("intake");
    expect(resolvePersonnelTab("settings", ["employees", "intake"])).toBe("employees");
    expect(resolvePersonnelTab(null, ["employees"])).toBe("employees");
  });
});

describe("translations", () => {
  it("labels every journal action, cell status and seeded category in both languages", () => {
    const codes = [
      ...PERSONNEL_EVENT_ACTIONS.map((action) => `personnel_event_${action}`),
      ...COMPLETENESS_CODES.map((code) => `personnel_cell_${code}`),
      ...[
        "arbeitsvertrag",
        "vertragsaenderung",
        "nachweis",
        "stundenzettel",
        "entgeltabrechnung",
        "lohnsteuer",
        "sozialversicherung",
        "arbeitsunfaehigkeit",
        "urlaub",
        "abmahnung",
        "kuendigung",
        "zeugnis",
        "schriftverkehr",
        "sonstiges",
      ].flatMap((code) => [`personnel_category_${code}`, `personnel_category_short_${code}`]),
    ];
    for (const catalog of [personnelRu, personnelDe]) {
      const labels = catalog as unknown as Record<string, string | undefined>;
      for (const key of codes) {
        expect(labels[key], key).toBeTruthy();
      }
    }
  });
});

describe("documents table", () => {
  const doc = (id: string, root: string, version: number, period: string, archived = "2026-06-01T10:00:00Z") => ({
    id,
    category: "stundenzettel",
    version_root_id: root,
    version_number: version,
    period,
    document_date: null,
    archived_at: archived,
  });

  it("lists the newest version per document and keeps older ones for expansion", () => {
    const { rows, history } = documentTableRows([
      doc("a1", "a", 1, "2026-05"),
      doc("a2", "a", 2, "2026-05", "2026-06-03T10:00:00Z"),
      doc("b1", "b", 1, "2026-04"),
    ]);
    expect(rows.map((row) => [row.document.id, row.isCurrent, row.historyCount])).toEqual([
      ["a2", true, 1],
      ["b1", true, 0],
    ]);
    expect(history.get("a2")?.map((row) => [row.document.id, row.isChild, row.isCurrent])).toEqual([
      ["a1", true, false],
    ]);
    expect(history.has("b1")).toBe(false);
  });

  it("formats file sizes like the rest of the app", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(-1)).toBe("");
  });
});
