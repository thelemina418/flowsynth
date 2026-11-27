import { describe, expect, it } from "vitest";
import { RECONCILIATION_FLOOR_SECONDS } from "./constants";
import { begin, applyIn, advanceIn, fresh, plainHabit } from "./fixtures";
import { recordTargetHit } from "./records";
import { deserialize, serialize } from "./save";
import { poolOutstanding } from "./trust";
import type { GameState } from "./types";

// The trust-accounting matrix (focus-tool spec §1–3): presence (visible /
// hidden / slept / discarded / reloaded / import) × mode (planned /
// open-ended) × slice (under-plan / past-target / sub-floor). Every cell's
// crediting and report expectation is decided by the spec's trust table.
// Interim (issue #15): the board retired, so credited practice time and the
// provisional pool are the whole of what a gap moves.

// Buffer an away gap and classify it whole — the flush is the boundary a
// return performs.
function away(state: GameState, seconds: number): void {
  advanceIn(state, seconds, "flow", "away", 0);
  advanceIn(state, 0, "flow");
}

describe("presence: visible credits live in every slice", () => {
  it("planned, under target: presence credits live", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 300, "flow", "visible", 0);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(300, 6);
    expect(s.game.session!.accounting.poolSeconds).toBe(0);
  });

  it("planned, past target: overrun presence still credits live — presence is always trusted", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    advanceIn(s, 300, "flow", "visible", 0);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(900, 6);
    expect(s.game.session!.accounting.poolSeconds).toBe(0);
  });

  it("open-ended: presence credits live", () => {
    const s = fresh();
    begin(s, null, 0);
    advanceIn(s, 120, "flow", "visible", 0);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(120, 6);
  });
});

describe("presence: hidden away through the trust table", () => {
  it("planned, under target: away is trusted — auto-credits, never questioned", () => {
    const s = fresh();
    begin(s, 600, 0);
    away(s, 400);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(400, 6);
    expect(s.game.session!.accounting.poolSeconds).toBe(0);
    expect(poolOutstanding(s)).toBe(false);
  });

  it("planned, past target: away is provisional — the minutes wait in the pool", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    away(s, 300);
    expect(s.game.session!.accounting.poolSeconds).toBeCloseTo(300, 6);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(600, 6);
    expect(poolOutstanding(s)).toBe(true);
  });

  it("a gap spanning the target splits at the return: under-plan auto-credits, past-target goes provisional", () => {
    const s = fresh();
    begin(s, 600, 0);
    away(s, 900);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(600, 6);
    expect(s.game.session!.accounting.poolSeconds).toBeCloseTo(300, 6);
  });

  it("open-ended past the floor: all away time is provisional", () => {
    const s = fresh();
    begin(s, null, 0);
    away(s, 1200);
    expect(s.game.session!.accounting.poolSeconds).toBeCloseTo(1200, 6);
    expect(s.game.session!.accounting.creditedSeconds).toBe(0);
  });

  it("paused credits nothing — neither present nor away", () => {
    const s = fresh();
    begin(s, 600, 0);
    applyIn(s, { type: "pauseSession" });
    const before = s.game.session!.elapsed;
    advanceIn(s, 600, "flow", "visible", 0);
    expect(s.game.session!.elapsed).toBe(before);
    expect(s.game.session!.accounting.creditedSeconds).toBe(0);
  });
});

