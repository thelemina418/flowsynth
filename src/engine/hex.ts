// The board's geometry (spec chunk 02, issue #24): axial (q, r) cells on a
// flat-top hex grid. Pure arithmetic: the board's cell kinds (board.ts),
// the authored walls (map.ts), resonance patterns and the SVG drawing all
// read cells through this one module.
//
// Drawing convention: flat-top, screen y pointing down. A cell's centre is
// toPixel(cell, size), where size is the hex's circumradius.

export interface Cell {
  readonly q: number;
  readonly r: number;
}

// A point in the drawing.
export interface Point {
  readonly x: number;
  readonly y: number;
}

// The lifetime board's radius (progression-map.md: Master and Encore).
export const LIFETIME_RADIUS = 5;

// `-0 + 0` is 0: rotation and mirroring negate coordinates, and a signed
// zero would make equal cells compare unequal.
function at(q: number, r: number): Cell {
  return { q: q + 0, r: r + 0 };
}

// The six neighbour offsets, clockwise on screen from upper-right: -30°,
// 30°, 90°, 150°, 210°, 270°. Direction i + 1 is direction i turned 60°
// clockwise, which is what rotate(_, 1) does.
export const DIRECTIONS: readonly Cell[] = [at(1, -1), at(1, 0), at(0, 1), at(-1, 1), at(-1, 0), at(0, -1)];

// A facing (spec chunk 03, issue #31): one of the six DIRECTIONS, by index.
// On the flat-top board they read as compass words.
export type Facing = 0 | 1 | 2 | 3 | 4 | 5;

export const FACING_NAMES: readonly string[] = ["NE", "SE", "S", "SW", "NW", "N"];

export function isFacing(value: unknown): value is Facing {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 6;
}

// The facing turned k × 60° clockwise (k may be negative), as rotate turns
// a cell.
export function turnFacing(facing: Facing, k: number): Facing {
  return ((((facing + k) % 6) + 6) % 6) as Facing;
}

// A stable string key for maps and sets.
export function cellKey(cell: Cell): string {
  return `${cell.q},${cell.r}`;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.q === b.q && a.r === b.r;
}

export function addCell(a: Cell, b: Cell): Cell {
  return at(a.q + b.q, a.r + b.r);
}

export function distance(a: Cell, b: Cell): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// A cell's ring is its hex distance from (0,0).
export function ring(cell: Cell): number {
  return distance(cell, at(0, 0));
}

export function neighbours(cell: Cell): Cell[] {
  return DIRECTIONS.map((d) => addCell(cell, d));
}

// Rotation about (0,0) by k × 60° clockwise on screen (k may be negative).
// Patterns are tested relative to an oscillator: rotate the offset, then
// add it to the oscillator's cell.
export function rotate(cell: Cell, k: number): Cell {
  const turns = ((k % 6) + 6) % 6;
  let { q, r } = cell;
  for (let i = 0; i < turns; i++) [q, r] = [-r, q + r];
  return at(q, r);
}

// The mirror image about the q axis: the drawing flipped top to bottom.
// With rotate, it reaches all twelve orientations of a pattern.
export function mirror(cell: Cell): Cell {
  return at(cell.q, -cell.q - cell.r);
}

// The cells at exactly distance n from (0,0), in a fixed clockwise order:
// start n steps along direction 4 (upper-left), then walk n steps along
// each direction in turn.
export function ringCells(n: number): Cell[] {
  if (n === 0) return [at(0, 0)];
  const cells: Cell[] = [];
  let cell = at(DIRECTIONS[4]!.q * n, DIRECTIONS[4]!.r * n);
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < n; step++) {
      cells.push(cell);
      cell = addCell(cell, DIRECTIONS[side]!);
    }
  }
  return cells;
}

// Every cell within the radius, ring by ring outward.
export function cellsWithin(radius: number): Cell[] {
  const cells: Cell[] = [];
  for (let n = 0; n <= radius; n++) cells.push(...ringCells(n));
  return cells;
}

// The lifetime board: 91 cells.
export function lifetimeCells(): Cell[] {
  return cellsWithin(LIFETIME_RADIUS);
}

// A flat-top cell's centre, for circumradius `size`.
export function toPixel(cell: Cell, size: number): Point {
  return { x: size * 1.5 * cell.q, y: size * Math.sqrt(3) * (cell.r + cell.q / 2) };
}

// A flat-top hex's six corners about its centre, starting at 0° (east).
export function corners(center: Point, size: number): Point[] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i;
    return { x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) };
  });
}

// Arrow keys on the drawn board. Up and down step along a column (q
// fixed). Flat-top cells have no neighbour straight left or right, so left
// and right zig-zag along a drawn row: from an even column east steps
// down-right and west down-left, from an odd column up-right and up-left,
// so a step left undoes a step right.
export type ScreenDirection = "up" | "down" | "left" | "right";

export function screenNeighbour(cell: Cell, direction: ScreenDirection): Cell {
  const odd = (cell.q & 1) === 1;
  switch (direction) {
    case "up": return addCell(cell, DIRECTIONS[5]!);
    case "down": return addCell(cell, DIRECTIONS[2]!);
    case "right": return addCell(cell, DIRECTIONS[odd ? 0 : 1]!);
    case "left": return addCell(cell, DIRECTIONS[odd ? 4 : 3]!);
  }
}
