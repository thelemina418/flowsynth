import { describe, expect, it } from "vitest";
import { applyIn, advanceIn, fresh, giveHabit, habitOf, intentionOf } from "./fixtures";
import { accrueGoalProgress, normalizeGoals, occurrenceKeyFor, pendingGoalsOf, activeGoalOf } from "./goals";
import { deserialize, serialize } from "./save";
import type { Goal } from "./types";

const DAY = 24 * 60 * 60 * 1000;

function withHabit(s: ReturnType<typeof fresh>, name = "Piano") {
  const habit = habitOf(s, applyIn(s, { type: "createHabit", name: name }));
  applyIn(s, { type: "selectHabit", id: habit.id });
  return habit;
}

describe("one goal per habit", () => {
  it("create refuses while an active goal stands, and answers again once it is gone (issue #445)", () => {
    const s = fresh();
    const habit = withHabit(s);
    const made = applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 });
    expect(made.ok).toBe(true);
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }).ok).toBe(false);
    applyIn(s, { type: "deleteIntention", id: made.id! });
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }).ok).toBe(true);
    // Another habit's goal is its own.
    const other = habitOf(s, applyIn(s, { type: "createHabit", name: "Cooking" }));
    expect(applyIn(s, { type: "createIntention", habitId: other.id, minutes: 5, schedule: "daily", now: 1 }).ok).toBe(true);
  });

  it("an unresolved migration choice also refuses create until a goal is retained (issue #445)", () => {
    const s = fresh();
    const habit = withHabit(s);
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }));
    goal.pendingChoice = true;
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 9, schedule: "once", now: 1 }).ok).toBe(false);
    expect(applyIn(s, { type: "retainIntention", id: goal.id }).ok).toBe(true);
    // The retained row is the habit's active goal; a fresh goal waits for
    // its removal.
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 9, schedule: "once", now: 1 }).ok).toBe(false);
    applyIn(s, { type: "deleteIntention", id: goal.id });
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 9, schedule: "once", now: 1 }).ok).toBe(true);
  });

  it("goals are habit-owned: the cross-habit template refuses (issue #423)", () => {
    const s = fresh();
    expect(applyIn(s, { type: "createIntention", habitId: null, minutes: 10, schedule: "daily", now: 1 }).ok).toBe(false);
  });

  it("rejects goals with bad inputs, unknown habits, or while in flow", () => {
    const s = fresh();
    const habit = withHabit(s);
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 0, schedule: "daily", now: 1 }).ok).toBe(false);
    expect(applyIn(s, { type: "createIntention", habitId: "nope", minutes: 5, schedule: "daily", now: 1 }).ok).toBe(false);
    applyIn(s, { type: "startSession", target: 600, now: 0 });
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }).ok).toBe(false);
    applyIn(s, { type: "endSession", now: 0 });
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }).ok).toBe(true);
  });

  it("delete removes the habit's active goal and never a carried-over row (issue #445)", () => {
    const s = fresh();
    const habit = withHabit(s);
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }));
    goal.pendingChoice = true;
    expect(applyIn(s, { type: "deleteIntention", id: goal.id }).ok).toBe(false);
    expect(s.records.intentions).toHaveLength(1);
    applyIn(s, { type: "retainIntention", id: goal.id });
    expect(applyIn(s, { type: "deleteIntention", id: goal.id }).ok).toBe(true);
    expect(activeGoalOf(s, habit.id)).toBeUndefined();
    expect(goal.retired).toBe(true);
  });
});

