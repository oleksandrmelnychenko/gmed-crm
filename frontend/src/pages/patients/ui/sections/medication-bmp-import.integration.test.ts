import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(directory, relativePath), "utf8");
}

describe("BMP import medication-plan integration", () => {
  it("mounts the action in the patient medication header and refreshes both intelligence panels", () => {
    const clinical = source("patient-clinical-tab.tsx");

    expect(clinical).toContain("<MedicationBmpImportAction");
    expect(clinical).toMatch(/onImported=\{\(\) => setVersion\(\(current\) => current \+ 1\)\}/);
    expect(clinical).toMatch(/<MedicationIntelligencePanel[\s\S]*?refreshKey=\{`\$\{version\}:/);
    expect(clinical).toMatch(/<MedicationEvidenceReviewPanel[\s\S]*?refreshKey=\{`\$\{version\}:/);
  });

  it("mounts the same workflow in case workspace and refreshes independently after confirm", () => {
    const workspace = source("../../../case-workspace/patient-record-sections.tsx");

    expect(workspace).toContain("<MedicationBmpImportAction");
    expect(workspace).toContain("setBmpImportVersion((current) => current + 1)");
    expect(workspace).toContain("record.reload()");
    expect(workspace).toMatch(/<MedicationIntelligencePanel[\s\S]*?refreshKey=\{`\$\{bmpImportVersion\}:/);
    expect(workspace).toMatch(/<MedicationEvidenceReviewPanel[\s\S]*?refreshKey=\{`\$\{bmpImportVersion\}:/);
  });
});