describe("presence: sub-floor absences auto-credit silently on both modes", () => {
  it("open-ended, below the floor: credits, never joins the pool", () => {
    const s = fresh();
    begin(s, null, 0);
    away(s, RECONCILIATION_FLOOR_SECONDS - 1);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(RECONCILIATION_FLOOR_SECONDS - 1, 6);
    expect(s.game.session!.accounting.poolSeconds).toBe(0);
  });

  it("planned, past target, below the floor: still auto-credits silently", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    away(s, RECONCILIATION_FLOOR_SECONDS - 1);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(600 + RECONCILIATION_FLOOR_SECONDS - 1, 6);
    expect(s.game.session!.accounting.poolSeconds).toBe(0);
  });

  it("a hidden stretch classifies whole, never per throttled wake-up", () => {
    const s = fresh();
    begin(s, null, 0);
    // A throttled tab wakes ~1/min: ten buffered wake-ups are one absence.
    for (let i = 0; i < 10; i++) advanceIn(s, 60, "flow", "away", 0);
    advanceIn(s, 0, "flow");
    expect(s.game.session!.accounting.poolSeconds).toBeCloseTo(600, 6);
    expect(s.game.session!.accounting.creditedSeconds).toBe(0);
  });
});

describe("presence: slept gaps size by dual-clock drift", () => {
  it("a positive drift step is away even while the tab stayed visible", () => {
    const s = fresh();
    begin(s, null, 0);
    advanceIn(s, 3600, "flow", "visible", 1800);
    // The machine slept for 1800 s of the 3600 s wall gap: that span is
    // away (provisional, open-ended past the floor); the awake half credits
    // live as presence.
    expect(s.game.session!.accounting.poolSeconds).toBeCloseTo(1800, 6);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(1800, 6);
  });

  it("sleep-gap credit clamps at the plan on planned sessions", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 5000, "flow", "visible", 5000);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(600, 6);
    expect(s.game.session!.accounting.poolSeconds).toBeCloseTo(4400, 6);
  });

  it("sub-noise jitter steps neither discard the gap nor size a sleep", () => {
    const s = fresh();
    begin(s, 600, 0);
    // Whole-millisecond quantization jitters the measured drift a
    // millisecond or two per boundary (§1): sub-floor in either direction,
    // so each gap credits whole and sizes no sleep.
    for (let i = 0; i < 10; i++) advanceIn(s, 0.1, "flow", "visible", i % 2 === 0 ? -0.002 : 0.002);
    expect(s.game.session!.elapsed).toBeCloseTo(1, 6);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(1, 6);
    expect(s.game.session!.accounting.poolSeconds).toBe(0);
  });

  it("a sub-noise positive step sizes no sleep, even where the slice would go provisional", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    advanceIn(s, 1800, "flow", "visible", 0.04);
    // +40 ms of jitter lands past the plan, where a real slept slice goes
    // provisional: sizing it would leak the boundary's gap into the pool.
    expect(s.game.session!.accounting.poolSeconds).toBe(0);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(2400, 6);
    expect(s.game.session!.elapsed).toBeCloseTo(2400, 6);
  });

  it("a negative drift step (clock rolled back) credits zero", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 600, "flow", "visible", -120);
    expect(s.game.session!.elapsed).toBeCloseTo(0, 6);
    expect(s.game.session!.accounting.creditedSeconds).toBe(0);
  });

  it("sleep during an already-hidden stretch changes nothing: the stretch is away regardless", () => {
    const s = fresh();
    begin(s, null, 0);
    away(s, 3000);
    expect(s.game.session!.accounting.poolSeconds).toBeCloseTo(3000, 6);
  });

  it("slept past the plan on a planned session: the sleep slice past the target goes provisional", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    advanceIn(s, 1800, "flow", "visible", 1800);
    // All 1800 s of sleep land past the target: nothing credits, all of it
    // waits in the pool.
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(600, 6);
    expect(s.game.session!.accounting.poolSeconds).toBeCloseTo(1800, 6);
  });

  it("a slept gap straddling the plan: sleep clamps at the target, the awake tail credits live", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 1800, "flow", "visible", 1000);
    // Sleep: 600 s trusted up to the plan, 400 s provisional; then 800 s
    // awake presence credits live past the target.
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(1400, 6);
    expect(s.game.session!.accounting.poolSeconds).toBeCloseTo(400, 6);
    expect(s.game.session!.elapsed).toBeCloseTo(1800, 6);
  });
});

