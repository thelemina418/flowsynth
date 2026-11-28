import { describe, expect, it } from "vitest";
import { begin, applyIn, advanceIn, fresh, giveHabit, habitOf, intentionOf } from "./fixtures";
import { accrueIntentionProgress, normalizeIntentions, occurrenceKeyFor, pendingIntentionsOf, activeIntentionOf } from "./intentions";
import { deserialize, serialize } from "./save";
import type { Intention } from "./types";

const DAY = 24 * 60 * 60 * 1000;

function withHabit(s: ReturnType<typeof fresh>, name = "Piano") {
  const habit = habitOf(s, applyIn(s, { type: "createHabit", name: name }));
  applyIn(s, { type: "selectHabit", id: habit.id });
  return habit;
}

describe("one intention per habit", () => {
  it("create refuses while an active intention stands, and answers again once it is gone (issue #445)", () => {
    const s = fresh();
    const habit = withHabit(s);
    const made = applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 });
    expect(made.ok).toBe(true);
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }).ok).toBe(false);
    applyIn(s, { type: "deleteIntention", id: made.id! });
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }).ok).toBe(true);
    // Another habit's intention is its own.
    const other = habitOf(s, applyIn(s, { type: "createHabit", name: "Cooking" }));
    expect(applyIn(s, { type: "createIntention", habitId: other.id, minutes: 5, schedule: "daily", now: 1 }).ok).toBe(true);
  });

  it("an unresolved migration choice also refuses create until an intention is retained (issue #445)", () => {
    const s = fresh();
    const habit = withHabit(s);
    const intention = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }));
    intention.pendingChoice = true;
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 9, schedule: "once", now: 1 }).ok).toBe(false);
    expect(applyIn(s, { type: "retainIntention", id: intention.id }).ok).toBe(true);
    // The retained row is the habit's active intention; a fresh intention waits for
    // its removal.
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 9, schedule: "once", now: 1 }).ok).toBe(false);
    applyIn(s, { type: "deleteIntention", id: intention.id });
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 9, schedule: "once", now: 1 }).ok).toBe(true);
  });

  it("intentions are habit-owned: the cross-habit template refuses (issue #423)", () => {
    const s = fresh();
    expect(applyIn(s, { type: "createIntention", habitId: null, minutes: 10, schedule: "daily", now: 1 }).ok).toBe(false);
  });

  it("rejects intentions with bad inputs, unknown habits, or while in flow", () => {
    const s = fresh();
    const habit = withHabit(s);
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 0, schedule: "daily", now: 1 }).ok).toBe(false);
    expect(applyIn(s, { type: "createIntention", habitId: "nope", minutes: 5, schedule: "daily", now: 1 }).ok).toBe(false);
    begin(s, 600, 0);
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }).ok).toBe(false);
    applyIn(s, { type: "endSession", now: 0 });
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }).ok).toBe(true);
  });

  it("delete removes the habit's active intention and never a carried-over row (issue #445)", () => {
    const s = fresh();
    const habit = withHabit(s);
    const intention = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 5, schedule: "daily", now: 1 }));
    intention.pendingChoice = true;
    expect(applyIn(s, { type: "deleteIntention", id: intention.id }).ok).toBe(false);
    expect(s.records.intentions).toHaveLength(1);
    applyIn(s, { type: "retainIntention", id: intention.id });
    expect(applyIn(s, { type: "deleteIntention", id: intention.id }).ok).toBe(true);
    expect(activeIntentionOf(s, habit.id)).toBeUndefined();
    expect(intention.retired).toBe(true);
  });
});

