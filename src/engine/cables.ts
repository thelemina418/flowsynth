import { cellKind } from "./board";
import { distance, sameCell, type Cell } from "./hex";
import { categoryOf } from "./modules";
import { moduleAt } from "./placement";
import type { Board, Cable, CableType, Game, GameState } from "./types";

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
export const CABLE_LENGTH = 3;

const CABLE_NAMES: Record<CableType, string> = { patch: "Patch" };

export function cableName(type: CableType): string {
  return CABLE_NAMES[type];
}

export function isCableType(value: unknown): value is CableType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CABLE_NAMES, value);
}

// The cable plugged into the jack on `source`, if any.
export function cableFrom(board: Board, source: Cell): Cable | undefined {
  return board.cables.find((cable) => sameCell(cable.source, source));
}

// Twice the signed area of the triangle a, b, c. Crossing is an affine
// property, and axial (q, r) is an affine image of the flat-top pixel
// layout, so the test runs on the integer cells exactly.
function orient(a: Cell, b: Cell, c: Cell): number {
  return (b.q - a.q) * (c.r - a.r) - (b.r - a.r) * (c.q - a.q);
}

// c lies on segment ab, given the three are collinear.
function within(a: Cell, b: Cell, c: Cell): boolean {
  return Math.min(a.q, b.q) <= c.q && c.q <= Math.max(a.q, b.q) && Math.min(a.r, b.r) <= c.r && c.r <= Math.max(a.r, b.r);
}

function meet(a: Cell, b: Cell, c: Cell, d: Cell): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && within(c, d, a)) || (d2 === 0 && within(c, d, b)) || (d3 === 0 && within(a, b, c)) || (d4 === 0 && within(a, b, d));
}

// Two cables cross when their straight segments between cell centres meet
// anywhere but an endpoint they share. Collinear overlap counts, and so
// does running through the other's endpoint; meeting only at a shared
// source or target doesn't.
export function crosses(one: Cable, other: Cable): boolean {
  const ends: [Cell, Cell][] = [
    [one.source, one.target],
    [one.target, one.source],
  ];
  for (const [shared, far] of ends) {
    for (const [otherShared, otherFar] of [
      [other.source, other.target],
      [other.target, other.source],
    ] as [Cell, Cell][]) {
      if (!sameCell(shared, otherShared)) continue;
      // From a shared endpoint the two meet again only when they run the
      // same way along one line.
      if (orient(shared, far, otherFar) !== 0) return false;
      const along = (far.q - shared.q) * (otherFar.q - shared.q) + (far.r - shared.r) * (otherFar.r - shared.r);
      return along > 0;
    }
  }
  return meet(one.source, one.target, other.source, other.target);
}

function locked(state: GameState): string | null {
  return state.game.mode === "upgrade" ? null : "The board is locked while a session runs.";
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
function routeRefusal(board: Board, cable: Cable): string | null {
  const kind = cellKind(board, cable.target);
  if (kind === "dark") return "That cell is dark.";
  if (kind === "wall") return "That cell is a wall.";
  if (sameCell(cable.source, cable.target)) return "A cable can't end where it starts.";
  if (distance(cable.source, cable.target) > CABLE_LENGTH) return `That cable is longer than ${CABLE_LENGTH}.`;
  return null;
}

function crossingRefusal(cable: Cable, others: Cable[]): string | null {
  return others.some((other) => crosses(cable, other)) ? "That cable would cross another." : null;
}

// Why a new cable can't join the board, whatever the mode: the rules a
// patch runs once the layout is unlocked, and the ones a saved cable is
// read by (engine/save.ts).
export function newCableRefusal(game: Pick<Game, "board" | "cableAllowance" | "arrivedCables">, cable: Cable): string | null {
  const board = game.board;
  if (!game.arrivedCables.includes(cable.type)) return `${cableName(cable.type)} hasn't arrived yet.`;
  const jack = jackRefusal(board, cable.source);
  if (jack) return jack;
  const route = routeRefusal(board, cable);
  if (route) return route;
  if (board.cables.length >= game.cableAllowance) return "Cable allowance is full.";
  return crossingRefusal(cable, board.cables);
}

// Why `apply` would refuse this cable action, or null when it would take
// it. Reads the state; never changes it.
export function cableRefusal(state: GameState, action: CableAction): string | null {
  const refused = locked(state);
  if (refused) return refused;
  const board = state.game.board;
  switch (action.type) {
    case "patchCable":
      return newCableRefusal(state.game, { type: action.cable, source: action.source, target: action.target });
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
