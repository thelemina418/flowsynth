import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { advanceIn, applyIn, fresh, giveHabit, giveProducer, ownCells } from "./fixtures";
import type { Cell } from "./hex";
import { deserialize, serialize } from "./save";
import { cloneState } from "./state";
import type { Action } from "./apply";
import type { GameState, ModuleType } from "./types";

// Patching into walls (spec chunk 03, issue #34), through the GameState
// seam: a Patch may target a wall in the current arc, which takes the
// charge as damage at 1:1, except into an `Only Arm damage` wall (issue
// #48), which refuses it. Damage is a rate here; HP over time is
// conquest.test.ts's (issue #49).

const O = { q: 0, r: 0 };
const NE = { q: 1, r: -1 };
const SHALE = { q: -1, r: 1 };
const FLINT = { q: 0, r: -2 };
const SCHIST = { q: 2, r: -1 };
const BASALT = { q: 0, r: -1 };
const HOUR = 3600;

function must(s: GameState, action: Parameters<typeof applyIn>[1]): void {
  const done = applyIn(s, action);
  if (!done.ok) throw new Error(`fixture ${action.type} failed: ${done.reason}`);
}

function place(s: GameState, module: ModuleType, cell: Cell): void {
  must(s, { type: "placeModule", module, cell });
}

function patch(s: GameState, source: Cell, target: Cell) {
  return applyIn(s, { type: "patchCable", cable: "patch", source, target });
}

function wallRate(s: GameState, cell: Cell) {
  return s.game.rates.walls.find((w) => w.cell.q === cell.q && w.cell.r === cell.r);
}

function oscillatorAt(s: GameState, cell: Cell) {
  return s.game.rates.oscillators.find((o) => o.cell.q === cell.q && o.cell.r === cell.r)!;
}

// The opening board: a Flywheel at the centre facing NE onto a Triangle.
function charged(): GameState {
  const s = fresh();
  place(s, "flywheel", O);
  place(s, "triangle", NE);
  return s;
}

describe("the spec's acceptance", () => {
  it("patching the Triangle's Flywheel to Shale removes the Triangle's charge, and Shale takes 1/s less its 0.1/s regen", () => {
    const s = charged();
    expect(oscillatorAt(s, NE).charge.toNumber()).toBeCloseTo(1 + Math.log(2), 12);
    expect(patch(s, O, SHALE).ok).toBe(true);
    expect(oscillatorAt(s, NE).chargeReceived.toNumber()).toBe(0);
    expect(oscillatorAt(s, NE).charge.toNumber()).toBe(1);
    const shale = wallRate(s, SHALE)!;
    expect(shale.damage.toNumber()).toBe(1);
    expect(shale.regen.toNumber()).toBe(0.1);
    expect(shale.net.toNumber()).toBeCloseTo(0.9, 12);
  });
});

