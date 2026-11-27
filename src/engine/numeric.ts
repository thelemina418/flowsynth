import { NumFault } from "./num";

// The finite-double guard for the plain-number seconds (issue #486):
// JSON.stringify silently writes null for a nonfinite number, and an
// accumulated Infinity compounds forever after, so every commit checks its
// figure first. It throws num's one fault, NumFault, so the apply/advance
// boundary restores the state whole for either check (ADR-0094).
export function requireFinite(value: number, detail: string): number {
  if (!Number.isFinite(value)) throw new NumFault(detail);
  return value;
}
