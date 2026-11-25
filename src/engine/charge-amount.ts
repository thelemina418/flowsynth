import { requireFinite, sumWithCarry } from "./numeric";

// The conserved transfer needs the rounding remainder at both ends: a
// producer can debit 1.44 × dt while its finished reserve is exactly 2.
// Carry the same two-part quantity through reception and sharing, rather
// than trying to recover it from the rounded rate and elapsed time later.
export type ChargeAmount = readonly [value: number, carry: number];
export const noCharge: ChargeAmount = [0, 0];
const detail = "World charge in transit";

export function addCharge(a: ChargeAmount, b: ChargeAmount): ChargeAmount {
  return sumWithCarry(a[0], a[1], b[0], b[1], detail);
}

// Split a double without scaling it (which could overflow a finite rate).
// These truncated high halves make the product's low terms recoverable.
const bits = new DataView(new ArrayBuffer(8));
function highHalf(value: number): number {
  bits.setFloat64(0, value);
  bits.setUint32(4, bits.getUint32(4) & 0xf8000000);
  return bits.getFloat64(0);
}

export function scaleCharge([value, carry]: ChargeAmount, factor: number): ChargeAmount {
  if (factor === 1) return [value, carry];
  const product = requireFinite(value * factor, detail);
  const a = highHalf(value), b = highHalf(factor);
  const aLow = value - a, bLow = factor - b;
  const error = ((a * b - product) + a * bLow + aLow * b) + aLow * bLow;
  return sumWithCarry(product, error, carry * factor, 0, detail);
}

export function divideCharge(amount: ChargeAmount, divisor: number): ChargeAmount {
  if (divisor === 1) return amount;
  const q = amount[0] / divisor;
  const [value, carry] = scaleCharge([q, 0], divisor);
  const remainder = ((amount[0] - value) + (amount[1] - carry)) / divisor;
  return sumWithCarry(q, 0, remainder, 0, detail);
}
