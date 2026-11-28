import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { advanceIn, applyIn, begin, fresh, giveOscillators } from "./fixtures";
import { D } from "./num";
import { deserialize, serialize } from "./save";
import type { GameState } from "./types";

// The session's facts and its summary (spec chunk 04, issue #40): the ν
// the session made, its class, the seconds credited to the class, and the
// class level before and after.

// Sine, Triangle, Triangle in a triangle: 2.9325 ν/s (chunk 02's layout
// under the opening's pressure, issue #52).
// The third oscillator comes with Engineer Lv 1 (0.5 h of credit).
function laidOut(): GameState {
  let s = fresh();
  giveOscillators(s, { allowance: 3 });
  for (const [module, q, r] of [["sine", 0, 0], ["triangle", 1, 0], ["triangle", 0, 1]] as const) {
    s = apply(s, { type: "placeModule", module, cell: { q, r } }).state;
  }
  return s;
}

function away(state: GameState, seconds: number): void {
  advanceIn(state, seconds, "flow", "away", 0);
  advanceIn(state, 0, "flow");
}

describe("the session's nous", () => {
  it("counts the ν banked from trusted flow time", () => {
    const s = laidOut();
    begin(s, 1500, 0);
    advanceIn(s, 600, "flow");
    expect(s.game.session!.nousMade.toNumber()).toBe(1759.5);
  });

  it("adds the provisional ν once a non-missed answer settles it, and not after a missed one", () => {
    const full = laidOut();
    begin(full, 1500, 0);
    advanceIn(full, 1200, "flow");
    away(full, 600);
    // 5 min trusted up to the plan, 5 min provisional (trust.flushPendingAway).
    expect(full.game.session!.nousMade.toNumber()).toBe(4398.75);
    applyIn(full, { type: "settleHonestyReport", outcome: "full" });
    expect(full.game.session!.nousMade.toNumber()).toBe(5278.5);

    const missed = laidOut();
    begin(missed, 1500, 0);
    advanceIn(missed, 1200, "flow");
    away(missed, 600);
    applyIn(missed, { type: "settleHonestyReport", outcome: "missed" });
    expect(missed.game.session!.nousMade.toNumber()).toBe(4398.75);
    expect(missed.game.nous.toNumber()).toBe(4398.75);
  });
});

describe("the summary", () => {
  it("carries the session's ν, class, class seconds and level before and after", () => {
    const s = laidOut();
    begin(s, 1500, 0);
    advanceIn(s, 1200, "flow");
    away(s, 600);
    applyIn(s, { type: "settleHonestyReport", outcome: "full" });
    applyIn(s, { type: "endSession", now: 5_000 });
    const summary = s.game.summary!;
    expect(summary.nous.toNumber()).toBe(5278.5);
    expect(summary.habitClass).toBe("engineer");
    expect(summary.classSeconds).toBe(1800);
    // 0.5 h before, 1.0 h after: Lv 1 both sides of the session.
    expect(summary.levelBefore).toBe(1);
    expect(summary.levelAfter).toBe(1);
  });

  it("records the level crossed when the session passes a threshold", () => {
    const s = fresh();
    begin(s, 1500, 0);
    advanceIn(s, 1800, "flow");
    applyIn(s, { type: "endSession", now: 5_000 });
    expect(s.game.summary).toMatchObject({ habitClass: "engineer", classSeconds: 1800, levelBefore: 0, levelAfter: 1 });
  });

  it("credits no class to a habit still awaiting one", () => {
    const s = fresh();
    applyIn(s, { type: "createHabit", name: "Piano" });
    begin(s, null, 0, s.records.habits[0]!.id);
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: 5_000 });
    expect(s.game.summary).toMatchObject({ habitClass: null, classSeconds: 0, levelBefore: 0, levelAfter: 0 });
  });
});

describe("saving the session's facts", () => {
  it("round-trips nousMade and the summary's fields", () => {
    const s = laidOut();
    begin(s, 1500, 0);
    advanceIn(s, 600, "flow");
    const mid = deserialize(serialize(s, 1_000)).state!;
    expect(mid.game.session!.nousMade.toNumber()).toBe(1759.5);
    advanceIn(s, 3000, "flow");
    applyIn(s, { type: "endSession", now: 5_000 });
    const loaded = deserialize(serialize(s, 1_000)).state!;
    expect(loaded.game.summary).toEqual(s.game.summary);
    expect(loaded.game.summary).toMatchObject({ habitClass: "engineer", classSeconds: 3600, levelBefore: 1, levelAfter: 2 });
  });

  it("defaults the fields when a save lacks them", () => {
    const s = laidOut();
    begin(s, 1500, 0);
    advanceIn(s, 600, "flow");
    const file = JSON.parse(serialize(s, 1_000));
    delete file.state.game.session.nousMade;
    expect(deserialize(JSON.stringify(file)).state!.game.session!.nousMade).toEqual(D(0));

    const ended = laidOut();
    begin(ended, 1500, 0);
    applyIn(ended, { type: "endSession", now: 5_000 });
    const saved = JSON.parse(serialize(ended, 1_000));
    for (const key of ["nous", "habitClass", "classSeconds", "levelBefore", "levelAfter"]) delete saved.state.game.summary[key];
    expect(deserialize(JSON.stringify(saved)).state!.game.summary).toMatchObject({ nous: D(0), habitClass: null, classSeconds: 0, levelBefore: 0, levelAfter: 0 });
  });
});
