import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { begin, applyIn, advanceIn, fresh, giveHabit, habitOf } from "./fixtures";

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
    expect({ ...advanceIn(s, 100, "flow"), state: undefined }).toEqual({ intentionsCompleted: 0 });
    begin(s, 600, 0);
    applyIn(s, { type: "pauseSession" });
    expect(credited(s, 100)).toBe(0);
    expect(s.game.session?.elapsed).toBe(0);
    applyIn(s, { type: "resumeSession" });
    expect(credited(s, 1)).toBe(1);
  });

  it("zero elapsed time credits nothing", () => {
    const s = fresh();
    begin(s, 600, 0);
    expect(credited(s, 0)).toBe(0);
  });

  it("splitting the walk preserves credited time", () => {
    const a = fresh();
    begin(a, 600, 0);
    const full = credited(a, 600);
    const b = fresh();
    begin(b, 600, 0);
    expect(credited(b, 20) + credited(b, 580)).toBeCloseTo(full, 9);
  });

  it("open-ended sessions credit the active habit with present time", () => {
    const s = fresh();
    const { habit } = giveHabit(s);
    begin(s, null, 0);
    expect(credited(s, 3600)).toBe(3600);
    expect(habit.seconds).toBe(3600);
    expect(s.game.session?.target).toBeNull();
  });

  it("reaching the target is informational only; crediting continues unchanged", () => {
    const s = fresh();
    begin(s, 600, 0);
    expect(credited(s, 600)).toBe(600);
    expect(credited(s, 100)).toBe(100);
    expect(s.game.session?.elapsed).toBe(700);
  });

  it("ending early keeps the credited time in the record", () => {
    const s = fresh();
    begin(s, 600, 1_000);
    credited(s, 300);
    expect(applyIn(s, { type: "endSession", now: 301_000 }).ok).toBe(true);
    expect(s.records.sessionsCompleted).toBe(1);
    expect(s.records.sessionRecords[0]).toMatchObject({ creditedSeconds: 300, plannedTarget: 600, mode: "planned" });
    expect(s.game.summary).toMatchObject({ seconds: 300, plannedTarget: 600, seen: false });
  });

  describe("starting a session carries the habit (issue #39)", () => {
    function refused(s: ReturnType<typeof fresh>, action: Parameters<typeof applyIn>[1], reason: string): void {
      const before = structuredClone(s);
      const result = apply(s, action);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(reason);
      expect(result.state).toEqual(before);
    }

    it("selects the habit and starts in one action", () => {
      const s = fresh();
      const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano", habitClass: "engineer" }));
      expect(applyIn(s, { type: "startSession", habitId: piano.id, target: 1500, now: 0 }).ok).toBe(true);
      expect(s.records.activeHabitId).toBe(piano.id);
      expect(s.game.mode).toBe("flow");
      expect(s.game.session?.target).toBe(1500);
    });

    it("is refused without a known habit", () => {
      const s = fresh();
      refused(s, { type: "startSession", habitId: "h404", target: 1500, now: 0 }, "Choose a habit first.");
    });

    it("is refused for a habit still awaiting its class", () => {
      const s = fresh();
      const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
      refused(s, { type: "startSession", habitId: piano.id, target: 1500, now: 0 }, "Choose a habit first.");
    });

    it("is refused for an archived habit", () => {
      const s = fresh();
      const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano", habitClass: "engineer" }));
      applyIn(s, { type: "archiveHabit", id: piano.id });
      refused(s, { type: "startSession", habitId: piano.id, target: 1500, now: 0 }, "Choose a habit first.");
    });

    it("is refused for a length outside 10 to 180 minutes, or none", () => {
      const s = fresh();
      const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano", habitClass: "engineer" }));
      refused(s, { type: "startSession", habitId: piano.id, target: 9 * 60, now: 0 }, "Choose a length from 10 to 180 minutes.");
      refused(s, { type: "startSession", habitId: piano.id, target: 181 * 60, now: 0 }, "Choose a length from 10 to 180 minutes.");
      refused(s, { type: "startSession", habitId: piano.id, target: null, now: 0 }, "Choose a length from 10 to 180 minutes.");
      expect(applyIn(s, { type: "startSession", habitId: piano.id, target: 10 * 60, now: 0 }).ok).toBe(true);
    });

    it("accepts the full 180 minutes", () => {
      const s = fresh();
      const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano", habitClass: "engineer" }));
      expect(applyIn(s, { type: "startSession", habitId: piano.id, target: 180 * 60, now: 0 }).ok).toBe(true);
    });
  });
});