describe("goal progress and completion", () => {
  it("accrues live practice for matching goals and completes them once", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "daily", now: 1 });
    applyIn(s, { type: "startSession", target: 600, now: 0 });
    const result = advanceIn(s, 600, "flow");
    expect(result.goalsCompleted).toBe(1);
    expect(s.records.intentions[0]!.completed).toBe(true);
    expect(s.records.intentions[0]!.completedCount).toBe(1);
  });

  it("templates are conditions only: completions grant nothing", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "daily", now: 1 });
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 600, "flow");
    expect(s.records.intentions[0]!.completed).toBe(true);
    const before = structuredClone(s);
    advanceIn(s, 3600, "flow");
    // Past completion the goal holds; only the practice facts move.
    expect(s.records.intentions).toEqual(before.records.intentions);
    expect(s.records.habits[0]!.seconds).toBe(before.records.habits[0]!.seconds + 3600);
  });

  it("goals are habit-owned: only their habit's practice advances them (issue #423)", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "createIntention", habitId: piano.id, minutes: 10, schedule: "daily", now: 1 });
    expect(accrueGoalProgress(s, null, 300)).toBe(0); // unstructured advances nothing
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    const cooking = habitOf(s, applyIn(s, { type: "createHabit", name: "Cooking" }));
    expect(accrueGoalProgress(s, cooking.id, 600)).toBe(0); // another habit advances nothing
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    expect(accrueGoalProgress(s, piano.id, 600)).toBe(1); // completes
  });

  it("specific-habit goals ignore other habits and no-habit sessions", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "createIntention", habitId: piano.id, minutes: 10, schedule: "daily", now: 1 });
    const cooking = habitOf(s, applyIn(s, { type: "createHabit", name: "Cooking" }));
    accrueGoalProgress(s, cooking.id, 600);
    accrueGoalProgress(s, null, 600);
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    accrueGoalProgress(s, piano.id, 600);
    expect(s.records.intentions[0]!.completed).toBe(true);
  });

  it("does not count practice from before the goal existed", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "startSession", target: 600, now: 0 });
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: 5_000 });
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "daily", now: 6_000 });
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
  });

  it("manual logs complete goals between sessions", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 15, schedule: "daily", now: 1 });
    const result = applyIn(s, { type: "logPractice", habitId: habit.id, minutes: 15, now: 2_000 });
    expect(result.completions).toBe(1);
    expect(s.records.intentions[0]!.completed).toBe(true);
  });
});

