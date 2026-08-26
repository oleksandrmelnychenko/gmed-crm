import { describe, expect, it } from "vitest";

import {
  BMP_SCANNER_MAX_BYTES,
  MedicationBmpScannerError,
  normalizeMedicationBmpScanResult,
} from "./bmp-carrier-scanner";

describe("normalizeMedicationBmpScanResult", () => {
  it("accepts a bounded BMP carrier and preserves its native byte count", () => {
    expect(normalizeMedicationBmpScanResult({
      carrierXml: " \n<MP v=\"028\"><P g=\"Jörg\" /></MP>\n",
      byteLength: 43,
      source: "raw_bytes",
    })).toEqual({
      carrierXml: "<MP v=\"028\"><P g=\"Jörg\" /></MP>",
      byteLength: 43,
      source: "raw_bytes",
    });
  });

  it.each([
    { carrierXml: "https://example.test", byteLength: 20 },
    { carrierXml: "<MP></MP>", byteLength: 0 },
    { carrierXml: "<MP></MP>", byteLength: BMP_SCANNER_MAX_BYTES + 1 },
  ])("rejects invalid native results", (result) => {
    expect(() => normalizeMedicationBmpScanResult(result)).toThrow(MedicationBmpScannerError);
  });
});
