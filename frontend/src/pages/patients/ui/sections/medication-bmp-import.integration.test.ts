import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(directory, relativePath), "utf8");
}

describe("BMP import medication-plan integration", () => {
  it("keeps BMP import in the medication header and AI panels on their dedicated screen", () => {
    const clinical = source("patient-clinical-tab.tsx");
    const medicationAi = source("patient-medication-ai-tab.tsx");

    expect(clinical).toContain("<MedicationBmpImportAction");
    expect(clinical).toMatch(/onImported=\{\(\) => setVersion\(\(current\) => current \+ 1\)\}/);
    expect(clinical).not.toContain("<MedicationIntelligencePanel");
    expect(clinical).not.toContain("<MedicationEvidenceReviewPanel");
    expect(medicationAi).toContain("<MedicationIntelligencePanel");
    expect(medicationAi).toContain("<MedicationEvidenceReviewPanel");
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
