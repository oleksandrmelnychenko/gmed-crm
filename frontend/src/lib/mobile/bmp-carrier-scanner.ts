import { Capacitor, registerPlugin } from "@capacitor/core";

export const BMP_SCANNER_MAX_BYTES = 128 * 1024;

type ScanOptions = {
  instruction: string;
  cancel: string;
  torchOn: string;
  torchOff: string;
  invalid: string;
};

type NativeScanResult = {
  carrierXml?: unknown;
  byteLength?: unknown;
  source?: unknown;
};

export type MedicationBmpScanResult = {
  carrierXml: string;
  byteLength: number;
  source: "raw_bytes" | "raw_value" | "unknown";
};

interface GmedBmpScannerPlugin {
  scan(options: ScanOptions): Promise<NativeScanResult>;
}

const NativeBmpScanner = registerPlugin<GmedBmpScannerPlugin>("GmedBmpScanner");

export class MedicationBmpScannerError extends Error {
  readonly code:
    | "unsupported"
    | "camera_permission_denied"
    | "scan_cancelled"
    | "invalid_bmp_carrier"
    | "scan_failed";

  constructor(
    code:
      | "unsupported"
      | "camera_permission_denied"
      | "scan_cancelled"
      | "invalid_bmp_carrier"
      | "scan_failed",
    message: string,
  ) {
    super(message);
    this.name = "MedicationBmpScannerError";
    this.code = code;
  }
}

export function isMedicationBmpScannerAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function normalizeMedicationBmpScanResult(
  result: NativeScanResult,
): MedicationBmpScanResult {
  if (typeof result.carrierXml !== "string") {
    throw new MedicationBmpScannerError("invalid_bmp_carrier", "Scanner returned no BMP XML");
  }
  const carrierXml = result.carrierXml.replace(/^\uFEFF/, "").trim();
  const byteLength = typeof result.byteLength === "number"
    ? result.byteLength
    : new TextEncoder().encode(carrierXml).byteLength;
  if (
    !carrierXml.startsWith("<MP")
    || !carrierXml.includes("</MP>")
    || !Number.isSafeInteger(byteLength)
    || byteLength <= 0
    || byteLength > BMP_SCANNER_MAX_BYTES
  ) {
    throw new MedicationBmpScannerError("invalid_bmp_carrier", "Scanner returned an invalid BMP carrier");
  }
  const source = result.source === "raw_bytes" || result.source === "raw_value"
    ? result.source
    : "unknown";
  return { carrierXml, byteLength, source };
}

function scannerError(error: unknown): MedicationBmpScannerError {
  if (error instanceof MedicationBmpScannerError) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (code === "camera_permission_denied") {
    return new MedicationBmpScannerError(code, "Camera permission was denied");
  }
  if (code === "scan_cancelled") {
    return new MedicationBmpScannerError(code, "BMP scan was cancelled");
  }
  if (code === "invalid_bmp_carrier") {
    return new MedicationBmpScannerError(code, "Data Matrix is not a supported BMP carrier");
  }
  return new MedicationBmpScannerError("scan_failed", "Unable to scan the BMP carrier");
}

export async function scanMedicationBmpCarrier(
  options: ScanOptions,
): Promise<MedicationBmpScanResult> {
  if (!isMedicationBmpScannerAvailable()) {
    throw new MedicationBmpScannerError(
      "unsupported",
      "BMP camera scanning is only available in the Android app",
    );
  }
  try {
    return normalizeMedicationBmpScanResult(await NativeBmpScanner.scan(options));
  } catch (error) {
    throw scannerError(error);
  }
}
