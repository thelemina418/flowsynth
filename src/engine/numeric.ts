// The numeric fault (issue #486): a figure the doubles cannot represent is
// refused at its commit point. JSON.stringify silently writes null for a
// nonfinite number, and an accumulated Infinity compounds forever after, so
// every commit checks its figure first, the advance walk restores the state
// it was given, and the caller receives the refusal instead of a
// half-applied update. Spec chunk 01's `num` layer (issue #16) replaces this
// with a no-NaN Decimal check.

export class NumericFault extends Error {
  constructor(readonly detail: string) {
    super(`numeric fault: ${detail}`);
    this.name = "NumericFault";
  }
}

// The one commit-point check: the figure must be a finite double to land.
export function requireFinite(value: number, detail: string): number {
  if (!Number.isFinite(value)) throw new NumericFault(detail);
  return value;
}
