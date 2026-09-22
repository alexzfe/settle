// A QR code as an SVG, drawn from qr.ts: dark modules on white inside the four-module quiet zone
// scanners need, sharp at any size.

import { useMemo } from "react";
import { qrCode } from "./qr";

const QUIET_ZONE = 4;

export function QrCode({ text, size = 200 }: { text: string; size?: number }) {
  const path = useMemo(() => modulesPath(text), [text]);
  if (!path) return null;
  const side = path.size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={`QR code for ${text}`}
      viewBox={`0 0 ${side} ${side}`}
      width={size}
      height={size}
      // On a narrow phone the block shrinks with its column rather than pushing the page sideways.
      style={{ maxWidth: "100%", height: "auto" }}
      shapeRendering="crispEdges"
    >
      <title>{`QR code for ${text}`}</title>
      <rect width={side} height={side} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

/** One square per dark module, offset by the quiet zone; undefined when the text is too long. */
function modulesPath(text: string): { size: number; d: string } | undefined {
  let code: ReturnType<typeof qrCode>;
  try {
    code = qrCode(text);
  } catch {
    return undefined;
  }
  let d = "";
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.isDark(x, y)) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { size: code.size, d };
}
