import { describe, expect, it } from "vitest";
import { dayStrip } from "./almanac";
import { advanceIn, applyIn, begin, fresh, habitOf } from "./fixtures";
import type { GameState } from "./types";

// The Almanac's day strips (issue #43, ADR-0080): a habit's credited time,
// live and manual, by local calendar day — the basis daily Intention
// occurrences roll on. `npm run test:calendar` runs this file under UTC
// and a DST-observing zone. Stamps are built with the local Date
// constructor, so each names a local wall time in either zone.

const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min).getTime();
const MIN = 60;

function piano(s: GameState) {
  return habitOf(s, applyIn(s, { type: "createHabit", name: "Piano", habitClass: "engineer" }));
}

function log(s: GameState, habitId: string, minutes: number, at: number) {
  const result = applyIn(s, { type: "logPractice", habitId, minutes, now: at });
  if (!result.ok) throw new Error(result.reason);
}

describe("the Almanac's day strips", () => {
  it("buckets live and manual credited time by local day, oldest first, today last", () => {
    const s = fresh();
    const habit = piano(s);
    const other = habitOf(s, applyIn(s, { type: "createHabit", name: "Chess", habitClass: "producer" }));
    log(s, habit.id, 20, local(2026, 5, 10, 9));
    log(s, habit.id, 15, local(2026, 5, 10, 21));
    log(s, habit.id, 40, local(2026, 5, 7, 0, 5));
    log(s, habit.id, 99, local(2026, 5, 3, 23, 55)); // eight days back: off the 7-day strip
    log(s, other.id, 30, local(2026, 5, 9));
    // A live session, credited 25 minutes and stamped at its end.
    begin(s, 1500, local(2026, 5, 8, 18), habit.id);
    advanceIn(s, 1500, "flow");
    applyIn(s, { type: "endSession", now: local(2026, 5, 8, 18, 25) });

    expect(dayStrip(s, habit.id, 7, local(2026, 5, 10, 22))).toEqual([0, 0, 0, 40 * MIN, 25 * MIN, 0, 35 * MIN]);
  });

  it("gives a 30-day strip whose first day is 29 days before today", () => {
    const s = fresh();
    const habit = piano(s);
    log(s, habit.id, 10, local(2026, 4, 12, 0, 1));
    log(s, habit.id, 5, local(2026, 4, 11, 23, 59));
    const strip = dayStrip(s, habit.id, 30, local(2026, 5, 10, 8));
    expect(strip).toHaveLength(30);
    expect(strip[0]).toBe(10 * MIN);
    expect(strip.reduce((a, b) => a + b, 0)).toBe(10 * MIN);
  });

  it("keeps a day a calendar day across a spring-forward and a fall-back transition", () => {
    const s = fresh();
    const habit = piano(s);
    // US spring-forward is Sunday 8 March 2026: that day is 23 hours long
    // in a DST zone. Practice just after its midnight and just before the
    // next stays on 8 March.
    log(s, habit.id, 10, local(2026, 2, 8, 0, 30));
    log(s, habit.id, 20, local(2026, 2, 8, 23, 30));
    log(s, habit.id, 30, local(2026, 2, 7, 23, 30));
    expect(dayStrip(s, habit.id, 3, local(2026, 2, 9, 12))).toEqual([30 * MIN, 30 * MIN, 0]);

    // US fall-back is Sunday 1 November 2026: a 25-hour day.
    log(s, habit.id, 7, local(2026, 10, 1, 0, 30));
    log(s, habit.id, 8, local(2026, 10, 1, 23, 30));
    log(s, habit.id, 9, local(2026, 10, 2, 0, 30));
    expect(dayStrip(s, habit.id, 3, local(2026, 10, 2, 12))).toEqual([0, 15 * MIN, 9 * MIN]);
  });

  it("counts nothing for a day the clock hasn't reached", () => {
    const s = fresh();
    const habit = piano(s);
    log(s, habit.id, 10, local(2026, 5, 11, 9));
    expect(dayStrip(s, habit.id, 7, local(2026, 5, 10, 9))).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
