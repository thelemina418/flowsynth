import { describe, expect, it } from "vitest";
import { advance } from "./advance";
import { endSession, startSession } from "./actions";
import { fresh, giveHabit } from "./fixtures";
import { addPracticeLog } from "./habits";
import { SAVE_VERSION } from "./constants";
import { createGoal } from "./goals";
import { deserialize, serialize, SaveRefusedError } from "./save";
import { applyGap, flushPendingAway, resolveHonestyReport } from "./trust";
import { writeNote } from "./notes";
import type { GameState } from "./types";

// The interim save boundary (issue #15): the real-life records round-trip,
// a v15 save's records load with its retired economy left behind, older
// versions start fresh, newer ones are refused.

// A synthetic v15 save in the shape the retired build wrote: the records
// the interim keeps, beside the economy, board and World it leaves behind.
function legacyV15(state: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: "flowsynth",
    version: 15,
    savedAt: 1_000,
    state: {
      mode: "upgrade",
      sessionIndex: 3,
      sessionsCompleted: 3,
      nous: 812.5,
      totalEarned: 9_000,
      eraEarned: 4_000,
      arete: 2,
      prestiges: 1,
      scrap: 40,
      modules: [{ id: "m1", type: "additive", pos: { q: 0, r: 0 }, level: 12, invested: 300, reserve: 0 }],
      cells: [{ q: 0, r: 0 }],
      world: { frontier: 3, weapons: [{ id: "w1", store: 2 }] },
      forge: { progress: 5, earned: 1 },
      achievements: { "first-light": 1 },
      muted: true,
      notificationAsked: true,
      habits: [{ id: "h1", name: "Piano", seconds: 5_400.5, archived: false, color: "cyan", classId: "engineer", classes: { engineer: { xp: 5_400 } } },
        { id: "h2", name: "Cello", seconds: 60, archived: true, color: "amber", classId: "blacksmith", classes: {} }],
      activeHabitId: "h1",
      practiceLog: [{ id: "p4", habitId: "h1", seconds: 5_400.5, source: "live", at: 9_000 }],
      notes: [{ id: "n5", sessionId: 2, atElapsed: 30, text: "kept", habitId: "h1", at: 8_000 }],
      goals: [{ id: "g6", condition: { kind: "habit-minutes", habitId: "h1", minutes: 20 }, schedule: { kind: "daily" }, occurrenceKey: "2026-11-01",
        progressSeconds: 600, liveSeconds: 600, completed: false, completedCount: 4, createdAt: 1 }],
      sessionRecords: [{ sessionNumber: 3, startedAt: 7_000, endedAt: 9_000, habitId: "h1", mode: "planned", plannedTarget: 1_500, creditedSeconds: 1_500,
        earned: 150, honestyEvents: [{ awaySeconds: 300, outcome: "planned" }], reflection: { text: "good", slider: 4 },
        goalsAdvanced: [{ goalId: "g6", seconds: 600 }], achievements: ["first-light"], breather: { seconds: 300, completed: true } }],
      session: null,
      summary: null,
      nextId: 7,
      ...state,
    },
  });
}

