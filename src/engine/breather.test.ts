import { describe, expect, it } from "vitest";
import { advanceIn, applyIn, begin, fresh, giveOscillators } from "./fixtures";
import type { GameState } from "./types";
import { cloneState } from "./state";
import { deserialize, serialize } from "./save";

// The breather (spec chunk 04, issue #41; ADR-0095): a session with at
// least 10 credited minutes banks one, credited ÷ 5 from 5 to 15 minutes,
// and at most one is held.

// A session of `minutes` present, credited minutes, ended.
function session(state: GameState, minutes: number): void {
  begin(state, Math.max(600, minutes * 60), 0);
  advanceIn(state, minutes * 60, "flow");
  const ended = applyIn(state, { type: "endSession", now: 1_000 });
  if (!ended.ok) throw new Error(ended.reason);
  applyIn(state, { type: "dismissSummary" });
}

describe("banking a breather", () => {
  it("banks 5, 10 and 15 minutes for 25, 50 and 90 credited minutes", () => {
    for (const [minutes, banked] of [
      [25, 300],
      [50, 600],
      [90, 900],
    ] as const) {
      const s = fresh();
      session(s, minutes);
      expect(s.game.breather.banked).toEqual({ seconds: banked });
      expect(s.game.summary!.breather).toBe(banked);
    }
  });

  it("banks nothing for 9 minutes, and keeps an earlier bank", () => {
    const s = fresh();
    session(s, 9);
    expect(s.game.breather.banked).toBeNull();
    expect(s.game.summary!.breather).toBeNull();
    session(s, 25);
    session(s, 9);
    expect(s.game.breather.banked).toEqual({ seconds: 300 });
  });

  it("replaces an older bank with a newer one, and a new session keeps it", () => {
    const s = fresh();
    session(s, 90);
    session(s, 25);
    expect(s.game.breather.banked).toEqual({ seconds: 300 });
    begin(s, 1500, 2_000);
    expect(s.game.breather.banked).toEqual({ seconds: 300 });
  });
});

// Release, charged by a Flywheel facing SE, beside a lone Sine (issue #41,
// Rates): Release's breather base is 6 where its flow base is 0.
function releaseLayout(): GameState {
  const s = fresh();
  giveOscillators(s, { arrive: ["release"] });
  applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 0 } });
  applyIn(s, { type: "rotateModule", cell: { q: 0, r: 0 }, turn: "clockwise" });
  applyIn(s, { type: "placeModule", module: "release", cell: { q: 1, r: 0 } });
  applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 1 } });
  return s;
}

describe("breather rates", () => {
  it("gives Release 6 × its factors, every other oscillator its flow rate, and doubles the sum", () => {
    const s = releaseLayout();
    const [release, sine] = s.game.rates.oscillators;
    expect(release!.module).toBe("release");
    // A Flywheel at 0 Producer hours delivers 1 charge/s: 1 + ln 2. The
    // opening's walls press 34% on (1,0) and 39% on (0,1) (issue #52).
    expect(release!.rate.toNumber()).toBe(0);
    expect(release!.breatherRate.toNumber()).toBeCloseTo(6 * (1 + Math.LN2) * 0.66, 12);
    expect(sine!.breatherRate.toNumber()).toBeCloseTo(0.61, 12);
    expect(s.game.rates.breatherTotal.toNumber()).toBeCloseTo(2 * (0.61 + 6 * (1 + Math.LN2) * 0.66), 12);
  });
});

// The Release layout with a 25-minute session ended: a 5-minute breather
// banked and the summary dismissed.
function bankedLayout(): GameState {
  const s = releaseLayout();
  session(s, 25);
  return s;
}

