import { describe, expect, it } from "vitest";
import { D, eq } from "./num";
import { begin, applyIn, advanceIn, fresh, giveHabit } from "./fixtures";
import { SAVE_VERSION } from "./constants";
import { deserialize, serialize, SaveRefusedError } from "./save";
import type { GameState } from "./types";

// The save boundary: the real-life records round-trip, a v15 save's
// records load with its retired economy left behind, older versions start
// fresh, newer ones are refused.

// A synthetic v15 save in the shape the retired build wrote: the records
// the migration keeps, beside the economy, board and World it leaves behind.
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
  it("round-trips the full state byte-identical", () => {
    const s = fresh();
    const { habit } = giveHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 20, schedule: "daily", now: 1 });
    applyIn(s, { type: "writeNote", text: "between sessions", now: 500 });
    begin(s, 600, 1_000);
    advanceIn(s, 123.25, "flow");
    applyIn(s, { type: "writeNote", text: "in flow", now: 1_200 });
    const text = serialize(s, 1_000);
    const loaded = deserialize(text);
    expect(loaded.error).toBeUndefined();
    expect(serialize(loaded.state!, 1_000)).toBe(text);
  });

  it("saves carry the current version", () => {
    expect(JSON.parse(serialize(fresh(), 0)).version).toBe(SAVE_VERSION);
  });

  it("resuming from a mid-flow save does not duplicate credit", () => {
    const build = () => {
      const s = fresh();
      giveHabit(s);
      begin(s, 600, 0);
      return s;
    };
    const straight = build();
    advanceIn(straight, 400, "flow");
    const split = build();
    advanceIn(split, 150, "flow");
    const restored = deserialize(serialize(split, 0)).state!;
    advanceIn(restored, 250, "flow");
    expect(restored.game.session!.accounting).toEqual(straight.game.session!.accounting);
    expect(restored.records.habits).toEqual(straight.records.habits);
  });

  it("an unseen summary, its events, and its reflection survive a reload together (§8)", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    advanceIn(s, 300, "flow", "away", 0);
    advanceIn(s, 0, "flow");
    applyIn(s, { type: "settleHonestyReport", outcome: "missed" });
    applyIn(s, { type: "endSession", now: 5_000 });
    s.game.summary!.reflection = { text: "drifted", slider: 3 };
    const loaded = deserialize(serialize(s, 1_000));
    expect(loaded.error).toBeUndefined();
    const summary = loaded.state!.game.summary!;
    expect(summary.seen).toBe(false);
    expect(summary.honestyEvents).toEqual([{ awaySeconds: 300, outcome: "missed" }]);
    expect(summary.reflection).toEqual({ text: "drifted", slider: 3 });
  });

  it("habits, the practice log, and session history survive a reload", () => {
    const s = fresh();
    const { habit } = giveHabit(s);
    begin(s, 600, 1_000);
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: 601_000 });
    applyIn(s, { type: "logPractice", habitId: habit.id, minutes: 5, now: 700_000 });
    const loaded = deserialize(serialize(s, 0)).state!;
    expect(loaded.records.habits).toEqual(s.records.habits);
    expect(loaded.records.practiceLog).toEqual(s.records.practiceLog);
    expect(loaded.records.sessionRecords).toEqual(s.records.sessionRecords);
  });
});

