import { cellKind, wallHp } from "./board";
import type { Cell } from "./hex";
import { authoredIndex, wallOf } from "./map";
import { cmp, div, gt, type Num } from "./num";
import type { Board, BoardRates } from "./types";

// The wall being fought (spec chunk 05, issue #50): among walls whose net
// damage is above 0, the one that falls soonest (HP ÷ net). If none is
// winning, the wall taking the most damage. If no wall takes damage, none.
// Ties go to authored order. The flow screen's HP row and the summary's HP
// segment both read it; it is derived, never stored.
export interface FoughtWall {
  cell: Cell;
  name: string;
  hp: Num;
  full: Num;
}

export function foughtWall(board: Board, rates: BoardRates): FoughtWall | null {
  const candidates = rates.walls
    .filter((rate) => gt(rate.damage, 0) && cellKind(board, rate.cell) === "wall")
    .map((rate) => ({ rate, hp: wallHp(board, rate.cell), order: authoredIndex(rate.cell) }));
  if (candidates.length === 0) return null;
  const winning = candidates.filter((c) => gt(c.rate.net, 0));
  const ranked = winning.length > 0
    ? winning.sort((a, b) => cmp(div(a.hp, a.rate.net), div(b.hp, b.rate.net)) || a.order - b.order)
    : candidates.sort((a, b) => cmp(b.rate.damage, a.rate.damage) || a.order - b.order);
  const best = ranked[0]!;
  return { cell: { q: best.rate.cell.q, r: best.rate.cell.r }, name: wallOf(best.rate.cell).name, hp: best.hp, full: best.rate.full };
}
