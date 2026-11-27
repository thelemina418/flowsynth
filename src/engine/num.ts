// The numeric layer (ADR-0094). Every economy value is a break_eternity
// Decimal, and this is the only module that imports break_eternity: the rest
// of the game builds, combines, compares, shows and saves numbers through
// the functions below.
import Decimal from "break_eternity.js";

export type Num = Decimal;
export type NumLike = Num | number | string;

export function D(value: NumLike): Num {
  return new Decimal(value);
}

export function isNum(value: unknown): value is Num {
  return value instanceof Decimal;
}

export const add = (a: NumLike, b: NumLike): Num => D(a).add(b);
export const sub = (a: NumLike, b: NumLike): Num => D(a).sub(b);
export const mul = (a: NumLike, b: NumLike): Num => D(a).mul(b);
export const div = (a: NumLike, b: NumLike): Num => D(a).div(b);
export const pow = (a: NumLike, b: NumLike): Num => D(a).pow(b);
export const log10 = (a: NumLike): Num => D(a).log10();
export const ln = (a: NumLike): Num => D(a).ln();
export const neg = (a: NumLike): Num => D(a).neg();
export const abs = (a: NumLike): Num => D(a).abs();
export const floor = (a: NumLike): Num => D(a).floor();
export const min = (a: NumLike, b: NumLike): Num => D(a).min(b);
export const max = (a: NumLike, b: NumLike): Num => D(a).max(b);

export const cmp = (a: NumLike, b: NumLike): -1 | 0 | 1 => D(a).cmp(b);
export const eq = (a: NumLike, b: NumLike): boolean => D(a).eq(b);
export const lt = (a: NumLike, b: NumLike): boolean => D(a).lt(b);
export const lte = (a: NumLike, b: NumLike): boolean => D(a).lte(b);
export const gt = (a: NumLike, b: NumLike): boolean => D(a).gt(b);
export const gte = (a: NumLike, b: NumLike): boolean => D(a).gte(b);

// The numeric fault (ADR-0094): a Decimal holds any finite or infinite size,
// so the one figure the economy refuses is NaN. Commit points check with
// requireNotNaN, and the save refuses to write or read one.
export class NumFault extends Error {
  constructor(readonly detail: string) {
    super(`numeric fault: ${detail}`);
    this.name = "NumFault";
  }
}

export function isNaNNum(value: Num): boolean {
  return Number.isNaN(value.mag) || Number.isNaN(value.sign) || Number.isNaN(value.layer);
}

// The plain-number seconds' guard (issue #486): JSON.stringify silently
// writes null for a nonfinite number, and an accumulated Infinity compounds
// forever after, so every commit of a seconds figure checks it first.
export function requireFinite(value: number, detail: string): number {
  if (!Number.isFinite(value)) throw new NumFault(detail);
  return value;
}

// Returns the value so a guard can wrap the computed figure inline.
export function requireNotNaN(value: Num, detail: string): Num {
  if (isNaNNum(value)) throw new NumFault(`${detail} is NaN`);
  return value;
}

const THIN_SPACE = "\u2009";

function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

// Display truncates rather than rounds, so a shown figure never exceeds the
// value behind it. The nudge absorbs break_eternity's representation noise
// (3 held as 2.9999999999) without ever lifting a real shortfall.
const NUDGE = 1e-6;

// 1.23e45: two decimals, truncated, trailing zeros dropped.
function scientific(n: number): string {
  const [m, e] = n.toExponential(12).split("e") as [string, string];
  const mantissa = Math.min(9.99, Math.floor(Number(m) * 100 + NUDGE) / 100);
  return `${mantissa}e${Number(e)}`;
}

// The exponent after an `e` prefix: plain digits below 1e6 (e400), then
// mantissa form (e1.2e308) where a bare power of ten drops its 1, so
// 10^(10^12) reads ee12. Past the double range the prefixes stack.
function exponent(e: Num): string {
  if (e.lt(1e6)) return String(Math.floor(e.toNumber() + NUDGE));
  if (e.lt(Number.MAX_VALUE)) {
    const text = scientific(e.toNumber());
    return text.startsWith("1e") ? text.slice(1) : text;
  }
  return `e${exponent(e.log10())}`;
}

function magnitude(value: Num): string {
  if (value.lt(1e6)) return groupDigits(Math.floor(value.toNumber() + NUDGE));
  if (value.lt(1e308)) return scientific(value.toNumber());
  return `e${exponent(value.log10())}`;
}

// Every number the game shows. Below 1e6, digits grouped by thin spaces
// (12 480); then 1.23e45; from e308, e-prefixed exponents (e1.2e308, ee12).
// A negative is a minus before its magnitude's text; zero is never signed.
export function fmt(value: Num): string {
  if (isNaNNum(value)) return "NaN";
  if (!Number.isFinite(value.mag)) return value.sign < 0 ? "-\u221e" : "\u221e";
  const text = magnitude(value.abs());
  return value.sign < 0 && text !== "0" ? `-${text}` : text;
}

// A rate (ν/s) or factor: two decimals with at least one (1.0, 1.75, 4.5),
// truncated like every shown figure; from a thousand up, fmt's figures.
// The Hex detail and the pace report both read rates through this.
export function fmtRate(value: Num): string {
  if (value.gte(1000)) return fmt(value);
  const hundredths = Math.floor(value.toNumber() * 100 + NUDGE);
  return (hundredths / 100).toFixed(2).replace(/(\.\d)0$/, "$1");
}

// The save form of a Decimal: its own components, written so nothing is
// recomputed on the way back. An optional minus, one `e` per layer, then the
// magnitude in JavaScript's shortest round-trip form: 12480, -0.1,
// ee308.0791812460476, e-400. The double's own text is exact, so the trip
// is lossless at every size.
export function toSave(value: Num): string {
  requireNotNaN(value, "saved figure");
  if (value.sign === 0) return "0";
  const minus = value.sign < 0 ? "-" : "";
  if (!Number.isFinite(value.mag)) return `${minus}Infinity`;
  return `${minus}${"e".repeat(value.layer)}${String(value.mag)}`;
}

const SAVED = /^(-?)(e*)(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/;

export function fromSave(text: string): Num {
  if (text === "Infinity" || text === "-Infinity") return new Decimal(Number(text));
  const match = SAVED.exec(text);
  if (!match) throw new NumFault(`saved figure ${JSON.stringify(text)} is malformed`);
  const [, minus, layers, magText] = match as unknown as [string, string, string, string];
  const mag = Number(magText);
  if (layers.length === 0 && mag < 0) throw new NumFault(`saved figure ${JSON.stringify(text)} is malformed`);
  if (mag === 0 && layers.length === 0) return new Decimal(0);
  return requireNotNaN(Decimal.fromComponents(minus ? -1 : 1, layers.length, mag), "saved figure");
}
