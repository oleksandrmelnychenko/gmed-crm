/**
 * QR code encoder (ISO/IEC 18004, byte mode) for the authenticator enrolment.
 *
 * The otpauth URI carries the shared secret of the second factor, so it is
 * encoded in the browser and never sent to a QR service. No QR library is in
 * the lockfile; this is a compact port of the reference algorithm of Project
 * Nayuki's "QR Code generator library" (MIT License, Copyright (c) Project
 * Nayuki, https://www.nayuki.io/page/qr-code-generator-library), reduced to
 * byte-mode segments, versions 1–40 and automatic mask selection.
 */

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

const ECC_ORDINAL: Record<QrErrorCorrection, number> = { L: 0, M: 1, Q: 2, H: 3 };
/** Format bits of each level (ISO/IEC 18004 table 12). */
const ECC_FORMAT_BITS: Record<QrErrorCorrection, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Error correction codewords per block, by level and version (index 0 unused).
const ECC_CODEWORDS_PER_BLOCK: readonly (readonly number[])[] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

// Number of error correction blocks, by level and version (index 0 unused).
const NUM_ERROR_CORRECTION_BLOCKS: readonly (readonly number[])[] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** An encoded symbol: `modules[y][x]` is true for a dark module. */
export type QrMatrix = {
  version: number;
  size: number;
  mask: number;
  modules: boolean[][];
};

function getBit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

/** Bits of raw data modules in a symbol of `version` (no function patterns). */
export function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Data codewords (bytes) of a symbol of `version` at level `ecl`. */
export function numDataCodewords(version: number, ecl: QrErrorCorrection): number {
  const ordinal = ECC_ORDINAL[ecl];
  return (
    Math.floor(numRawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ordinal][version] * NUM_ERROR_CORRECTION_BLOCKS[ordinal][version]
  );
}

/** Product of two elements of GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1. */
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** Generator polynomial of `degree` (coefficients from highest to lowest, leading 1 omitted). */
export function reedSolomonDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** Error correction codewords of `data` for the divisor. */
export function reedSolomonRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** The data codewords of a byte-mode segment, padded to the symbol's capacity. */
function dataCodewords(bytes: readonly number[], version: number, ecl: QrErrorCorrection): number[] {
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0x4, 4); // byte mode
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);
  const capacityBits = numDataCodewords(version, ecl) * 8;
  append(0, Math.min(4, capacityBits - bits.length)); // terminator
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);
  const result: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    result.push(byte);
  }
  return result;
}