describe("a wall's rate", () => {
  it("a Flywheel at 4 credited Producer hours patched into Shale deals 1.4 damage/s", () => {
    const s = fresh();
    s.records.classCredit.producer = 4 * HOUR;
    place(s, "flywheel", O);
    expect(patch(s, O, SHALE).ok).toBe(true);
    expect(wallRate(s, SHALE)!.damage.toNumber()).toBeCloseTo(1.4, 12);
  });

  it("every wall carries its kind's regen: Basalt 1/s, Schist 15/s", () => {
    const s = fresh();
    ownCells(s, [{ q: 1, r: 1 }]);
    // Producer Lv 2 (1.5 h): 2 modulators, 2 cables, 1.15 charge/s each.
    giveProducer(s, { modulators: 2, cables: 2 });
    place(s, "flywheel", { q: 1, r: 0 });
    place(s, "flywheel", O);
    expect(patch(s, { q: 1, r: 0 }, SCHIST).ok).toBe(true);
    expect(patch(s, O, BASALT).ok).toBe(true);
    const schist = wallRate(s, SCHIST)!;
    expect(schist.regen.toNumber()).toBe(15);
    expect(schist.net.toNumber()).toBeCloseTo(-13.85, 12);
    const basalt = wallRate(s, BASALT)!;
    expect(basalt.regen.toNumber()).toBe(1);
    expect(basalt.net.toNumber()).toBeCloseTo(0.15, 12);
  });

  it("carries its full HP, its pressure and the oscillators it presses (spec chunk 05)", () => {
    // Basalt (8%) presses on the Sine and the Triangle beside it,
    // not on the Flywheel patched into it.
    const s = fresh();
    place(s, "sine", O);
    place(s, "triangle", NE);
    place(s, "flywheel", { q: 0, r: 1 });
    expect(patch(s, { q: 0, r: 1 }, BASALT).ok).toBe(true);
    const basalt = wallRate(s, BASALT)!;
    expect([basalt.full.toNumber(), basalt.pressure, basalt.pressed]).toEqual([6000, 0.08, 2]);
    // Shale borders the Sine and the Flywheel.
    expect(patch(s, { q: 0, r: 1 }, SHALE).ok).toBe(false);
    must(s, { type: "repatchCable", source: { q: 0, r: 1 }, target: SHALE });
    const shale = wallRate(s, SHALE)!;
    expect([shale.full.toNumber(), shale.pressure, shale.pressed]).toEqual([600, 0.05, 1]);
  });

  it("reach onto a wall deals no damage", () => {
    // Facing SW from the centre: Shale, then (-2,2), a wall.
    const s = fresh();
    place(s, "flywheel", O);
    for (let i = 0; i < 3; i++) must(s, { type: "rotateModule", cell: O, turn: "clockwise" });
    expect(s.game.rates.modulators[0]!.deliveries.map((d) => d.holds)).toEqual(["wall", "wall"]);
    expect(s.game.rates.walls).toEqual([]);
  });

  it("two Patches into one wall sum", () => {
    const s = fresh();
    giveProducer(s, { modulators: 2, cables: 2 });
    place(s, "flywheel", O);
    place(s, "flywheel", { q: 0, r: 1 });
    expect(patch(s, O, SHALE).ok).toBe(true);
    expect(patch(s, { q: 0, r: 1 }, SHALE).ok).toBe(true);
    expect(s.game.rates.walls).toHaveLength(1);
    expect(wallRate(s, SHALE)!.damage.toNumber()).toBeCloseTo(2.3, 12);
    expect(wallRate(s, SHALE)!.net.toNumber()).toBeCloseTo(2.2, 12);
  });

  it("unplugging the Patch leaves the wall untargeted", () => {
    const s = fresh();
    place(s, "flywheel", O);
    must(s, { type: "patchCable", cable: "patch", source: O, target: SHALE });
    must(s, { type: "unplugCable", source: O });
    expect(s.game.rates.walls).toEqual([]);
  });
});

describe("upgrade mode applies nothing to a wall", () => {
  it("in upgrade the board and the wall rates stay as they were; flow moves walls since issue #49 (conquest.test.ts)", () => {
    const s = fresh();
    giveHabit(s);
    place(s, "flywheel", O);
    must(s, { type: "patchCable", cable: "patch", source: O, target: SHALE });
    const board = cloneState(s).game.board;
    const walls = cloneState(s).game.rates.walls;
    advanceIn(s, HOUR, "upgrade");
    expect(s.game.board).toEqual(board);
    expect(s.game.rates.walls).toEqual(walls);
  });
});

describe("the Patch rules for a wall target", () => {
  it("a Patch into Flint is refused with `Only Arm damage.` and the state deep-equal", () => {
    const s = fresh();
    ownCells(s, [{ q: 1, r: -2 }]);
    place(s, "flywheel", { q: 1, r: -2 });
    const before = cloneState(s);
    const done = apply(s, { type: "patchCable", cable: "patch", source: { q: 1, r: -2 }, target: FLINT });
    expect(done.ok).toBe(false);
    expect(done.reason).toBe("Only Arm damage.");
    expect(done.state).toEqual(before);
  });

  it("re-aiming a Patch into Flint is refused the same way", () => {
    const s = fresh();
    ownCells(s, [{ q: 1, r: -2 }]);
    place(s, "flywheel", { q: 1, r: -2 });
    must(s, { type: "patchCable", cable: "patch", source: { q: 1, r: -2 }, target: BASALT });
    const before = cloneState(s);
    const done = apply(s, { type: "repatchCable", source: { q: 1, r: -2 }, target: FLINT });
    expect(done.reason).toBe("Only Arm damage.");
    expect(done.state).toEqual(before);
  });

  it("a wall beyond length 3 is refused with the state deep-equal", () => {
    // (-2,0) to Schist at (2,-1) is 4 apart.
    const s = fresh();
    ownCells(s, [{ q: -2, r: 0 }]);
    place(s, "flywheel", { q: -2, r: 0 });
    const before = cloneState(s);
    const done = apply(s, { type: "patchCable", cable: "patch", source: { q: -2, r: 0 }, target: SCHIST });
    expect(done.ok).toBe(false);
    expect(done.reason).toBe("That cable is longer than 3.");
    expect(done.state).toEqual(before);
  });

  it("a dark cell stays refused with the state deep-equal", () => {
    const s = fresh();
    ownCells(s, [{ q: 0, r: -2 }]);
    place(s, "flywheel", { q: 0, r: -2 });
    const before = cloneState(s);
    const done = apply(s, { type: "patchCable", cable: "patch", source: { q: 0, r: -2 }, target: { q: 0, r: -3 } });
    expect(done.ok).toBe(false);
    expect(done.reason).toBe("That cell is dark.");
    expect(done.state).toEqual(before);
  });

  it("a Patch can be re-aimed from an open cell to a wall", () => {
    const s = fresh();
    place(s, "flywheel", O);
    must(s, { type: "patchCable", cable: "patch", source: O, target: { q: 1, r: 0 } });
    must(s, { type: "repatchCable", source: O, target: SHALE });
    expect(wallRate(s, SHALE)!.damage.toNumber()).toBe(1);
  });
});

