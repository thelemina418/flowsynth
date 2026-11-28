import { describe, expect, it } from "vitest";
import { advance } from "./advance";
import { cellKind } from "./board";
import { advanceIn, applyIn, begin, fresh, giveHabit, giveProducer } from "./fixtures";
import { goalOf } from "./goal";
import type { Cell } from "./hex";
import { cloneState } from "./state";
import type { GameState, ModuleType } from "./types";

// Wall HP and conquest in flow (spec chunk 05, issue #49), through the
// GameState seam: trusted flow time moves every wall below full HP, or
// taking damage, along hp(t) = min(full, hp₀ − (damage − regen) × t), and a
// wall that reaches 0 is conquered at that instant: its cell opens for
// life and the rates are recomputed once.

const O = { q: 0, r: 0 };
const E = { q: 1, r: 0 };
const SE = { q: 0, r: 1 };
const SHALE = { q: -1, r: 1 };
const SHALE_FALLS = 600 / 0.9;

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

// A Flywheel at 1 charge/s at the centre patched into Shale, a Sine
// making ν beside it, and an Engineer session running (Engineer credit
// moves no rate).
function fightingShale(): GameState {
  const s = fresh();
  place(s, "flywheel", O);
  place(s, "sine", E);
  must(s, { type: "patchCable", cable: "patch", source: O, target: SHALE });
  giveHabit(s, "Piano", "engineer");
  begin(s, null, 0);
  return s;
}

describe("the spec's acceptance", () => {
  it("a Flywheel at 1 charge/s patched into Shale conquers it after exactly 600 ÷ 0.9 s of trusted flow, and not before", () => {
    const s = fightingShale();
    const rate = s.game.rates.total.toNumber();
    advanceIn(s, SHALE_FALLS - 1, "flow");
    expect(cellKind(s.game.board, SHALE)).toBe("wall");
    expect(hpOf(s, SHALE)).toBeCloseTo(0.9, 9);
    expect(goalOf(s)).toBe("Conquer Shale");
    advanceIn(s, 1, "flow");
    expect(cellKind(s.game.board, SHALE)).toBe("open");
    expect(s.game.board.placements.some((p) => p.cell.q === SHALE.q && p.cell.r === SHALE.r)).toBe(false);
    expect(s.game.board.walls).toEqual([]);
    expect(s.game.rates.walls).toEqual([]);
    expect(goalOf(s)).toBe("Conquer Basalt");
    expect(s.game.nous.toNumber()).toBeCloseTo(rate * SHALE_FALLS, 9);
  });

  it("one long span conquers Shale at its instant and goes on with the rest", () => {
    const s = fightingShale();
    advanceIn(s, 1000, "flow");
    expect(cellKind(s.game.board, SHALE)).toBe("open");
    expect(s.game.board.walls).toEqual([]);
  });

  it("upgrade mode moves no wall: advance(s, 10⁶, 'upgrade') is deep-equal", () => {
    const s = fresh();
    place(s, "flywheel", O);
    must(s, { type: "patchCable", cable: "patch", source: O, target: SHALE });
    const before = cloneState(s);
    expect(advance(s, 1e6, "upgrade").state).toEqual(before);
  });
});

describe("HP over time", () => {
  it("paused time moves no wall", () => {
    const s = fightingShale();
    advanceIn(s, 100, "flow");
    must(s, { type: "pauseSession" });
    const before = cloneState(s.game.board);
    advanceIn(s, 10_000, "flow");
    expect(s.game.board).toEqual(before);
  });

  it("a damaged wall that nothing is fighting heals to full and no further", () => {
    const s = fightingShale();
    advanceIn(s, 100, "flow");
    expect(hpOf(s, SHALE)).toBeCloseTo(510, 9);
    must(s, { type: "endSession", now: 1 });
    must(s, { type: "dismissSummary" });
    must(s, { type: "unplugCable", source: O });
    begin(s, null, 2);
    advanceIn(s, 500, "flow");
    expect(hpOf(s, SHALE)).toBeCloseTo(560, 9);
    advanceIn(s, 400, "flow");
    expect(hpOf(s, SHALE)).toBeUndefined();
    advanceIn(s, 10_000, "flow");
    expect(s.game.board.walls).toEqual([]);
  });

  it("a wall whose damage doesn't exceed its regen never drops: 1 charge/s into Basalt's 1/s regen", () => {
    const s = fresh();
    place(s, "flywheel", O);
    must(s, { type: "patchCable", cable: "patch", source: O, target: { q: 0, r: -1 } });
    giveHabit(s, "Piano", "engineer");
    begin(s, null, 0);
    advanceIn(s, 100_000, "flow");
    expect(s.game.board.walls).toEqual([]);
    expect(cellKind(s.game.board, { q: 0, r: -1 })).toBe("wall");
  });

  it("two attackers on one wall add up: two Flywheels at 1.15 charge/s take Shale down 2.2/s", () => {
    const s = fresh();
    giveProducer(s, { modulators: 2, cables: 2 });
    place(s, "flywheel", O);
    place(s, "flywheel", SE);
    must(s, { type: "patchCable", cable: "patch", source: O, target: SHALE });
    must(s, { type: "patchCable", cable: "patch", source: SE, target: SHALE });
    giveHabit(s, "Piano", "engineer");
    begin(s, null, 0);
    advanceIn(s, 100, "flow");
    expect(hpOf(s, SHALE)).toBeCloseTo(380, 9);
  });
});

describe("conquest", () => {
  it("a cable aimed at Shale stays after the conquest and delivers to the empty cell", () => {
    const s = fightingShale();
    advanceIn(s, 1000, "flow");
    expect(s.game.board.cables).toEqual([{ type: "patch", source: O, target: SHALE }]);
    expect(s.game.rates.modulators[0]!.deliveries).toEqual([{ cell: SHALE, holds: "empty" }]);
  });

  it("ν is paid at the old rate up to the conquest instant and at the new rate after it", () => {
    // Producer Lv 2 (1.5 h): two Flywheels at 1.15 charge/s. One is
    // patched into Shale (net 1.05/s); the other charges a Sine. A
    // Producer session raises the Flywheels' output, read once more at the
    // conquest's recompute, so the Sine's rate changes at that instant.
    const s = fresh();
    giveProducer(s, { modulators: 2, cables: 2 });
    const credit = s.records.classCredit.producer;
    place(s, "flywheel", O);
    place(s, "sine", E);
    // Facing NE from (0,1), its reach is (1,0) and (2,-1): the Sine.
    place(s, "flywheel", SE);
    must(s, { type: "patchCable", cable: "patch", source: O, target: SHALE });
    giveHabit(s, "Synthesis", "producer");
    begin(s, null, 0);
    const before = s.game.rates.total.toNumber();
    const falls = 600 / (1 + 0.1 * (credit / 3600) - 0.1);
    advanceIn(s, falls + 100, "flow");
    expect(cellKind(s.game.board, SHALE)).toBe("open");
    const after = s.game.rates.total.toNumber();
    expect(after).toBeGreaterThan(before);
    expect(s.game.nous.toNumber()).toBeCloseTo(before * falls + after * 100, 6);
  });
});
