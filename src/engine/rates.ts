import { cellKind } from "./board";
import { addCell, cellKey, DIRECTIONS, neighbours, sameCell, type Cell } from "./hex";
import { add, D, div, gt, ln, min, mul, pow, sub, type Num } from "./num";
import { armRole, baseRate, breatherBaseRate, damagePerCharge, hasFacing, isArm, isModulator, isOscillator, outputOf, patternOf, reachOf, takesCharge } from "./modules";
import { busMultiplier, emptyConsole, faderMultiplier } from "./console";
import { wallOf } from "./map";
import { cableFrom, moduleAt } from "./placement";
import { instancesOf } from "./resonance";
import type { ArmRate, Board, BoardRates, ConsoleState, ChargeDelivery, ModulatorRate, ModulatorType, OscillatorRate, Placement, ReachHolds, WallRate } from "./types";

// The board's rates (spec chunk 02, issue #26; mechanics-sketch.md,
// Rates). One pure function of the layout, the credited Producer time
// (issue #32) and the console's levels (issue #58). `apply` calls it once after a layout or facing change and
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
// credit (live credited seconds; manual log entries never add to it),
// times its channel fader (issue #58) and the Modulators bus (#60): the cap bounds the class growth,
// never the fader.
function modulatorOutput(module: ModulatorType, producerSeconds: number, console: ConsoleState): Num {
  const output = outputOf(module);
  const grown = add(output.base, mul(output.perProducerHour ?? 0, div(producerSeconds, 3600)));
  return mul(output.max === undefined ? grown : min(grown, output.max), faderMultiplier(console, module));
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
// `Pressure ×2` (issue #52).
function wallPressure(cell: Cell): number {
  const wall = wallOf(cell);
  return wall.pressure * (wall.modifier === "pressureDouble" ? 2 : 1);
}

// A wall's rate at `damage`, read against the oscillators' rates: the one
// owner of a wall's full HP, pressure and pressed count. An oscillator is
// pressed while its pressure leg isn't identity, so one a Guard Plate
// shields isn't counted, and nor is a modulator or an Arm.
function wallRateOf(cell: Cell, damage: Num, oscillators: readonly OscillatorRate[]): WallRate {
  const wall = wallOf(cell);
  const around = neighbours(cell);
  const pressed = oscillators.filter((o) => gt(o.pressure, 0) && around.some((n) => sameCell(n, o.cell))).length;
  return { cell, damage, regen: wall.regen, net: sub(damage, wall.regen), full: wall.hp, pressure: wallPressure(cell), pressed };
}

// Any wall's rate from the cached rates: its `rates.walls` entry while it
// takes damage, otherwise the same reading at no damage. The Hex detail
// reads a wall through this.
export function wallRateAt(rates: BoardRates, cell: Cell): WallRate {
  return rates.walls.find((w) => sameCell(w.cell, cell)) ?? wallRateOf({ q: cell.q, r: cell.r }, D(0), rates.oscillators);
}

// Whether a cell holds an oscillator that a bordering wall would press on,
// a Guard Plate aside: what a Guard Plate shields (issue #54).
function isPressed(board: Board, cell: Cell): boolean {
  const module = moduleAt(board, cell)?.module;
  return module !== undefined && isOscillator(module) && bordersWall(board, cell);
}

function bordersWall(board: Board, cell: Cell): boolean {
  return neighbours(cell).some((n) => cellKind(board, n) === "wall");
}

// The pressure on a cell: the sum over its bordering walls inside the
// arc, capped. A pure derivation from the board's cell kinds, so a dark
// cell presses on nothing and a conquered (open) cell stops pressing at
// once (issue #52). A cell beside an active Guard Plate takes none (issue
// #54).
function pressureOn(board: Board, cell: Cell, guarded: ReadonlySet<string>): Num {
  if (guarded.has(cellKey(cell))) return D(0);
  let sum = 0;
  for (const n of neighbours(cell)) if (cellKind(board, n) === "wall") sum += wallPressure(n);
  return D(Math.min(sum, PRESSURE_CAP));
}

// A board with no module placed.
export function noRates(): BoardRates {
  return { oscillators: [], modulators: [], arms: [], walls: [], total: D(0), breatherTotal: D(0) };
}

export function computeBoardRates(board: Board, producerSeconds: number, console: ConsoleState = emptyConsole()): BoardRates {
  // Every module in a reach (or at a Patch's target) receives the full
  // output; only an oscillator or a Blade takes anything from it, and
  // several deliveries sum (before the log, for an oscillator).
  const modulators: ModulatorRate[] = [];
  const received = new Map<string, Num>();
  // Damage per wall cell, from Patches (issue #34) and Blades (issue #53):
  // reach onto a wall does nothing.
  const damage = new Map<string, { cell: Cell; damage: Num }>();
  for (const placement of board.placements) {
    const module = placement.module;
    if (!isModulator(module)) continue;
    const output = modulatorOutput(module, producerSeconds, console);
    // A patched modulator delivers to its cable's target alone, in place
    // of its reach (issue #33).
    const cable = cableFrom(board, placement.cell);
    const cells = cable ? [{ q: cable.target.q, r: cable.target.r }] : reachCells(placement);
    const deliveries: ChargeDelivery[] = cells.map((cell) => ({ cell, holds: holdsAt(board, cell) }));
    // A Patch into an `Only Arm damage` wall deals nothing (the route
    // rule refuses one, issue #48).
    if (cable && deliveries[0]!.holds === "wall" && wallOf(cable.target).modifier !== "armOnly") {
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
  // Arms (issue #53): a striking Arm (the Blade) deals its damage per
  // charge × the charge it receives to the cell it faces, when that cell
  // is a wall; otherwise it does nothing. A guarding Arm (the Guard Plate)
  // bordering a wall guards its neighbours from pressure (issue #54).
  const arms: ArmRate[] = [];
  const guarded = new Set<string>();
  for (const placement of board.placements) {
    const module = placement.module;
    if (!isArm(module)) continue;
    const cell = { q: placement.cell.q, r: placement.cell.r };
    if (armRole(module) === "guard") {
      const active = bordersWall(board, cell);
      if (active) for (const n of neighbours(cell)) guarded.add(cellKey(n));
      // It shields the oscillators beside it that a wall would press on.
      const shields = active ? neighbours(cell).filter((n) => isPressed(board, n)).length : 0;
      arms.push({ cell, role: "guard", module, active, shields });
      continue;
    }
    const facing = placement.facing ?? 0;
    const faces = addCell(placement.cell, DIRECTIONS[facing]!);
    const facesWall = cellKind(board, faces) === "wall";
    const chargeReceived = received.get(cellKey(placement.cell)) ?? D(0);
    // The Arms bus multiplies every Blade's damage (issue #60).
    const dealt = facesWall ? mul(mul(damagePerCharge(module), chargeReceived), busMultiplier(console, "arm")) : D(0);
    if (facesWall && gt(dealt, 0)) {
      const key = cellKey(faces);
      const wall = damage.get(key) ?? { cell: faces, damage: D(0) };
      damage.set(key, { ...wall, damage: add(wall.damage, dealt) });
    }
    arms.push({ cell, role: "strike", module, facing, chargeReceived, faces, facesWall, damage: dealt });
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
    // The type's channel fader (issue #58) times the Oscillators bus
    // (#60). Pressure (issue #52) reduces
    // ν only: modulator output and wall damage ignore it.
    const faders = faderMultiplier(console, module);
    const pressure = pressureOn(board, placement.cell, guarded);
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
  const walls: WallRate[] = [...damage.values()].map(({ cell, damage }) => wallRateOf(cell, damage, oscillators));
  // The board runs ×2 in a breather (issue #41).
  return { oscillators, modulators, arms, walls, total, breatherTotal: mul(2, breatherSum) };
}
