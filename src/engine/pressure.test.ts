import { describe, expect, it } from "vitest";
import { advanceIn, applyIn, begin, fresh, giveHabit, giveOscillators, ownCells } from "./fixtures";
import type { Cell } from "./hex";
import type { GameState, ModuleType } from "./types";

// Pressure (spec chunk 05, issue #52), through the GameState seam: each
// wall inside the arc presses on the oscillators bordering it, doubled for
// `Pressure ×2`, summed and capped at 60%. It fills the oscillator's
// pressure leg, so rate = … × (1 − pressure), flow and breather alike, and
// touches ν only. A cell opened by conquest presses on nothing: these
// fixtures own the cell, as a conquest would leave it.

const O = { q: 0, r: 0 };
const SOUTH = { q: 0, r: 1 };
const SHALE = { q: -1, r: 1 };
const BASALT = { q: 0, r: -1 };

function place(s: GameState, module: ModuleType, cell: Cell): void {
  const done = applyIn(s, { type: "placeModule", module, cell });
  if (!done.ok) throw new Error(`fixture placement failed: ${done.reason}`);
}

function oscillatorAt(s: GameState, cell: Cell) {
  return s.game.rates.oscillators.find((o) => o.cell.q === cell.q && o.cell.r === cell.r)!;
}

describe("the spec's acceptance", () => {
  it("an oscillator bordering Shale alone makes ×0.95", () => {
    const s = fresh();
    // (0,1)'s ring-2 neighbours, owned as if conquered, leave Shale its one wall.
    ownCells(s, [{ q: 1, r: 1 }, { q: 0, r: 2 }, { q: -1, r: 2 }]);
    place(s, "sine", SOUTH);
    const sine = oscillatorAt(s, SOUTH);
    expect(sine.pressure.toNumber()).toBeCloseTo(0.05, 12);
    expect(sine.rate.toNumber()).toBeCloseTo(0.95, 12);
    expect(s.game.rates.total.toNumber()).toBeCloseTo(0.95, 12);
  });

  it("bordering Shale and the `Pressure ×2` Basalt loses 5 + 16 = 21%", () => {
    const s = fresh();
    ownCells(s, [BASALT]);
    place(s, "sine", O);
    expect(oscillatorAt(s, O).pressure.toNumber()).toBeCloseTo(0.21, 12);
    expect(oscillatorAt(s, O).rate.toNumber()).toBeCloseTo(0.79, 12);
  });
});

describe("stacking and the arc", () => {
  // The marked Schist's cell, owned as if conquered: in Sketch it borders
  // Schist, the doubled Basalt, Shale and Flint (12 + 16 + 5 + 10 = 43%),
  // and two ring-3 Gneiss cells beyond the arc.
  const MARKED = { q: -2, r: 1 };

  it("a wall beyond the arc's radius exerts no pressure", () => {
    const s = fresh();
    ownCells(s, [MARKED]);
    place(s, "sine", MARKED);
    expect(oscillatorAt(s, MARKED).pressure.toNumber()).toBeCloseTo(0.43, 12);
  });

  it("stacked pressure caps at 60%", () => {
    const s = fresh();
    ownCells(s, [MARKED]);
    s.game.board.arc = "demo";
    // Demo lights the two Gneiss cells: 43 + 15 + 15 = 73%, capped.
    place(s, "sine", MARKED);
    expect(oscillatorAt(s, MARKED).pressure.toNumber()).toBe(0.6);
    expect(oscillatorAt(s, MARKED).rate.toNumber()).toBeCloseTo(0.4, 12);
  });
});

describe("pressure touches ν only", () => {
  it("a modulator beside walls keeps its full output, and the charged oscillator takes pressure after charge", () => {
    const s = fresh();
    ownCells(s, [BASALT]);
    // A Flywheel at the centre faces NE onto (1,-1), which borders two
    // Schists and a Flint now that Basalt (0,-1) is open: 12 + 12 + 10 = 34%.
    place(s, "flywheel", O);
    place(s, "triangle", { q: 1, r: -1 });
    expect(s.game.rates.modulators[0]!.output.toNumber()).toBe(1);
    const triangle = oscillatorAt(s, { q: 1, r: -1 });
    expect(triangle.chargeReceived.toNumber()).toBe(1);
    expect(triangle.pressure.toNumber()).toBeCloseTo(0.34, 12);
    expect(triangle.rate.toNumber()).toBeCloseTo((1 + Math.log(2)) * 0.66, 12);
  });

  it("a Patch into Shale still deals its whole output beside the pressing walls", () => {
    const s = fresh();
    place(s, "flywheel", O);
    expect(applyIn(s, { type: "patchCable", cable: "patch", source: O, target: SHALE }).ok).toBe(true);
    expect(s.game.rates.walls[0]!.damage.toNumber()).toBe(1);
  });

  it("breather rates take the same pressure", () => {
    const s = fresh();
    ownCells(s, [{ q: 1, r: 1 }, { q: 0, r: 2 }, { q: -1, r: 2 }]);
    place(s, "sine", SOUTH);
    expect(oscillatorAt(s, SOUTH).breatherRate.toNumber()).toBeCloseTo(0.95, 12);
    // The board runs ×2 in a breather.
    expect(s.game.rates.breatherTotal.toNumber()).toBeCloseTo(1.9, 12);
  });
});

describe("an opened cell", () => {
  it("stops pressing in the next recompute: owning Shale's cell lifts its 5%", () => {
    const s = fresh();
    giveOscillators(s, { allowance: 3 });
    ownCells(s, [{ q: 1, r: 1 }, { q: 0, r: 2 }, { q: -1, r: 2 }]);
    place(s, "sine", SOUTH);
    expect(oscillatorAt(s, SOUTH).pressure.toNumber()).toBeCloseTo(0.05, 12);
    // Shale's cell open, as a conquest leaves it; the next recompute reads the board.
    ownCells(s, [SHALE]);
    place(s, "sine", { q: 1, r: 0 });
    expect(oscillatorAt(s, SOUTH).pressure.toNumber()).toBe(0);
    expect(oscillatorAt(s, SOUTH).rate.toNumber()).toBe(1);
  });
});

describe("a conquest", () => {
  it("removes the conquered wall's pressure in the same recompute: Shale falls and the Sine beside it goes from 39% to 34%", () => {
    const s = fresh();
    // A Flywheel at 1 charge/s patched into Shale (net 0.9/s), a Sine at (0,1).
    place(s, "flywheel", O);
    place(s, "sine", SOUTH);
    expect(applyIn(s, { type: "patchCable", cable: "patch", source: O, target: SHALE }).ok).toBe(true);
    giveHabit(s, "Piano", "engineer");
    begin(s, null, 0);
    expect(oscillatorAt(s, SOUTH).pressure.toNumber()).toBeCloseTo(0.39, 12);
    advanceIn(s, 600 / 0.9 - 1, "flow");
    expect(oscillatorAt(s, SOUTH).pressure.toNumber()).toBeCloseTo(0.39, 12);
    advanceIn(s, 1, "flow");
    expect(oscillatorAt(s, SOUTH).pressure.toNumber()).toBeCloseTo(0.34, 12);
    expect(s.game.rates.total.toNumber()).toBeCloseTo(0.66, 12);
  });
});
