import { describe, expect, it } from "vitest";
import { cellKind } from "./board";
import { advanceIn, applyIn, begin, fresh, giveHabit } from "./fixtures";
import type { Cell } from "./hex";
import { deserialize, serialize } from "./save";
import { cloneState } from "./state";
import type { GameState, HonestyOutcome, ModuleType } from "./types";

// Away time past the plan and breathers fight walls (spec chunk 05, issue
// #51), through the GameState seam. Provisional flow time holds its wall
// seconds aside, as it holds provisional ν; the honesty answer runs them
// through the walls or drops them. A completed breather runs its length
// through the walls at 2× damage, regen ×1.

const O = { q: 0, r: 0 };
const E = { q: 1, r: 0 };
const SHALE = { q: -1, r: 1 };

function must(s: GameState, action: Parameters<typeof applyIn>[1]): void {
  const done = applyIn(s, action);
  if (!done.ok) throw new Error(`fixture ${action.type} failed: ${done.reason}`);
}

function place(s: GameState, module: ModuleType, cell: Cell): void {
  must(s, { type: "placeModule", module, cell });
}

function hpOf(s: GameState, cell: Cell): number | undefined {
  return s.game.board.walls.find((w) => w.cell.q === cell.q && w.cell.r === cell.r)?.hp.toNumber();
}

// A Flywheel at 1 charge/s patched into Shale (net 0.9/s), a Sine making ν
// beside it, and a planned Engineer session of 10 minutes running.
function fightingShale(target: number | null = 600): GameState {
  const s = fresh();
  place(s, "flywheel", O);
  place(s, "sine", E);
  must(s, { type: "patchCable", cable: "patch", source: O, target: SHALE });
  giveHabit(s, "Piano", "engineer");
  begin(s, target, 0);
  return s;
}

// Present for `present` s, then away for `away` s and back.
function awayPastPlan(s: GameState, present: number, away: number): void {
  advanceIn(s, present, "flow");
  advanceIn(s, away, "flow", "away");
  advanceIn(s, 0, "flow");
}

describe("away time past the plan", () => {
  it("holds its wall seconds: Shale stands where the present time left it until the report settles", () => {
    const s = fightingShale();
    awayPastPlan(s, 600, 400);
    expect(s.game.session!.accounting.poolSeconds).toBeCloseTo(400, 9);
    expect(hpOf(s, SHALE)).toBeCloseTo(600 - 0.9 * 600, 9);
  });

  it("`missed` leaves the walls as they were", () => {
    const s = fightingShale();
    awayPastPlan(s, 600, 400);
    const walls = cloneState(s.game.board.walls);
    must(s, { type: "settleHonestyReport", outcome: "missed" });
    expect(s.game.board.walls).toEqual(walls);
  });

  for (const outcome of ["full", "planned"] as HonestyOutcome[]) {
    it(`\`${outcome}\` runs the held seconds through the walls`, () => {
      const s = fightingShale();
      awayPastPlan(s, 300, 600);
      // 300 s present, then 300 s of the absence trusted up to the plan and
      // 300 s held: Shale stands at 600 − 0.9 × 600 until the answer.
      expect(hpOf(s, SHALE)).toBeCloseTo(60, 9);
      must(s, { type: "settleHonestyReport", outcome });
      expect(hpOf(s, SHALE)).toBeUndefined();
      expect(cellKind(s.game.board, SHALE)).toBe("open");
      expect(s.game.session!.walls).toEqual([{ cell: SHALE, lost: expect.anything(), conquered: true }]);
    });
  }

  it("keeps the provisional ν as computed when the replay conquers", () => {
    const s = fightingShale();
    awayPastPlan(s, 300, 600);
    const held = s.game.session!.accounting.provisionalNous;
    const nous = s.game.nous;
    must(s, { type: "settleHonestyReport", outcome: "full" });
    expect(s.game.nous.sub(nous).eq(held)).toBe(true);
  });

  it("on an open-ended session, the replay moves Shale by the held seconds at net 0.9/s", () => {
    const s = fightingShale(null);
    awayPastPlan(s, 100, 200);
    expect(hpOf(s, SHALE)).toBeCloseTo(510, 9);
    must(s, { type: "settleHonestyReport", outcome: "full" });
    expect(hpOf(s, SHALE)).toBeCloseTo(510 - 0.9 * 200, 9);
  });

  it("an older save holds the pool's seconds", () => {
    const s = fightingShale(null);
    awayPastPlan(s, 100, 200);
    const file = JSON.parse(serialize(s, 0));
    delete file.state.game.session.accounting.wallSeconds;
    const loaded = deserialize(JSON.stringify(file)).state!;
    must(loaded, { type: "settleHonestyReport", outcome: "full" });
    expect(hpOf(loaded, SHALE)).toBeCloseTo(510 - 0.9 * 200, 9);
  });
});