/** Splits the data into blocks, adds their error correction and interleaves. */
export function addEccAndInterleave(data: readonly number[], version: number, ecl: QrErrorCorrection): number[] {
  const ordinal = ECC_ORDINAL[ecl];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ordinal][version];
  const blockEccLength = ECC_CODEWORDS_PER_BLOCK[ordinal][version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLength = Math.floor(rawCodewords / numBlocks);
  const divisor = reedSolomonDivisor(blockEccLength);
  const blocks: number[][] = [];
  for (let i = 0, offset = 0; i < numBlocks; i++) {
    const block = data.slice(offset, offset + shortBlockLength - blockEccLength + (i < numShortBlocks ? 0 : 1));
    offset += block.length;
    const ecc = reedSolomonRemainder(block, divisor);
    if (i < numShortBlocks) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      // Skip the padding byte of the short blocks.
      if (i !== shortBlockLength - blockEccLength || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

/** Positions of the alignment pattern centres along one axis. */
export function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < numAlign; position -= step) {
    result.splice(1, 0, position);
  }
  return result;
}

/** The 15 format bits of a level and mask (BCH code, XOR mask 0x5412). */
export function formatBits(ecl: QrErrorCorrection, mask: number): number {
  const data = (ECC_FORMAT_BITS[ecl] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up). */
export function versionBits(version: number): number {
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return (version << 12) | remainder;
}

class QrSymbol {
  readonly version: number;
  readonly ecl: QrErrorCorrection;
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(version: number, ecl: QrErrorCorrection) {
    this.version = version;
    this.ecl = ecl;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  private setFunction(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const positions = alignmentPatternPositions(this.version);
    const count = positions.length;
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        // Not over the three finder patterns.
        if ((i === 0 && j === 0) || (i === 0 && j === count - 1) || (i === count - 1 && j === 0)) continue;
        this.drawAlignment(positions[i], positions[j]);
      }
    }
    this.drawFormat(0); // reserved now, written with the chosen mask later
    this.drawVersion();
  }

  drawFormat(mask: number) {
    const bits = formatBits(this.ecl, mask);
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, getBit(bits, i));
    this.setFunction(8, 7, getBit(bits, 6));
    this.setFunction(8, 8, getBit(bits, 7));
    this.setFunction(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) this.setFunction(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunction(8, this.size - 15 + i, getBit(bits, i));
    this.setFunction(8, this.size - 8, true); // the dark module
  }

  private drawVersion() {
    if (this.version < 7) return;
    const bits = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const dark = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  private drawFinder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunction(xx, yy, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  private drawAlignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  drawCodewords(codewords: readonly number[]) {
    let bitIndex = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing pattern
      for (let vertical = 0; vertical < this.size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vertical : vertical;
          if (!this.isFunction[y][x] && bitIndex < codewords.length * 8) {
            this.modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
            bitIndex++;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        if (maskApplies(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  penalty(): number {
    const size = this.size;
    const at = (x: number, y: number) => this.modules[y][x];
    let result = 0;
    // Rule 1: runs of five or more modules of one colour.
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        let runColor = false;
        let runLength = 0;
        for (let b = 0; b < size; b++) {
          const color = pass === 0 ? at(b, a) : at(a, b);
          if (b > 0 && color === runColor) {
            runLength++;
          } else {
            if (runLength >= 5) result += PENALTY_N1 + (runLength - 5);
            runColor = color;
            runLength = 1;
          }
        }
        if (runLength >= 5) result += PENALTY_N1 + (runLength - 5);
      }
    }
    // Rule 2: 2x2 blocks of one colour.
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const color = at(x, y);
        if (color === at(x + 1, y) && color === at(x, y + 1) && color === at(x + 1, y + 1)) result += PENALTY_N2;
      }
    }
    // Rule 3: finder-like patterns 1:1:3:1:1 with four light modules on a side.
    const patterns = [
      [true, false, true, true, true, false, true, false, false, false, false],
      [false, false, false, false, true, false, true, true, true, false, true],
    ];
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        for (let b = 0; b + 11 <= size; b++) {
          for (const pattern of patterns) {
            let matches = true;
            for (let k = 0; k < 11 && matches; k++) {
              const color = pass === 0 ? at(b + k, a) : at(a, b + k);
              matches = color === pattern[k];
            }
            if (matches) result += PENALTY_N3;
          }
        }
      }
    }
    // Rule 4: balance of dark and light modules.
    let dark = 0;
    for (const row of this.modules) for (const module of row) if (module) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += Math.max(0, k) * PENALTY_N4;
    return result;
  }
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: throw new Error("mask out of range");
  }
}

/**
 * Encodes `text` (UTF-8, byte mode) in the smallest version that fits at
 * level `ecl`, with the mask of the lowest penalty.
 */
export function encodeQr(text: string, ecl: QrErrorCorrection = "M"): QrMatrix {
  const bytes = utf8Bytes(text);
  let version = 1;
  for (; version <= 40; version++) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= numDataCodewords(version, ecl) * 8) break;
  }
  if (version > 40) throw new Error("text too long for a QR code");
  const codewords = addEccAndInterleave(dataCodewords(bytes, version, ecl), version, ecl);

  let best: QrSymbol | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const symbol = new QrSymbol(version, ecl);
    symbol.drawFunctionPatterns();
    symbol.drawCodewords(codewords);
    symbol.applyMask(mask);
    symbol.drawFormat(mask);
    const penalty = symbol.penalty();
    if (penalty < bestPenalty) {
      best = symbol;
      bestPenalty = penalty;
      bestMask = mask;
    }
  }
  const chosen = best as QrSymbol;
  return { version, size: chosen.size, mask: bestMask, modules: chosen.modules };
}

/** SVG path (one unit per module, with a quiet zone of `border` modules). */
export function qrSvgPath(matrix: QrMatrix, border = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.modules[y][x]) parts.push(`M${x + border},${y + border}h1v1h-1z`);
    }
  }
  return parts.join("");
}