describe("taking a breather", () => {
  it("moves the bank into running and the mode to breather", () => {
    const s = bankedLayout();
    expect(applyIn(s, { type: "takeBreather", now: 7_000 }).ok).toBe(true);
    expect(s.game.mode).toBe("breather");
    expect(s.game.breather.banked).toBeNull();
    expect(s.game.breather.running).toEqual({ seconds: 300, elapsed: 0, startedAt: 7_000 });
  });

  it("is refused with nothing banked, the summary unseen, one running, or outside upgrade mode", () => {
    const none = releaseLayout();
    expect(applyIn(none, { type: "takeBreather", now: 0 }).ok).toBe(false);

    const unseen = releaseLayout();
    begin(unseen, 1500, 0);
    advanceIn(unseen, 1500, "flow");
    applyIn(unseen, { type: "endSession", now: 1_000 });
    expect(applyIn(unseen, { type: "takeBreather", now: 0 }).ok).toBe(false);

    const running = bankedLayout();
    applyIn(running, { type: "takeBreather", now: 0 });
    expect(applyIn(running, { type: "takeBreather", now: 0 }).ok).toBe(false);

    const flowing = bankedLayout();
    begin(flowing, 1500, 0);
    expect(applyIn(flowing, { type: "takeBreather", now: 0 }).ok).toBe(false);
  });

  it("pays breatherTotal × length exactly once, at the deadline, and lands in upgrade mode", () => {
    const s = bankedLayout();
    const nous = s.game.nous;
    const total = s.game.rates.breatherTotal;
    applyIn(s, { type: "takeBreather", now: 0 });
    advanceIn(s, 120, "breather");
    expect(s.game.breather.running!.elapsed).toBe(120);
    expect(s.game.nous.eq(nous)).toBe(true);
    advanceIn(s, 3600, "breather");
    const paid = total.mul(300).toNumber();
    expect(s.game.nous.sub(nous).toNumber()).toBeCloseTo(paid, 9);
    expect(s.game.breather.result!.nous.toNumber()).toBeCloseTo(paid, 9);
    expect(s.game.breather.running).toBeNull();
    expect(s.game.mode).toBe("upgrade");
    const after = s.game.nous;
    advanceIn(s, 3600, "breather");
    expect(s.game.nous.eq(after)).toBe(true);
  });

  it("credits no habit, class or Intention", () => {
    const s = bankedLayout();
    const habit = s.records.habits[0]!;
    applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 60, schedule: "daily", now: 0 });
    const records = cloneState(s.records);
    applyIn(s, { type: "takeBreather", now: 0 });
    advanceIn(s, 120, "breather");
    advanceIn(s, 600, "breather");
    expect(s.records).toEqual(records);
  });

  it("ending early pays nothing and re-banks the same length", () => {
    const s = bankedLayout();
    const nous = s.game.nous;
    applyIn(s, { type: "takeBreather", now: 0 });
    advanceIn(s, 200, "breather");
    expect(applyIn(s, { type: "endBreatherEarly" }).ok).toBe(true);
    expect(s.game.nous.eq(nous)).toBe(true);
    expect(s.game.breather).toEqual({ banked: { seconds: 300 }, running: null, result: null });
    expect(s.game.mode).toBe("upgrade");
    expect(applyIn(s, { type: "endBreatherEarly" }).ok).toBe(false);
  });

  it("dismissing the result clears it", () => {
    const s = bankedLayout();
    applyIn(s, { type: "takeBreather", now: 0 });
    advanceIn(s, 300, "breather");
    expect(s.game.breather.result).not.toBeNull();
    expect(applyIn(s, { type: "dismissBreatherResult" }).ok).toBe(true);
    expect(s.game.breather.result).toBeNull();
    expect(applyIn(s, { type: "dismissBreatherResult" }).ok).toBe(false);
  });

  it("leaves an upgrade hour deep-equal with a breather banked, and a breather advance outside a breather", () => {
    const s = bankedLayout();
    const before = cloneState(s);
    advanceIn(s, 3600, "upgrade");
    advanceIn(s, 3600, "breather");
    expect(s).toEqual(before);
  });
});

describe("the board during a breather", () => {
  it("is locked", () => {
    const s = bankedLayout();
    applyIn(s, { type: "takeBreather", now: 0 });
    expect(applyIn(s, { type: "removeModule", cell: { q: 0, r: 1 } }).ok).toBe(false);
  });
});

describe("saving a breather", () => {
  const roundTrip = (s: GameState): GameState => {
    const loaded = deserialize(serialize(s, 0));
    if (!loaded.state) throw new Error(loaded.error);
    return loaded.state;
  };

  it("round-trips the banked, running and result states, and the summary's breather", () => {
    const s = bankedLayout();
    const banked = roundTrip(s);
    expect(banked.game.breather).toEqual(s.game.breather);
    expect(banked.game.summary!.breather).toBe(300);

    applyIn(s, { type: "takeBreather", now: 9_000 });
    advanceIn(s, 100, "breather");
    const running = roundTrip(s);
    expect(running.game.mode).toBe("breather");
    expect(running.game.breather).toEqual(s.game.breather);

    advanceIn(s, 200, "breather");
    const result = roundTrip(s);
    expect(result.game.mode).toBe("upgrade");
    expect(result.game.breather.result!.nous.eq(s.game.breather.result!.nous)).toBe(true);
  });

  it("completes a breather whose deadline passed while closed on the first breather advance after load", () => {
    const s = bankedLayout();
    const nous = s.game.nous;
    applyIn(s, { type: "takeBreather", now: 0 });
    advanceIn(s, 100, "breather");
    const loaded = roundTrip(s);
    advanceIn(loaded, 10_000, "breather");
    expect(loaded.game.mode).toBe("upgrade");
    expect(loaded.game.nous.sub(nous).toNumber()).toBeCloseTo(s.game.rates.breatherTotal.mul(300).toNumber(), 9);
  });

  it("reads a save without breather facts as nothing banked", () => {
    const text = serialize(fresh(), 0).replace(/"breather": \{[^}]*\},?/, "");
    expect(text).not.toContain('"breather"');
    expect(deserialize(text).state!.game.breather).toEqual({ banked: null, running: null, result: null });
  });
});
