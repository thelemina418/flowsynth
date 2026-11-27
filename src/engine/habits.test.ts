import { describe, expect, it } from "vitest";
import { begin, applyIn, advanceIn, fresh, habitOf } from "./fixtures";
import { activeHabit, DEFAULT_HABIT_COLOR, HABIT_COLORS, normalizeHabitColor } from "./habits";
import { serialize, deserialize } from "./save";

describe("habit management", () => {
  it("creates, renames, and archives habits between sessions only", () => {
    const s = fresh();
    const made = applyIn(s, { type: "createHabit", name: "  Piano  " });
    expect(made.ok).toBe(true);
    expect(habitOf(s, made).name).toBe("Piano");
    expect(applyIn(s, { type: "createHabit", name: "   " }).ok).toBe(false);

    expect(applyIn(s, { type: "renameHabit", id: made.id!, name: "Cooking" }).ok).toBe(true);
    expect(applyIn(s, { type: "archiveHabit", id: made.id! }).ok).toBe(true);
    expect(activeHabit(s)).toBeUndefined();

    begin(s, 600, 0);
    expect(applyIn(s, { type: "createHabit", name: "X" }).ok).toBe(false);
    expect(applyIn(s, { type: "renameHabit", id: "h1", name: "Y" }).ok).toBe(false);
    expect(applyIn(s, { type: "archiveHabit", id: "h1" }).ok).toBe(false);
    expect(applyIn(s, { type: "selectHabit", id: null }).ok).toBe(false);
  });

  it("archives the active habit cleanly", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    expect(applyIn(s, { type: "selectHabit", id: habit.id }).ok).toBe(true);
    expect(s.records.activeHabitId).toBe(habit.id);
    applyIn(s, { type: "archiveHabit", id: habit.id });
    expect(s.records.activeHabitId).toBeNull();
  });

  it("selection accepts null (unstructured practice) and rejects unknown habits", () => {
    const s = fresh();
    expect(applyIn(s, { type: "selectHabit", id: null }).ok).toBe(true);
    expect(applyIn(s, { type: "selectHabit", id: "nope" }).ok).toBe(false);
  });
});

describe("the habit's palette (issue #445, ADR-0075)", () => {
  it("creates with the default color and re-colors between sessions only, on real habits with real keys", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    expect(habit.color).toBe(DEFAULT_HABIT_COLOR);
    expect(HABIT_COLORS).toEqual(["vermillion", "amber", "green", "cyan", "indigo", "violet"]);
    expect(applyIn(s, { type: "recolorHabit", id: habit.id, color: "cyan" }).ok).toBe(true);
    expect(habit.color).toBe("cyan");
    expect(applyIn(s, { type: "recolorHabit", id: "nope", color: "amber" }).ok).toBe(false);
    expect(applyIn(s, { type: "recolorHabit", id: habit.id, color: "chartreuse" as never }).ok).toBe(false);
    expect(habit.color).toBe("cyan");
    begin(s, 600, 0);
    expect(applyIn(s, { type: "recolorHabit", id: habit.id, color: "amber" }).ok).toBe(false);
    applyIn(s, { type: "endSession", now: 0 });
    expect(habit.color).toBe("cyan");
  });

  it("lenient-defaults a pre-palette save's color and drops corrupt keys", () => {
    expect(normalizeHabitColor(undefined)).toBe(DEFAULT_HABIT_COLOR);
    expect(normalizeHabitColor(7)).toBe(DEFAULT_HABIT_COLOR);
    expect(normalizeHabitColor("violet")).toBe("violet");
  });

  it("persists the color across saves", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "recolorHabit", id: habit.id, color: "indigo" });
    const loaded = deserialize(serialize(s, 0)).state!;
    expect(loaded.records.habits[0]!.color).toBe("indigo");
  });
});

describe("habit development", () => {
  it("accrues live flow time for the selected habit only, one-for-one", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: piano.id });
    begin(s, 600, 0);
    advanceIn(s, 300, "flow");
    expect(piano.seconds).toBeCloseTo(300, 6);
    applyIn(s, { type: "endSession", now: 1_000 });

    const cooking = habitOf(s, applyIn(s, { type: "createHabit", name: "Cooking" }));
    applyIn(s, { type: "selectHabit", id: cooking.id });
    begin(s, 600, 0);
    advanceIn(s, 120, "flow");
    expect(piano.seconds).toBeCloseTo(300, 6);
    expect(cooking.seconds).toBeCloseTo(120, 6);
  });

  it("does not accrue while paused or in upgrade mode", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: piano.id });
    begin(s, 600, 0);
    advanceIn(s, 60, "flow");
    s.game.mode = "paused";
    advanceIn(s, 600, "flow");
    s.game.mode = "flow";
    advanceIn(s, 60, "flow");
    applyIn(s, { type: "endSession", now: 0 });
    expect(piano.seconds).toBeCloseTo(120, 6);
  });

  it("manual logs advance the habit's credited time", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "logPractice", habitId: piano.id, minutes: 15, now: 2_000 });
    expect(piano.seconds).toBeCloseTo(900, 6);
    expect(s.records.practiceLog).toHaveLength(1);
    expect(s.records.practiceLog[0]!.source).toBe("manual");
    expect(s.records.practiceLog[0]!.at).toBe(2_000);
    expect(applyIn(s, { type: "logPractice", habitId: piano.id, minutes: -5, now: 0 }).ok).toBe(false);
  });

  it("the habit app is a fixed instrument: development never scales with any module", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "logPractice", habitId: piano.id, minutes: 10, now: 0 });
    expect(piano.seconds).toBeCloseTo(600, 6);
    applyIn(s, { type: "selectHabit", id: piano.id });
    begin(s, 600, 0);
    advanceIn(s, 100, "flow");
    expect(piano.seconds).toBeCloseTo(700, 6);
  });

  it("logs one live practice entry per session with a timestamp", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: piano.id });
    begin(s, 600, 0);
    advanceIn(s, 250, "flow");
    applyIn(s, { type: "endSession", now: 5_000 });
    expect(s.records.practiceLog).toHaveLength(1);
    expect(s.records.practiceLog[0]!.source).toBe("live");
    expect(s.records.practiceLog[0]!.seconds).toBeCloseTo(250, 6);
    expect(s.records.practiceLog[0]!.at).toBe(5_000);

    begin(s, 600, 0);
    advanceIn(s, 10, "flow");
    applyIn(s, { type: "endSession", now: 6_000 });
    expect(s.records.practiceLog).toHaveLength(2);
  });

  it("persists habits, selection, and the practice log across saves", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: piano.id });
    begin(s, 600, 0);
    advanceIn(s, 300, "flow");
    applyIn(s, { type: "endSession", now: 9_000 });
    applyIn(s, { type: "logPractice", habitId: piano.id, minutes: 5, now: 9_500 });
    const loaded = deserialize(serialize(s, 0))!;
    expect(loaded.state!.records.habits[0]!.name).toBe("Piano");
    expect(loaded.state!.records.activeHabitId).toBe(piano.id);
    expect(loaded.state!.records.practiceLog).toHaveLength(2);
    expect(loaded.state!.records.habits[0]!.seconds).toBeCloseTo(piano.seconds, 6);
  });
});
