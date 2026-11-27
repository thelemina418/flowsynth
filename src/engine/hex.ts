// The board's geometry (spec chunk 02, issue #24): axial (q, r) cells on a
// flat-top hex grid. Pure arithmetic: the board's cell kinds (board.ts),
// the authored walls (map.ts), resonance patterns and the SVG drawing all
// read cells through this one module.
//
// Drawing convention: flat-top, screen y pointing down. A cell's centre is
// toPixel(cell, size), where size is the hex's circumradius.

export interface Hex {
  readonly q: number;
  readonly r: number;
}

// The lifetime board's radius (progression-map.md: Master and Encore).
export const LIFETIME_RADIUS = 5;

// `-0 + 0` is 0: rotation and mirroring negate coordinates, and a signed
// zero would make equal cells compare unequal.
function hex(q: number, r: number): Hex {
  return { q: q + 0, r: r + 0 };
}

// The six neighbour offsets, clockwise on screen from upper-right: -30°,
// 30°, 90°, 150°, 210°, 270°. Direction i + 1 is direction i turned 60°
// clockwise, which is what rotate(_, 1) does.
export const DIRECTIONS: readonly Hex[] = [hex(1, -1), hex(1, 0), hex(0, 1), hex(-1, 1), hex(-1, 0), hex(0, -1)];

// A stable string key for maps and sets.
export function hexKey(cell: Hex): string {
  return `${cell.q},${cell.r}`;
}

export function sameHex(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function add(a: Hex, b: Hex): Hex {
  return hex(a.q + b.q, a.r + b.r);
}

export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// A cell's ring is its hex distance from (0,0).
export function ring(cell: Hex): number {
  return distance(cell, hex(0, 0));
}

export function neighbours(cell: Hex): Hex[] {
  return DIRECTIONS.map((d) => add(cell, d));
}

// Rotation about (0,0) by k × 60° clockwise on screen (k may be negative).
// Patterns are tested relative to an oscillator: rotate the offset, then
// add it to the oscillator's cell.
export function rotate(cell: Hex, k: number): Hex {
  const turns = ((k % 6) + 6) % 6;
  let { q, r } = cell;
  for (let i = 0; i < turns; i++) [q, r] = [-r, q + r];
  return hex(q, r);
}

// The mirror image about the q axis: the drawing flipped top to bottom.
// With rotate, it reaches all twelve orientations of a pattern.
export function mirror(cell: Hex): Hex {
  return hex(cell.q, -cell.q - cell.r);
}

// The cells at exactly distance n from (0,0), in a fixed clockwise order:
// start n steps along direction 4 (upper-left), then walk n steps along
// each direction in turn.
export function ringCells(n: number): Hex[] {
  if (n === 0) return [hex(0, 0)];
  const cells: Hex[] = [];
  let cell = hex(DIRECTIONS[4]!.q * n, DIRECTIONS[4]!.r * n);
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < n; step++) {
      cells.push(cell);
      cell = add(cell, DIRECTIONS[side]!);
    }
  }
  return cells;
}

// Every cell within the radius, ring by ring outward.
export function cellsWithin(radius: number): Hex[] {
  const cells: Hex[] = [];
  for (let n = 0; n <= radius; n++) cells.push(...ringCells(n));
  return cells;
}

// The lifetime board: 91 cells.
export function lifetimeCells(): Hex[] {
  return cellsWithin(LIFETIME_RADIUS);
}

// A flat-top cell's centre, for circumradius `size`.
export function toPixel(cell: Hex, size: number): { x: number; y: number } {
  return { x: size * 1.5 * cell.q, y: size * Math.sqrt(3) * (cell.r + cell.q / 2) };
}

// A flat-top hex's six corners about its centre, starting at 0° (east).
export function corners(center: { x: number; y: number }, size: number): { x: number; y: number }[] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i;
    return { x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) };
  });
}
