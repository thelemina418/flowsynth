import { describe, expect, it } from "vitest";
import { RECONCILIATION_FLOOR_SECONDS } from "./constants";
import { applyIn, advanceIn, fresh, giveHabit, giveOscillators } from "./fixtures";
import { cloneState } from "./state";
import type { GameState, HonestyOutcome } from "./types";

// The board's nous (spec chunk 02, issue #26): flow credits the board's
// total ν/s for every walked second, trusted time into nous and
// provisional time into the session's provisional nous, which the honesty
// report banks or drops (ADR-0019).

// The acceptance layout: Sine 1 ν/s, two Triangles at 1.75 each.
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
  if (!applyIn(s, { type: "startSession", target, now: 0 }).ok) throw new Error("fixture session failed");
}

describe("trusted flow", () => {
  it("one trusted hour yields exactly (1 + 1.75 + 1.75) × 3600 ν, the Triangles' share 3.5 × 3600", () => {
    const s = acceptanceLayout();
    start(s);
    advanceIn(s, 3600, "flow");
    expect(s.game.nous.toNumber()).toBe(4.5 * 3600);
    const triangles = s.game.rates.oscillators.filter((o) => o.module === "triangle");
    expect(triangles.reduce((sum, o) => sum + o.rate.toNumber() * 3600, 0)).toBe(3.5 * 3600);
  });

  it("an hour walked in 3600 one-second steps yields the same exact nous", () => {
    const s = acceptanceLayout();
    start(s);
    for (let i = 0; i < 3600; i++) advanceIn(s, 1, "flow");
    expect(s.game.nous.toNumber()).toBe(4.5 * 3600);
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

  it("a breather hour is still a no-op", () => {
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
    expect(s.game.session!.accounting.provisionalNous.toNumber()).toBe(4.5 * 3600);
  });

  it.each<[HonestyOutcome, number]>([
    ["full", 4.5 * 3600],
    ["missed", 0],
  ])("the honesty report answered %s settles nous at %d", (outcome, nous) => {
    const s = provisionalHour();
    expect(applyIn(s, { type: "settleHonestyReport", outcome }).ok).toBe(true);
    expect(s.game.nous.toNumber()).toBe(nous);
    expect(s.game.session!.accounting.provisionalNous.toNumber()).toBe(0);
  });
});
