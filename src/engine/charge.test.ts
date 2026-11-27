import { describe, expect, it } from "vitest";
import { advanceIn, applyIn, fresh, giveHabit, ownCells } from "./fixtures";
import type { Cell, Facing } from "./hex";
import { deserialize, serialize } from "./save";
import { cloneState } from "./state";
import type { GameState } from "./types";

// Reach and the charge factor (spec chunk 03, issue #32), through the
// GameState seam: a Flywheel's charge reaches the modules in its reach and
// raises their rate by 1 + ln(1 + charge/s received).

const O = { q: 0, r: 0 };
const HOUR = 3600;

// A Flywheel at `cell`, turned to `facing` from its opening NE.
function flywheelAt(s: GameState, facing: Facing, cell: Cell = O): void {
  if (!applyIn(s, { type: "placeModule", module: "flywheel", cell }).ok) throw new Error("fixture Flywheel failed");
  for (let i = 0; i < facing; i++) applyIn(s, { type: "rotateModule", cell, turn: "clockwise" });
}

function place(s: GameState, module: "sine" | "triangle", cell: Cell): void {
  if (!applyIn(s, { type: "placeModule", module, cell }).ok) throw new Error(`fixture ${module} failed`);
}

function oscillatorAt(s: GameState, cell: Cell) {
  return s.game.rates.oscillators.find((o) => o.cell.q === cell.q && o.cell.r === cell.r)!;
}

function flywheel(s: GameState, cell: Cell = O) {
  return s.game.rates.modulators.find((m) => m.cell.q === cell.q && m.cell.r === cell.r)!;
}

function start(s: GameState): void {
  if (!applyIn(s, { type: "startSession", target: null, now: 0 }).ok) throw new Error("fixture session failed");
}

function end(s: GameState): void {
  if (!applyIn(s, { type: "endSession", now: 1 }).ok) throw new Error("fixture end failed");
}

describe("the spec's acceptance", () => {
  it("a Flywheel at 1 charge/s facing a Triangle 2 cells away gives it a charge factor of 1 + ln 2 (×1.69)", () => {
    const s = fresh();
    ownCells(s, [{ q: 2, r: 0 }]);
    flywheelAt(s, 1);
    place(s, "triangle", { q: 2, r: 0 });
    const triangle = oscillatorAt(s, { q: 2, r: 0 });
    expect(triangle.chargeReceived.toNumber()).toBe(1);
    expect(triangle.charge.toNumber()).toBeCloseTo(1 + Math.log(2), 12);
    expect(triangle.charge.toFixed(2)).toBe("1.69");
    expect(triangle.rate.toNumber()).toBeCloseTo(1 + Math.log(2), 12);
  });
});

describe("the Flywheel's reach", () => {
  const EXPECTED: [string, Cell[]][] = [
    ["NE", [{ q: 1, r: -1 }, { q: 2, r: -2 }]],
    ["SE", [{ q: 1, r: 0 }, { q: 2, r: 0 }]],
    ["S", [{ q: 0, r: 1 }, { q: 0, r: 2 }]],
    ["SW", [{ q: -1, r: 1 }, { q: -2, r: 2 }]],
    ["NW", [{ q: -1, r: 0 }, { q: -2, r: 0 }]],
    ["N", [{ q: 0, r: -1 }, { q: 0, r: -2 }]],
  ];
  EXPECTED.forEach(([name, cells], facing) => {
    it(`facing ${name}, reaches the 2 cells in a straight line that way`, () => {
      const s = fresh();
      flywheelAt(s, facing as Facing);
      expect(flywheel(s).facing).toBe(facing);
      expect(flywheel(s).deliveries.map((d) => d.cell)).toEqual(cells);
    });
  });

  it("both reach cells receive the full output, and a wall in the first doesn't block the second", () => {
    const s = fresh();
    ownCells(s, [{ q: 1, r: 1 }, { q: 2, r: 2 }]);
    // Facing SE from (0,0) would be the opening; from (1,-1) facing S the
    // reach is (1,0), then (1,1).
    flywheelAt(s, 2, { q: 1, r: -1 });
    place(s, "triangle", { q: 1, r: 0 });
    place(s, "sine", { q: 1, r: 1 });
    expect(oscillatorAt(s, { q: 1, r: 0 }).chargeReceived.toNumber()).toBe(1);
    expect(oscillatorAt(s, { q: 1, r: 1 }).chargeReceived.toNumber()).toBe(1);

    // Facing SW from (0,0): Shale stands on (-1,1); (-2,2) beyond it still
    // takes the charge.
    const walled = fresh();
    ownCells(walled, [{ q: -2, r: 2 }]);
    flywheelAt(walled, 3);
    place(walled, "triangle", { q: -2, r: 2 });
    expect(flywheel(walled).deliveries.map((d) => d.holds)).toEqual(["wall", "triangle"]);
    expect(oscillatorAt(walled, { q: -2, r: 2 }).chargeReceived.toNumber()).toBe(1);
  });
});

