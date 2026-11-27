import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { advance } from "./advance";
import { fresh, giveHabit } from "./fixtures";

// Session rules (ADR-0019) in the interim shape (issue #15): time moves only
// the session's practice facts, so credited seconds are what a span earns.
function credited(state: ReturnType<typeof fresh>, seconds: number): number {
  const before = state.game.session?.accounting.creditedSeconds ?? 0;
  advance(state, seconds, "flow");
  return (state.game.session?.accounting.creditedSeconds ?? 0) - before;
}

describe("session rules", () => {
  it("credits nothing in upgrade mode or while paused", () => {
    const s = fresh();
    expect(advance(s, 100, "flow")).toEqual({ goalsCompleted: 0 });
    apply(s, { type: "startSession", target: 600, now: 0 });
    apply(s, { type: "pauseSession" });
    expect(credited(s, 100)).toBe(0);
    expect(s.game.session?.elapsed).toBe(0);
    apply(s, { type: "resumeSession" });
    expect(credited(s, 1)).toBe(1);
  });

  it("zero elapsed time credits nothing", () => {
    const s = fresh();
    apply(s, { type: "startSession", target: 600, now: 0 });
    expect(credited(s, 0)).toBe(0);
  });

  it("splitting the walk preserves credited time", () => {
    const a = fresh();
    apply(a, { type: "startSession", target: 600, now: 0 });
    const full = credited(a, 600);
    const b = fresh();
    apply(b, { type: "startSession", target: 600, now: 0 });
    expect(credited(b, 20) + credited(b, 580)).toBeCloseTo(full, 9);
  });

  it("open-ended sessions credit the active habit with present time", () => {
    const s = fresh();
    const { habit } = giveHabit(s);
    apply(s, { type: "startSession", target: null, now: 0 });
    expect(credited(s, 3600)).toBe(3600);
    expect(habit.seconds).toBe(3600);
    expect(s.game.session?.target).toBeNull();
  });

  it("reaching the target is informational only; crediting continues unchanged", () => {
    const s = fresh();
    apply(s, { type: "startSession", target: 600, now: 0 });
    expect(credited(s, 600)).toBe(600);
    expect(credited(s, 100)).toBe(100);
    expect(s.game.session?.elapsed).toBe(700);
  });

  it("ending early keeps the credited time in the record", () => {
    const s = fresh();
    apply(s, { type: "startSession", target: 600, now: 1_000 });
    credited(s, 300);
    expect(apply(s, { type: "endSession", now: 301_000 }).ok).toBe(true);
    expect(s.records.sessionsCompleted).toBe(1);
    expect(s.records.sessionRecords[0]).toMatchObject({ creditedSeconds: 300, plannedTarget: 600, mode: "planned" });
    expect(s.game.summary).toMatchObject({ seconds: 300, plannedTarget: 600, seen: false });
  });

  it("accepts any timed duration; presets are a UI concern, not an engine rule", () => {
    const s = fresh();
    expect(apply(s, { type: "startSession", target: 30, now: 0 }).ok).toBe(true);
    expect(credited(s, 30)).toBe(30);
  });
});
