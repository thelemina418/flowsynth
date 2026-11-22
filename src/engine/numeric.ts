// The numeric fault (issue #486, parent #484 stories 33–35): the economy
// refuses figures it cannot represent. JSON.stringify silently writes null
// for a nonfinite number — the corruption the parent save carried — and an
// accumulated Infinity compounds silently forever after. Both are refused
// at the commit point: every economy commit checks its figure first, the
// advance walk restores the state it was given, and the caller receives
// the refusal instead of a half-applied update.

// One thrown shape, caught by the advance walk's restore wrapper (and by
// nothing else — every other commit site refuses before it mutates, so the
// throw only ever travels to the walk that can undo it).
export class NumericFault extends Error {
  constructor(readonly detail: string) {
    super(`numeric fault: ${detail}`);
    this.name = "NumericFault";
  }
}

// The one commit-point check: the figure must be a finite double to land.
// Returns the value so a guard can wrap the computed figure inline.
export function requireFinite(value: number, detail: string): number {
  if (!Number.isFinite(value)) throw new NumericFault(detail);
  return value;
}

// Error-free two-sum for doubles. A meter keeps the rounded total as its
// public value and carries the low part into the next addition. This keeps
// fine ticks from accumulating an error proportional to their count, without
// making a just-short representable value eligible for a payment or a fill.
function twoSum(a: number, b: number, detail: string): [number, number] {
  const total = requireFinite(a + b, detail);
  const right = total - a;
  return [total, (a - (total - right)) + (b - right)];
}

function accumulate(value: number, carry: number | undefined, delta: number, detail: string): [number, number] {
  const [total, error] = twoSum(value, delta, detail);
  const [rounded, low] = twoSum(total, error + (carry ?? 0), detail);
  return [rounded, requireFinite(low, detail)];
}

type Sum<K extends string> = Record<K, number> & Partial<Record<`${K}Carry`, number>>;

export function addToSum<K extends string>(owner: Sum<K>, key: K, delta: number, detail: string): void {
  const values: Record<K, number> = owner;
  const carries: Partial<Record<`${K}Carry`, number>> = owner;
  const carryKey = `${key}Carry` as const;
  const [total, carry] = accumulate(values[key], carries[carryKey], delta, detail);
  values[key] = total;
  if (carry) carries[carryKey] = carry;
  else delete carries[carryKey];
}

export function resetSum<K extends string>(owner: Sum<K>, key: K, total: number): void {
  const values: Record<K, number> = owner;
  const carries: Partial<Record<`${K}Carry`, number>> = owner;
  values[key] = total;
  delete carries[`${key}Carry` as const];
}

// Readiness is a strict comparison on the rounded figure. For a future
// boundary, use the carried low part when calculating the distance to it.
export function gapTo<K extends string>(owner: Sum<K>, key: K, target: number): number {
  const carries: Partial<Record<`${K}Carry`, number>> = owner;
  return owner[key] >= target ? 0 : (target - owner[key]) - (carries[`${key}Carry` as const] ?? 0);
}

// Old saves have no carry. Only accept a finite low part that belongs to a
// retained (unclamped) total and cannot alter its rounded public value.
export function savedCarry(original: unknown, total: number, carry: unknown): number | undefined {
  if (original === total && typeof carry === "number" && Number.isFinite(carry) && carry !== 0 && total + carry === total) return carry;
}

export function restoreSumCarry<K extends string>(owner: Sum<K>, key: K, raw: Partial<Record<K | `${K}Carry`, unknown>>): void {
  const carryKey = `${key}Carry` as const;
  const carry = savedCarry(raw[key], owner[key], raw[carryKey]);
  const carries: Partial<Record<`${K}Carry`, number>> = owner;
  if (carry !== undefined) carries[carryKey] = carry;
}
