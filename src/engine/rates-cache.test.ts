import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyIn, advanceIn, fresh, giveHabit, giveOscillators } from "./fixtures";
import { grantsOf } from "./levels";
import { computeBoardRates } from "./rates";
import { deserialize, serialize } from "./save";
import { cloneState } from "./state";
import type { GameState } from "./types";

// Rates are analytic (spec chunk 02, issue #26): computed once per layout
// change, never per tick. The wrapper keeps the real computation and
// counts its calls.
vi.mock("./rates", async (importOriginal) => {
  const real = await importOriginal<typeof import("./rates")>();
  return { ...real, computeBoardRates: vi.fn(real.computeBoardRates) };
});

const counted = vi.mocked(computeBoardRates);

function acceptanceLayout(): GameState {
  const s = fresh();
  giveOscillators(s, { allowance: 3 });
  counted.mockClear();
  applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
  applyIn(s, { type: "placeModule", module: "triangle", cell: { q: 1, r: 0 } });
  applyIn(s, { type: "placeModule", module: "triangle", cell: { q: 0, r: 1 } });
  return s;
}

// A block body: mockClear returns the mock, and a function returned from
// beforeEach would run as its teardown.
beforeEach(() => {
  counted.mockClear();
});

describe("recomputing the board's rates", () => {
  it("recomputes once for each layout change: place, move, remove", () => {
    const s = acceptanceLayout();
    expect(counted).toHaveBeenCalledTimes(3);
    counted.mockClear();
    applyIn(s, { type: "moveModule", from: { q: 0, r: 0 }, to: { q: 1, r: -1 } });
    expect(counted).toHaveBeenCalledTimes(1);
    applyIn(s, { type: "removeModule", cell: { q: 1, r: -1 } });
    expect(counted).toHaveBeenCalledTimes(2);
  });

  it("recomputes nothing for a refused placement or an action that leaves the layout alone", () => {
    const s = acceptanceLayout();
    counted.mockClear();
    applyIn(s, { type: "placeModule", module: "sine", cell: { q: -1, r: 1 } });
    applyIn(s, { type: "createHabit", name: "Piano" });
    expect(counted).not.toHaveBeenCalled();
  });

  it("recomputes zero times across any number of flow advances", () => {
    const s = acceptanceLayout();
    giveHabit(s, "Piano", "engineer");
    applyIn(s, { type: "startSession", target: null, now: 0 });
    counted.mockClear();
    for (let i = 0; i < 500; i++) advanceIn(s, 1, "flow");
    advanceIn(s, 600, "flow", "away");
    advanceIn(s, 0, "flow");
    expect(counted).not.toHaveBeenCalled();
    expect(s.game.nous.toNumber()).toBeGreaterThan(0);
  });

  it("recomputes once for a rotation and once for a session's end, and nothing for a refused rotation (issue #32)", () => {
    const s = acceptanceLayout();
    applyIn(s, { type: "removeModule", cell: { q: 0, r: 1 } });
    applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 1 } });
    counted.mockClear();
    applyIn(s, { type: "rotateModule", cell: { q: 0, r: 1 }, turn: "clockwise" });
    expect(counted).toHaveBeenCalledTimes(1);
    counted.mockClear();
    applyIn(s, { type: "rotateModule", cell: { q: 0, r: 0 }, turn: "clockwise" });
    giveHabit(s, "Synthesis", "producer");
    applyIn(s, { type: "startSession", target: null, now: 0 });
    applyIn(s, { type: "rotateModule", cell: { q: 0, r: 1 }, turn: "clockwise" });
    for (let i = 0; i < 100; i++) advanceIn(s, 36, "flow");
    expect(counted).not.toHaveBeenCalled();
    applyIn(s, { type: "endSession", now: 1 });
    expect(counted).toHaveBeenCalledTimes(1);
    expect(s.game.rates.modulators[0]!.output.toNumber()).toBe(1.1);
    counted.mockClear();
    applyIn(s, { type: "endSession", now: 2 });
    expect(counted).not.toHaveBeenCalled();
  });

  it("recomputes once each for a patch, a repatch and an unplug, and nothing for a refused one (issue #33)", () => {
    const s = acceptanceLayout();
    applyIn(s, { type: "removeModule", cell: { q: 0, r: 1 } });
    applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 1 } });
    counted.mockClear();
    expect(applyIn(s, { type: "patchCable", cable: "patch", source: { q: 0, r: 1 }, target: { q: 1, r: 0 } }).ok).toBe(true);
    expect(counted).toHaveBeenCalledTimes(1);
    expect(applyIn(s, { type: "repatchCable", source: { q: 0, r: 1 }, target: { q: 0, r: 0 } }).ok).toBe(true);
    expect(counted).toHaveBeenCalledTimes(2);
    expect(applyIn(s, { type: "unplugCable", source: { q: 0, r: 1 } }).ok).toBe(true);
    expect(counted).toHaveBeenCalledTimes(3);
    counted.mockClear();
    applyIn(s, { type: "unplugCable", source: { q: 0, r: 1 } });
    applyIn(s, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: 1, r: 0 } });
    expect(counted).not.toHaveBeenCalled();
  });

  it("recomputes once when choosing a class credits Producer time, and nothing when the choice changes no Producer credit or is refused", () => {
    const s = acceptanceLayout();
    applyIn(s, { type: "removeModule", cell: { q: 0, r: 1 } });
    applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 1 } });
    // Three awaiting habits: one with an hour of live time, one with an
    // hour for Engineer, one with none.
    const flowed = applyIn(s, { type: "createHabit", name: "Synthesis" }).id!;
    const other = applyIn(s, { type: "createHabit", name: "Drums" }).id!;
    const idle = applyIn(s, { type: "createHabit", name: "Bass" }).id!;
    for (const id of [flowed, other]) {
      applyIn(s, { type: "selectHabit", id });
      applyIn(s, { type: "startSession", target: null, now: 0 });
      for (let i = 0; i < 100; i++) advanceIn(s, 36, "flow");
      applyIn(s, { type: "endSession", now: 1 });
    }
    expect(s.game.rates.modulators[0]!.output.toNumber()).toBe(1);
    counted.mockClear();
    expect(applyIn(s, { type: "chooseClass", habitId: flowed, habitClass: "producer" }).ok).toBe(true);
    expect(counted).toHaveBeenCalledTimes(1);
    expect(s.game.rates.modulators[0]!.output.toNumber()).toBe(1.1);
    counted.mockClear();
    expect(applyIn(s, { type: "chooseClass", habitId: other, habitClass: "engineer" }).ok).toBe(true);
    expect(applyIn(s, { type: "chooseClass", habitId: idle, habitClass: "producer" }).ok).toBe(true);
    expect(applyIn(s, { type: "chooseClass", habitId: flowed, habitClass: "producer" }).ok).toBe(false);
    expect(counted).not.toHaveBeenCalled();
  });

  it("a class level crossed mid-flow raises the derived allowance in the same advance and recomputes nothing (issue #38)", () => {
    const s = fresh();
    giveHabit(s, "Piano", "engineer");
    applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 1_799, "flow");
    expect(grantsOf(s).allowance.oscillator).toBe(2);
    counted.mockClear();
    advanceIn(s, 1, "flow");
    expect(grantsOf(s).allowance.oscillator).toBe(3);
    expect(counted).not.toHaveBeenCalled();
  });

  it("recomputes once on load, from the layout, and never writes the rates to the save", () => {
    const s = acceptanceLayout();
    const text = serialize(s, 0);
    expect(text).not.toMatch(/rates|resonance|instances/);
    counted.mockClear();
    const loaded = deserialize(text).state!;
    expect(counted).toHaveBeenCalledTimes(1);
    expect(loaded.game.rates).toEqual(cloneState(s.game.rates));
    expect(loaded.game.rates.total.toNumber()).toBe(4.5);
  });
});