describe("a cable into a wall in the save", () => {
  it("round-trips, and the wall's rate is recomputed on load", () => {
    const s = fresh();
    s.records.classCredit.producer = 4 * HOUR;
    place(s, "flywheel", O);
    must(s, { type: "patchCable", cable: "patch", source: O, target: SHALE });
    s.game.rates.walls = [];
    const loaded = deserialize(serialize(s, 1_000)).state;
    if (!loaded) throw new Error("load failed");
    expect(loaded.game.board.cables).toEqual([{ type: "patch", source: O, target: SHALE }]);
    const shale = wallRate(loaded, SHALE)!;
    expect(shale.damage.toNumber()).toBeCloseTo(1.4, 12);
    expect(shale.net.toNumber()).toBeCloseTo(1.3, 12);
  });
});

// The spec's acceptance (chunk 05): no wall's HP changes in upgrade mode.
// Two walls fought for 100 s, then the session ended; every upgrade-mode
// action, each from that state, leaves `board.walls` as it was.
describe("no upgrade-mode apply changes a wall's HP", () => {
  function damaged(): GameState {
    const s = fresh();
    giveProducer(s, { modulators: 2, cables: 2 });
    place(s, "flywheel", O);
    place(s, "flywheel", { q: 1, r: 0 });
    must(s, { type: "patchCable", cable: "patch", source: O, target: SHALE });
    must(s, { type: "patchCable", cable: "patch", source: { q: 1, r: 0 }, target: BASALT });
    giveHabit(s, "Piano", "engineer");
    must(s, { type: "startSession", habitId: s.records.activeHabitId!, target: 1500, now: 0 });
    advanceIn(s, 100, "flow");
    must(s, { type: "endSession", now: 100_000 });
    return s;
  }

  it("moves no wall for a layout, cable, habit, note, Intention, summary or Encyclopedia action", () => {
    const start = damaged();
    expect(start.game.mode).toBe("upgrade");
    expect(start.game.board.walls).toHaveLength(2);
    expect(start.game.encyclopedia.revealed.length).toBeGreaterThan(0);
    const walls = cloneState(start).game.board.walls;
    const habitId = start.records.activeHabitId!;
    const NOW = 200_000;
    const actions: Action[] = [
      { type: "placeModule", module: "sine", cell: NE },
      { type: "moveModule", from: O, to: NE },
      { type: "rotateModule", cell: { q: 1, r: 0 }, turn: "clockwise" },
      { type: "removeModule", cell: O },
      { type: "unplugCable", source: O },
      { type: "repatchCable", source: O, target: { q: 0, r: 1 } },
      { type: "createHabit", name: "Cello", habitClass: "producer" },
      { type: "renameHabit", id: habitId, name: "Organ" },
      { type: "recolorHabit", id: habitId, color: "cyan" },
      { type: "selectHabit", id: null },
      { type: "reattuneHabit", habitId, habitClass: "producer" },
      { type: "logPractice", habitId, minutes: 30, now: NOW },
      { type: "reflect", text: "Steady.", slider: 4 },
      { type: "dismissSummary" },
      { type: "writeNote", text: "A note.", now: NOW },
      { type: "createIntention", habitId, minutes: 30, schedule: "daily", now: NOW },
      { type: "rollIntentions", now: NOW },
      { type: "readEntry", id: start.game.encyclopedia.revealed[0]! },
      { type: "archiveHabit", id: habitId },
    ];
    for (const action of actions) {
      const s = cloneState(start);
      const done = apply(s, action);
      expect(done.ok, `${action.type}: ${done.reason}`).toBe(true);
      expect(done.state.game.board.walls, action.type).toEqual(walls);
    }
  });
});
