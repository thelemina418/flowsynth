import { cellKind } from "./board";
import { crosses, distance, sameCell, type Cell } from "./hex";
import { categoryOf } from "./modules";
import { cableFrom, locked, moduleAt } from "./placement";
import { grantsOf } from "./levels";
import type { Board, Cable, CableType, GameState } from "./types";

// Cables (spec chunk 03, issue #33). Patching, re-aiming and unplugging
// reach these through `apply` (engine/apply.ts). The rules live in
// `cableRefusal` alone: `apply` runs it before it changes anything and the
// board's cable outlines read it directly, so an outline can never
// disagree with what a click would do.

export type CableAction =
  | { type: "patchCable"; cable: CableType; source: Cell; target: Cell }
  // Re-aims the cable from `source` at a new target.
  | { type: "repatchCable"; source: Cell; target: Cell }
  // Returns the cable from `source` to the allowance.
  | { type: "unplugCable"; source: Cell };

export interface CableResult {
  ok: boolean;
  reason?: string;
}

// A cable's longest reach, in hex distance (mechanics-sketch.md).
const CABLE_LENGTH = 3;

const CABLE_NAMES: Record<CableType, string> = { patch: "Patch" };

export function cableName(type: CableType): string {
  return CABLE_NAMES[type];
}

export function isCableType(value: unknown): value is CableType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CABLE_NAMES, value);
}

// Why the jack on `source` can't take a new cable, or null when it can:
// it holds a modulator with no cable yet.
export function jackRefusal(board: Board, source: Cell): string | null {
  const placed = moduleAt(board, source);
  if (!placed || categoryOf(placed.module) !== "modulator") return "Only a modulator has a jack.";
  if (cableFrom(board, source)) return "That modulator is already patched.";
  return null;
}

// Why the cable can't run from its source to its target, crossings aside.
// An open cell or a wall inside the current arc is a target (issue #34).
function routeRefusal(board: Board, cable: Cable): string | null {
  if (cellKind(board, cable.target) === "dark") return "That cell is dark.";
  if (sameCell(cable.source, cable.target)) return "A cable can't end where it starts.";
  if (distance(cable.source, cable.target) > CABLE_LENGTH) return `That cable is longer than ${CABLE_LENGTH}.`;
  return null;
}

function crossingRefusal(cable: Cable, others: Cable[]): string | null {
  return others.some((other) => crosses(cable.source, cable.target, other.source, other.target)) ? "That cable would cross another." : null;
}

// Why a new cable can't join the board, whatever the mode: the rules a
// patch runs once the layout is unlocked, and the ones a saved cable is
// read by (engine/save.ts).
export interface CableRoom {
  board: Board;
  cableAllowance: number;
  arrivedCables: CableType[];
}

export function newCableRefusal(game: CableRoom, cable: Cable): string | null {
  const board = game.board;
  if (!game.arrivedCables.includes(cable.type)) return `${cableName(cable.type)} hasn't arrived yet.`;
  const jack = jackRefusal(board, cable.source);
  if (jack) return jack;
  const route = routeRefusal(board, cable);
  if (route) return route;
  if (board.cables.length >= game.cableAllowance) return "Cable allowance is full.";
  return crossingRefusal(cable, board.cables);
}

// The board with its derived cable allowance and cable types (issue #38).
export function cableRoom(state: GameState): CableRoom {
  const { cableAllowance, arrivedCables } = grantsOf(state);
  return { board: state.game.board, cableAllowance, arrivedCables };
}

// Why `apply` would refuse this cable action, or null when it would take
// it. Reads the state; never changes it.
export function cableRefusal(state: GameState, action: CableAction): string | null {
  const refused = locked(state);
  if (refused) return refused;
  const board = state.game.board;
  switch (action.type) {
    case "patchCable":
      return newCableRefusal(cableRoom(state), { type: action.cable, source: action.source, target: action.target });
    case "repatchCable": {
      const placed = cableFrom(board, action.source);
      if (!placed) return "No cable runs from that cell.";
      const cable: Cable = { ...placed, target: action.target };
      const others = board.cables.filter((other) => other !== placed);
      return routeRefusal(board, cable) ?? crossingRefusal(cable, others);
    }
    case "unplugCable":
      return cableFrom(board, action.source) ? null : "No cable runs from that cell.";
  }
}

// Applies a cable action to the draft state, once the rules allow it.
export function recable(state: GameState, action: CableAction): CableResult {
  const reason = cableRefusal(state, action);
  if (reason !== null) return { ok: false, reason };
  const board = state.game.board;
  switch (action.type) {
    case "patchCable":
      board.cables.push({ type: action.cable, source: { q: action.source.q, r: action.source.r }, target: { q: action.target.q, r: action.target.r } });
      break;
    case "repatchCable":
      cableFrom(board, action.source)!.target = { q: action.target.q, r: action.target.r };
      break;
    case "unplugCable": {
      const placed = cableFrom(board, action.source)!;
      board.cables = board.cables.filter((cable) => cable !== placed);
      break;
    }
  }
  return { ok: true };
}
