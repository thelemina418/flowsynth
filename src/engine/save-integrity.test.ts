import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { advance } from "./advance";
import { deserialize, serialize } from "./save";
import { fresh, giveHabit } from "./fixtures";
import type { GameState } from "./types";

// Save integrity at the numeric limits (issue #486): an update whose
// arithmetic leaves the representable range is refused whole — no invalid
// figure, no half-applied span — and the state it leaves behind still saves
// and loads. Interim (issue #15): with the board retired, the figures at the
// limit are the session's clock, credited time and provisional pool.

// Near the top of the double range: one more large span overflows.
const EDGE = 1.7e308;

function flowState(target: number | null = null): GameState {
  const s = fresh();
  giveHabit(s);
  apply(s, { type: "startSession", target: target, now: 0 });
  return s;
}

describe("the advance walk refuses what it cannot represent (issue #486)", () => {
  it("a session clock past the representable range refuses the span and commits nothing", () => {
    const s = flowState();
    s.game.session!.elapsed = EDGE;
    const before = serialize(s, 1000);
    const result = advance(s, EDGE, "flow");
    expect(result.fault).toBe("the session clock");
    expect(serialize(s, 1000)).toBe(before);
  });

  it("credited time past the range refuses the span, habit and goal untouched", () => {
    const s = fresh();
    const { habit } = giveHabit(s);
    expect(apply(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "once", now: 1 }).ok).toBe(true);
    apply(s, { type: "startSession", target: null, now: 0 });
    s.game.session!.accounting.creditedSeconds = EDGE;
    const before = serialize(s, 1000);
    expect(advance(s, EDGE, "flow").fault).toBe("the credited practice time");
    expect(serialize(s, 1000)).toBe(before);
  });

  it("a big-but-finite span still credits: the refusal never bites the representable range", () => {
    const s = flowState();
    expect(advance(s, 1e300, "flow").fault).toBeUndefined();
    expect(s.game.session!.accounting.creditedSeconds).toBe(1e300);
  });

  it("a paused session advances nothing even at the edge", () => {
    const s = flowState();
    s.game.session!.elapsed = EDGE;
    apply(s, { type: "pauseSession" });
    expect(advance(s, EDGE, "flow")).toEqual({ goalsCompleted: 0 });
  });
});

describe("every sink refuses whole (issue #486)", () => {
  it("a provisional span's refused moments leave no pool", () => {
    const s = flowState();
    s.game.session!.accounting.poolSeconds = EDGE;
    s.game.session!.accounting.pendingAwaySeconds = EDGE;
    const before = serialize(s, 1000);
    // The return of presence classifies the open-ended absence as provisional.
    expect(advance(s, 0, "flow").fault).toBe("the provisional pool");
    expect(serialize(s, 1000)).toBe(before);
  });

  it("an honesty report crediting an unrepresentable figure is refused before it credits a minute", () => {
    const s = flowState();
    s.game.session!.accounting.creditedSeconds = EDGE;
    s.game.session!.accounting.poolSeconds = EDGE;
    const before = serialize(s, 1000);
    const resolution = apply(s, { type: "settleHonestyReport", outcome: "full" });
    expect(resolution.ok).toBe(false);
    expect(resolution.reason).toBeTruthy();
    expect(serialize(s, 1000)).toBe(before);
  });
});

describe("failure without destructive mutation, then a valid save (issue #486)", () => {
  it("prior valid progress survives the refused update and saves whole", () => {
    const s = flowState();
    expect(advance(s, 60, "flow").fault).toBeUndefined();
    s.game.session!.elapsed = EDGE;
    expect(advance(s, EDGE, "flow").fault).toBeTruthy();
    expect(s.game.session!.accounting.creditedSeconds).toBe(60);
    const reloaded = deserialize(serialize(s, 1000));
    expect(reloaded.state?.game.session?.accounting.creditedSeconds).toBe(60);
    expect(reloaded.state?.records.habits[0]!.seconds).toBe(60);
  });

  it("a refused absence survives reload and retries once", () => {
    const s = flowState();
    s.game.session!.elapsed = EDGE;
    s.game.session!.accounting.pendingAwaySeconds = EDGE;
    const before = serialize(s, 1000);
    expect(advance(s, 0, "flow").fault).toBeTruthy();
    expect(serialize(s, 1000)).toBe(before);
    const restored = deserialize(before).state!;
    restored.game.session!.elapsed = 0;
    expect(advance(restored, 0, "flow").fault).toBeUndefined();
    expect(restored.game.session!.accounting.pendingAwaySeconds).toBe(0);
    const settled = serialize(restored, 1000);
    advance(restored, 0, "flow");
    expect(serialize(restored, 1000)).toBe(settled);
  });

  it("a refused absence prevents the following live slice from committing", () => {
    const s = flowState();
    s.game.session!.elapsed = EDGE;
    s.game.session!.accounting.pendingAwaySeconds = EDGE;
    expect(advance(s, 60, "flow", "visible", 0).fault).toBeTruthy();
    expect(s.game.session!.accounting.pendingAwaySeconds).toBe(EDGE);
    expect(s.game.session!.accounting.creditedSeconds).toBe(0);
  });

  it("a provisional failure rolls back the successful trusted half of a split absence", () => {
    const s = flowState(600);
    s.game.session!.accounting.poolSeconds = EDGE;
    s.game.session!.accounting.pendingAwaySeconds = 1e308;
    const before = serialize(s, 1000);
    const result = advance(s, 0, "flow");
    expect(result.fault).toBe("the provisional pool");
    expect(serialize(s, 1000)).toBe(before);
  });
});