describe("one reconcile path: discard, reload, and import", () => {
  it("a mid-session reload classifies the saved gap as away through the same rules", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 300, "flow");
    const savedAt = 1_000_000;
    const loaded = deserialize(serialize(s, savedAt))!.state!;
    // The tab comes back ten minutes later — the whole gap is away, and
    // it spans the target: 300 s trusted, 300 s provisional.
    away(loaded, 600);
    expect(loaded.game.session!.accounting.creditedSeconds).toBeCloseTo(600, 6);
    expect(loaded.game.session!.accounting.poolSeconds).toBeCloseTo(300, 6);
  });

  it("a discarded tab's long gap flows provisional on open-ended and the report waits", () => {
    const s = fresh();
    begin(s, null, 0);
    advanceIn(s, 120, "flow");
    const loaded = deserialize(serialize(s, 5_000))!.state!;
    away(loaded, 3600);
    expect(loaded.game.session!.accounting.poolSeconds).toBeCloseTo(3600, 6);
    expect(poolOutstanding(loaded)).toBe(true);
    expect(loaded.game.session!.accounting.creditedSeconds).toBeCloseTo(120, 6);
  });

  it("an imported save with a running session reconciles identically", () => {
    const original = fresh();
    begin(original, 600, 0);
    advanceIn(original, 600, "flow");
    const imported = deserialize(serialize(original, 2_000_000))!.state!;
    away(imported, 1500);
    // 900 s trusted up to the plan, 600 s provisional past it.
    expect(imported.game.session!.accounting.creditedSeconds).toBeCloseTo(600, 6);
    expect(imported.game.session!.accounting.poolSeconds).toBeCloseTo(1500, 6);
  });

  it("an imported save's sub-floor gap auto-credits silently, never joining the pool", () => {
    const original = fresh();
    begin(original, null, 0);
    advanceIn(original, 60, "flow");
    const imported = deserialize(serialize(original, 2_000_000))!.state!;
    away(imported, RECONCILIATION_FLOOR_SECONDS - 1);
    expect(imported.game.session!.accounting.poolSeconds).toBe(0);
    expect(imported.game.session!.accounting.creditedSeconds).toBeCloseTo(60 + RECONCILIATION_FLOOR_SECONDS - 1, 6);
  });

  it("a discarded tab's gap on a planned session still under the plan is trusted in full", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 120, "flow");
    const loaded = deserialize(serialize(s, 5_000))!.state!;
    away(loaded, 300);
    expect(loaded.game.session!.accounting.creditedSeconds).toBeCloseTo(420, 6);
    expect(loaded.game.session!.accounting.poolSeconds).toBe(0);
    expect(poolOutstanding(loaded)).toBe(false);
  });
});

