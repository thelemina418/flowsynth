import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { advance } from "./advance";
import { fresh, habitOf, intentionOf } from "./fixtures";
import { occurrenceKeyFor, occurrenceStartFor } from "./goals";
import type { GoalSchedule } from "./types";

// The calendar-basis regressions (issue #505). The engine's calendar basis
// is the host's local calendar — goal occurrence days read it — and that
// basis is declared, not discovered:
// these cases hold under UTC and under a DST-observing zone alike (the
// targeted runner, `npm run test:calendar`, executes this file and the goals
// suite under both). The expectations are derived from the raw UTC offset —
// an independent construction — so the goals primitives can never disagree
// with themselves without failing here, and the fixed-figure assertions are
// identical in both zones by design.

const DAY_MS = 24 * 60 * 60 * 1000;

// The local midnight preceding t, derived arithmetically from the raw
// offsets the host reports across the previous day. On a fall-back day the
// calendar date holds two midnight instants (00:00 in the pre-transition
// offset and 00:00 in the post-transition one); the engine's day start is
// the earliest real midnight — the Date-constructor pick — so the derivation
// takes every offset seen in the trailing 26 hours, keeps the candidates
// that display as 00:00 in the host zone, and takes the earliest. Ordinary
// days have one offset and one candidate; spring-forward days one real
// midnight. This is the independent side of every derivation below.
function localMidnightBefore(t: number): number {
  const offsets = new Set<number>();
  for (let back = 0; back <= 26; back += 1) offsets.add(-new Date(t - back * 3_600_000).getTimezoneOffset());
  let earliest: number | null = null;
  for (const offset of offsets) {
    const minutesIntoDay = (((t / 60_000) + offset) % 1440 + 1440) % 1440;
    const candidate = t - minutesIntoDay * 60_000;
    const shown = new Date(candidate);
    if (shown.getHours() !== 0 || shown.getMinutes() !== 0) continue;
    if (earliest === null || candidate < earliest) earliest = candidate;
  }
  return earliest!;
}

function withHabit(s: ReturnType<typeof fresh>) {
  const habit = habitOf(s, apply(s, { type: "createHabit", name: "Piano" }));
  apply(s, { type: "selectHabit", id: habit.id });
  return habit;
}

describe("the declared calendar basis (issue #505)", () => {
  it("daily occurrences begin at the earliest local midnight — the first one on a fall-back day", () => {
    // The first stamp lands on different local dates per zone (02:00 UTC is
    // the previous evening in a west-of-UTC zone); the second sits after a
    // 23-hour spring-forward day; the third sits on a fall-back day, whose
    // calendar date holds two midnight instants — the day rolls at the
    // first of them, and the derivation pins exactly that pick.
    const stamps = [
      Date.UTC(2026, 5, 10, 2, 0, 0),
      Date.UTC(2026, 2, 9, 12, 30, 0),
      Date.UTC(2026, 10, 1, 21, 0, 0),
    ];
    const schedule: GoalSchedule = { kind: "daily" };
    for (const now of stamps) {
      const start = occurrenceStartFor(schedule, now, 0);
      expect(start).toBe(localMidnightBefore(now));
      // The occurrence key and its own period start can never disagree.
      expect(occurrenceKeyFor(schedule, now)).toBe(occurrenceKeyFor(schedule, start));
      expect(start).toBeLessThanOrEqual(now);
    }
  });

  it("weekly occurrences begin on the local Monday", () => {
    const stamps = [Date.UTC(2026, 2, 8, 22, 0, 0), Date.UTC(2026, 10, 1, 12, 0, 0)];
    const schedule: GoalSchedule = { kind: "weekly" };
    for (const now of stamps) {
      const start = occurrenceStartFor(schedule, now, 0);
      expect(new Date(start).getDay()).toBe(1); // Monday, in local terms
      expect(start).toBeLessThanOrEqual(now);
      expect(occurrenceKeyFor(schedule, now)).toBe(occurrenceKeyFor(schedule, start));
    }
  });

  it("a session crossing the midnight after a DST-shortened day splits at the local boundary", () => {
    // Local noon on March 9 — its preceding local midnight closes the
    // 23-hour spring-forward day (March 8) in a DST-observing zone and an
    // ordinary 24-hour day in UTC. The split figures are identical in both.
    const boundary = localMidnightBefore(new Date(2026, 2, 9, 12).getTime());
    const s = fresh();
    const habit = withHabit(s);
    const goal = intentionOf(s, apply(s, { type: "createIntention", habitId: habit.id, minutes: 60, schedule: "weekly", now: boundary - DAY_MS }));
    apply(s, { type: "startSession", target: null, now: boundary - 600_000 });
    advance(s, 1200, "flow");
    apply(s, { type: "endSession", now: boundary + 600_000 });
    apply(s, { type: "editIntention", id: goal.id, minutes: 60, schedule: "daily", now: boundary + 600_000 });
    // Only the post-boundary share belongs to the new daily occurrence.
    expect(goal.progressSeconds).toBeCloseTo(600, 6);
  });
});