describe("goal edits (issue #445)", () => {
  it("a target edit retains qualifying practice: 30 to 60 after 20 qualifying minutes", () => {
    const s = fresh();
    const habit = withHabit(s);
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 30, schedule: "daily", now: 1 }));
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 20 * 60, "flow");
    applyIn(s, { type: "endSession", now: 0 });
    expect(applyIn(s, { type: "editIntention", id: goal.id, minutes: 60, schedule: "daily", now: 9_000 }).ok).toBe(true);
    expect(goal.condition.minutes).toBe(60);
    expect(goal.progressSeconds).toBeCloseTo(20 * 60, 6);
    expect(goal.completed).toBe(false);
    // The retained minutes ride toward the raised target: forty more
    // completes it.
    applyIn(s, { type: "startSession", target: null, now: 0 });
    expect(advanceIn(s, 40 * 60, "flow").goalsCompleted).toBe(1);
    applyIn(s, { type: "endSession", now: 0 });
    expect(goal.completedCount).toBe(1);
  });

  it("a met goal stays completed until a raised target un-completes it, and no completion replays", () => {
    const s = fresh();
    const habit = withHabit(s);
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 }));
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: 0 });
    expect(goal.completed).toBe(true);
    // Lower the target below met progress: already complete, no second
    // completion tick.
    applyIn(s, { type: "editIntention", id: goal.id, minutes: 5, schedule: "once", now: 9_000 });
    expect(goal.completed).toBe(true);
    expect(goal.completedCount).toBe(1);
    // Raise it: the completion un-lands, the practice stays.
    applyIn(s, { type: "editIntention", id: goal.id, minutes: 15, schedule: "once", now: 9_100 });
    expect(goal.completed).toBe(false);
    expect(goal.progressSeconds).toBeCloseTo(600, 6);
    applyIn(s, { type: "startSession", target: null, now: 0 });
    expect(advanceIn(s, 300, "flow").goalsCompleted).toBe(1);
    applyIn(s, { type: "endSession", now: 0 });
    // The raised target's completion is the goal's second lifetime
    // completion — the count accrues across the edit.
    expect(goal.completedCount).toBe(2);
  });

  it("a cadence edit splits live practice at midnight", () => {
    const s = fresh();
    const habit = withHabit(s);
    const midnight = new Date(2026, 9, 21).getTime();
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 60, schedule: "weekly", now: midnight - DAY }));
    applyIn(s, { type: "startSession", target: null, now: midnight - 600_000 });
    advanceIn(s, 1200, "flow");
    applyIn(s, { type: "endSession", now: midnight + 600_000 });
    applyIn(s, { type: "editIntention", id: goal.id, minutes: 60, schedule: "daily", now: midnight + 600_000 });
    expect(goal.progressSeconds).toBeCloseTo(600);
    const loaded = deserialize(serialize(s, 0)).state!;
    expect(activeGoalOf(loaded, habit.id)!.progressSeconds).toBeCloseTo(600);
  });

  it("removal, replacement, edits and reload preserve previous goal descriptions", () => {
    const s = fresh();
    const habit = withHabit(s);
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 30, schedule: "daily", now: 1 }));
    applyIn(s, { type: "startSession", target: null, now: 1000 });
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: 601000 });
    applyIn(s, { type: "editIntention", id: goal.id, minutes: 60, schedule: "weekly", now: 602000 });
    applyIn(s, { type: "deleteIntention", id: goal.id });
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 603000 }).ok).toBe(true);
    const loaded = deserialize(serialize(s, 0)).state!;
    expect(loaded.records.sessionRecords[0]!.goalsAdvanced[0]!.goal!.condition.minutes).toBe(30);
    expect(loaded.records.sessionRecords[0]!.goalsAdvanced[0]!.goal!.schedule.kind).toBe("daily");
    expect(loaded.records.intentions.find(row => row.id === goal.id)!.retired).toBe(true);
  });

  it("edits refuse bad figures and lock in flow", () => {
    const s = fresh();
    const habit = withHabit(s);
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 }));
    expect(applyIn(s, { type: "editIntention", id: goal.id, minutes: 0, schedule: "once", now: 9_000 }).ok).toBe(false);
    expect(applyIn(s, { type: "editIntention", id: "nope", minutes: 10, schedule: "once", now: 9_000 }).ok).toBe(false);
    applyIn(s, { type: "startSession", target: 600, now: 0 });
    expect(applyIn(s, { type: "editIntention", id: goal.id, minutes: 20, schedule: "once", now: 9_000 }).ok).toBe(false);
    applyIn(s, { type: "endSession", now: 0 });
    expect(goal.condition.minutes).toBe(10);
  });

  it("a cadence edit recalculates from qualifying practice in the new period", () => {
    const s = fresh();
    const habit = withHabit(s);
    const wednesday = Date.UTC(2026, 9, 21, 10); // 2026-10-21 Wed
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 30, schedule: "daily", now: wednesday - 3 * DAY }));
    // Yesterday's credited session (10 min) and last week's (12 min).
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: wednesday - DAY });
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 720, "flow");
    applyIn(s, { type: "endSession", now: wednesday - 8 * DAY });
    // Today's live practice and manual condition progress both survive.
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 300, "flow");
    applyIn(s, { type: "endSession", now: wednesday });
    applyIn(s, { type: "logPractice", habitId: habit.id, minutes: 10, now: wednesday + 1_000 });
    applyIn(s, { type: "editIntention", id: goal.id, minutes: 30, schedule: "weekly", now: wednesday + 2_000 });
    expect(goal.schedule.kind).toBe("weekly");
    expect(goal.occurrenceKey).toBe(occurrenceKeyFor(goal.schedule, wednesday + 2_000));
    // Last week stays outside the period.
    expect(goal.progressSeconds).toBeCloseTo(300 + 600 + 600, 6);
    expect(goal.completed).toBe(false);
  });

  it("a cadence edit to once reads from the goal's creation; daily reads from local midnight", () => {
    const s = fresh();
    const habit = withHabit(s);
    const created = new Date(2026, 9, 19, 23).getTime(); // created late on the 19th
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 60, schedule: "once", now: created }));
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 1_200, "flow");
    applyIn(s, { type: "endSession", now: created + DAY + 3_600_000 + 1_200_000 }); // the 21st, 00:00 local
    applyIn(s, { type: "editIntention", id: goal.id, minutes: 60, schedule: "daily", now: created + DAY + 3_600_000 + 1_200_000 });
    // Daily's period is today: the whole session landed after midnight.
    expect(goal.progressSeconds).toBeCloseTo(1_200, 6);
    // Back to once reads from creation: the whole record.
    applyIn(s, { type: "editIntention", id: goal.id, minutes: 60, schedule: "once", now: created + DAY + 3_600_000 + 1_200_000 });
    expect(goal.progressSeconds).toBeCloseTo(1_200, 6);
    applyIn(s, { type: "editIntention", id: goal.id, minutes: 10, schedule: "daily", now: created + DAY + 3_600_000 + 1_200_000 });
    expect(goal.completed).toBe(true);
    expect(goal.completedCount).toBe(0); // the recalculation never mints a completion
  });
});

