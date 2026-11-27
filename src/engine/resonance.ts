import { add, DIRECTIONS, hexKey, mirror, rotate, sameHex, type Hex } from "./hex";
import { categoryOf, patternOf, type PartnerRule, type Pattern } from "./modules";
import { moduleAt } from "./placement";
import type { Board, Placement, ResonanceInstance } from "./types";

// The resonance matcher (spec chunk 02, issue #26). A pattern is data
// relative to its oscillator (engine/modules.ts); this module turns it,
// mirrors it, and finds the distinct sets of partner cells that satisfy it.

// The one adjacency question: the cell next to `cell` in `direction`.
// Every pattern step goes through it, so chunk 08's Sync cables, which
// make two oscillators count as adjacent, extend it here without touching
// the matcher.
export function adjacent(_board: Board, cell: Hex, direction: number): Hex {
  return add(cell, DIRECTIONS[direction]!);
}

function directionIndex(vector: Hex): number {
  return DIRECTIONS.findIndex((d) => sameHex(d, vector));
}

// The direction maps of a pattern's orientations: 6 rotations, and their
// mirror images unless the pattern opts out.
function orientations(pattern: Pattern): number[][] {
  const maps: number[][] = [];
  for (const mirrored of pattern.mirrored === false ? [false] : [false, true]) {
    for (let k = 0; k < 6; k++) {
      maps.push(DIRECTIONS.map((d) => directionIndex(rotate(mirrored ? mirror(d) : d, k))));
    }
  }
  return maps;
}

function admits(rule: PartnerRule, placement: Placement): boolean {
  if (rule.kind === "any") return true;
  if (rule.kind === "type") return placement.module === rule.module;
  return categoryOf(placement.module) === rule.category;
}

// The satisfied instances of the pattern of the oscillator `origin`. Two
// orientations that land on the same partner cells are one instance.
export function instancesOf(board: Board, origin: Placement): ResonanceInstance[] {
  const pattern = patternOf(origin.module);
  if (!pattern) return [];
  const need = pattern.atLeast ?? pattern.paths.length;
  const found = new Map<string, ResonanceInstance>();
  for (const turn of orientations(pattern)) {
    const partners: Placement[] = [];
    for (const path of pattern.paths) {
      const cell = path.reduce((at, step) => adjacent(board, at, turn[step]!), origin.cell);
      const held = moduleAt(board, cell);
      if (held && !sameHex(held.cell, origin.cell) && admits(pattern.partner, held)) partners.push(held);
    }
    if (partners.length < need) continue;
    const key = partners.map((p) => hexKey(p.cell)).sort().join(" ");
    if (!found.has(key)) found.set(key, { partners: partners.map((p) => ({ cell: { q: p.cell.q, r: p.cell.r }, module: p.module })) });
  }
  return [...found.values()];
}
