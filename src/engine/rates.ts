import { cellKind } from "./board";
import { addCell, cellKey, DIRECTIONS, type Cell } from "./hex";
import { add, D, min, mul, pow, sub, type Num } from "./num";
import { baseRate, hasFacing, isOscillator, outputOf, patternOf, reachOf } from "./modules";
import { moduleAt } from "./placement";
import { instancesOf } from "./resonance";
import type { Board, BoardRates, ChargeDelivery, ModulatorRate, ModulatorType, OscillatorRate, Placement, ReachHolds } from "./types";

// The board's rates (spec chunk 02, issue #26; mechanics-sketch.md,
// Rates). One pure function of the layout and the credited Producer time
// (issue #32). `apply` calls it once after a layout or facing change and
// once when a flow session ends, the save reader once on load; `advance`
// only reads the result cached on the game state.

// 1 + R × (1 + 0.5 + 0.25 + …) over n terms, i.e. 1 + R × (2 − 2^(1−n)),
// and 1 for no instance.
export function resonanceFactor(strength: number, instances: number): Num {
  if (instances === 0) return D(1);
  return add(1, mul(strength, sub(2, pow(2, 1 - instances))));
}

// The charge factor (mechanics-sketch.md): 1 + ln(1 + charge/s received).
export function chargeFactor(received: Num): Num {
  return add(1, add(1, received).ln());
}

// A modulator's output in charge/s, from the lifetime Producer class
// credit (live credited seconds; manual log entries never add to it).
export function modulatorOutput(module: ModulatorType, producerSeconds: number): Num {
  const output = outputOf(module);
  const grown = add(output.base, mul(output.perProducerHour ?? 0, D(producerSeconds).div(3600)));
  return output.max === undefined ? grown : min(grown, output.max);
}

// The cells a placed modulator's reach covers, in reach order: each path
// turned by the facing (a faced reach) and walked from the modulator.
export function reachCells(placement: Placement): Cell[] {
  const reach = reachOf(placement.module);
  const turn = reach.faced ? (placement.facing ?? 0) : 0;
  return reach.paths.map((path) => path.reduce<Cell>((cell, step) => addCell(cell, DIRECTIONS[(step + turn) % 6]!), placement.cell));
}

function holdsAt(board: Board, cell: Cell): ReachHolds {
  const kind = cellKind(board, cell);
  if (kind !== "open") return kind;
  return moduleAt(board, cell)?.module ?? "empty";
}

// A board with no module placed.
export function noRates(): BoardRates {
  return { oscillators: [], modulators: [], total: D(0) };
}

export function computeBoardRates(board: Board, producerSeconds: number): BoardRates {
  // Every module in a reach receives the full output; only an oscillator
  // takes anything from it, and several deliveries sum before the log.
  const modulators: ModulatorRate[] = [];
  const received = new Map<string, Num>();
  for (const placement of board.placements) {
    const module = placement.module;
    if (isOscillator(module)) continue;
    const output = modulatorOutput(module, producerSeconds);
    const deliveries: ChargeDelivery[] = reachCells(placement).map((cell) => ({ cell, holds: holdsAt(board, cell) }));
    for (const delivery of deliveries) {
      if (delivery.holds === "empty" || delivery.holds === "wall" || delivery.holds === "dark" || !isOscillator(delivery.holds)) continue;
      const key = cellKey(delivery.cell);
      received.set(key, add(received.get(key) ?? 0, output));
    }
    modulators.push({
      cell: { q: placement.cell.q, r: placement.cell.r },
      module,
      facing: hasFacing(module) ? (placement.facing ?? 0) : null,
      output,
      deliveries,
    });
  }
  const oscillators: OscillatorRate[] = [];
  let total = D(0);
  for (const placement of board.placements) {
    const module = placement.module;
    if (!isOscillator(module)) continue;
    const strength = patternOf(module)?.strength ?? 0;
    const instances = instancesOf(board, placement);
    const base = D(baseRate(module));
    const resonance = resonanceFactor(strength, instances.length);
    const chargeReceived = received.get(cellKey(placement.cell)) ?? D(0);
    const charge = chargeFactor(chargeReceived);
    // Identity legs until chunks 06 (faders) and 05 (pressure).
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
      chargeReceived,
      charge,
      faders,
      pressure,
      rate,
    });
    total = add(total, rate);
  }
  return { oscillators, modulators, total };
}
