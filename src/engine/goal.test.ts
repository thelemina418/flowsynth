import { describe, expect, it } from "vitest";
import { advanceIn, applyIn, begin, fresh, giveOscillators, ownCells, openRoadie } from "./fixtures";
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

  it("an opened Shale cell moves on to Conquer Basalt (issue #49)", () => {
    const s = fresh();
    ownCells(s, [SHALE]);
    expect(goalOf(s)).toBe("Conquer Basalt");
  });

  it("either Basalt's open cell finishes Conquer Basalt, and Reach Flint follows until Roadie opens (issues #49, #53)", () => {
    for (const basalt of [{ q: -1, r: 0 }, { q: 0, r: -1 }]) {
      const s = fresh();
      ownCells(s, [SHALE, basalt]);
      expect(goalOf(s)).toBe("Reach Flint");
    }
  });

  it("with Roadie open, the Goal walks Conquer Flint, then Conquer Schist, leaving no inert entry (issue #53)", () => {
    const s = fresh();
    openRoadie(s);
    expect(goalOf(s)).toBe("Conquer Flint");
    ownCells(s, [{ q: 0, r: -2 }]);
    expect(goalOf(s)).toBe("Conquer Schist");
    ownCells(s, [{ q: -2, r: 1 }]);
    // Prestige shows only from 1e6 era ν (issue #61; engine/era.test.ts).
    expect(goalOf(s)).toBeNull();
  });
});

describe("first-session disclosure", () => {
  it("a fresh start shows no chips, doors or class levels", () => {
    expect(disclosureOf(fresh())).toEqual({ chips: false, doors: false });
  });

  it("after one completed session, chips, doors and class levels are shown", () => {
    const s = fresh();
    expect(begin(s, 1500, 0).ok).toBe(true);
    advanceIn(s, 1500, "flow");
    expect(applyIn(s, { type: "endSession", now: 1_500_000 }).ok).toBe(true);
    expect(disclosureOf(s)).toEqual({ chips: true, doors: true });
  });
});
