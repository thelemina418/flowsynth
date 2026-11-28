import { describe, expect, it } from "vitest";
import { advanceIn, applyIn, begin, fresh, giveHabit, giveProducer, openRoadie, ownCells, woundWall } from "./fixtures";
import { cellKind } from "./board";
import { entriesOf } from "./encyclopedia";
import { grantsOf } from "./levels";
import type { Cell } from "./hex";
import type { GameState, ModuleType } from "./types";

// The Guard Plate (spec chunk 05, issue #54), through the GameState seam:
// Roadie Lv 2 brings it. It has no facing. Bordering at least one wall it
// is active, and every oscillator beside it takes no pressure. Bordering
// none it does nothing.

const HOUR = 3600;
const O = { q: 0, r: 0 };
const NE = { q: 1, r: -1 };
const SE = { q: 0, r: 1 };
const E = { q: 1, r: 0 };
const BASALT_W = { q: -1, r: 0 };

function must(s: GameState, action: Parameters<typeof applyIn>[1]): void {
  const done = applyIn(s, action);
  if (!done.ok) throw new Error(`fixture ${action.type} failed: ${done.reason}`);
}

function place(s: GameState, module: ModuleType, cell: Cell): void {
  must(s, { type: "placeModule", module, cell });
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.q === b.q && a.r === b.r;
}

function oscillatorAt(s: GameState, cell: Cell) {
  return s.game.rates.oscillators.find((o) => sameCell(o.cell, cell))!;
}

// Roadie open (Shale and Basalt (0,−1) owned) at Lv 2, which brings the
// Guard Plate and 2 Arms.
function plated(): GameState {
  const s = fresh();
  openRoadie(s);
  s.records.classCredit.roadie = 1.5 * HOUR;
  return s;
}

describe("the Guard Plate arrives", () => {
  it("at Roadie Lv 2, and not at Lv 1", () => {
    const s = fresh();
    openRoadie(s);
    s.records.classCredit.roadie = 0.5 * HOUR;
    expect(grantsOf(s).arrived).not.toContain("guardPlate");
    s.records.classCredit.roadie = 1.5 * HOUR;
    expect(grantsOf(s).arrived).toContain("guardPlate");
    expect(grantsOf(s).allowance.arm).toBe(2);
  });
});

describe("pressure beside a Guard Plate", () => {
  // A Sine at (0,1) borders Schist (1,1), Schist (−1,2) and Flint (0,2):
  // 12 + 12 + 10 = 34%.
  it("an oscillator next to an active Guard Plate has 0 pressure", () => {
    const s = plated();
    place(s, "sine", SE);
    expect(oscillatorAt(s, SE).pressure.toNumber()).toBeCloseTo(0.34, 12);
    // The centre borders Basalt (−1,0), so a Guard Plate there is active.
    place(s, "guardPlate", O);
    expect(oscillatorAt(s, SE).pressure.toNumber()).toBe(0);
    expect(oscillatorAt(s, SE).rate.toNumber()).toBe(1);
    expect(s.game.rates.arms[0]).toMatchObject({ module: "guardPlate", active: true, shields: 1 });
  });

  it("next to a Guard Plate that borders no wall, it keeps its full pressure", () => {
    const s = plated();
    // (1,0)'s three ring-2 walls owned, as if conquered: it borders none.
    // The Sine loses Schist (1,1) and keeps 12 + 10 = 22%.
    ownCells(s, [{ q: 2, r: 0 }, { q: 2, r: -1 }, { q: 1, r: 1 }]);
    place(s, "guardPlate", E);
    place(s, "sine", SE);
    expect(oscillatorAt(s, SE).pressure.toNumber()).toBeCloseTo(0.22, 12);
    expect(s.game.rates.arms[0]).toMatchObject({ module: "guardPlate", active: false, shields: 0 });
  });
});

describe("a conquest beside a Guard Plate", () => {
  it("when its walls are all conquered it goes inactive, and its neighbours' pressure returns from the walls still bordering them", () => {
    const s = plated();
    // A Guard Plate at the centre, whose one wall is Basalt (−1,0), worn
    // to 1 HP. A Flywheel on (1,−1) at 1.05 charge/s (Producer Lv 1) is
    // patched into it, past its regen of 1.
    giveProducer(s, { modulators: 2 });
    woundWall(s, BASALT_W, 1);
    place(s, "guardPlate", O);
    place(s, "sine", SE);
    place(s, "flywheel", NE);
    must(s, { type: "patchCable", cable: "patch", source: NE, target: BASALT_W });
    expect(oscillatorAt(s, SE).pressure.toNumber()).toBe(0);
    giveHabit(s, "Piano", "engineer");
    begin(s, null, 0);
    advanceIn(s, 100, "flow");
    expect(cellKind(s.game.board, BASALT_W)).toBe("open");
    expect(s.game.rates.arms[0]).toMatchObject({ module: "guardPlate", active: false, shields: 0 });
    // The Sine's three ring-2 walls press again: 12 + 12 + 10 = 34%.
    expect(oscillatorAt(s, SE).pressure.toNumber()).toBeCloseTo(0.34, 12);
  });
});

describe("the Arms entry", () => {
  it("says what a Guard Plate does", () => {
    const s = plated();
    // Any action reveals what the state now shows; Roadie is open.
    place(s, "guardPlate", O);
    expect(entriesOf(s).find((e) => e.id === "arms")!.lines).toContain("Guard Plate · cancels pressure on its neighbours");
  });
});