const SE = { q: 0, r: 1 };

// A Flywheel at the centre and a Sine at (0,1), beside Shale; a
// `minutes`-minute Engineer session ended, banking a breather of
// minutes ÷ 5; then the Flywheel patched into Shale (net 0.9/s in flow).
function bankedAgainstShale(minutes: number): GameState {
  const s = fresh();
  place(s, "flywheel", O);
  place(s, "sine", SE);
  giveHabit(s, "Piano", "engineer");
  begin(s, minutes * 60, 0);
  advanceIn(s, minutes * 60, "flow");
  must(s, { type: "endSession", now: 1_000 });
  must(s, { type: "dismissSummary" });
  must(s, { type: "patchCable", cable: "patch", source: O, target: SHALE });
  return s;
}

describe("a breather fights walls", () => {
  it("runs its length through the walls at 2× damage and regen ×1", () => {
    const s = bankedAgainstShale(25);
    expect(s.game.breather.banked).toEqual({ seconds: 300 });
    must(s, { type: "takeBreather", now: 0 });
    advanceIn(s, 120, "breather");
    expect(s.game.board.walls).toEqual([]);
    advanceIn(s, 3600, "breather");
    // Damage 2 × 1.0/s, regen 0.1/s: 1.9/s over 300 s.
    expect(hpOf(s, SHALE)).toBeCloseTo(600 - 1.9 * 300, 9);
    expect(s.game.breather.result!.walls).toEqual([{ cell: SHALE, lost: expect.anything(), conquered: false, fought: true }]);
    expect(s.game.breather.result!.walls[0]!.lost.toNumber()).toBeCloseTo(570, 9);
  });

  it("a conquest mid-breather splits the ν payout at each segment's breatherTotal", () => {
    const s = bankedAgainstShale(50);
    expect(s.game.breather.banked).toEqual({ seconds: 600 });
    const before = s.game.rates.breatherTotal.toNumber();
    const nous = s.game.nous;
    must(s, { type: "takeBreather", now: 0 });
    advanceIn(s, 600, "breather");
    expect(cellKind(s.game.board, SHALE)).toBe("open");
    expect(s.game.board.walls).toEqual([]);
    // Shale's fall eases the Sine at (0,1) from 39% to 34% pressure.
    const after = s.game.rates.breatherTotal.toNumber();
    expect(after).toBeGreaterThan(before);
    const falls = 600 / 1.9;
    const paid = before * falls + after * (600 - falls);
    expect(s.game.nous.sub(nous).toNumber()).toBeCloseTo(paid, 9);
    expect(s.game.breather.result!.nous.toNumber()).toBeCloseTo(paid, 9);
    expect(s.game.breather.result!.walls).toEqual([{ cell: SHALE, lost: expect.anything(), conquered: true, fought: false }]);
  });

  it("ending a breather early leaves the walls deep-equal", () => {
    const s = bankedAgainstShale(25);
    const board = cloneState(s.game.board);
    must(s, { type: "takeBreather", now: 0 });
    advanceIn(s, 299, "breather");
    must(s, { type: "endBreatherEarly" });
    expect(s.game.board).toEqual(board);
  });

  it("a breather reloaded past its deadline moves the walls once", () => {
    const s = bankedAgainstShale(25);
    must(s, { type: "takeBreather", now: 0 });
    advanceIn(s, 100, "breather");
    const loaded = deserialize(serialize(s, 0)).state!;
    advanceIn(loaded, 10_000, "breather");
    expect(hpOf(loaded, SHALE)).toBeCloseTo(600 - 1.9 * 300, 9);
    const again = deserialize(serialize(loaded, 0)).state!;
    advanceIn(again, 10_000, "breather");
    expect(hpOf(again, SHALE)).toBeCloseTo(600 - 1.9 * 300, 9);
    expect(again.game.breather.result!.walls[0]!.lost.toNumber()).toBeCloseTo(570, 9);
  });
});
