// A QR code for a short text such as a URL, made here without a library or the network: byte
// mode, error correction level M (about 15% of the code can be lost), the smallest of the 40
// versions that holds the text, and the mask with the lowest penalty. It follows ISO/IEC 18004
// the way Project Nayuki's QR Code generator (MIT) does.

/** Level M's error correction codewords per block, by version (index 0 unused). */
const ECC_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];

/** Level M's number of error correction blocks, by version (index 0 unused). */
const ECC_BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

/** Level M, as the format bits spell it. */
const LEVEL_M = 0b00;

/** The eight masks, by number: whether the module in column x, row y is flipped. */
const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

export interface QrCode {
  /** 1 to 40. */
  version: number;
  /** The mask applied, 0 to 7. */
  mask: number;
  /** Modules per side, without the quiet zone around it. */
  size: number;
  /** Whether the module in column x, row y is dark. */
  isDark: (x: number, y: number) => boolean;
}

/** The QR code for `text`, encoded as UTF-8. Throws a RangeError when it is too long for one. */
export function qrCode(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = smallestVersion(bytes.length);
  const codewords = withErrorCorrection(version, dataCodewords(version, bytes));
  return draw(version, codewords);
}

/** The count of modules that carry data and error correction, after the fixed patterns. */
function rawDataModules(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    modules -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

function dataCapacity(version: number): number {
  const ecc = (ECC_PER_BLOCK[version] ?? 0) * (ECC_BLOCKS[version] ?? 0);
  return Math.floor(rawDataModules(version) / 8) - ecc;
}

/** The bits of a byte count: 8 up to version 9, 16 from version 10. */
function countBits(version: number): number {
  return version < 10 ? 8 : 16;
}

function smallestVersion(length: number): number {
  for (let version = 1; version <= 40; version++) {
    if (4 + countBits(version) + length * 8 <= dataCapacity(version) * 8) return version;
  }
  throw new RangeError(`${length} bytes are too many for a QR code.`);
}

/** The mode, the byte count, the bytes, the terminator, and the padding, as codewords. */
function dataCodewords(version: number, bytes: Uint8Array): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCapacity(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  return codewords;
}

/**
 * The data split into blocks, the shorter blocks first, each followed by its Reed-Solomon error
 * correction; then interleaved: the data codewords block by block, then the error correction.
 */
function withErrorCorrection(version: number, data: number[]): number[] {
  const blocks = ECC_BLOCKS[version] ?? 1;
  const eccLength = ECC_PER_BLOCK[version] ?? 0;
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortDataLength = Math.floor(raw / blocks) - eccLength;
  const divisor = reedSolomonDivisor(eccLength);
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  for (let block = 0, at = 0; block < blocks; block++) {
    const length = shortDataLength + (block < shortBlocks ? 0 : 1);
    const part = data.slice(at, at + length);
    at += length;
    dataBlocks.push(part);
    eccBlocks.push(reedSolomonRemainder(part, divisor));
  }
  const interleaved: number[] = [];
  for (let i = 0; i <= shortDataLength; i++) {
    for (const part of dataBlocks) if (i < part.length) interleaved.push(part[i] ?? 0);
  }
  for (let i = 0; i < eccLength; i++) {
    for (const part of eccBlocks) interleaved.push(part[i] ?? 0);
  }
  return interleaved;
}

/** Multiplication in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1. */
function multiply(x: number, y: number): number {
  let product = 0;
  for (let i = 7; i >= 0; i--) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((y >>> i) & 1) * x;
  }
  return product;
}

/** The generator polynomial of the given degree, highest term first, its leading 1 left out. */
function reedSolomonDivisor(degree: number): number[] {
  const divisor = new Array<number>(degree).fill(0);
  divisor[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      divisor[j] = multiply(divisor[j] ?? 0, root) ^ (j + 1 < degree ? (divisor[j + 1] ?? 0) : 0);
    }
    root = multiply(root, 0x02);
  }
  return divisor;
}

function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const remainder = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (remainder.shift() ?? 0);
    remainder.push(0);
    for (let i = 0; i < divisor.length; i++) {
      remainder[i] = (remainder[i] ?? 0) ^ multiply(divisor[i] ?? 0, factor);
    }
  }
  return remainder;
}

/** The centres of the alignment patterns along each axis. */
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const positions = [6];
  for (let at = version * 4 + 10; positions.length < count; at -= step) positions.splice(1, 0, at);
  return positions;
}

/** Level M and the mask, with their BCH error correction, masked as the standard says. */
function formatBits(mask: number): number {
  const data = (LEVEL_M << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

function draw(version: number, codewords: number[]): QrCode {
  const size = version * 4 + 17;
  const modules = new Uint8Array(size * size);
  const fixed = new Uint8Array(size * size);
  const set = (x: number, y: number, dark: boolean) => {
    modules[y * size + x] = dark ? 1 : 0;
    fixed[y * size + x] = 1;
  };

  // Timing patterns, then the finder patterns with their separators over them.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finders = [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const;
  for (const [cx, cy] of finders) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const [x, y] = [cx + dx, cy + dy];
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  // Alignment patterns, except the three that would overlap a finder.
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((cy, i) => {
    positions.forEach((cx, j) => {
      if ((i === 0 && (j === 0 || j === last)) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });

  const drawFormat = (mask: number) => {
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  // Reserves the format modules, which are drawn again once the mask is chosen.
  drawFormat(0);

  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const [a, b] = [size - 11 + (i % 3), Math.floor(i / 3)];
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // The codewords, in two-module columns zigzagging up and down from the bottom right,
  // stepping over the vertical timing pattern.
  const total = codewords.length * 8;
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (fixed[y * size + x] === 1 || bit >= total) continue;
        modules[y * size + x] = ((codewords[bit >>> 3] ?? 0) >>> (7 - (bit & 7))) & 1;
        bit++;
      }
    }
  }

  const applyMask = (mask: number) => {
    const flips = MASKS[mask] ?? MASKS[0];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const at = y * size + x;
        if (fixed[at] === 0 && flips?.(x, y)) modules[at] = modules[at] === 1 ? 0 : 1;
      }
    }
  };
  const isDark = (x: number, y: number) => modules[y * size + x] === 1;
  let best = 0;
  let lowest = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < MASKS.length; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const score = penalty(size, isDark);
    if (score < lowest) [best, lowest] = [mask, score];
    applyMask(mask);
  }
  applyMask(best);
  drawFormat(best);
  return { version, mask: best, size, isDark };
}

/**
 * The standard's penalty for a masked code, lower being easier to scan: runs of five or more
 * modules of one color, 2 × 2 blocks of one color, patterns that look like a finder, and dark and
 * light out of balance.
 */
function penalty(size: number, isDark: (x: number, y: number) => boolean): number {
  let score = 0;
  for (const across of [true, false]) {
    for (let a = 0; a < size; a++) {
      let line = "";
      for (let b = 0; b < size; b++) line += (across ? isDark(b, a) : isDark(a, b)) ? "1" : "0";
      for (const run of line.match(/0{5,}|1{5,}/g) ?? []) score += run.length - 2;
      score += 40 * (line.match(/(?=10111010000|00001011101)/g) ?? []).length;
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isDark(x, y)) dark++;
      if (x + 1 < size && y + 1 < size) {
        const color = isDark(x, y);
        if (isDark(x + 1, y) === color && isDark(x, y + 1) === color) {
          if (isDark(x + 1, y + 1) === color) score += 3;
        }
      }
    }
  }
  return score + 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
}
