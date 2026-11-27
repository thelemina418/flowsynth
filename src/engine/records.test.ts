import { describe, expect, it } from "vitest";
import { habitPracticeSummary, habitRecordName, habitTaggedNotes, recordMissed, recordTargetHit, sessionRecordsNewestFirst } from "./records";
import { deserialize, serialize } from "./save";
import type { GameState } from "./types";
import { applyIn, advanceIn, fresh, habitOf, intentionOf } from "./fixtures";

// Session records (focus-tool spec §9): one append-only entry per session
// at close, whatever its length or mode; history derives hits and misses,
// and ids resolve at render.

const START = new Date(2026, 8, 18, 9, 0).getTime();
const END = START + 30 * 60_000;

function practice(state: GameState, seconds: number): void {
  advanceIn(state, seconds, "flow");
}

describe("the session record", () => {
  it("every session writes exactly one record at close — planned, open-ended, unstructured, seconds-long", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: habit.id });
    applyIn(s, { type: "startSession", target: 600, now: START });
    practice(s, 600);
    applyIn(s, { type: "endSession", now: START + 600_000 });

    applyIn(s, { type: "startSession", target: null, now: START + 700_000 });
    practice(s, 60);
    applyIn(s, { type: "endSession", now: START + 760_000 });

    applyIn(s, { type: "selectHabit", id: null });
    applyIn(s, { type: "startSession", target: null, now: START + 800_000 });
    applyIn(s, { type: "endSession", now: START + 800_500 });

    applyIn(s, { type: "startSession", target: 600, now: START + 900_000 });
    applyIn(s, { type: "endSession", now: START + 900_400 });

    expect(s.records.sessionRecords).toHaveLength(4);
    expect(s.records.sessionRecords.map((r) => r.sessionNumber)).toEqual([1, 2, 3, 4]);
    expect(s.records.sessionRecords[0]!.mode).toBe("planned");
    expect(s.records.sessionRecords[1]!.mode).toBe("open-ended");
    expect(s.records.sessionRecords[2]!.habitId).toBeNull();
    expect(s.records.sessionRecords[3]!.creditedSeconds).toBe(0);
    // Append-only: nothing prunes or rewrites earlier entries.
    expect(s.records.sessionRecords[0]!.sessionNumber).toBe(1);
  });

  it("carries the start and end stamps from the wall clock", () => {
    const s = fresh();
    applyIn(s, { type: "startSession", target: 600, now: START });
    practice(s, 600);
    applyIn(s, { type: "endSession", now: END });
    expect(s.records.sessionRecords[0]!.startedAt).toBe(START);
    expect(s.records.sessionRecords[0]!.endedAt).toBe(END);
  });

  it("a pre-§9 session resumed without a start stamp dates its record at close, not 1970", () => {
    const s = fresh();
    applyIn(s, { type: "startSession", target: 600, now: 0 });
    practice(s, 60);
    applyIn(s, { type: "endSession", now: END });
    expect(s.records.sessionRecords[0]!.startedAt).toBe(END);
  });

  it("stores credited seconds post-reconciliation and earned after a bucket drop", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: habit.id });
    applyIn(s, { type: "startSession", target: 600, now: START });
    practice(s, 600);
    // Half an hour away past the plan, reported as a miss: C stays at the
    // plan.
    advanceIn(s, 1800, "flow", "away", 0);
    advanceIn(s, 0, "flow");
    applyIn(s, { type: "settleHonestyReport", outcome: "missed" });
    applyIn(s, { type: "endSession", now: END });
    const record = s.records.sessionRecords[0]!;
    expect(record.creditedSeconds).toBe(600);
    expect(record.honestyEvents).toEqual([{ awaySeconds: 1800, outcome: "missed" }]);
  });

  it("a planned honesty answer lifts credited seconds above presence", () => {
    const s = fresh();
    applyIn(s, { type: "startSession", target: 1800, now: START });
    practice(s, 1800);
    advanceIn(s, 600, "flow", "away", 0);
    advanceIn(s, 0, "flow");
    applyIn(s, { type: "settleHonestyReport", outcome: "planned" });
    applyIn(s, { type: "endSession", now: END });
    const record = s.records.sessionRecords[0]!;
    expect(record.creditedSeconds).toBe(1800);
    expect(recordTargetHit(record)).toBe(true);
    expect(recordMissed(record)).toBe(false);
  });

  it("the reflection joins the record as the summary records it", () => {
    const s = fresh();
    applyIn(s, { type: "startSession", target: 600, now: START });
    practice(s, 600);
    applyIn(s, { type: "endSession", now: END });
    expect(s.records.sessionRecords[0]!.reflection).toBeNull();
    applyIn(s, { type: "reflect", text: "steady", slider: 5 });
    expect(s.records.sessionRecords[0]!.reflection).toEqual({ text: "steady", slider: 5 });
  });

  it("goals advanced snapshot at close: deleting the goal never rewrites history", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: habit.id });
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "once", now: START }));
    applyIn(s, { type: "startSession", target: null, now: START });
    practice(s, 120);
    applyIn(s, { type: "endSession", now: END });
    expect(s.records.sessionRecords[0]!.goalsAdvanced).toMatchObject([{ goalId: goal.id, seconds: 120 }]);
    applyIn(s, { type: "deleteIntention", id: goal.id });
    expect(s.records.sessionRecords[0]!.goalsAdvanced).toMatchObject([{ goalId: goal.id, seconds: 120 }]);
  });

  it("credited provisional time from the honesty report joins the goals-advanced snapshot", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: habit.id });
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 40, schedule: "once", now: START }));
    applyIn(s, { type: "startSession", target: 1800, now: START });
    practice(s, 1800);
    advanceIn(s, 600, "flow", "away", 0);
    advanceIn(s, 0, "flow");
    applyIn(s, { type: "settleHonestyReport", outcome: "full" });
    applyIn(s, { type: "endSession", now: END });
    // 30 presence minutes + 10 credited from the report complete the 40.
    expect(s.records.sessionRecords[0]!.goalsAdvanced).toMatchObject([{ goalId: goal.id, seconds: 2400 }]);
  });

  it("manual practice logs never join a session's goals-advanced snapshot", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: habit.id });
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "once", now: START });
    applyIn(s, { type: "logPractice", habitId: habit.id, minutes: 10, now: START });
    applyIn(s, { type: "startSession", target: null, now: START });
    practice(s, 60);
    applyIn(s, { type: "endSession", now: END });
    expect(s.records.sessionRecords[0]!.goalsAdvanced).toEqual([]);
  });

  it("the id resolves at render: renames and archiving never rewrite history", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: habit.id });
    applyIn(s, { type: "startSession", target: 600, now: START });
    practice(s, 600);
    applyIn(s, { type: "endSession", now: END });
    expect(s.records.sessionRecords[0]!.habitId).toBe(habit.id);
    applyIn(s, { type: "renameHabit", id: habit.id, name: "Fortepiano" });
    applyIn(s, { type: "archiveHabit", id: habit.id });
    expect(s.records.sessionRecords[0]!.habitId).toBe(habit.id);
    expect(habitRecordName(s, habit.id)).toBe("Fortepiano");
  });

  it("records survive a save round-trip intact", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: habit.id });
    applyIn(s, { type: "startSession", target: 600, now: START });
    practice(s, 600);
    applyIn(s, { type: "endSession", now: END });
    applyIn(s, { type: "reflect", text: "kept" });
    const loaded = deserialize(serialize(s, END))!;
    expect(loaded.error).toBeUndefined();
    expect(loaded.state!.records.sessionRecords).toEqual(s.records.sessionRecords);
  });

  it("the newest-first view reverses the append-only run", () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) {
      applyIn(s, { type: "startSession", target: null, now: START + i * 1000 });
      applyIn(s, { type: "endSession", now: START + i * 1000 + 500 });
    }
    expect(sessionRecordsNewestFirst(s).map((r) => r.sessionNumber)).toEqual([3, 2, 1]);
  });
});

describe("habit development aggregates (§9)", () => {
  it("sessions practiced counts live sessions only; last practiced reads live and manual together", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: habit.id });
    applyIn(s, { type: "startSession", target: null, now: START });
    practice(s, 60);
    applyIn(s, { type: "endSession", now: START + 120_000 });
    applyIn(s, { type: "logPractice", habitId: habit.id, minutes: 10, now: START + 500_000 });
    const summary = habitPracticeSummary(s, habit.id);
    expect(summary.sessions).toBe(1);
    expect(summary.lastPracticed).toBe(START + 500_000);
  });

  it("an untouched habit reports zero sessions and no last-practiced date", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    expect(habitPracticeSummary(s, habit.id)).toEqual({ sessions: 0, lastPracticed: null });
  });

  it("tagged notes list newest first", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: habit.id });
    applyIn(s, { type: "startSession", target: null, now: START });
    applyIn(s, { type: "writeNote", text: "first thought", now: START + 1000 });
    applyIn(s, { type: "writeNote", text: "second thought", now: START + 2000 });
    expect(habitTaggedNotes(s, habit.id).map((n) => n.text)).toEqual(["second thought", "first thought"]);
  });
});