describe("intention progress and completion", () => {
  it("accrues live practice for matching intentions and completes them once", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "daily", now: 1 });
    begin(s, 600, 0);
    const result = advanceIn(s, 600, "flow");
    expect(result.intentionsCompleted).toBe(1);
    expect(s.records.intentions[0]!.completed).toBe(true);
    expect(s.records.intentions[0]!.completedCount).toBe(1);
  });

  it("templates are conditions only: completions grant nothing", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "daily", now: 1 });
    begin(s, null, 0);
    advanceIn(s, 600, "flow");
    expect(s.records.intentions[0]!.completed).toBe(true);
    const before = structuredClone(s);
    advanceIn(s, 3600, "flow");
    // Past completion the intention holds; only the practice facts move.
    expect(s.records.intentions).toEqual(before.records.intentions);
    expect(s.records.habits[0]!.seconds).toBe(before.records.habits[0]!.seconds + 3600);
  });

  it("intentions are habit-owned: only their habit's practice advances them (issue #423)", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "createIntention", habitId: piano.id, minutes: 10, schedule: "daily", now: 1 });
    expect(accrueIntentionProgress(s, null, 300)).toBe(0); // unstructured advances nothing
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    const cooking = habitOf(s, applyIn(s, { type: "createHabit", name: "Cooking" }));
    expect(accrueIntentionProgress(s, cooking.id, 600)).toBe(0); // another habit advances nothing
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    expect(accrueIntentionProgress(s, piano.id, 600)).toBe(1); // completes
  });

  it("specific-habit intentions ignore other habits and no-habit sessions", () => {
    const s = fresh();
    const piano = habitOf(s, applyIn(s, { type: "createHabit", name: "Piano" }));
    applyIn(s, { type: "createIntention", habitId: piano.id, minutes: 10, schedule: "daily", now: 1 });
    const cooking = habitOf(s, applyIn(s, { type: "createHabit", name: "Cooking" }));
    accrueIntentionProgress(s, cooking.id, 600);
    accrueIntentionProgress(s, null, 600);
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    accrueIntentionProgress(s, piano.id, 600);
    expect(s.records.intentions[0]!.completed).toBe(true);
  });

  it("does not count practice from before the intention existed", () => {
    const s = fresh();
    const habit = withHabit(s);
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: 5_000 });
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "daily", now: 6_000 });
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
  });

  it("manual logs complete intentions between sessions", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 15, schedule: "daily", now: 1 });
    const result = applyIn(s, { type: "logPractice", habitId: habit.id, minutes: 15, now: 2_000 });
    expect(result.completions).toBe(1);
    expect(s.records.intentions[0]!.completed).toBe(true);
  });
});

