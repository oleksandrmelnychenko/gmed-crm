import { useMemo } from "react";

import { encodeQr, qrSvgPath, type QrErrorCorrection } from "@/lib/qr-code";

const QUIET_ZONE = 4;

/**
 * A QR code drawn in the browser. Used for the authenticator enrolment: the
 * otpauth URI contains the shared secret and never leaves the page.
 * Always dark on white, also in the dark theme, so every camera reads it.
 */
export function QrCodeImage({
  value,
  label,
  size = 192,
  errorCorrection = "M",
}: {
  value: string;
  label: string;
  size?: number;
  errorCorrection?: QrErrorCorrection;
}) {
  const { path, dimension } = useMemo(() => {
    const matrix = encodeQr(value, errorCorrection);
    return {
      path: qrSvgPath(matrix, QUIET_ZONE),
      dimension: matrix.size + QUIET_ZONE * 2,
    };
  }, [value, errorCorrection]);
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="qr-code"
      viewBox={`0 0 ${dimension} ${dimension}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="max-w-full rounded-md border border-border"
    >
      <rect width={dimension} height={dimension} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
