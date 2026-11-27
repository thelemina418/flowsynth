import { add, D, mul, pow, sub, type Num } from "./num";
import { baseRate, isOscillator, patternOf } from "./modules";
import { instancesOf } from "./resonance";
import type { Board, BoardRates, OscillatorRate } from "./types";

// The board's rates (spec chunk 02, issue #26; mechanics-sketch.md,
// Rates). One pure function of the layout. `apply` calls it once after a
// layout change and the save reader once on load; `advance` only reads the
// result cached on the game state.

// 1 + R × (1 + 0.5 + 0.25 + …) over n terms, i.e. 1 + R × (2 − 2^(1−n)),
// and 1 for no instance.
export function resonanceFactor(strength: number, instances: number): Num {
  if (instances === 0) return D(1);
  return add(1, mul(strength, sub(2, pow(2, 1 - instances))));
}

// A board with no oscillator placed.
export function noRates(): BoardRates {
  return { oscillators: [], total: D(0) };
}

export function computeBoardRates(board: Board): BoardRates {
  const oscillators: OscillatorRate[] = [];
  let total = D(0);
  for (const placement of board.placements) {
    const module = placement.module;
    if (!isOscillator(module)) continue;
    const strength = patternOf(module)?.strength ?? 0;
    const instances = instancesOf(board, placement);
    const base = D(baseRate(module));
    const resonance = resonanceFactor(strength, instances.length);
    // Identity legs until chunks 03 (charge), 06 (faders) and 05 (pressure).
    const charge = D(1);
    const faders = D(1);
    const pressure = D(0);
    const rate = mul(mul(mul(mul(base, resonance), charge), faders), sub(1, pressure));
    oscillators.push({
      cell: { q: placement.cell.q, r: placement.cell.r },
      module,
      base,
      strength: D(strength),
      instances,
      resonance,
      charge,
      faders,
      pressure,
      rate,
    });
    total = add(total, rate);
  }
  return { oscillators, total };
}
