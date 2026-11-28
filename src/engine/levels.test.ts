import { describe, expect, it } from "vitest";
import { apply, type Action } from "./apply";
import { begin, advanceIn, applyIn, fresh, giveHabit, ownCells } from "./fixtures";
import { cellsWithin, type Cell } from "./hex";
import { classLevel, grantsOf } from "./levels";
import { D } from "./num";
import { cloneState } from "./state";
import type { GameState, HabitClass } from "./types";

// Class levels and their grants (spec chunk 04, issue #38), read through
// the state: a class's credited seconds give its level, and the levels of
// the open classes give the allowance and the arrived types.

const HOUR = 3600;
const O = { q: 0, r: 0 };
const E = { q: 1, r: 0 };
const SE = { q: 0, r: 1 };
const W = { q: -1, r: 0 };
const SW = { q: -1, r: 1 };
const FAR = { q: 2, r: 0 };

function credited(hours: Partial<Record<HabitClass, number>>): GameState {
  const s = fresh();
  for (const [habitClass, h] of Object.entries(hours)) s.records.classCredit[habitClass as HabitClass] = h * HOUR;
  return s;
}

describe("class levels", () => {
  it("every class starts at Lv 0, with the opening grants", () => {
    const s = fresh();
    for (const habitClass of ["engineer", "producer", "mixer", "roadie"] as const) expect(classLevel(s, habitClass).level).toBe(0);
    expect(grantsOf(s)).toEqual({
      allowance: { oscillator: 2, modulator: 1 },
      cableAllowance: 1,
      arrived: ["sine", "triangle", "flywheel"],
      arrivedCables: ["patch"],
    });
  });

  it("Engineer at 0.49 h, 0.5 h, 1.5 h, 5 h and 12 h is Lv 0, 1, 2, 4 and 6", () => {
    const levels = [0.49, 0.5, 1.5, 5, 12].map((h) => classLevel(credited({ engineer: h }), "engineer").level);
    expect(levels).toEqual([0, 1, 2, 4, 6]);
    const oscillators = [0.49, 0.5, 1.5, 5, 12].map((h) => grantsOf(credited({ engineer: h })).allowance.oscillator);
    expect(oscillators).toEqual([2, 3, 3, 4, 5]);
  });

  it("Square, Saw and Release arrive at Engineer Lv 2, 4 and 6, after the start types", () => {
    expect(grantsOf(credited({ engineer: 1.49 })).arrived).toEqual(["sine", "triangle", "flywheel"]);
    expect(grantsOf(credited({ engineer: 1.5 })).arrived).toEqual(["sine", "triangle", "flywheel", "square"]);
    expect(grantsOf(credited({ engineer: 3 })).arrived).toEqual(["sine", "triangle", "flywheel", "square"]);
    expect(grantsOf(credited({ engineer: 5 })).arrived).toEqual(["sine", "triangle", "flywheel", "square", "saw"]);
    expect(grantsOf(credited({ engineer: 12 })).arrived).toEqual(["sine", "triangle", "flywheel", "square", "saw", "release"]);
  });

  it("Engineer past Lv 6 grants +1 Oscillator each level", () => {
    // Lv 7 at 17 h, Lv 8 at 23 h, Lv 9 at 30 h.
    expect([17, 23, 30].map((h) => grantsOf(credited({ engineer: h })).allowance.oscillator)).toEqual([6, 7, 8]);
  });

  it("Producer at Lv 0 to 6 alternates Modulator and cable, skipping the Pulsewell's milestone", () => {
    const hours = [0, 0.5, 1.5, 3, 5, 8, 12];
    expect(hours.map((h) => classLevel(credited({ producer: h }), "producer").level)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(hours.map((h) => grantsOf(credited({ producer: h })).allowance.modulator)).toEqual([1, 2, 2, 2, 3, 3, 4]);
    expect(hours.map((h) => grantsOf(credited({ producer: h })).cableAllowance)).toEqual([1, 1, 2, 2, 2, 3, 3]);
    expect(grantsOf(credited({ producer: 1.5 })).arrived).not.toContain("pulsewell");
    expect(grantsOf(credited({ producer: 3 })).arrived).toEqual(["sine", "triangle", "flywheel", "pulsewell"]);
  });

  it("arrived types run in arrival order across classes", () => {
    // Producer Lv 3 at 3 h; Engineer Lv 2 at 1.5 h: both arrive.
    expect(grantsOf(credited({ producer: 3, engineer: 1.5 })).arrived).toEqual(["sine", "triangle", "flywheel", "square", "pulsewell"]);
  });

  it("past 30 h each threshold is 1 h further than the last step: 38, 47, 57, 68", () => {
    const at = (h: number) => classLevel(credited({ engineer: h }), "engineer");
    expect(at(30)).toEqual({ level: 9, current: 30 * HOUR, next: 38 * HOUR });
    expect(at(37.99).level).toBe(9);
    expect(at(38)).toEqual({ level: 10, current: 38 * HOUR, next: 47 * HOUR });
    expect(at(47).level).toBe(11);
    expect(at(56.99).level).toBe(11);
    expect(at(57).level).toBe(12);
    expect(at(68)).toEqual({ level: 13, current: 68 * HOUR, next: 80 * HOUR });
  });

  it("names the current and next threshold from Lv 0", () => {
    expect(classLevel(fresh(), "engineer")).toEqual({ level: 0, current: 0, next: 0.5 * HOUR });
    expect(classLevel(credited({ engineer: 1 }), "engineer")).toEqual({ level: 1, current: 0.5 * HOUR, next: 1.5 * HOUR });
  });

  it("a closed class grants nothing, whatever its credit", () => {
    const s = credited({ roadie: 30, mixer: 30 });
    expect(classLevel(s, "roadie").level).toBe(9);
    expect(grantsOf(s)).toEqual(grantsOf(fresh()));
  });
});

describe("the allowance in play", () => {
  function refused(s: GameState, action: Action): string | undefined {
    const before = cloneState(s);
    const done = apply(s, action);
    expect(done.ok).toBe(false);
    expect(done.state).toBe(s);
    expect(s).toEqual(before);
    return done.reason;
  }

  it("a placement beyond the derived allowance is refused; the next Engineer level takes it", () => {
    const s = credited({ engineer: 0.49 });
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    applyIn(s, { type: "placeModule", module: "triangle", cell: E });
    expect(refused(s, { type: "placeModule", module: "triangle", cell: SE })).toBe("Oscillator allowance is full.");
    s.records.classCredit.engineer = 0.5 * HOUR;
    expect(applyIn(s, { type: "placeModule", module: "triangle", cell: SE }).ok).toBe(true);
  });

  it("a type arrives with its level: Square at Engineer Lv 2", () => {
    const s = credited({ engineer: 1.49 });
    expect(refused(s, { type: "placeModule", module: "square", cell: O })).toBe("Square hasn't arrived yet.");
    s.records.classCredit.engineer = 1.5 * HOUR;
    expect(applyIn(s, { type: "placeModule", module: "square", cell: O }).ok).toBe(true);
  });

  it("a patch beyond the derived cable allowance is refused; Producer Lv 2 takes it", () => {
    const s = credited({ producer: 1 });
    ownCells(s, cellsWithin(2));
    applyIn(s, { type: "placeModule", module: "flywheel", cell: O });
    applyIn(s, { type: "placeModule", module: "flywheel", cell: W });
    expect(applyIn(s, { type: "patchCable", cable: "patch", source: O, target: E }).ok).toBe(true);
    expect(refused(s, { type: "patchCable", cable: "patch", source: W, target: SW })).toBe("Cable allowance is full.");
    s.records.classCredit.producer = 1.5 * HOUR;
    expect(applyIn(s, { type: "patchCable", cable: "patch", source: W, target: SW }).ok).toBe(true);
  });

  it("manual practice logs grant nothing", () => {
    const s = fresh();
    const { habit } = giveHabit(s, "Piano", "engineer");
    expect(applyIn(s, { type: "logPractice", habitId: habit.id, minutes: 600, now: 1_000 }).ok).toBe(true);
    expect(classLevel(s, "engineer").level).toBe(0);
    expect(grantsOf(s)).toEqual(grantsOf(fresh()));
  });

  it("nous buys no level, allowance or type", () => {
    const s = fresh();
    s.game.nous = D("1e100");
    expect(classLevel(s, "engineer").level).toBe(0);
    expect(grantsOf(s)).toEqual(grantsOf(fresh()));
  });

  it("credit crossing a threshold in flow raises the derived allowance in the same advance", () => {
    const s = fresh();
    giveHabit(s, "Piano", "engineer");
    begin(s, null, 0);
    advanceIn(s, 0.5 * HOUR - 1, "flow");
    expect(grantsOf(s).allowance.oscillator).toBe(2);
    advanceIn(s, 1, "flow");
    expect(s.records.classCredit.engineer).toBe(0.5 * HOUR);
    expect(grantsOf(s).allowance.oscillator).toBe(3);
  });
});

describe("the Pulsewell", () => {
  function pulsewellAmid(): GameState {
    const s = credited({ producer: 3 });
    ownCells(s, cellsWithin(2));
    expect(applyIn(s, { type: "placeModule", module: "pulsewell", cell: O }).ok).toBe(true);
    return s;
  }

  it("unpatched, it delivers 0.5 charge/s to each of its 6 neighbours", () => {
    const s = pulsewellAmid();
    const pulsewell = s.game.rates.modulators[0]!;
    expect(pulsewell.output.toNumber()).toBe(0.5);
    expect(pulsewell.deliveries).toHaveLength(6);
    applyIn(s, { type: "placeModule", module: "sine", cell: E });
    expect(s.game.rates.oscillators[0]!.chargeReceived.toNumber()).toBe(0.5);
  });

  it("patched, it delivers its per-target 0.5 charge/s to its one target", () => {
    const s = pulsewellAmid();
    applyIn(s, { type: "placeModule", module: "sine", cell: FAR });
    applyIn(s, { type: "placeModule", module: "triangle", cell: E });
    expect(applyIn(s, { type: "patchCable", cable: "patch", source: O, target: FAR }).ok).toBe(true);
    const at = (cell: Cell) => s.game.rates.oscillators.find((o) => o.cell.q === cell.q && o.cell.r === cell.r)!;
    expect(s.game.rates.modulators[0]!.deliveries).toEqual([{ cell: FAR, holds: "sine" }]);
    expect(at(FAR).chargeReceived.toNumber()).toBe(0.5);
    expect(at(E).chargeReceived.toNumber()).toBe(0);
  });
});
