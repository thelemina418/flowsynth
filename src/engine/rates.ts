import { cellKind } from "./board";
import { addCell, cellKey, DIRECTIONS, neighbours, type Cell } from "./hex";
import { add, D, div, ln, min, mul, pow, sub, type Num } from "./num";
import { baseRate, breatherBaseRate, hasFacing, isOscillator, outputOf, patternOf, reachOf, takesCharge } from "./modules";
import { wallAt } from "./map";
import { cableFrom, moduleAt } from "./placement";
import { instancesOf } from "./resonance";
import type { Board, BoardRates, ChargeDelivery, ModulatorRate, ModulatorType, OscillatorRate, Placement, ReachHolds, WallRate } from "./types";

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
function chargeFactor(received: Num): Num {
  return add(1, ln(add(1, received)));
}

// A modulator's output in charge/s, from the lifetime Producer class
// credit (live credited seconds; manual log entries never add to it).
function modulatorOutput(module: ModulatorType, producerSeconds: number): Num {
  const output = outputOf(module);
  const grown = add(output.base, mul(output.perProducerHour ?? 0, div(producerSeconds, 3600)));
  return output.max === undefined ? grown : min(grown, output.max);
}

// The cells a placed modulator's reach covers, in reach order: each path
// turned by the facing (a faced reach) and walked from the modulator.
function reachCells(placement: Placement): Cell[] {
  const reach = reachOf(placement.module);
  const turn = reach.faced ? (placement.facing ?? 0) : 0;
  return reach.paths.map((path) => path.reduce<Cell>((cell, step) => addCell(cell, DIRECTIONS[(step + turn) % 6]!), placement.cell));
}

function holdsAt(board: Board, cell: Cell): ReachHolds {
  const kind = cellKind(board, cell);
  if (kind !== "open") return kind;
  return moduleAt(board, cell)?.module ?? "empty";
}

// The pressure cap (mechanics-sketch.md, Rates): a crowded corner hurts
// but never shuts an oscillator off.
const PRESSURE_CAP = 0.6;

// The pressure one wall exerts on each module bordering it, doubled for
// `Pressure ×2` (issue #52). Shared with the Hex detail's wall line.
export function wallPressure(cell: Cell): number {
  const wall = wallAt(cell)!;
  return wall.pressure * (wall.modifier === "pressureDouble" ? 2 : 1);
}

// The pressure on a cell: the sum over its bordering walls inside the
// arc, capped. A pure derivation from the board's cell kinds, so a dark
// cell presses on nothing and a conquered (open) cell stops pressing at
// once (issue #52).
function pressureOn(board: Board, cell: Cell): Num {
  let sum = 0;
  for (const n of neighbours(cell)) if (cellKind(board, n) === "wall") sum += wallPressure(n);
  return D(Math.min(sum, PRESSURE_CAP));
}

// A board with no module placed.
export function noRates(): BoardRates {
  return { oscillators: [], modulators: [], walls: [], total: D(0), breatherTotal: D(0) };
}

export function computeBoardRates(board: Board, producerSeconds: number): BoardRates {
  // Every module in a reach (or at a Patch's target) receives the full output; only an oscillator
  // takes anything from it, and several deliveries sum before the log.
  const modulators: ModulatorRate[] = [];
  const received = new Map<string, Num>();
  // Damage per wall cell, from Patches only (issue #34): reach onto a wall
  // does nothing.
  const damage = new Map<string, { cell: Cell; damage: Num }>();
  for (const placement of board.placements) {
    const module = placement.module;
    if (isOscillator(module)) continue;
    const output = modulatorOutput(module, producerSeconds);
    // A patched modulator delivers to its cable's target alone, in place
    // of its reach (issue #33).
    const cable = cableFrom(board, placement.cell);
    const cells = cable ? [{ q: cable.target.q, r: cable.target.r }] : reachCells(placement);
    const deliveries: ChargeDelivery[] = cells.map((cell) => ({ cell, holds: holdsAt(board, cell) }));
    if (cable && deliveries[0]!.holds === "wall") {
      const key = cellKey(cable.target);
      const wall = damage.get(key) ?? { cell: { q: cable.target.q, r: cable.target.r }, damage: D(0) };
      damage.set(key, { ...wall, damage: add(wall.damage, output) });
    }
    for (const delivery of deliveries) {
      if (!takesCharge(delivery.holds)) continue;
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
  let breatherSum = D(0);
  for (const placement of board.placements) {
    const module = placement.module;
    if (!isOscillator(module)) continue;
    const strength = patternOf(module)?.strength ?? 0;
    const instances = instancesOf(board, placement);
    const base = D(baseRate(module));
    const resonance = resonanceFactor(strength, instances.length);
    const chargeReceived = received.get(cellKey(placement.cell)) ?? D(0);
    const charge = chargeFactor(chargeReceived);
    // Faders are an identity leg until chunk 06. Pressure (issue #52)
    // reduces ν only: modulator output and wall damage ignore it.
    const faders = D(1);
    const pressure = pressureOn(board, placement.cell);
    const product = (b: Num): Num => mul(mul(mul(mul(b, resonance), charge), faders), sub(1, pressure));
    const rate = product(base);
    // The same product on the breather base (issue #41).
    const breatherRate = product(D(breatherBaseRate(module)));
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
      breatherRate,
    });
    total = add(total, rate);
    breatherSum = add(breatherSum, breatherRate);
  }
  const walls: WallRate[] = [...damage.values()].map(({ cell, damage }) => {
    const regen = wallAt(cell)!.regen;
    return { cell, damage, regen, net: sub(damage, regen) };
  });
  // The board runs ×2 in a breather (issue #41).
  return { oscillators, modulators, walls, total, breatherTotal: mul(2, breatherSum) };
}
