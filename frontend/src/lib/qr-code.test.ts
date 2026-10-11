import { describe, expect, it } from "vitest";

import {
  alignmentPatternPositions,
  encodeQr,
  formatBits,
  numDataCodewords,
  reedSolomonDivisor,
  reedSolomonRemainder,
  versionBits,
  type QrErrorCorrection,
  type QrMatrix,
} from "@/lib/qr-code";

// GF(2^8) arithmetic of the reader, written separately from the encoder.
const EXP: number[] = [];
const LOG: number[] = new Array<number>(256).fill(0);
{
  let value = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255]);

const BLOCKS: Record<QrErrorCorrection, { blocks: number[]; ecc: number[] }> = {
  // Versions 1–10 (ISO/IEC 18004 table 9), enough for otpauth URIs.
  L: { blocks: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4], ecc: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18] },
  M: { blocks: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5], ecc: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26] },
  Q: { blocks: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8], ecc: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24] },
  H: { blocks: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8], ecc: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28] },
};
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/** Which modules belong to function patterns, built from the spec layout. */
function functionMap(version: number): boolean[][] {
  const size = version * 4 + 17;
  const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) map[y][x] = true;
  };
  mark(0, 0, 9, 9); // finder, separator, format
  mark(size - 8, 0, 8, 9);
  mark(0, size - 8, 9, 8);
  const positions = alignmentPatternPositions(version);
  for (const cy of positions) {
    for (const cx of positions) {
      if (map[cy][cx]) continue; // overlaps a finder (timing is marked below)
      mark(cx - 2, cy - 2, 5, 5);
    }
  }
  mark(6, 0, 1, size); // timing
  mark(0, 6, size, 1);
  if (version >= 7) {
    mark(size - 11, 0, 3, 6);
    mark(0, size - 11, 6, 3);
  }
  return map;
}

function readFormat(matrix: QrMatrix): number {
  let bits = 0;
  const m = matrix.modules;
  // First copy around the top-left finder: [x, y] of bits 0..14.
  const coordinates: Array<[number, number]> = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  coordinates.forEach(([x, y], index) => {
    if (m[y][x]) bits |= 1 << index;
  });
  return bits;
}

function decode(matrix: QrMatrix, ecl: QrErrorCorrection): string {
  const { size, version } = matrix;
  const format = readFormat(matrix);
  const mask = [0, 1, 2, 3, 4, 5, 6, 7].find((candidate) => formatBits(ecl, candidate) === format);
  expect(mask, "format bits name a mask of the level").toBeDefined();
  expect(mask).toBe(matrix.mask);
  const functions = functionMap(version);
  const maskAt = (x: number, y: number) => {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (functions[y][x]) continue;
        bits.push((matrix.modules[y][x] !== maskAt(x, y)) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const total = TOTAL_CODEWORDS[version - 1];
  const codewords: number[] = [];
  for (let i = 0; i < total; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j];
    codewords.push(byte);
  }

  // De-interleave and check every block's syndromes.
  const blockCount = BLOCKS[ecl].blocks[version - 1];
  const eccLength = BLOCKS[ecl].ecc[version - 1];
  const dataTotal = total - blockCount * eccLength;
  const shortData = Math.floor(dataTotal / blockCount);
  const longBlocks = dataTotal % blockCount;
  const dataLengths = Array.from({ length: blockCount }, (_, i) =>
    shortData + (i >= blockCount - longBlocks ? 1 : 0),
  );
  const blocks: number[][] = dataLengths.map(() => []);
  let index = 0;
  for (let i = 0; i < shortData + 1; i++) {
    for (let b = 0; b < blockCount; b++) {
      if (i < dataLengths[b]) blocks[b].push(codewords[index++]);
    }
  }
  for (let i = 0; i < eccLength; i++) {
    for (let b = 0; b < blockCount; b++) blocks[b].push(codewords[index++]);
  }
  for (const block of blocks) {
    for (let root = 0; root < eccLength; root++) {
      let syndrome = 0;
      for (const coefficient of block) syndrome = mul(syndrome, EXP[root]) ^ coefficient;
      expect(syndrome).toBe(0);
    }
  }
  const data = blocks.flatMap((block, b) => block.slice(0, dataLengths[b]));

  // Byte mode segment.
  const stream = data.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((shift) => (byte >> shift) & 1));
  const take = (count: number) => {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | (stream.shift() as number);
    return value;
  };
  expect(take(4)).toBe(0x4);
  const length = take(version <= 9 ? 8 : 16);
  const bytes = Array.from({ length }, () => take(8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

describe("qr-code", () => {
  it("computes the Reed-Solomon codewords of the ISO example", () => {
    // "HELLO WORLD", version 1-M (alphanumeric data codewords).
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomonRemainder(data, reedSolomonDivisor(10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it("writes the format and version information of the standard", () => {
    expect(formatBits("M", 0)).toBe(0b101010000010010);
    expect(formatBits("L", 0)).toBe(0b111011111000100);
    expect(versionBits(7)).toBe(0b000111110010010100);
    expect(alignmentPatternPositions(1)).toEqual([]);
    expect(alignmentPatternPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPatternPositions(14)).toEqual([6, 26, 46, 66]);
    expect(alignmentPatternPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(numDataCodewords(1, "M")).toBe(16);
    expect(numDataCodewords(7, "M")).toBe(124);
    expect(numDataCodewords(10, "M")).toBe(216);
  });

  it("encodes an otpauth URI that a reader recovers byte for byte", () => {
    const uri =
      "otpauth://totp/GMED%20Console:anna.muster%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=GMED%20Console&algorithm=SHA1&digits=6&period=30";
    for (const ecl of ["L", "M", "Q"] as const) {
      const matrix = encodeQr(uri, ecl);
      expect(matrix.size).toBe(matrix.version * 4 + 17);
      expect(matrix.version).toBeLessThanOrEqual(10);
      expect(decode(matrix, ecl)).toBe(uri);
    }
  });

  it("chooses the smallest version and keeps short texts small", () => {
    expect(encodeQr("GMED", "M").version).toBe(1);
    const matrix = encodeQr("x".repeat(100), "M");
    expect(matrix.version).toBe(6);
    expect(decode(matrix, "M")).toBe("x".repeat(100));
  });

  it("draws the three finder patterns", () => {
    const { modules, size } = encodeQr("finder", "M");
    for (const [x0, y0] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let i = 0; i < 7; i++) {
        expect(modules[y0][x0 + i]).toBe(true);
        expect(modules[y0 + 6][x0 + i]).toBe(true);
      }
      expect(modules[y0 + 1][x0 + 1]).toBe(false);
      expect(modules[y0 + 3][x0 + 3]).toBe(true);
    }
  });
});
