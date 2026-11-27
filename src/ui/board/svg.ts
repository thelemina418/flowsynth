// Drawn coordinates to two decimals, so the SVG text stays short; `+ 0`
// keeps a signed zero out of the markup.
export function round(n: number): number {
  return Math.round(n * 100) / 100 + 0;
}