describe("the migration's retain-one choice (issue #445)", () => {
  // The v11 → v12 conversion's shape, built by hand: several active rows
  // for one habit, every row held pending.
  function pendingPair(s: ReturnType<typeof fresh>): [Goal, Goal] {
    const habit = s.records.habits[0]!;
    const a = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 }));
    const b: Goal = {
      ...structuredClone(a),
      id: `${a.id}b`,
      condition: { kind: "habit-minutes", habitId: habit.id, minutes: 45 },
      progressSeconds: 900,
      createdAt: a.createdAt + 1,
    };
    s.records.intentions.push(b);
    a.pendingChoice = true;
    b.pendingChoice = true;
    return [a, b];
  }

  it("pending rows neither accrue nor complete, and practice is never blocked", () => {
    const s = fresh();
    withHabit(s);
    const [a, b] = pendingPair(s);
    expect(activeGoalOf(s, s.records.habits[0]!.id)).toBeUndefined();
    // An unresolved choice never blocks a session.
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 3_600, "flow");
    applyIn(s, { type: "endSession", now: 0 });
    expect(a.progressSeconds).toBe(0);
    expect(b.progressSeconds).toBe(900);
    expect(a.completed).toBe(false);
    expect(b.completed).toBe(false);
    expect(s.records.habits[0]!.seconds).toBe(3_600);
  });

  it("retaining one row activates it with its record and retires the siblings to history", () => {
    const s = fresh();
    const habit = withHabit(s);
    const [a, b] = pendingPair(s);
    expect(applyIn(s, { type: "retainIntention", id: b.id }).ok).toBe(true);
    expect(b.pendingChoice).toBeUndefined();
    expect(b.retired).toBeUndefined();
    expect(a.retired).toBe(true);
    expect(pendingGoalsOf(s, habit.id)).toHaveLength(0);
    expect(activeGoalOf(s, habit.id)).toBe(b);
    expect(b.progressSeconds).toBe(900);
    // The retained row runs: credited practice advances it again.
    expect(accrueGoalProgress(s, habit.id, 1_800)).toBe(1);
    expect(b.completed).toBe(true);
    // The retired sibling's facts never moved.
    expect(a.progressSeconds).toBe(0);
    expect(a.condition).toEqual({ kind: "habit-minutes", habitId: habit.id, minutes: 10 });
  });

  it("the choice locks in flow like every goal mutation", () => {
    const s = fresh();
    withHabit(s);
    const [a] = pendingPair(s);
    applyIn(s, { type: "startSession", target: 600, now: 0 });
    expect(applyIn(s, { type: "retainIntention", id: a.id }).ok).toBe(false);
    applyIn(s, { type: "endSession", now: 0 });
    expect(a.pendingChoice).toBe(true);
  });

  it("a pending selection and its records survive reload", () => {
    const s = fresh();
    withHabit(s);
    const [a, b] = pendingPair(s);
    const loaded = deserialize(serialize(s, 0)).state!;
    const loadedA = loaded.records.intentions.find((g) => g.id === a.id)!;
    const loadedB = loaded.records.intentions.find((g) => g.id === b.id)!;
    expect(loadedA.pendingChoice).toBe(true);
    expect(loadedB.pendingChoice).toBe(true);
    expect(loadedB.progressSeconds).toBe(900);
    expect(loaded.records.habits[0]!.color).toBe("vermillion");
    applyIn(loaded, { type: "retainIntention", id: loadedA.id });
    expect(loadedA.pendingChoice).toBeUndefined();
    expect(loadedB.retired).toBe(true);
  });
});

