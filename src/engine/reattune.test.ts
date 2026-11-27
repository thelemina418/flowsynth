import { describe, expect, it } from "vitest";
import type { Action } from "./apply";
import { advanceIn, applyIn, begin, fresh, habitOf } from "./fixtures";
import { classLevel } from "./levels";

// Re-attuning (issue #43): a habit's class changes between sessions, and
// credit already earned stays with the class that earned it.
describe("re-attuning a habit", () => {
  it("leaves every class level where it was and sends the next credited flow to the new class", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano", habitClass: "engineer" }));
    begin(s, 1800, 0, piano.id);
    advanceIn(s, 1800, "flow");
    applyIn(s, { type: "endSession", now: 1_800_000 });
    const credit = { ...s.records.classCredit };
    expect(classLevel(s, "engineer").level).toBe(1);

    expect(applyIn(s, { type: "reattuneHabit", habitId: piano.id, habitClass: "producer" }).ok).toBe(true);
    expect(piano.habitClass).toBe("producer");
    expect(s.records.classCredit).toEqual(credit);
    expect(classLevel(s, "engineer").level).toBe(1);
    expect(classLevel(s, "producer").level).toBe(0);
    expect(piano.seconds).toBe(1800);

    begin(s, 1800, 2_000_000, piano.id);
    advanceIn(s, 1800, "flow");
    expect(s.records.classCredit).toEqual({ ...credit, producer: 1800 });
    expect(classLevel(s, "engineer").level).toBe(1);
    expect(classLevel(s, "producer").level).toBe(1);
  });

  it("refuses an unknown or archived habit, a closed class, the same class, a habit awaiting its class, and flow, changing nothing", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano", habitClass: "engineer" }));
    const old = habitOf(s, applyIn(s, { type: "createHabit", name: "Old", habitClass: "engineer" }));
    applyIn(s, { type: "archiveHabit", id: old.id });
    const waiting = habitOf(s, applyIn(s, { type: "createHabit", name: "Waiting" }));
    const refused = (action: Action, reason: string) => {
      const before = structuredClone(s);
      const result = applyIn(s, action);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(reason);
      expect(s).toEqual(before);
    };
    refused({ type: "reattuneHabit", habitId: "nope", habitClass: "producer" }, "Habit not found.");
    refused({ type: "reattuneHabit", habitId: old.id, habitClass: "producer" }, "Habit not found.");
    refused({ type: "reattuneHabit", habitId: piano.id, habitClass: "roadie" }, "The Roadie class isn't open yet.");
    refused({ type: "reattuneHabit", habitId: piano.id, habitClass: "engineer" }, "Piano is already Engineer.");
    refused({ type: "reattuneHabit", habitId: waiting.id, habitClass: "producer" }, "Choose this habit's class first.");
    begin(s, 600, 0, piano.id);
    refused({ type: "reattuneHabit", habitId: piano.id, habitClass: "producer" }, "Habits are managed between sessions.");
  });
});
