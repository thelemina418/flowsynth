import { describe, expect, it } from "vitest";
import { RECONCILIATION_FLOOR_SECONDS } from "./constants";
import { begin, applyIn, advanceIn, fresh, giveHabit, giveOscillators } from "./fixtures";
import { cloneState } from "./state";
import type { GameState, HonestyOutcome } from "./types";

// The board's nous (spec chunk 02, issue #26): flow credits the board's
// total ν/s for every walked second, trusted time into nous and
// provisional time into the session's provisional nous, which the honesty
// report banks or drops (ADR-0019).

// The acceptance layout: Sine 1 ν/s, two Triangles at 1.75 each, under
// the opening's pressure (issue #52): 29% on the Sine, 34% and 39% on the
// Triangles, so 0.71 + 1.155 + 1.0675 = 2.9325 ν/s.
const RATE = 2.9325;
function acceptanceLayout(): GameState {
  const s = fresh();
  giveOscillators(s, { allowance: 3 });
  applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
  applyIn(s, { type: "placeModule", module: "triangle", cell: { q: 1, r: 0 } });
  applyIn(s, { type: "placeModule", module: "triangle", cell: { q: 0, r: 1 } });
  giveHabit(s, "Piano", "engineer");
  return s;
}

function start(s: GameState, target: number | null = null): void {
  if (!begin(s, target, 0).ok) throw new Error("fixture session failed");
}

describe("trusted flow", () => {
  it("one trusted hour yields exactly 2.9325 × 3600 ν, the Triangles' share 2.2225 × 3600", () => {
    const s = acceptanceLayout();
    start(s);
    advanceIn(s, 3600, "flow");
    expect(s.game.nous.toNumber()).toBe(RATE * 3600);
    const triangles = s.game.rates.oscillators.filter((o) => o.module === "triangle");
    expect(triangles.reduce((sum, o) => sum + o.rate.toNumber() * 3600, 0)).toBeCloseTo(2.2225 * 3600, 9);
  });

  it("an hour walked in 3600 one-second steps yields the same nous", () => {
    const s = acceptanceLayout();
    start(s);
    for (let i = 0; i < 3600; i++) advanceIn(s, 1, "flow");
    // 2.9325 isn't a binary fraction as 4.5 was, so 3600 additions carry
    // float rounding (issue #52); they agree to well under a millionth.
    expect(s.game.nous.toNumber()).toBeCloseTo(RATE * 3600, 6);
  });

  it("an empty board makes nothing", () => {
    const s = fresh();
    giveHabit(s, "Piano", "engineer");
    start(s);
    advanceIn(s, 3600, "flow");
    expect(s.game.nous.toNumber()).toBe(0);
  });
});

describe("nothing accrues outside flow", () => {
  it("an hour in upgrade leaves the laid-out state deep-equal", () => {
    const s = acceptanceLayout();
    const before = cloneState(s);
    advanceIn(s, 3600, "upgrade");
    expect(s).toEqual(before);
  });

  it("an hour paused makes nothing", () => {
    const s = acceptanceLayout();
    start(s);
    applyIn(s, { type: "pauseSession" });
    advanceIn(s, 3600, "flow");
    expect(s.game.nous.toNumber()).toBe(0);
  });

  it("a breather hour outside a breather is a no-op (issue #41)", () => {
    const s = acceptanceLayout();
    start(s);
    const before = cloneState(s);
    advanceIn(s, 3600, "breather");
    expect(s).toEqual(before);
  });
});

describe("provisional flow", () => {
  // An open-ended absence past the floor is wholly provisional.
  function provisionalHour(): GameState {
    const s = acceptanceLayout();
    start(s);
    advanceIn(s, 3600, "flow", "away");
    advanceIn(s, 0, "flow");
    return s;
  }

  it("goes only to the provisional nous", () => {
    expect(3600).toBeGreaterThan(RECONCILIATION_FLOOR_SECONDS);
    const s = provisionalHour();
    expect(s.game.nous.toNumber()).toBe(0);
    expect(s.game.session!.accounting.provisionalNous.toNumber()).toBe(RATE * 3600);
  });

  it.each<[HonestyOutcome, number]>([
    ["full", RATE * 3600],
    ["missed", 0],
  ])("the honesty report answered %s settles nous at %d", (outcome, nous) => {
    const s = provisionalHour();
    expect(applyIn(s, { type: "settleHonestyReport", outcome }).ok).toBe(true);
    expect(s.game.nous.toNumber()).toBe(nous);
    expect(s.game.session!.accounting.provisionalNous.toNumber()).toBe(0);
  });
});
