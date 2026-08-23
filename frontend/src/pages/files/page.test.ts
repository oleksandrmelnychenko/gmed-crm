import { describe, expect, it } from "vitest";

import {
  filterOperationalAttachmentFiles,
  sortOperationalAttachmentFiles,
  type OperationalAttachmentFile,
} from "./page";

function file(overrides: Partial<OperationalAttachmentFile> = {}): OperationalAttachmentFile {
  return {
    id: "file-1",
    file_name: "hotel-receipt.pdf",
    mime_type: "application/pdf",
    file_size: 1_024,
    uploaded_by: "user-1",
    uploaded_by_name: "Anna Berger",
    created_at: "2026-08-23T10:00:00Z",
    task_id: "task-1",
    task_title: "Hotel bestätigen",
    task_kind: "task",
    task_status: "open",
    patient_id: "patient-1",
    patient_name: "Max Mustermann",
    provider_id: "provider-1",
    provider_name: "Hotel Central",
    ...overrides,
  };
}

describe("operational attachment file registry", () => {
  it("searches across file, task, patient, provider and uploader", () => {
    const rows = [
      file(),
      file({
        id: "file-2",
        file_name: "transfer.jpg",
        task_title: "Fahrt organisieren",
        patient_name: "Olga Petrova",
        provider_name: "Taxi West",
        uploaded_by_name: "Nina Klein",
      }),
    ];
    for (const query of ["receipt", "bestätigen", "mustermann", "central", "berger"]) {
      expect(filterOperationalAttachmentFiles(rows, { query, kind: "all" })).toHaveLength(1);
    }
    expect(filterOperationalAttachmentFiles(rows, { query: "petrova", kind: "all" })[0]?.id).toBe("file-2");
  });

  it("filters by task kind and sorts newest first", () => {
    const rows = [
      file({ id: "task-file", task_kind: "task", created_at: "2026-08-20T10:00:00Z" }),
      file({ id: "event-file", task_kind: "event", created_at: "2026-08-23T10:00:00Z" }),
    ];
    expect(filterOperationalAttachmentFiles(rows, { query: "", kind: "event" }).map((row) => row.id))
      .toEqual(["event-file"]);
    expect(sortOperationalAttachmentFiles(rows).map((row) => row.id))
      .toEqual(["event-file", "task-file"]);
  });
});