describe("persistence", () => {
  it("round-trips the full interim state byte-identical", () => {
    const s = fresh();
    const { habit } = giveHabit(s);
    createGoal(s, { habitId: habit.id, minutes: 20, schedule: "daily", now: 1 });
    writeNote(s, "between sessions", 500);
    startSession(s, 600, 1_000);
    advance(s, 123.25);
    writeNote(s, "in flow", 1_200);
    const text = serialize(s, 1_000);
    const loaded = deserialize(text);
    expect(loaded.error).toBeUndefined();
    expect(serialize(loaded.state!, 1_000)).toBe(text);
  });

  it("saves carry the current version", () => {
    expect(JSON.parse(serialize(fresh())).version).toBe(SAVE_VERSION);
  });

  it("resuming from a mid-flow save does not duplicate credit", () => {
    const build = () => {
      const s = fresh();
      giveHabit(s);
      startSession(s, 600);
      return s;
    };
    const straight = build();
    advance(straight, 400);
    const split = build();
    advance(split, 150);
    const restored = deserialize(serialize(split)).state!;
    advance(restored, 250);
    expect(restored.session!.accounting).toEqual(straight.session!.accounting);
    expect(restored.habits).toEqual(straight.habits);
  });

  it("an unseen summary, its events, and its reflection survive a reload together (§8)", () => {
    const s = fresh();
    startSession(s, 600);
    advance(s, 600);
    applyGap(s, 300, "away", 0);
    flushPendingAway(s);
    resolveHonestyReport(s, "missed");
    endSession(s, 5_000);
    s.summary!.reflection = { text: "drifted", slider: 3 };
    const loaded = deserialize(serialize(s, 1_000));
    expect(loaded.error).toBeUndefined();
    const summary = loaded.state!.summary!;
    expect(summary.seen).toBe(false);
    expect(summary.honestyEvents).toEqual([{ awaySeconds: 300, outcome: "missed" }]);
    expect(summary.reflection).toEqual({ text: "drifted", slider: 3 });
  });

  it("habits, the practice log, and session history survive a reload", () => {
    const s = fresh();
    const { habit } = giveHabit(s);
    startSession(s, 600, 1_000);
    advance(s, 600);
    endSession(s, 601_000);
    addPracticeLog(s, habit.id, 5, 700_000);
    const loaded = deserialize(serialize(s)).state!;
    expect(loaded.habits).toEqual(s.habits);
    expect(loaded.practiceLog).toEqual(s.practiceLog);
    expect(loaded.sessionRecords).toEqual(s.sessionRecords);
  });
});

describe("a v15 save's records (issue #15)", () => {
  it("loads the real-life records and leaves the retired economy behind", () => {
    const result = deserialize(legacyV15());
    expect(result.error).toBeUndefined();
    const state = result.state!;
    expect(state.habits).toEqual([
      { id: "h1", name: "Piano", seconds: 5_400.5, archived: false, color: "cyan" },
      { id: "h2", name: "Cello", seconds: 60, archived: true, color: "amber" },
    ]);
    expect(state.activeHabitId).toBe("h1");
    expect(state.notes).toEqual([{ id: "n5", sessionId: 2, atElapsed: 30, text: "kept", habitId: "h1", at: 8_000 }]);
    expect(state.practiceLog).toHaveLength(1);
    expect(state.goals[0]).not.toHaveProperty("liveSeconds");
    expect(state.goals[0]).toMatchObject({ id: "g6", progressSeconds: 600, completedCount: 4 });
    expect(state.sessionRecords).toEqual([{
      sessionNumber: 3, startedAt: 7_000, endedAt: 9_000, habitId: "h1", mode: "planned", plannedTarget: 1_500, creditedSeconds: 1_500,
      honestyEvents: [{ awaySeconds: 300, outcome: "planned" }], reflection: { text: "good", slider: 4 },
      goalsAdvanced: [{ goalId: "g6", seconds: 600 }],
    }]);
    expect(state).toMatchObject({ sessionIndex: 3, sessionsCompleted: 3, muted: true, notificationAsked: true, nextId: 7 });
    for (const retired of ["nous", "modules", "cells", "world", "forge", "achievements", "arete", "prestiges", "scrap"]) {
      expect(state, retired).not.toHaveProperty(retired);
    }
  });

  it("a running session keeps its trust ledger; the provisional nous stays behind", () => {
    const result = deserialize(legacyV15({
      mode: "flow",
      session: {
        target: 1_500, elapsed: 900, earned: 90, unlocked: [], targetSignaled: false, startedAt: 5_000, goalSeconds: { g6: 300 },
        accounting: { creditedSeconds: 600, poolSeconds: 300, bucketNous: 30, pendingAwaySeconds: 12, events: [] },
        rolls: { flow: 0, forge: 0, mutator: 0 },
      },
    }));
    expect(result.error).toBeUndefined();
    expect(result.state!.mode).toBe("flow");
    expect(result.state!.session).toEqual({
      target: 1_500, elapsed: 900, targetSignaled: false, startedAt: 5_000, goalSeconds: { g6: 300 },
      accounting: { creditedSeconds: 600, poolSeconds: 300, pendingAwaySeconds: 12, events: [] },
    });
    // The pool still settles through the honesty report.
    expect(resolveHonestyReport(result.state!, "full").ok).toBe(true);
    expect(result.state!.session!.accounting.creditedSeconds).toBe(900);
  });

  it("a breather in progress lands between sessions", () => {
    const state = deserialize(legacyV15({ mode: "breather", breather: { startedAt: 1, allowanceSeconds: 300, elapsed: 10 } })).state!;
    expect(state.mode).toBe("upgrade");
    expect(state.session).toBeNull();
  });

  it("an unseen summary keeps its practice facts", () => {
    const state = deserialize(legacyV15({
      summary: { sessionNumber: 3, earned: 150, seconds: 1_500, ratePerMinute: 6, plannedTarget: 1_500, honestyEvents: [],
        reflection: null, achievements: [], breatherAllowance: 300, seen: false },
    })).state!;
    expect(state.summary).toEqual({ sessionNumber: 3, seconds: 1_500, plannedTarget: 1_500, honestyEvents: [], reflection: null, seen: false });
  });
});

