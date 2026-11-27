import { describe, expect, it } from "vitest";
import { applyIn, advanceIn, fresh, giveHabit } from "./fixtures";

// Session rules (ADR-0019) in the interim shape (issue #15): time moves only
// the session's practice facts, so credited seconds are what a span earns.
function credited(state: ReturnType<typeof fresh>, seconds: number): number {
  const before = state.game.session?.accounting.creditedSeconds ?? 0;
  advanceIn(state, seconds, "flow");
  return (state.game.session?.accounting.creditedSeconds ?? 0) - before;
}

describe("session rules", () => {
  it("credits nothing in upgrade mode or while paused", () => {
    const s = fresh();
    expect({ ...advanceIn(s, 100, "flow"), state: undefined }).toEqual({ goalsCompleted: 0 });
    applyIn(s, { type: "startSession", target: 600, now: 0 });
    applyIn(s, { type: "pauseSession" });
    expect(credited(s, 100)).toBe(0);
    expect(s.game.session?.elapsed).toBe(0);
    applyIn(s, { type: "resumeSession" });
    expect(credited(s, 1)).toBe(1);
  });

  it("zero elapsed time credits nothing", () => {
    const s = fresh();
    applyIn(s, { type: "startSession", target: 600, now: 0 });
    expect(credited(s, 0)).toBe(0);
  });

  it("splitting the walk preserves credited time", () => {
    const a = fresh();
    applyIn(a, { type: "startSession", target: 600, now: 0 });
    const full = credited(a, 600);
    const b = fresh();
    applyIn(b, { type: "startSession", target: 600, now: 0 });
    expect(credited(b, 20) + credited(b, 580)).toBeCloseTo(full, 9);
  });

  it("open-ended sessions credit the active habit with present time", () => {
    const s = fresh();
    const { habit } = giveHabit(s);
    applyIn(s, { type: "startSession", target: null, now: 0 });
    expect(credited(s, 3600)).toBe(3600);
    expect(habit.seconds).toBe(3600);
    expect(s.game.session?.target).toBeNull();
  });

  it("reaching the target is informational only; crediting continues unchanged", () => {
    const s = fresh();
    applyIn(s, { type: "startSession", target: 600, now: 0 });
    expect(credited(s, 600)).toBe(600);
    expect(credited(s, 100)).toBe(100);
    expect(s.game.session?.elapsed).toBe(700);
  });

  it("ending early keeps the credited time in the record", () => {
    const s = fresh();
    applyIn(s, { type: "startSession", target: 600, now: 1_000 });
    credited(s, 300);
    expect(applyIn(s, { type: "endSession", now: 301_000 }).ok).toBe(true);
    expect(s.records.sessionsCompleted).toBe(1);
    expect(s.records.sessionRecords[0]).toMatchObject({ creditedSeconds: 300, plannedTarget: 600, mode: "planned" });
    expect(s.game.summary).toMatchObject({ seconds: 300, plannedTarget: 600, seen: false });
  });

  it("accepts any timed duration; presets are a UI concern, not an engine rule", () => {
    const s = fresh();
    expect(applyIn(s, { type: "startSession", target: 30, now: 0 }).ok).toBe(true);
    expect(credited(s, 30)).toBe(30);
  });
});