describe("intention edits (issue #445)", () => {
  it("a target edit retains qualifying practice: 30 to 60 after 20 qualifying minutes", () => {
    const s = fresh();
    const habit = withHabit(s);
    const intention = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 30, schedule: "daily", now: 1 }));
    begin(s, null, 0);
    advanceIn(s, 20 * 60, "flow");
    applyIn(s, { type: "endSession", now: 0 });
    expect(applyIn(s, { type: "editIntention", id: intention.id, minutes: 60, schedule: "daily", now: 9_000 }).ok).toBe(true);
    expect(intention.condition.minutes).toBe(60);
    expect(intention.progressSeconds).toBeCloseTo(20 * 60, 6);
    expect(intention.completed).toBe(false);
    // The retained minutes ride toward the raised target: forty more
    // completes it.
    begin(s, null, 0);
    expect(advanceIn(s, 40 * 60, "flow").intentionsCompleted).toBe(1);
    applyIn(s, { type: "endSession", now: 0 });
    expect(intention.completedCount).toBe(1);
  });

  it("a met intention stays completed until a raised target un-completes it, and no completion replays", () => {
    const s = fresh();
    const habit = withHabit(s);
    const intention = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 }));
    begin(s, null, 0);
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: 0 });
    expect(intention.completed).toBe(true);
    // Lower the target below met progress: already complete, no second
    // completion tick.
    applyIn(s, { type: "editIntention", id: intention.id, minutes: 5, schedule: "once", now: 9_000 });
    expect(intention.completed).toBe(true);
    expect(intention.completedCount).toBe(1);
    // Raise it: the completion un-lands, the practice stays.
    applyIn(s, { type: "editIntention", id: intention.id, minutes: 15, schedule: "once", now: 9_100 });
    expect(intention.completed).toBe(false);
    expect(intention.progressSeconds).toBeCloseTo(600, 6);
    begin(s, null, 0);
    expect(advanceIn(s, 300, "flow").intentionsCompleted).toBe(1);
    applyIn(s, { type: "endSession", now: 0 });
    // The raised target's completion is the intention's second lifetime
    // completion — the count accrues across the edit.
    expect(intention.completedCount).toBe(2);
  });

  it("a cadence edit splits live practice at midnight", () => {
    const s = fresh();
    const habit = withHabit(s);
    const midnight = new Date(2026, 9, 21).getTime();
    const intention = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 60, schedule: "weekly", now: midnight - DAY }));
    begin(s, null, midnight - 600_000);
    advanceIn(s, 1200, "flow");
    applyIn(s, { type: "endSession", now: midnight + 600_000 });
    applyIn(s, { type: "editIntention", id: intention.id, minutes: 60, schedule: "daily", now: midnight + 600_000 });
    expect(intention.progressSeconds).toBeCloseTo(600);
    const loaded = deserialize(serialize(s, 0)).state!;
    expect(activeIntentionOf(loaded, habit.id)!.progressSeconds).toBeCloseTo(600);
  });

  it("removal, replacement, edits and reload preserve previous intention descriptions", () => {
    const s = fresh();
    const habit = withHabit(s);
    const intention = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 30, schedule: "daily", now: 1 }));
    begin(s, null, 1000);
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: 601000 });
    applyIn(s, { type: "editIntention", id: intention.id, minutes: 60, schedule: "weekly", now: 602000 });
    applyIn(s, { type: "deleteIntention", id: intention.id });
    expect(applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 603000 }).ok).toBe(true);
    const loaded = deserialize(serialize(s, 0)).state!;
    expect(loaded.records.sessionRecords[0]!.goalsAdvanced[0]!.goal!.condition.minutes).toBe(30);
    expect(loaded.records.sessionRecords[0]!.goalsAdvanced[0]!.goal!.schedule.kind).toBe("daily");
    expect(loaded.records.intentions.find(row => row.id === intention.id)!.retired).toBe(true);
  });

  it("edits refuse bad figures and lock in flow", () => {
    const s = fresh();
    const habit = withHabit(s);
    const intention = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 }));
    expect(applyIn(s, { type: "editIntention", id: intention.id, minutes: 0, schedule: "once", now: 9_000 }).ok).toBe(false);
    expect(applyIn(s, { type: "editIntention", id: "nope", minutes: 10, schedule: "once", now: 9_000 }).ok).toBe(false);
    begin(s, 600, 0);
    expect(applyIn(s, { type: "editIntention", id: intention.id, minutes: 20, schedule: "once", now: 9_000 }).ok).toBe(false);
    applyIn(s, { type: "endSession", now: 0 });
    expect(intention.condition.minutes).toBe(10);
  });

  it("a cadence edit recalculates from qualifying practice in the new period", () => {
    const s = fresh();
    const habit = withHabit(s);
    const wednesday = Date.UTC(2026, 9, 21, 10); // 2026-10-21 Wed
    const intention = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 30, schedule: "daily", now: wednesday - 3 * DAY }));
    // Yesterday's credited session (10 min) and last week's (12 min).
    begin(s, null, 0);
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: wednesday - DAY });
    begin(s, null, 0);
    advanceIn(s, 720, "flow");
    applyIn(s, { type: "endSession", now: wednesday - 8 * DAY });
    // Today's live practice and manual condition progress both survive.
    begin(s, null, 0);
    advanceIn(s, 300, "flow");
    applyIn(s, { type: "endSession", now: wednesday });
    applyIn(s, { type: "logPractice", habitId: habit.id, minutes: 10, now: wednesday + 1_000 });
    applyIn(s, { type: "editIntention", id: intention.id, minutes: 30, schedule: "weekly", now: wednesday + 2_000 });
    expect(intention.schedule.kind).toBe("weekly");
    expect(intention.occurrenceKey).toBe(occurrenceKeyFor(intention.schedule, wednesday + 2_000));
    // Last week stays outside the period.
    expect(intention.progressSeconds).toBeCloseTo(300 + 600 + 600, 6);
    expect(intention.completed).toBe(false);
  });

  it("a cadence edit to once reads from the intention's creation; daily reads from local midnight", () => {
    const s = fresh();
    const habit = withHabit(s);
    const created = new Date(2026, 9, 19, 23).getTime(); // created late on the 19th
    const intention = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 60, schedule: "once", now: created }));
    begin(s, null, 0);
    advanceIn(s, 1_200, "flow");
    applyIn(s, { type: "endSession", now: created + DAY + 3_600_000 + 1_200_000 }); // the 21st, 00:00 local
    applyIn(s, { type: "editIntention", id: intention.id, minutes: 60, schedule: "daily", now: created + DAY + 3_600_000 + 1_200_000 });
    // Daily's period is today: the whole session landed after midnight.
    expect(intention.progressSeconds).toBeCloseTo(1_200, 6);
    // Back to once reads from creation: the whole record.
    applyIn(s, { type: "editIntention", id: intention.id, minutes: 60, schedule: "once", now: created + DAY + 3_600_000 + 1_200_000 });
    expect(intention.progressSeconds).toBeCloseTo(1_200, 6);
    applyIn(s, { type: "editIntention", id: intention.id, minutes: 10, schedule: "daily", now: created + DAY + 3_600_000 + 1_200_000 });
    expect(intention.completed).toBe(true);
    expect(intention.completedCount).toBe(0); // the recalculation never mints a completion
  });
});

