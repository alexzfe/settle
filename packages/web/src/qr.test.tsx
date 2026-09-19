import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { QrCode } from "./QrCode";
import { type QrCode as Code, qrCode } from "./qr";

afterEach(cleanup);

/** 41 bytes: version 3 at level M, one block. */
const phoneUrl = "http://192.168.1.20:4380/guide/k3Jx9QaZ7p";

it("picks the smallest version that holds the text at level M", () => {
  // Level M's byte capacities: 14 bytes in version 1, 26 in 2, 42 in 3.
  expect(qrCode("x".repeat(14)).version).toBe(1);
  expect(qrCode("x".repeat(15)).version).toBe(2);
  expect(qrCode("x".repeat(26)).version).toBe(2);
  expect(qrCode("x".repeat(27)).version).toBe(3);
  expect(qrCode("x".repeat(42)).version).toBe(3);
  expect(qrCode("x".repeat(43)).version).toBe(4);
  expect(qrCode("x".repeat(43)).size).toBe(33);
  expect(() => qrCode("x".repeat(3000))).toThrow(RangeError);
});

it("draws the finder and timing patterns and the dark module", () => {
  const code = qrCode(phoneUrl);
  const { size } = code;
  // Each finder: a dark 7 × 7 ring, a light ring, a dark 3 × 3 core, then a light separator.
  for (const [left, top] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ] as const) {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        expect(code.isDark(left + dx, top + dy)).toBe(ring !== 2);
      }
    }
  }
  expect(code.isDark(7, 3)).toBe(false);
  for (let i = 8; i < size - 8; i++) {
    expect(code.isDark(i, 6)).toBe(i % 2 === 0);
    expect(code.isDark(6, i)).toBe(i % 2 === 0);
  }
  expect(code.isDark(8, size - 8)).toBe(true);
});

/** The 15 format bits from each of their two copies, unmasked. */
function formatCopies(code: Code): [number, number] {
  const { size, isDark } = code;
  const read = (cells: [number, number][]) =>
    cells.reduce((bits, [x, y], i) => bits | (Number(isDark(x, y)) << i), 0) ^ 0x5412;
  const first: [number, number][] = [
    ...[0, 1, 2, 3, 4, 5, 7, 8].map((y): [number, number] => [8, y]),
    [7, 8],
    ...[5, 4, 3, 2, 1, 0].map((x): [number, number] => [x, 8]),
  ];
  const second: [number, number][] = [
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): [number, number] => [size - 1 - i, 8]),
    ...[8, 9, 10, 11, 12, 13, 14].map((i): [number, number] => [8, size - 15 + i]),
  ];
  return [read(first), read(second)];
}

it("writes the same format bits twice: level M, the mask chosen, and a valid BCH code", () => {
  const code = qrCode(phoneUrl);
  const [first, second] = formatCopies(code);
  expect(first).toBe(second);
  expect(first >>> 13).toBe(0b00); // Level M.
  expect((first >>> 10) & 0b111).toBe(code.mask);
  // The 15 bits are a multiple of the generator x^10 + x^8 + x^5 + x^4 + x^2 + x + 1.
  let remainder = first;
  for (let i = 14; i >= 10; i--) if ((remainder >>> i) & 1) remainder ^= 0x537 << (i - 10);
  expect(remainder).toBe(0);
});

/** GF(2^8) exponent and logarithm tables, built here apart from the encoder's arithmetic. */
const EXP: number[] = [];
const LOG: number[] = [];
for (let i = 0, value = 1; i < 255; i++) {
  EXP[i] = value;
  LOG[value] = i;
  value = (value << 1) ^ (value & 0x80 ? 0x11d : 0);
}

/**
 * Reads a single-block code back the way a scanner does: undoes the mask on every module outside
 * the fixed patterns of a version 2 to 6 code, then reads the codewords column pair by column
 * pair, zigzagging up from the bottom right.
 */
function readCodewords(code: Code): number[] {
  const { size, isDark, mask } = code;
  const align = size - 7;
  const isFixed = (x: number, y: number) =>
    x === 6 ||
    y === 6 ||
    (x < 9 && y < 9) ||
    (x >= size - 8 && y < 9) ||
    (x < 9 && y >= size - 8) ||
    (Math.abs(x - align) <= 2 && Math.abs(y - align) <= 2);
  const flipped = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][mask] as (x: number, y: number) => boolean;
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let n = 0; n < size; n++) {
      const y = upward ? size - 1 - n : n;
      for (const x of [right, right - 1]) {
        if (!isFixed(x, y)) bits.push(Number(isDark(x, y) !== flipped(x, y)));
      }
    }
    upward = !upward;
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((byte, bit) => byte * 2 + bit, 0));
  }
  return codewords;
}

it("carries the text in byte mode, with Reed-Solomon codewords a scanner can check", () => {
  // Version 3 at level M: one block of 44 data and 26 error correction codewords.
  const code = qrCode(phoneUrl);
  expect(code.version).toBe(3);
  const codewords = readCodewords(code).slice(0, 70);

  const bits = codewords.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (byte >>> i) & 1));
  const number = (from: number, length: number) =>
    bits.slice(from, from + length).reduce((value, bit) => value * 2 + bit, 0);
  expect(number(0, 4)).toBe(0b0100);
  const length = number(4, 8);
  const text = Array.from({ length }, (_, i) => number(12 + i * 8, 8));
  expect(new TextDecoder().decode(new Uint8Array(text))).toBe(phoneUrl);

  // Every syndrome of the whole block is zero: c(α^j) = 0 for j = 0 to 25.
  for (let j = 0; j < 26; j++) {
    let syndrome = 0;
    for (const byte of codewords) {
      const shifted = syndrome === 0 ? 0 : (EXP[((LOG[syndrome] ?? 0) + j) % 255] ?? 0);
      syndrome = shifted ^ byte;
    }
    expect(syndrome).toBe(0);
  }
});

it("renders a URL as an SVG of dark modules inside a quiet zone", () => {
  render(<QrCode text={phoneUrl} size={160} />);
  const svg = screen.getByRole("img", { name: `QR code for ${phoneUrl}` });
  const code = qrCode(phoneUrl);
  // 29 modules a side for version 3, and 4 of quiet zone on each side.
  expect(svg.getAttribute("viewBox")).toBe("0 0 37 37");
  expect(svg.getAttribute("width")).toBe("160");
  let dark = 0;
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) if (code.isDark(x, y)) dark++;
  }
  const d = svg.querySelector("path")?.getAttribute("d") ?? "";
  expect(d.match(/M/g)).toHaveLength(dark);
  // The top-left module of the top-left finder, just inside the quiet zone.
  expect(d.startsWith("M4 4h1v1h-1z")).toBe(true);
});
