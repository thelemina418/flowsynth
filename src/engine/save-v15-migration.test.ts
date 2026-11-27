import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fresh } from "./fixtures";
import { deserialize, serialize } from "./save";

// The one-time v15 → v16 migration (issue #19). The fixture is a v15 save
// written by the retired build's own engine (commit 424a224) from a
// scripted play history; its text is placeholder text throughout
// (fixtures/saves/README.md). A returning player keeps every real-life
// record, and the game starts fresh apart from one Almanac line.

const V15 = readFileSync(new URL("./fixtures/saves/v15-migration.json", import.meta.url), "utf8");

function migrated() {
  const result = deserialize(V15);
  expect(result.error).toBeUndefined();
  return result.state!;
}

describe("the v15 → v16 migration (issue #19)", () => {
  it("keeps the habits, practice log, session history, Notes and Intentions", () => {
    const state = migrated();
    expect(state.records.habits.map((h) => [h.id, h.name, h.seconds, h.archived, h.color])).toEqual([
      ["h2", "Habit A", 7_501, false, "vermillion"],
      ["h3", "Habit B", 6_601, false, "cyan"],
      ["h4", "Habit C", 3_601, true, "amber"],
    ]);
    expect(state.records.practiceLog.map((p) => [p.habitId, p.seconds, p.source])).toEqual([
      ["h2", 1_500, "live"],
      ["h2", 3_301, "live"],
      ["h3", 2_700, "manual"],
      ["h3", 1_801, "live"],
      ["h4", 3_601, "live"],
      ["h2", 1_200, "manual"],
      ["h3", 2_100, "live"],
      ["h2", 1_500, "live"],
    ]);
    expect(state.records.sessionRecords.map((r) => [r.sessionNumber, r.habitId, r.mode, r.creditedSeconds, r.honestyEvents])).toEqual([
      [1, "h2", "planned", 1_500, []],
      [2, "h2", "planned", 3_301, [{ awaySeconds: 600, outcome: "full" }]],
      [3, "h3", "open-ended", 1_801, [{ awaySeconds: 600, outcome: "missed" }]],
      [4, null, "planned", 1_200, []],
      [5, "h4", "planned", 3_601, [{ awaySeconds: 600, outcome: "planned" }]],
      [6, "h3", "planned", 2_100, []],
      [7, "h2", "planned", 1_500, []],
    ]);
    expect(state.records.sessionRecords.filter((r) => r.reflection).map((r) => r.sessionNumber)).toEqual([1, 3, 6]);
    expect(state.records.notes).toHaveLength(9);
    expect(state.records.notes[0]).toMatchObject({ text: "Placeholder note between sessions.", habitId: null });
    expect(state.records.intentions.map((g) => [g.id, g.condition.habitId, g.condition.minutes, g.schedule.kind, g.completedCount])).toEqual([
      ["g5", "h2", 30, "daily", 1],
      ["g6", "h3", 120, "weekly", 0],
      ["g7", "h4", 45, "once", 1],
    ]);
    expect(state.records).toMatchObject({ sessionIndex: 7, sessionsCompleted: 7 });
  });

  it("every migrated habit awaits its class, and no class holds credit yet", () => {
    const state = migrated();
    expect(state.records.habits.map((h) => h.habitClass)).toEqual([null, null, null]);
    expect(state.records.classCredit).toEqual({ engineer: 0, producer: 0, mixer: 0, roadie: 0 });
  });

  it("starts the game fresh apart from the legacy line, counting placed and unplaced modules", () => {
    const state = migrated();
    // The fixture's collection: the opening additive on the board, and a
    // focus-keyed generator, an infusor and a forge in the inventory.
    expect(state.game).toEqual({ ...fresh().game, legacyLine: "Legacy era · 4 modules · archived" });
  });

  it("the migrated state saves as v16 and reloads exactly", () => {
    const text = serialize(migrated(), 2_000);
    expect(JSON.parse(text).version).toBe(16);
    expect(serialize(deserialize(text).state!, 2_000)).toBe(text);
  });
});