describe("the migration's retain-one choice (issue #445)", () => {
  // The v11 → v12 conversion's shape, built by hand: several active rows
  // for one habit, every row held pending.
  function pendingPair(s: ReturnType<typeof fresh>): [Intention, Intention] {
    const habit = s.records.habits[0]!;
    const a = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 }));
    const b: Intention = {
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
    expect(activeIntentionOf(s, s.records.habits[0]!.id)).toBeUndefined();
    // An unresolved choice never blocks a session.
    begin(s, null, 0);
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
    expect(pendingIntentionsOf(s, habit.id)).toHaveLength(0);
    expect(activeIntentionOf(s, habit.id)).toBe(b);
    expect(b.progressSeconds).toBe(900);
    // The retained row runs: credited practice advances it again.
    expect(accrueIntentionProgress(s, habit.id, 1_800)).toBe(1);
    expect(b.completed).toBe(true);
    // The retired sibling's facts never moved.
    expect(a.progressSeconds).toBe(0);
    expect(a.condition).toEqual({ kind: "habit-minutes", habitId: habit.id, minutes: 10 });
  });

  it("the choice locks in flow like every intention mutation", () => {
    const s = fresh();
    withHabit(s);
    const [a] = pendingPair(s);
    begin(s, 600, 0);
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
  it("daily intentions reset at the local calendar day boundary", () => {
    const s = fresh();
    const habit = withHabit(s);
    const monday = Date.UTC(2026, 8, 14, 10); // 2026-09-14 10:00 UTC
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "daily", now: monday });
    accrueIntentionProgress(s, habit.id, 300);
    applyIn(s, { type: "rollIntentions", now: monday + 3600_000 }); // same day: no reset
    expect(s.records.intentions[0]!.progressSeconds).toBeCloseTo(300, 6);
    applyIn(s, { type: "rollIntentions", now: monday + DAY }); // next day: fresh occurrence
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    expect(s.records.intentions[0]!.completed).toBe(false);
    expect(s.records.intentions[0]!.completedCount).toBe(0);
  });

  it("weekly intentions reset at the Monday boundary", () => {
    const s = fresh();
    const habit = withHabit(s);
    const tuesday = Date.UTC(2026, 8, 15, 9); // 2026-09-15 Tue
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 60, schedule: "weekly", now: tuesday });
    accrueIntentionProgress(s, habit.id, 1800);
    applyIn(s, { type: "rollIntentions", now: tuesday + 2 * DAY }); // Thursday, same week
    expect(s.records.intentions[0]!.progressSeconds).toBeCloseTo(1800, 6);
    applyIn(s, { type: "rollIntentions", now: Date.UTC(2026, 8, 22, 8) }); // next Tuesday
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
  });

  it("one-time intentions never reset and keep running until edited or replaced", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 });
    accrueIntentionProgress(s, habit.id, 600);
    applyIn(s, { type: "rollIntentions", now: 999_999_999 });
    expect(s.records.intentions[0]!.completed).toBe(true);
    expect(s.records.intentions).toHaveLength(1);
  });
});

