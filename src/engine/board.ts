import { cellKey, lifetimeCells, ring, type Cell } from "./hex";
import { wallOf } from "./map";
import type { Num } from "./num";
import type { Arc, Board } from "./types";

// The board (spec chunk 02, issue #24): the cells the player owns and the
// current arc. A cell's kind is derived from them, never stored:
// - `open`: owned (empty or holding one module, from issue #25);
// - `dark`: not owned and beyond the current arc's radius;
// - `wall`: every other cell. Which wall it is comes from map.ts.

export type CellKind = "open" | "wall" | "dark";

// Each arc's max radius (progression-map.md, Horizon).
const ARC_RADIUS: Record<Arc, number> = { sketch: 2, demo: 3, record: 4, master: 5, encore: 5 };

export const ARCS = Object.keys(ARC_RADIUS) as readonly Arc[];

export function arcRadius(arc: Arc): number {
  return ARC_RADIUS[arc];
}

// The opening (mechanics-sketch.md, Board): four open cells, in Sketch.
export const OPENING_CELLS: readonly Cell[] = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: 1, r: -1 },
];

export function openingBoard(): Board {
  return { open: OPENING_CELLS.map((cell) => ({ q: cell.q, r: cell.r })), arc: "sketch", placements: [], cables: [], walls: [] };
}

export function isOpen(board: Board, cell: Cell): boolean {
  const key = cellKey(cell);
  return board.open.some((owned) => cellKey(owned) === key);
}

export function cellKind(board: Board, cell: Cell): CellKind {
  if (isOpen(board, cell)) return "open";
  return ring(cell) > arcRadius(board.arc) ? "dark" : "wall";
}

// A wall's current HP: its board entry while below full, else its full HP
// (issue #49). The one reader of `board.walls` for a wall's HP.
export function wallHp(board: Board, cell: Cell): Num {
  const key = cellKey(cell);
  return board.walls.find((w) => cellKey(w.cell) === key)?.hp ?? wallOf(cell).hp;
}

// The lifetime board, ring by ring outward, each cell with its kind.
export function boardCells(board: Board): { cell: Cell; kind: CellKind }[] {
  return lifetimeCells().map((cell) => ({ cell, kind: cellKind(board, cell) }));
}
