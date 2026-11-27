import { describe, expect, it } from "vitest";
import { advanceIn, applyIn, begin, fresh, giveOscillators, ownCells } from "./fixtures";
import { disclosureOf, goalOf } from "./goal";

// The Goal (spec chunk 04, issue #42): one line, read off the state by a
// fixed priority list per arc, and the first-session disclosure rule.

const O = { q: 0, r: 0 };
const E = { q: 1, r: 0 };
const SE = { q: 0, r: 1 };
const SHALE = { q: -1, r: 1 };

describe("the Goal", () => {
  it("a fresh start gives Conquer Shale", () => {
    expect(goalOf(fresh())).toBe("Conquer Shale");
  });

  it("Engineer Lv 1 with 2 oscillators placed gives Place a third oscillator, and a third placed gives Conquer Shale again", () => {
    const s = fresh();
    giveOscillators(s, { allowance: 3 });
    expect(applyIn(s, { type: "placeModule", module: "sine", cell: O }).ok).toBe(true);
    expect(applyIn(s, { type: "placeModule", module: "triangle", cell: E }).ok).toBe(true);
    expect(goalOf(s)).toBe("Place a third oscillator");
    expect(applyIn(s, { type: "placeModule", module: "sine", cell: SE }).ok).toBe(true);
    expect(goalOf(s)).toBe("Conquer Shale");
    // State-derived: taking one back brings it back.
    expect(applyIn(s, { type: "removeModule", cell: SE }).ok).toBe(true);
    expect(goalOf(s)).toBe("Place a third oscillator");
  });

  it("an opened Shale cell moves past Conquer Shale, to no inert entry", () => {
    const s = fresh();
    ownCells(s, [SHALE]);
    // Conquer Basalt, Reach Flint … Prestige are declared but shown false
    // until chunks 05 and 06, so nothing is left to name.
    expect(goalOf(s)).toBeNull();
  });
});

describe("first-session disclosure", () => {
  it("a fresh start shows no chips, doors or class levels", () => {
    expect(disclosureOf(fresh())).toEqual({ chips: false, doors: false, classLevels: false });
  });

  it("after one completed session, chips, doors and class levels are shown", () => {
    const s = fresh();
    expect(begin(s, 1500, 0).ok).toBe(true);
    advanceIn(s, 1500, "flow");
    expect(applyIn(s, { type: "endSession", now: 1_500_000 }).ok).toBe(true);
    expect(disclosureOf(s)).toEqual({ chips: true, doors: true, classLevels: true });
  });
});