describe("persistence", () => {
  it("round-trips intentions with their progress", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 20, schedule: "daily", now: 7_000 });
    accrueIntentionProgress(s, habit.id, 240);
    const loaded = deserialize(serialize(s, 0))!;
    expect(loaded.state!.records.intentions).toHaveLength(1);
    expect(loaded.state!.records.intentions[0]!.progressSeconds).toBeCloseTo(240, 6);
  });

  it("normalizeIntentions drops the retired per-intention fields and carries a pending flag as written", () => {
    const s = fresh();
    const habit = withHabit(s);
    const intention = intentionOf(s, applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 }));
    const legacy = { ...structuredClone(intention), color: "cyan", liveSeconds: undefined } as unknown as Intention;
    const pending = { ...structuredClone(intention), id: `${intention.id}p`, pendingChoice: false } as unknown as Intention;
    normalizeIntentions([legacy, pending]);
    expect("color" in legacy).toBe(false);
    expect("liveSeconds" in legacy).toBe(false);
    expect("pendingChoice" in pending).toBe(false);
  });
});

describe("the completion tick", () => {
  it("caps an oversized completion at the remaining intention duration", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 });
    accrueIntentionProgress(s, habit.id, 300);
    expect(accrueIntentionProgress(s, habit.id, 3600)).toBe(1);
    expect(s.records.intentions[0]!.progressSeconds).toBe(600);
  });

  it("trusted batches complete intentions like one-second ticks", () => {
    function scenario() {
      const s = fresh();
      const habit = giveHabit(s).habit;
      applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 1, schedule: "once", now: 1 });
      begin(s, 600, 0);
      return s;
    }
    const batch = scenario();
    const ticks = scenario();
    advanceIn(batch, 600, "flow", "away", 0);
    const result = advanceIn(batch, 0, "flow");
    let completions = 0;
    for (let i = 0; i < 600; i++) completions += advanceIn(ticks, 1, "flow").intentionsCompleted;
    expect(result.intentionsCompleted).toBe(1);
    expect(completions).toBe(1);
    expect(batch.game.session!.goalSeconds).toEqual(ticks.game.session!.goalSeconds);
    expect(batch.records.intentions).toEqual(ticks.records.intentions);
  });

  it("honesty-credited minutes complete intentions at the reconciliation", () => {
    const s = fresh();
    const habit = withHabit(s);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "once", now: 1 });
    begin(s, null, 0);
    advanceIn(s, 900, "flow", "away", 0); // open-ended past the floor: provisional
    advanceIn(s, 0, "flow");
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    expect(applyIn(s, { type: "settleHonestyReport", outcome: "full" }).completions).toBe(1);
    expect(s.records.intentions[0]!.completed).toBe(true);
  });

  it("recurring intentions complete once per occurrence — the reset re-opens them", () => {
    const s = fresh();
    const habit = withHabit(s);
    const monday = Date.UTC(2026, 8, 14, 10);
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 10, schedule: "daily", now: monday });
    expect(accrueIntentionProgress(s, habit.id, 600)).toBe(1);
    expect(accrueIntentionProgress(s, habit.id, 600)).toBe(0);
    applyIn(s, { type: "rollIntentions", now: monday + DAY });
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    expect(accrueIntentionProgress(s, habit.id, 600)).toBe(1);
    expect(s.records.intentions[0]!.completedCount).toBe(2);
  });
});
