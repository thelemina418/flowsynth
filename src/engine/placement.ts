import { cellKind } from "./board";
import { cellKey, sameCell, type Cell } from "./hex";
import { categoryOf, categoryName, moduleName } from "./modules";
import type { Board, GameState, ModuleCategory, ModuleType, Placement } from "./types";

// Placing, moving and removing modules (spec chunk 02, issue #25). Callers
// reach these through `apply` (engine/apply.ts), the one placement path the
// tray, the board's drag and its click-to-pick all share. Every refusal
// leaves the state untouched and says why in player-facing copy.

export interface PlacementResult {
  ok: boolean;
  reason?: string;
}

const ok: PlacementResult = { ok: true };

function fail(reason: string): PlacementResult {
  return { ok: false, reason };
}

export function moduleAt(board: Board, cell: Cell): Placement | undefined {
  const key = cellKey(cell);
  return board.placements.find((placement) => cellKey(placement.cell) === key);
}

export function placedCount(board: Board, category: ModuleCategory): number {
  return board.placements.filter((placement) => categoryOf(placement.module) === category).length;
}

// The layout is locked whenever time produces (ADR-0001): in flow, paused,
// and the breather once chunk 04 adds it.
function locked(state: GameState): PlacementResult | null {
  return state.game.mode === "upgrade" ? null : fail("The board is locked while a session runs.");
}

// Only an owned open cell takes a module.
function unbuildable(board: Board, cell: Cell): PlacementResult | null {
  const kind = cellKind(board, cell);
  if (kind === "wall") return fail("That cell is a wall.");
  if (kind === "dark") return fail("That cell is dark.");
  return null;
}

export function placeModule(state: GameState, module: ModuleType, cell: Cell): PlacementResult {
  const refused = locked(state);
  if (refused) return refused;
  const board = state.game.board;
  if (!state.game.arrived.includes(module)) return fail(`${moduleName(module)} hasn't arrived yet.`);
  const blocked = unbuildable(board, cell);
  if (blocked) return blocked;
  if (moduleAt(board, cell)) return fail("That cell already holds a module.");
  const category = categoryOf(module);
  if (placedCount(board, category) >= state.game.allowance[category]) {
    return fail(`${categoryName(category)} allowance is full.`);
  }
  board.placements.push({ cell: { q: cell.q, r: cell.r }, module });
  return ok;
}

// A move onto an occupied open cell swaps the two modules.
export function moveModule(state: GameState, from: Cell, to: Cell): PlacementResult {
  const refused = locked(state);
  if (refused) return refused;
  const board = state.game.board;
  const moving = moduleAt(board, from);
  if (!moving) return fail("No module sits on that cell.");
  const blocked = unbuildable(board, to);
  if (blocked) return blocked;
  if (sameCell(from, to)) return fail("The module is already there.");
  const other = moduleAt(board, to);
  if (other) other.cell = { q: from.q, r: from.r };
  moving.cell = { q: to.q, r: to.r };
  return ok;
}

export function removeModule(state: GameState, cell: Cell): PlacementResult {
  const refused = locked(state);
  if (refused) return refused;
  const board = state.game.board;
  const placed = moduleAt(board, cell);
  if (!placed) return fail("No module sits on that cell.");
  board.placements = board.placements.filter((placement) => placement !== placed);
  return ok;
}
