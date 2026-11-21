import { CATEGORY_OF, CHARGE_RECEIVING_CATEGORIES } from "./constants";
import { adjacent, sameHex } from "./hex";
import type { GameState, Hex, ModuleInstance } from "./types";

const chargeSource = (module: ModuleInstance): boolean =>
  CATEGORY_OF[module.type] === "generator" || CATEGORY_OF[module.type] === "conduit";
const chargeReceiver = (module: ModuleInstance): boolean =>
  CHARGE_RECEIVING_CATEGORIES.includes(CATEGORY_OF[module.type]);

// The runner and its route probes share this structural seat rule. A
// resting generator is still a charge source: reserves affect the strength
// tiebreak, not the existence of the line. This is a placement policy,
// never a substitute for the economy's actual received-charge calculation.
export function chargeLineCells(state: GameState): Hex[] {
  const placed = state.modules.filter((module) => module.pos !== null);
  const sources = placed.filter(chargeSource);
  return placed.filter((module) =>
    chargeReceiver(module) && sources.some((source) => adjacent(module.pos!, source.pos!)))
    .map((module) => module.pos!);
}

// A compact rack can route every receiver over enemy-reserved seats. A
// single ordinary Module move can make one useful line without buying more
// footprint. Prefer a deployed generator so a full rack swaps rather than
// evicts a voice; a bare conduit alone would not supply this new line.
export function starterChargeLineMove(
  state: GameState,
  availableSeats: readonly Hex[],
): { id: string; pos: Hex } | undefined {
  if (chargeLineCells(state).some(line => availableSeats.some(seat => sameHex(line, seat)))) return;
  const generators = state.modules.filter(module => CATEGORY_OF[module.type] === "generator");
  const generator = generators.find(module => module.pos !== null) ?? generators[0];
  if (!generator) return;
  const receivers = state.modules.flatMap(module => module.pos && chargeReceiver(module) ? [module.pos] : []);
  for (const seat of availableSeats) {
    if (!receivers.some(pos => sameHex(pos, seat))) continue;
    const pos = state.cells.find(cell => adjacent(cell, seat));
    if (pos) return { id: generator.id, pos };
  }
}