describe("what charge does on arrival", () => {
  it("charge to a modulator, an empty cell, a wall or a dark cell does nothing", () => {
    const s = fresh();
    s.game.allowance.modulator = 2;
    // (0,0) faces NE onto the second Flywheel at (1,-1), then a wall; the
    // second faces N onto a wall, then a dark cell.
    flywheelAt(s, 0);
    flywheelAt(s, 5, { q: 1, r: -1 });
    place(s, "sine", { q: 0, r: 1 });
    expect(flywheel(s).deliveries.map((d) => d.holds)).toEqual(["flywheel", "wall"]);
    expect(flywheel(s, { q: 1, r: -1 }).deliveries.map((d) => d.holds)).toEqual(["wall", "dark"]);
    expect(flywheel(s, { q: 1, r: -1 }).output.toNumber()).toBe(1);
    expect(oscillatorAt(s, { q: 0, r: 1 }).chargeReceived.toNumber()).toBe(0);
    expect(oscillatorAt(s, { q: 0, r: 1 }).charge.toNumber()).toBe(1);
    expect(s.game.rates.total.toNumber()).toBe(1);

    // Facing SE onto the empty (1,0), then a wall.
    const empty = fresh();
    flywheelAt(empty, 1);
    place(empty, "sine", { q: 0, r: 1 });
    expect(flywheel(empty).deliveries.map((d) => d.holds)).toEqual(["empty", "wall"]);
    expect(empty.game.rates.total.toNumber()).toBe(1);
  });

  it("two modulators on one oscillator sum before the log: 1 + ln 3", () => {
    const s = fresh();
    s.game.allowance.modulator = 2;
    ownCells(s, [{ q: 2, r: 0 }]);
    flywheelAt(s, 1);
    flywheelAt(s, 4, { q: 2, r: 0 });
    place(s, "triangle", { q: 1, r: 0 });
    const triangle = oscillatorAt(s, { q: 1, r: 0 });
    expect(triangle.chargeReceived.toNumber()).toBe(2);
    expect(triangle.charge.toNumber()).toBeCloseTo(1 + Math.log(3), 12);
  });
});

describe("the Flywheel's output", () => {
  function withProducerHours(hours: number): GameState {
    const s = fresh();
    s.records.classCredit.producer = hours * HOUR;
    flywheelAt(s, 0);
    return s;
  }

  it("is 1, 1.4 and 3 charge/s at 0, 4 and 25 credited Producer hours", () => {
    expect(flywheel(withProducerHours(0)).output.toNumber()).toBe(1);
    expect(flywheel(withProducerHours(4)).output.toNumber()).toBe(1.4);
    expect(flywheel(withProducerHours(25)).output.toNumber()).toBe(3);
  });

  it("is never raised by a manual log entry", () => {
    const s = fresh();
    const { habit } = giveHabit(s, "Synthesis", "producer");
    flywheelAt(s, 0);
    applyIn(s, { type: "logPractice", habitId: habit.id, minutes: 600, now: 0 });
    applyIn(s, { type: "rotateModule", cell: O, turn: "clockwise" });
    expect(flywheel(s).output.toNumber()).toBe(1);
  });

  it("holds steady through a Producer session and updates when it ends", () => {
    const s = fresh();
    giveHabit(s, "Synthesis", "producer");
    flywheelAt(s, 0);
    start(s);
    advanceIn(s, 4 * HOUR, "flow");
    expect(s.records.classCredit.producer).toBe(4 * HOUR);
    expect(flywheel(s).output.toNumber()).toBe(1);
    end(s);
    expect(flywheel(s).output.toNumber()).toBe(1.4);
  });
});

describe("nous on a charged layout", () => {
  // Flywheel (0,0) facing SE onto a Triangle at (1,0); a Sine at (0,1).
  function charged(): GameState {
    const s = fresh();
    flywheelAt(s, 1);
    place(s, "triangle", { q: 1, r: 0 });
    place(s, "sine", { q: 0, r: 1 });
    giveHabit(s, "Piano", "engineer");
    return s;
  }

  it("an hour of trusted flow yields exactly total ν/s × 3600", () => {
    const s = charged();
    expect(s.game.rates.total.toNumber()).toBeCloseTo(2 + Math.log(2), 12);
    start(s);
    advanceIn(s, HOUR, "flow");
    expect(s.game.nous.eq(s.game.rates.total.mul(HOUR))).toBe(true);
  });

  it("an hour in upgrade leaves the state deep-equal", () => {
    const s = charged();
    const before = cloneState(s);
    advanceIn(s, HOUR, "upgrade");
    expect(s).toEqual(before);
  });

  it("recomputes the rates, charge included, on load", () => {
    const s = charged();
    s.records.classCredit.producer = 4 * HOUR;
    applyIn(s, { type: "rotateModule", cell: O, turn: "clockwise" });
    applyIn(s, { type: "rotateModule", cell: O, turn: "counterclockwise" });
    const loaded = deserialize(serialize(s, 0)).state!;
    expect(loaded.game.rates).toEqual(cloneState(s.game.rates));
    expect(oscillatorAt(loaded, { q: 1, r: 0 }).chargeReceived.toNumber()).toBe(1.4);
  });
});
