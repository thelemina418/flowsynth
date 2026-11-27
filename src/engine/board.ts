import { hexKey, lifetimeCells, ring, type Hex } from "./hex";
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
export const OPENING_CELLS: readonly Hex[] = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: 1, r: -1 },
];

export function openingBoard(): Board {
  return { open: OPENING_CELLS.map((cell) => ({ q: cell.q, r: cell.r })), arc: "sketch" };
}

export function isOpen(board: Board, cell: Hex): boolean {
  const key = hexKey(cell);
  return board.open.some((owned) => hexKey(owned) === key);
}

export function cellKind(board: Board, cell: Hex): CellKind {
  if (isOpen(board, cell)) return "open";
  return ring(cell) > arcRadius(board.arc) ? "dark" : "wall";
}

// The lifetime board, ring by ring outward, each cell with its kind.
export function boardCells(board: Board): { cell: Hex; kind: CellKind }[] {
  return lifetimeCells().map((cell) => ({ cell, kind: cellKind(board, cell) }));
}
