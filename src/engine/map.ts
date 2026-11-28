import { cellKey, type Cell } from "./hex";
import { D, type Num } from "./num";
import type { HabitClass } from "./types";

// The authored map (spec chunk 05, issue #48): the lifetime board's 91
// cells as data. The four opening cells (board.ts) hold no wall; each of
// the other 87 has an authored wall: its kind, its modifier if it has one,
// and its class mark (the class it opens) if it has one. Which wall stands
// on a cell is fixed by position, so it is looked up here, never stored:
// the board stores only what the player owns, and a cell's kind (open,
// wall or dark) is derived from that and the arc (board.ts).

// The nine wall kinds, weakest first (mechanics-sketch.md, Walls).
export type WallKind = "shale" | "basalt" | "flint" | "schist" | "gneiss" | "obsidian" | "granite" | "quartz" | "corundum";

interface WallKindStats {
  name: string;
  hp: string;
  // Regen per second.
  regen: string;
  // The pressure the wall exerts on each bordering module, as a fraction.
  pressure: number;
}

// HP, regen and pressure per kind, the one place the pace runner's tuning
// lands (mechanics-sketch.md, Walls).
const KINDS: Record<WallKind, WallKindStats> = {
  shale: { name: "Shale", hp: "600", regen: "0.1", pressure: 0.05 },
  basalt: { name: "Basalt", hp: "6e3", regen: "1", pressure: 0.08 },
  flint: { name: "Flint", hp: "6e4", regen: "10", pressure: 0.1 },
  schist: { name: "Schist", hp: "1e6", regen: "100", pressure: 0.12 },
  gneiss: { name: "Gneiss", hp: "3e7", regen: "2e3", pressure: 0.15 },
  obsidian: { name: "Obsidian", hp: "1e9", regen: "5e4", pressure: 0.2 },
  granite: { name: "Granite", hp: "1e11", regen: "3e6", pressure: 0.25 },
  quartz: { name: "Quartz", hp: "1e13", regen: "2e8", pressure: 0.3 },
  corundum: { name: "Corundum", hp: "1e16", regen: "1e11", pressure: 0.4 },
};

// A modifier (GLOSSARY: Modifier): a wall's authored rule that changes how
// it is fought. `pressureDouble`: the wall's pressure counts twice.
// `armOnly`: only Blades damage it, and a Patch into it is refused.
export type Modifier = "pressureDouble" | "armOnly";

const MODIFIER_NAMES: Record<Modifier, string> = {
  pressureDouble: "Pressure ×2",
  armOnly: "Only Arm damage",
};

export function modifierName(modifier: Modifier): string {
  return MODIFIER_NAMES[modifier];
}

export interface AuthoredWall {
  kind: WallKind;
  // The kind's name (GLOSSARY: Wall).
  name: string;
  // Full HP.
  hp: Num;
  regen: Num;
  pressure: number;
  modifier: Modifier | null;
  // The class this wall opens, shown as its mark.
  opens: HabitClass | null;
}

type Entry = [WallKind, Modifier | null, HabitClass | null];