describe("a v15 save's records (issue #19)", () => {
  it("loads the real-life records and leaves the retired economy behind", () => {
    const result = deserialize(legacyV15());
    expect(result.error).toBeUndefined();
    const state = result.state!;
    expect(state.records.habits).toEqual([
      { id: "h1", name: "Piano", seconds: 5_400.5, archived: false, color: "cyan", habitClass: null },
      { id: "h2", name: "Cello", seconds: 60, archived: true, color: "amber", habitClass: null },
    ]);
    expect(state.records.activeHabitId).toBe("h1");
    expect(state.records.notes).toEqual([{ id: "n5", sessionId: 2, atElapsed: 30, text: "kept", habitId: "h1", at: 8_000 }]);
    expect(state.records.practiceLog).toHaveLength(1);
    expect(state.records.intentions[0]).not.toHaveProperty("liveSeconds");
    expect(state.records.intentions[0]).toMatchObject({ id: "g6", progressSeconds: 600, completedCount: 4 });
    expect(state.records.sessionRecords).toEqual([{
      sessionNumber: 3, startedAt: 7_000, endedAt: 9_000, habitId: "h1", mode: "planned", plannedTarget: 1_500, creditedSeconds: 1_500,
      honestyEvents: [{ awaySeconds: 300, outcome: "planned" }], reflection: { text: "good", slider: 4 },
      goalsAdvanced: [{ goalId: "g6", seconds: 600 }],
    }]);
    expect(state.records).toMatchObject({ sessionIndex: 3, sessionsCompleted: 3, nextId: 7 });
    expect(state.records.classCredit).toEqual({ engineer: 0, producer: 0, mixer: 0, roadie: 0 });
    // The game starts fresh: the retired economy's nous stays behind, and
    // the collection leaves one Almanac line (issue #19).
    // Its completed sessions reveal Classes (issue #44).
    const book = { revealed: [...fresh().game.encyclopedia.revealed, "classes"], seen: [] };
    expect(state.game).toEqual({ ...fresh().game, encyclopedia: book, legacyLine: "Legacy era · 1 module · archived" });
    for (const retired of ["nous", "modules", "cells", "world", "forge", "achievements", "arete", "prestiges", "scrap"]) {
      expect(state, retired).not.toHaveProperty(retired);
    }
  });

  it("a running session keeps its trust ledger and its provisional nous (story 27)", () => {
    const result = deserialize(legacyV15({
      mode: "flow",
      session: {
        target: 1_500, elapsed: 900, earned: 90, unlocked: [], targetSignaled: false, startedAt: 5_000, goalSeconds: { g6: 300 },
        accounting: { creditedSeconds: 600, poolSeconds: 300, bucketNous: 30, pendingAwaySeconds: 12, events: [] },
        rolls: { flow: 0, forge: 0, mutator: 0 },
      },
    }));
    expect(result.error).toBeUndefined();
    expect(result.state!.game.mode).toBe("flow");
    expect(result.state!.game.session).toEqual({
      target: 1_500, elapsed: 900, targetSignaled: false, startedAt: 5_000, goalSeconds: { g6: 300 }, nousMade: D(0), walls: [],
      accounting: { creditedSeconds: 600, poolSeconds: 300, pendingAwaySeconds: 12, events: [], provisionalNous: D(30), wallSeconds: 300 },
    });
    // The pool still settles through the honesty report, banking the
    // provisional nous.
    expect(applyIn(result.state!, { type: "settleHonestyReport", outcome: "full" }).ok).toBe(true);
    expect(result.state!.game.session!.accounting.creditedSeconds).toBe(900);
    expect(eq(result.state!.game.nous, 30)).toBe(true);
  });

  it("a breather in progress lands between sessions", () => {
    const state = deserialize(legacyV15({ mode: "breather", breather: { startedAt: 1, allowanceSeconds: 300, elapsed: 10 } })).state!;
    expect(state.game.mode).toBe("upgrade");
    expect(state.game.session).toBeNull();
  });

  it("the legacy line counts the collection placed and unplaced, leaving out a retired Mutator Forge", () => {
    const state = deserialize(legacyV15({
      modules: [
        { id: "m1", type: "additive", pos: { q: 0, r: 0 }, level: 3, invested: 30, reserve: 0 },
        { id: "m2", type: "infusor", pos: null, level: 0, invested: 0, reserve: 0 },
        { id: "m3", type: "forge", pos: null, level: 0, invested: 0, reserve: 0 },
        { id: "m4", type: "mutatorForge", pos: null, level: 0, invested: 0, reserve: 0 },
      ],
    })).state!;
    expect(state.game.legacyLine).toBe("Legacy era · 3 modules · archived");
  });

  it("a dismissed summary stays behind with the retired game", () => {
    const state = deserialize(legacyV15({
      summary: { sessionNumber: 3, seconds: 1_500, plannedTarget: 1_500, honestyEvents: [], reflection: null, seen: true },
    })).state!;
    expect(state.game.summary).toBeNull();
  });

  it("an unseen summary keeps its practice facts", () => {
    const state = deserialize(legacyV15({
      summary: { sessionNumber: 3, earned: 150, seconds: 1_500, ratePerMinute: 6, plannedTarget: 1_500, honestyEvents: [],
        reflection: null, achievements: [], breatherAllowance: 300, seen: false },
    })).state!;
    // The retired game's `earned` isn't the session's ν: the new facts
    // default (issue #40).
    expect(state.game.summary).toEqual({
      sessionNumber: 3, seconds: 1_500, plannedTarget: 1_500, honestyEvents: [], reflection: null, seen: false, walls: [],
      nous: D(0), habitClass: null, classSeconds: 0, levelBefore: 0, levelAfter: 0, breather: null,
    });
  });
});

describe("the version gate", () => {
  it("rejects every version older than v15 with the start-fresh message", () => {
    for (const version of [1, 7, 10, 12, 13, 14]) {
      const text = serialize(fresh(), 0).replace(`"version": ${SAVE_VERSION}`, `"version": ${version}`);
      const result = deserialize(text);
      expect(result.error, `v${version}`).toMatch(/older version/i);
      expect(result.olderVersion, `v${version}`).toBe(version);
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
    applyIn(s, { type: "writeNote", text: "portable", now: 1_000 });
    const loaded = deserialize(serialize(s, 42));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state!.records.notes[0]!.text).toBe("portable");
  });
});

describe("serialization refuses what it cannot write (issue #486)", () => {
  it("a state carrying a nonfinite number refuses the save instead of writing null", () => {
    for (const figure of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      const s: GameState = fresh();
      s.records.sessionsCompleted = figure;
      expect(() => serialize(s, 0)).toThrow(SaveRefusedError);
    }
  });

  it("the refusal names where the figure lives, however deep it hides", () => {
    const s = fresh();
    giveHabit(s);
    s.records.habits[0]!.seconds = NaN;
    expect(() => serialize(s, 0)).toThrow(/habits\[0\]\.seconds/);
  });

  it("a session's unrepresentable accounting refuses the save", () => {
    const s = fresh();
    begin(s, null, 0);
    s.game.session!.accounting.poolSeconds = Infinity;
    expect(() => serialize(s, 0)).toThrow(/poolSeconds/);
  });
});