describe("the honesty report", () => {
  it("didn't practice: the pool credits 0 in one move", () => {
    const s = fresh();
    begin(s, null, 0);
    advanceIn(s, 60, "flow");
    away(s, 600);
    const resolution = applyIn(s, { type: "settleHonestyReport", outcome: "missed" });
    expect(resolution.ok).toBe(true);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(60, 6);
    expect(s.game.session!.accounting.poolSeconds).toBe(0);
    expect(s.game.session!.accounting.events).toEqual([{ awaySeconds: 600, outcome: "missed" }]);
  });

  it("did what I planned: credit rises to max(C, T); the pool credits only up to the plan", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    away(s, 300);
    const resolution = applyIn(s, { type: "settleHonestyReport", outcome: "planned" });
    expect(resolution.ok).toBe(true);
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(600, 6);
    expect(s.game.session!.accounting.events).toEqual([{ awaySeconds: 300, outcome: "planned" }]);
  });

  it("practiced the whole time away: the pool credits fully", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    away(s, 300);
    applyIn(s, { type: "settleHonestyReport", outcome: "full" });
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(900, 6);
    expect(s.game.session!.accounting.events).toEqual([{ awaySeconds: 300, outcome: "full" }]);
  });

  it("open-ended sessions have no middle option: matching a plan is rejected", () => {
    const s = fresh();
    begin(s, null, 0);
    away(s, 600);
    expect(applyIn(s, { type: "settleHonestyReport", outcome: "planned" }).ok).toBe(false);
  });

  it("an unanswered pool rolls forward and the next answer settles the whole recalculated pool", () => {
    const s = fresh();
    begin(s, null, 0);
    away(s, 300);
    away(s, 300);
    expect(s.game.session!.accounting.poolSeconds).toBeCloseTo(600, 6);
    applyIn(s, { type: "settleHonestyReport", outcome: "full" });
    expect(s.game.session!.accounting.events).toEqual([{ awaySeconds: 600, outcome: "full" }]);
  });

  it("nothing already credited is ever retracted by a later miss", () => {
    const s = fresh();
    begin(s, null, 0);
    away(s, 600);
    applyIn(s, { type: "settleHonestyReport", outcome: "full" });
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(600, 6);
    away(s, 600);
    applyIn(s, { type: "settleHonestyReport", outcome: "missed" });
    expect(s.game.session!.accounting.creditedSeconds).toBeCloseTo(600, 6);
    expect(s.game.session!.accounting.events).toHaveLength(2);
  });

  it("credited provisional time accrues the habit and intentions only when the report credits it", () => {
    const s = fresh();
    s.records.habits.push(plainHabit("h1"));
    s.records.activeHabitId = "h1";
    s.records.intentions.push({
      id: "g1",
      condition: { kind: "habit-minutes", habitId: "h1", minutes: 10 },
      schedule: { kind: "once" },
      occurrenceKey: "once",
      progressSeconds: 0,
      completed: false,
      completedCount: 0,
      createdAt: 0,
    });
    begin(s, null, 0);
    away(s, 900);
    // Provisional time sits: no habit seconds, no intention progress.
    expect(s.records.habits[0]!.seconds).toBe(0);
    expect(s.records.intentions[0]!.progressSeconds).toBe(0);
    applyIn(s, { type: "settleHonestyReport", outcome: "full" });
    expect(s.records.habits[0]!.seconds).toBeCloseTo(900, 6);
    expect(s.records.intentions[0]!.completed).toBe(true);
  });
});

describe("credited practice time is the consumers' seam", () => {
  it("the practice-log entry and the summary key off C — never raw elapsed", () => {
    const s = fresh();
    s.records.habits.push(plainHabit("h1"));
    s.records.activeHabitId = "h1";
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    away(s, 300);
    applyIn(s, { type: "settleHonestyReport", outcome: "full" });
    applyIn(s, { type: "endSession", now: 5_000 });
    // C = 900: the log entry and the summary agree.
    expect(s.records.practiceLog).toHaveLength(1);
    expect(s.records.practiceLog[0]!.seconds).toBeCloseTo(900, 6);
    expect(s.records.practiceLog[0]!.source).toBe("live");
    expect(s.game.summary!.seconds).toBeCloseTo(900, 6);
  });

  it("a reported miss never suppresses a presence-earned target hit", () => {
    const s = fresh();
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    away(s, 300);
    applyIn(s, { type: "settleHonestyReport", outcome: "missed" });
    applyIn(s, { type: "endSession", now: 5_000 });
    expect(recordTargetHit(s.records.sessionRecords[0]!)).toBe(true);
    expect(s.game.summary!.seconds).toBeCloseTo(600, 6);
  });

  it("ending with the pool outstanding is refused — the answer is mandatory and final", () => {
    const s = fresh();
    begin(s, null, 0);
    away(s, 600);
    const result = applyIn(s, { type: "endSession", now: 5_000 });
    expect(result.ok).toBe(false);
    expect(s.game.mode).toBe("flow");
    applyIn(s, { type: "settleHonestyReport", outcome: "missed" });
    expect(applyIn(s, { type: "endSession", now: 5_000 }).ok).toBe(true);
  });
});