describe("the version gate", () => {
  it("rejects every version older than v15 with the start-fresh message", () => {
    for (const version of [1, 7, 10, 12, 13, 14]) {
      const text = serialize(fresh()).replace(`"version": ${SAVE_VERSION}`, `"version": ${version}`);
      const result = deserialize(text);
      expect(result.error, `v${version}`).toMatch(/older version/i);
      expect(result.state, `v${version}`).toBeUndefined();
    }
  });

  it("rejects corrupt, foreign, incomplete, and future-version saves", () => {
    expect(deserialize("{nope").error).toBeDefined();
    expect(deserialize('{"app":"other","version":15}').error).toBeDefined();
    expect(deserialize('{"app":"flowsynth","version":15}').error).toMatch(/incomplete/);
    expect(deserialize('{"app":"flowsynth","version":15,"state":{"mode":"weird"}}').error).toMatch(/unknown session mode/);
    expect(deserialize('{"app":"flowsynth","version":15,"state":{"mode":"upgrade","habits":[]}}').error).toMatch(/incomplete/);
    expect(deserialize(JSON.stringify({ app: "flowsynth", version: SAVE_VERSION + 1, state: {} })).error).toMatch(/newer than this build/i);
  });

  it("exported saves load unchanged", () => {
    const s = fresh();
    writeNote(s, "portable", 1_000);
    const loaded = deserialize(serialize(s, 42));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state!.notes[0]!.text).toBe("portable");
  });
});

describe("serialization refuses what it cannot write (issue #486)", () => {
  it("a state carrying a nonfinite number refuses the save instead of writing null", () => {
    for (const figure of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      const s: GameState = fresh();
      s.sessionsCompleted = figure;
      expect(() => serialize(s)).toThrow(SaveRefusedError);
    }
  });

  it("the refusal names where the figure lives, however deep it hides", () => {
    const s = fresh();
    giveHabit(s);
    s.habits[0]!.seconds = NaN;
    expect(() => serialize(s)).toThrow(/habits\[0\]\.seconds/);
  });

  it("a session's unrepresentable accounting refuses the save", () => {
    const s = fresh();
    startSession(s, null);
    s.session!.accounting.poolSeconds = Infinity;
    expect(() => serialize(s)).toThrow(/poolSeconds/);
  });
});
