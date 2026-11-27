import { describe, expect, it } from "vitest";
import { advance } from "./advance";
import { endSession, pauseSession, resumeSession, startSession } from "./actions";
import { fresh, giveHabit } from "./fixtures";

// Session rules (ADR-0019) in the interim shape (issue #15): time moves only
// the session's practice facts, so credited seconds are what a span earns.
function credited(state: ReturnType<typeof fresh>, seconds: number): number {
  const before = state.session?.accounting.creditedSeconds ?? 0;
  advance(state, seconds);
  return (state.session?.accounting.creditedSeconds ?? 0) - before;
}

describe("session rules", () => {
  it("credits nothing in upgrade mode or while paused", () => {
    const s = fresh();
    expect(advance(s, 100)).toEqual({ goalsCompleted: 0 });
    startSession(s, 600);
    pauseSession(s);
    expect(credited(s, 100)).toBe(0);
    expect(s.session?.elapsed).toBe(0);
    resumeSession(s);
    expect(credited(s, 1)).toBe(1);
  });

  it("zero elapsed time credits nothing", () => {
    const s = fresh();
    startSession(s, 600);
    expect(credited(s, 0)).toBe(0);
  });

  it("splitting the walk preserves credited time", () => {
    const a = fresh();
    startSession(a, 600);
    const full = credited(a, 600);
    const b = fresh();
    startSession(b, 600);
    expect(credited(b, 20) + credited(b, 580)).toBeCloseTo(full, 9);
  });

  it("open-ended sessions credit the active habit with present time", () => {
    const s = fresh();
    const { habit } = giveHabit(s);
    startSession(s, null);
    expect(credited(s, 3600)).toBe(3600);
    expect(habit.seconds).toBe(3600);
    expect(s.session?.target).toBeNull();
  });

  it("reaching the target is informational only; crediting continues unchanged", () => {
    const s = fresh();
    startSession(s, 600);
    expect(credited(s, 600)).toBe(600);
    expect(credited(s, 100)).toBe(100);
    expect(s.session?.elapsed).toBe(700);
  });

  it("ending early keeps the credited time in the record", () => {
    const s = fresh();
    startSession(s, 600, 1_000);
    credited(s, 300);
    expect(endSession(s, 301_000).ok).toBe(true);
    expect(s.sessionsCompleted).toBe(1);
    expect(s.sessionRecords[0]).toMatchObject({ creditedSeconds: 300, plannedTarget: 600, mode: "planned" });
    expect(s.summary).toMatchObject({ seconds: 300, plannedTarget: 600, seen: false });
  });

  it("accepts any timed duration; presets are a UI concern, not an engine rule", () => {
    const s = fresh();
    expect(startSession(s, 30).ok).toBe(true);
    expect(credited(s, 30)).toBe(30);
  });
});
