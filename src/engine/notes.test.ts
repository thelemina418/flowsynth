import { describe, expect, it } from "vitest";
import { applyIn, advanceIn, fresh, habitOf } from "./fixtures";
import { NOTE_BETWEEN_SESSIONS } from "./notes";
import { deserialize, serialize } from "./save";

describe("notes app", () => {
  it("captures notes in flow, paused, and between sessions (ADR-0018)", () => {
    const s = fresh();
    expect(applyIn(s, { type: "writeNote", text: "hello", now: 0 }).ok).toBe(true);
    // A note written outside any session carries the between-sessions mark
    // instead of a session clock.
    expect(s.records.notes[0]!.atElapsed).toBe(NOTE_BETWEEN_SESSIONS);
    expect(applyIn(s, { type: "writeNote", text: "   ", now: 0 }).ok).toBe(false);
    applyIn(s, { type: "startSession", target: 600, now: 0 });
    expect(applyIn(s, { type: "writeNote", text: "first thought", now: 0 }).ok).toBe(true);
    expect(s.records.notes.filter((n) => n.sessionId === s.records.sessionIndex).length).toBe(1);
    expect(s.records.notes[1]!.atElapsed).toBe(0);
    s.game.mode = "paused";
    expect(applyIn(s, { type: "writeNote", text: "paused thought", now: 0 }).ok).toBe(true);
    applyIn(s, { type: "endSession", now: 0 });
    expect(applyIn(s, { type: "writeNote", text: "after the session", now: 0 }).ok).toBe(true);
    expect(s.records.notes).toHaveLength(4);
  });

  it("notes are notes: capture changes no practice accounting", () => {
    const early = fresh();
    applyIn(early, { type: "startSession", target: 600, now: 0 });
    advanceIn(early, 10, "flow");
    applyIn(early, { type: "writeNote", text: "early", now: 0 });
    advanceIn(early, 590, "flow");

    const late = fresh();
    applyIn(late, { type: "startSession", target: 600, now: 0 });
    advanceIn(late, 600, "flow");

    expect(early.game.session!.accounting).toEqual(late.game.session!.accounting);
  });

  it("keeps notes across save round-trips", () => {
    const s = fresh();
    applyIn(s, { type: "startSession", target: 600, now: 0 });
    applyIn(s, { type: "writeNote", text: "persisted thought", now: 0 });
    advanceIn(s, 60, "flow");
    applyIn(s, { type: "endSession", now: 0 });
    const loaded = deserialize(serialize(s))!;
    expect(loaded.state!.records.notes).toHaveLength(1);
    expect(loaded.state!.records.notes[0]!.text).toBe("persisted thought");
  });

  it("in-session capture tags the active habit; the tag never retags (§9)", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: habit.id });
    applyIn(s, { type: "startSession", target: null, now: 0 });
    applyIn(s, { type: "writeNote", text: "tagged thought", now: 0 });
    expect(s.records.notes[0]!.habitId).toBe(habit.id);
    applyIn(s, { type: "endSession", now: 0 });
    // Renaming or archiving the habit never rewrites the captured tag —
    // the id is stored raw and resolves at render.
    habit.name = "Fortepiano";
    expect(s.records.notes[0]!.habitId).toBe(habit.id);
  });

  it("unstructured notes go untagged; paused-session notes tag the session's habit", () => {
    const s = fresh();
    const habit = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "selectHabit", id: habit.id });
    applyIn(s, { type: "startSession", target: null, now: 0 });
    s.game.mode = "paused";
    applyIn(s, { type: "writeNote", text: "paused but tagged", now: 0 });
    applyIn(s, { type: "selectHabit", id: null });
    // Selection is locked during flow/pause; unstructured is a start-time
    // choice, so simulate one by a habitless session.
    s.records.activeHabitId = null;
    applyIn(s, { type: "writeNote", text: "unstructured", now: 0 });
    expect(s.records.notes[0]!.habitId).toBe(habit.id);
    expect(s.records.notes[1]!.habitId).toBeNull();
  });

  it("upgrade-mode notes stay untagged and carry the wall-clock stamp (§9)", () => {
    const s = fresh();
    applyIn(s, { type: "writeNote", text: "between sessions", now: 5_000 });
    expect(s.records.notes[0]!.habitId).toBeNull();
    expect(s.records.notes[0]!.at).toBe(5_000);
    expect(s.records.notes[0]!.atElapsed).toBe(NOTE_BETWEEN_SESSIONS);
  });
});
