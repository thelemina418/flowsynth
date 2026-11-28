import { cellKind } from "./board";
import { cellKey, sameCell, turnFacing, type Cell } from "./hex";
import { grantsOf } from "./levels";
import { categoryOf, categoryName, hasFacing, moduleName } from "./modules";
import type { Board, Cable, GameState, ModuleCategory, ModuleType, Placement } from "./types";

// Placing, moving, removing and turning modules (spec chunk 02, issue #25;
// rotation, chunk 03, issue #31). Callers
// reach these through `apply` (engine/apply.ts), the one placement path the
// tray, the board's drag and its click-to-pick all share. Every refusal
// leaves the state untouched and says why in player-facing copy.
//
// The rules live in `placementRefusal` alone. `apply` runs it before it
// changes anything, and the board's pick outlines read it directly, so an
// outline can never disagree with what a click would do, and holding a
// pick never recomputes the board's rates.

export type PlacementAction =
  | { type: "placeModule"; module: ModuleType; cell: Cell }
  | { type: "moveModule"; from: Cell; to: Cell }
  | { type: "removeModule"; cell: Cell }
  // Turns a placed module with a facing 60° (issue #31).
  | { type: "rotateModule"; cell: Cell; turn: Turn };

export type Turn = "clockwise" | "counterclockwise";

export interface PlacementResult {
  ok: boolean;
  reason?: string;
}

export function moduleAt(board: Board, cell: Cell): Placement | undefined {
  const key = cellKey(cell);
  return board.placements.find((placement) => cellKey(placement.cell) === key);
}

export function placedCount(board: Board, category: ModuleCategory): number {
  return board.placements.filter((placement) => categoryOf(placement.module) === category).length;
}

// The module allowance not yet on the board, per category: the tray's
// counts and the flow screen's Ready count read it.
export function unplacedOf(state: GameState): Record<ModuleCategory, number> {
  const allowance = grantsOf(state).allowance;
  const board = state.game.board;
  return {
    oscillator: Math.max(0, allowance.oscillator - placedCount(board, "oscillator")),
    modulator: Math.max(0, allowance.modulator - placedCount(board, "modulator")),
    arm: Math.max(0, allowance.arm - placedCount(board, "arm")),
  };
}

// The cable plugged into the jack on `source`, if any.
export function cableFrom(board: Board, source: Cell): Cable | undefined {
  return board.cables.find((cable) => sameCell(cable.source, source));
}

// The layout, cables included, is locked whenever time produces
// (ADR-0001): in flow, paused, and a breather (issue #41).
export function locked(state: GameState): string | null {
  return state.game.mode === "upgrade" ? null : "The board is locked while a session runs.";
}

// Only an owned open cell takes a module.
function unbuildable(board: Board, cell: Cell): string | null {
  const kind = cellKind(board, cell);
  if (kind === "wall") return "That cell is a wall.";
  if (kind === "dark") return "That cell is dark.";
  return null;
}

// Why the tray can't give out a module of this type right now, or null
// when it can: the layout is unlocked, the type has arrived, and its
// category has allowance left.
export function trayRefusal(state: GameState, module: ModuleType): string | null {
  const refused = locked(state);
  if (refused) return refused;
  const grants = grantsOf(state);
  if (!grants.arrived.includes(module)) return `${moduleName(module)} hasn't arrived yet.`;
  const category = categoryOf(module);
  if (placedCount(state.game.board, category) >= grants.allowance[category]) {
    return `${categoryName(category)} allowance is full.`;
  }
  return null;
}

// Why `apply` would refuse this placement action, or null when it would
// take it. Reads the state; never changes it.
export function placementRefusal(state: GameState, action: PlacementAction): string | null {
  const refused = locked(state);
  if (refused) return refused;
  const board = state.game.board;
  switch (action.type) {
    case "placeModule": {
      if (!grantsOf(state).arrived.includes(action.module)) return `${moduleName(action.module)} hasn't arrived yet.`;
      const blocked = unbuildable(board, action.cell);
      if (blocked) return blocked;
      if (moduleAt(board, action.cell)) return "That cell already holds a module.";
      return trayRefusal(state, action.module);
    }
    case "moveModule": {
      if (!moduleAt(board, action.from)) return "No module sits on that cell.";
      const blocked = unbuildable(board, action.to);
      if (blocked) return blocked;
      if (sameCell(action.from, action.to)) return "The module is already there.";
      return null;
    }
    case "removeModule":
      return moduleAt(board, action.cell) ? null : "No module sits on that cell.";
    case "rotateModule": {
      const placed = moduleAt(board, action.cell);
      if (!placed) return "No module sits on that cell.";
      return hasFacing(placed.module) ? null : `${moduleName(placed.module)} has no facing.`;
    }
  }
}

// The cable plugged into the jack on `cell`, if any, returns to the
// allowance.
function unplugFrom(board: Board, cell: Cell): void {
  const plugged = cableFrom(board, cell);
  if (plugged) board.cables = board.cables.filter((cable) => cable !== plugged);
}

// Applies a placement action to the draft state, once the rules allow it.
export function relayout(state: GameState, action: PlacementAction): PlacementResult {
  const reason = placementRefusal(state, action);
  if (reason !== null) return { ok: false, reason };
  const board = state.game.board;
  switch (action.type) {
    case "placeModule":
      // A new placement with a facing faces NE (issue #31).
      board.placements.push({ cell: { q: action.cell.q, r: action.cell.r }, module: action.module, ...(hasFacing(action.module) && { facing: 0 as const }) });
      break;
    case "moveModule": {
      // A move onto an occupied open cell swaps the two modules.
      // A patched modulator that moves, either way, unplugs its cable
      // back to the allowance (issue #33); a cable aimed at a cell stays
      // aimed at it.
      const moving = moduleAt(board, action.from)!;
      const other = moduleAt(board, action.to);
      unplugFrom(board, action.from);
      if (other) unplugFrom(board, action.to);
      if (other) other.cell = { q: action.from.q, r: action.from.r };
      moving.cell = { q: action.to.q, r: action.to.r };
      break;
    }
    case "removeModule": {
      const placed = moduleAt(board, action.cell)!;
      board.placements = board.placements.filter((placement) => placement !== placed);
      unplugFrom(board, action.cell);
      break;
    }
    case "rotateModule": {
      const placed = moduleAt(board, action.cell)!;
      placed.facing = turnFacing(placed.facing ?? 0, action.turn === "clockwise" ? 1 : -1);
      break;
    }
  }
  return { ok: true };
}