// Every wall, ring by ring, each ring clockwise from its upper-left cell.
// Rings 1–2 are Sketch's, as agreed with the maintainer; rings 3–5 are the
// builder's layout (docs/build-log.md, chunk 05).
const MAP: Record<string, Entry> = {
  // Ring 1. (1,-1), (1,0) and (0,1) are opening cells.
  "-1,0": ["basalt", "pressureDouble", null],
  "0,-1": ["basalt", null, null],
  "-1,1": ["shale", null, null],
  // Ring 2.
  "-2,0": ["schist", null, null],
  "-1,-1": ["flint", null, null],
  "0,-2": ["flint", "armOnly", "roadie"],
  "1,-2": ["schist", null, null],
  "2,-2": ["flint", null, null],
  "2,-1": ["schist", null, null],
  "2,0": ["flint", null, null],
  "1,1": ["schist", null, null],
  "0,2": ["flint", null, null],
  "-1,2": ["schist", null, null],
  "-2,2": ["flint", null, null],
  "-2,1": ["schist", null, "mixer"],
  // Ring 3.
  "-3,0": ["obsidian", null, null],
  "-2,-1": ["gneiss", null, null],
  "-1,-2": ["gneiss", null, null],
  "0,-3": ["obsidian", null, null],
  "1,-3": ["gneiss", "pressureDouble", null],
  "2,-3": ["gneiss", null, null],
  "3,-3": ["obsidian", null, null],
  "3,-2": ["gneiss", null, null],
  "3,-1": ["gneiss", null, null],
  "3,0": ["obsidian", "armOnly", null],
  "2,1": ["gneiss", null, null],
  "1,2": ["gneiss", null, null],
  "0,3": ["obsidian", null, null],
  "-1,3": ["gneiss", null, null],
  "-2,3": ["gneiss", "pressureDouble", null],
  "-3,3": ["obsidian", null, null],
  "-3,2": ["gneiss", null, null],
  "-3,1": ["gneiss", null, null],
  // Ring 4.
  "-4,0": ["corundum", null, null],
  "-3,-1": ["granite", null, null],
  "-2,-2": ["quartz", "armOnly", null],
  "-1,-3": ["granite", null, null],
  "0,-4": ["corundum", null, null],
  "1,-4": ["granite", null, null],
  "2,-4": ["quartz", null, null],
  "3,-4": ["granite", "pressureDouble", null],
  "4,-4": ["corundum", null, null],
  "4,-3": ["granite", null, null],
  "4,-2": ["quartz", null, null],
  "4,-1": ["granite", null, null],
  "4,0": ["corundum", null, null],
  "3,1": ["granite", "pressureDouble", null],
  "2,2": ["quartz", null, null],
  "1,3": ["granite", null, null],
  "0,4": ["corundum", null, null],
  "-1,4": ["granite", null, null],
  "-2,4": ["quartz", "armOnly", null],
  "-3,4": ["granite", null, null],
  "-4,4": ["corundum", null, null],
  "-4,3": ["granite", null, null],
  "-4,2": ["quartz", null, null],
  "-4,1": ["granite", null, null],
  // Ring 5.
  "-5,0": ["corundum", null, null],
  "-4,-1": ["corundum", null, null],
  "-3,-2": ["corundum", null, null],
  "-2,-3": ["corundum", "pressureDouble", null],
  "-1,-4": ["corundum", null, null],
  "0,-5": ["corundum", null, null],
  "1,-5": ["corundum", null, null],
  "2,-5": ["corundum", null, null],
  "3,-5": ["corundum", null, null],
  "4,-5": ["corundum", null, null],
  "5,-5": ["corundum", null, null],
  "5,-4": ["corundum", "armOnly", null],
  "5,-3": ["corundum", null, null],
  "5,-2": ["corundum", null, null],
  "5,-1": ["corundum", null, null],
  "5,0": ["corundum", null, null],
  "4,1": ["corundum", null, null],
  "3,2": ["corundum", null, null],
  "2,3": ["corundum", "pressureDouble", null],
  "1,4": ["corundum", null, null],
  "0,5": ["corundum", null, null],
  "-1,5": ["corundum", null, null],
  "-2,5": ["corundum", null, null],
  "-3,5": ["corundum", null, null],
  "-4,5": ["corundum", null, null],
  "-5,5": ["corundum", null, null],
  "-5,4": ["corundum", "armOnly", null],
  "-5,3": ["corundum", null, null],
  "-5,2": ["corundum", null, null],
  "-5,1": ["corundum", null, null],
};

// Shale's cell, the first wall the Goal names (issue #42).
export const SHALE_CELL: Cell = { q: -1, r: 1 };

// The wall authored at a cell, or null at an opening cell or beyond the
// lifetime board. A conquered wall's cell still answers with its wall:
// whether a cell is a wall now is the board's derived kind.
export function wallAt(cell: Cell): AuthoredWall | null {
  const entry = MAP[cellKey(cell)];
  if (!entry) return null;
  const [kind, modifier, opens] = entry;
  const stats = KINDS[kind];
  return { kind, name: stats.name, hp: D(stats.hp), regen: D(stats.regen), pressure: stats.pressure, modifier, opens };
}
