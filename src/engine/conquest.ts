import { cellKind } from "./board";
import { EPS } from "./constants";
import { cellKey, type Cell } from "./hex";
import { wallAt } from "./map";
import { div, gt, gte, lte, min, mul, requireNotNaN, sub, type Num } from "./num";
import { computeBoardRates } from "./rates";
import type { GameState } from "./types";

// Wall HP and conquest (spec chunk 05, issue #49). One pure wall step moves
// every wall through a span of time at the cached rates, closed-form: over
// the span each wall follows hp(t) = min(full, hp₀ − (damage − regen) × t).
// Only a wall below full HP regenerates, so an untouched wall stays full.
// Conquest splits the span: the step finds the earliest instant a wall
// reaches 0, lets `segment` pay everything time pays (ν, practice) up to
// it, moves every wall to it, conquers the walls that fall there together,
// recomputes the rates once, and goes on with the rest. Internal to the
// flow walk: callers pass time through `advance`.

interface Moving {
  cell: Cell;
  hp: Num;
  full: Num;
  // damage − regen; regen alone for a wall nothing fights.
  net: Num;
}

// Every wall the span can move: each wall below full, and each wall the
// rates say takes damage, while its cell is still a wall.
function movingWalls(state: GameState): Moving[] {
  const board = state.game.board;
  const byKey = new Map<string, Moving>();
  for (const entry of board.walls) {
    const wall = wallAt(entry.cell);
    if (!wall || cellKind(board, entry.cell) !== "wall") continue;
    byKey.set(cellKey(entry.cell), { cell: entry.cell, hp: entry.hp, full: wall.hp, net: sub(0, wall.regen) });
  }
  for (const rate of state.game.rates.walls) {
    const wall = wallAt(rate.cell);
    if (!wall || cellKind(board, rate.cell) !== "wall") continue;
    const key = cellKey(rate.cell);
    byKey.set(key, { cell: rate.cell, hp: byKey.get(key)?.hp ?? wall.hp, full: wall.hp, net: rate.net });
  }
  return [...byKey.values()];
}

// Seconds until the wall reaches 0, or null while it isn't losing HP.
function fallsIn(wall: Moving): number | null {
  return gt(wall.net, 0) ? div(wall.hp, wall.net).toNumber() : null;
}

// Two instants this close are the same instant: the closed form's own
// rounding never splits a tie or delays a conquest.
function sameInstant(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

export function stepWalls(state: GameState, seconds: number, segment: (seconds: number) => void): void {
  let remaining = seconds;
  for (let guard = 0; remaining > 0; guard++) {
    if (guard > 1000) throw new Error("the wall step did not settle");
    const walls = movingWalls(state);
    const instants = walls.map(fallsIn);
    const earliest = Math.min(...instants.map((t) => t ?? Infinity));
    const conquers = earliest < remaining || sameInstant(earliest, remaining);
    const span = conquers ? Math.max(0, Math.min(earliest, remaining)) : remaining;
    segment(span);
    const board = state.game.board;
    const kept: GameState["game"]["board"]["walls"] = [];
    const fallen: Cell[] = [];
    walls.forEach((wall, i) => {
      const t = instants[i];
      if (conquers && t !== null && t !== undefined && sameInstant(t, earliest)) {
        fallen.push(wall.cell);
        return;
      }
      const hp = requireNotNaN(min(wall.full, sub(wall.hp, mul(wall.net, span))), "a wall's HP");
      if (lte(hp, 0)) fallen.push(wall.cell);
      else if (!gte(hp, wall.full)) kept.push({ cell: { q: wall.cell.q, r: wall.cell.r }, hp });
    });
    // Walls the span didn't touch keep their entry (beyond the arc, say).
    const touched = new Set(walls.map((w) => cellKey(w.cell)));
    board.walls = [...board.walls.filter((w) => !touched.has(cellKey(w.cell))), ...kept];
    remaining = conquers ? remaining - span : 0;
    if (fallen.length === 0) continue;
    for (const cell of fallen) board.open.push({ q: cell.q, r: cell.r });
    state.game.rates = computeBoardRates(board, state.records.classCredit.producer);
  }
}