describe("recurrence", () => {
  it("daily goals reset at the local calendar day boundary", () => {
    const s = fresh();
    const habit = withHabit(s);
    const monday = Date.UTC(2026, 8, 14, 10); // 2026-09-14 10:00 UTC
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "daily", now: monday });
    accrueGoalProgress(s, habit.id, 300);
    applyIn(s, { type: "rollIntentions", now: monday + 3600_000 }); // same day: no reset
    expect(s.records.intentions[0]!.progressSeconds).toBeCloseTo(300, 6);
    applyIn(s, { type: "rollIntentions", now: monday + DAY }); // next day: fresh occurrence
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    expect(s.records.intentions[0]!.completed).toBe(false);
    expect(s.records.intentions[0]!.completedCount).toBe(0);
  });

  it("weekly goals reset at the Monday boundary", () => {
    const s = fresh();
    const habit = withHabit(s);
    const tuesday = Date.UTC(2026, 8, 15, 9); // 2026-09-15 Tue
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 60, schedule: "weekly", now: tuesday });
    accrueGoalProgress(s, habit.id, 1800);
    applyIn(s, { type: "rollIntentions", now: tuesday + 2 * DAY }); // Thursday, same week
    expect(s.records.intentions[0]!.progressSeconds).toBeCloseTo(1800, 6);
    applyIn(s, { type: "rollIntentions", now: Date.UTC(2026, 8, 22, 8) }); // next Tuesday
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
  });

  it("one-time goals never reset and keep running until edited or replaced", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 });
    accrueGoalProgress(s, habit.id, 600);
    applyIn(s, { type: "rollIntentions", now: 999_999_999 });
    expect(s.records.intentions[0]!.completed).toBe(true);
    expect(s.records.intentions).toHaveLength(1);
  });
});

describe("persistence", () => {
  it("round-trips goals with their progress", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 20, schedule: "daily", now: 7_000 });
    accrueGoalProgress(s, habit.id, 240);
    const loaded = deserialize(serialize(s, 0))!;
    expect(loaded.state!.records.intentions).toHaveLength(1);
    expect(loaded.state!.records.intentions[0]!.progressSeconds).toBeCloseTo(240, 6);
  });

  it("normalizeGoals drops the retired per-goal fields and carries a pending flag as written", () => {
    const s = fresh();
    const habit = withHabit(s);
    const goal = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 }));
    const legacy = { ...structuredClone(goal), color: "cyan", liveSeconds: undefined } as unknown as Goal;
    const pending = { ...structuredClone(goal), id: `${goal.id}p`, pendingChoice: false } as unknown as Goal;
    normalizeGoals([legacy, pending]);
    expect("color" in legacy).toBe(false);
    expect("liveSeconds" in legacy).toBe(false);
    expect("pendingChoice" in pending).toBe(false);
  });
});

describe("the completion tick", () => {
  it("caps an oversized completion at the remaining goal duration", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 });
    accrueGoalProgress(s, habit.id, 300);
    expect(accrueGoalProgress(s, habit.id, 3600)).toBe(1);
    expect(s.records.intentions[0]!.progressSeconds).toBe(600);
  });

  it("trusted batches complete goals like one-second ticks", () => {
    function scenario() {
      const s = fresh();
      const habit = giveHabit(s).habit;
      applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 1, schedule: "once", now: 1 });
      applyIn(s, { type: "startSession", target: 600, now: 0 });
      return s;
    }
    const batch = scenario();
    const ticks = scenario();
    advanceIn(batch, 600, "flow", "away", 0);
    const result = advanceIn(batch, 0, "flow");
    let completions = 0;
    for (let i = 0; i < 600; i++) completions += advanceIn(ticks, 1, "flow").goalsCompleted;
    expect(result.goalsCompleted).toBe(1);
    expect(completions).toBe(1);
    expect(batch.game.session!.goalSeconds).toEqual(ticks.game.session!.goalSeconds);
    expect(batch.records.intentions).toEqual(ticks.records.intentions);
  });

  it("honesty-credited minutes complete goals at the reconciliation", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 });
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 900, "flow", "away", 0); // open-ended past the floor: provisional
    advanceIn(s, 0, "flow");
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    expect(applyIn(s, { type: "settleHonestyReport", outcome: "full" }).completions).toBe(1);
    expect(s.records.intentions[0]!.completed).toBe(true);
  });

  it("recurring goals complete once per occurrence — the reset re-opens them", () => {
    const s = fresh();
    const habit = withHabit(s);
    const monday = Date.UTC(2026, 8, 14, 10);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "daily", now: monday });
    expect(accrueGoalProgress(s, habit.id, 600)).toBe(1);
    expect(accrueGoalProgress(s, habit.id, 600)).toBe(0);
    applyIn(s, { type: "rollIntentions", now: monday + DAY });
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    expect(accrueGoalProgress(s, habit.id, 600)).toBe(1);
    expect(s.records.intentions[0]!.completedCount).toBe(2);
  });
});
