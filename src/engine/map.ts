import { cellKey, type Cell } from "./hex";
import type { HabitClass } from "./types";

// The authored map (issue #24 placeholder; chunk 05 authors the rest).
// Which wall stands on a cell is fixed by position, so it is looked up
// here, never stored: the board stores only what the player owns.
// Shale borders (0,0) and (0,1); Flint opens Roadie (mechanics-sketch.md).
// Every other wall is a nameless placeholder until chunk 05, which also
// brings HP, regen and pressure.

export interface AuthoredWall {
  // The wall's kind name (GLOSSARY: Wall), or null for a placeholder.
  name: string | null;
  // The class this wall opens when first touched, shown as its mark.
  opens: HabitClass | null;
}

const AUTHORED: Record<string, AuthoredWall> = {
  [cellKey({ q: -1, r: 1 })]: { name: "Shale", opens: null },
  [cellKey({ q: 2, r: -1 })]: { name: "Flint", opens: "roadie" },
};

const PLACEHOLDER: AuthoredWall = { name: null, opens: null };

// The wall authored at a cell. Only meaningful where the board's derived
// kind is `wall`.
export function wallAt(cell: Cell): AuthoredWall {
  const wall = AUTHORED[cellKey(cell)] ?? PLACEHOLDER;
  return { ...wall };
}
