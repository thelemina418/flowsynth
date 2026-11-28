import { describe, expect, it } from "vitest";
import { apply, type Action } from "./apply";
import { begin, applyIn, fresh, giveHabit } from "./fixtures";
import { grantsOf } from "./levels";
import { cloneState } from "./state";
import type { GameState } from "./types";

// Placing and aiming the Flywheel (spec chunk 03, issue #31), through the
// GameState seam: `apply` is the one placement and rotation path.

const O = { q: 0, r: 0 };
const E = { q: 1, r: 0 };
const SE = { q: 0, r: 1 };
const NE = { q: 1, r: -1 };
const SHALE = { q: -1, r: 1 };

function placed(s: GameState) {
  return s.game.board.placements.map((p) => `${p.module}@${p.cell.q},${p.cell.r}`).sort();
}

function facingAt(s: GameState, cell: { q: number; r: number }) {
  return s.game.board.placements.find((p) => p.cell.q === cell.q && p.cell.r === cell.r)?.facing;
}

function expectRefused(s: GameState, action: Action) {
  const before = cloneState(s);
  const result = apply(s, action);
  expect(result.ok).toBe(false);
  expect(result.reason).toMatch(/\w/);
  expect(result.state).toBe(s);
  expect(s).toEqual(before);
}

describe("the Flywheel's allowance", () => {
  it("a fresh start has the Flywheel and one Modulator allowance beside the oscillators'", () => {
    const s = fresh();
    expect(grantsOf(s).allowance).toEqual({ oscillator: 2, modulator: 1, arm: 0 });
    expect(grantsOf(s).arrived).toEqual(["sine", "triangle", "flywheel"]);
  });

  it("allows one Flywheel and refuses a second, independently of the oscillator allowance", () => {
    const s = fresh();
    expect(applyIn(s, { type: "placeModule", module: "flywheel", cell: O }).ok).toBe(true);
    expectRefused(s, { type: "placeModule", module: "flywheel", cell: E });
    expect(apply(s, { type: "placeModule", module: "flywheel", cell: E }).reason).toBe("Modulator allowance is full.");
    expect(applyIn(s, { type: "placeModule", module: "sine", cell: E }).ok).toBe(true);
    expect(applyIn(s, { type: "placeModule", module: "triangle", cell: SE }).ok).toBe(true);
    expect(placed(s)).toEqual(["flywheel@0,0", "sine@1,0", "triangle@0,1"]);
  });
});

describe("placing, moving, swapping and removing the Flywheel", () => {
  it("works through the existing placement actions", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "flywheel", cell: O });
    applyIn(s, { type: "placeModule", module: "sine", cell: E });
    expect(applyIn(s, { type: "moveModule", from: O, to: NE }).ok).toBe(true);
    expect(placed(s)).toEqual(["flywheel@1,-1", "sine@1,0"]);
    expect(applyIn(s, { type: "moveModule", from: NE, to: E }).ok).toBe(true);
    expect(placed(s)).toEqual(["flywheel@1,0", "sine@1,-1"]);
    expect(applyIn(s, { type: "removeModule", cell: E }).ok).toBe(true);
    expect(placed(s)).toEqual(["sine@1,-1"]);
  });

  it("refuses a wall, an occupied cell and an empty move, leaving the state deep-equal", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    expectRefused(s, { type: "placeModule", module: "flywheel", cell: SHALE });
    expectRefused(s, { type: "placeModule", module: "flywheel", cell: O });
    applyIn(s, { type: "placeModule", module: "flywheel", cell: E });
    expectRefused(s, { type: "moveModule", from: E, to: SHALE });
    expectRefused(s, { type: "moveModule", from: E, to: E });
    expectRefused(s, { type: "removeModule", cell: SE });
  });
});

describe("facing", () => {
  it("a new Flywheel faces NE, and a move or swap keeps its facing", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "flywheel", cell: O });
    expect(facingAt(s, O)).toBe(0);
    applyIn(s, { type: "rotateModule", cell: O, turn: "clockwise" });
    applyIn(s, { type: "moveModule", from: O, to: E });
    expect(facingAt(s, E)).toBe(1);
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    applyIn(s, { type: "moveModule", from: E, to: O });
    expect(facingAt(s, O)).toBe(1);
    expect(facingAt(s, E)).toBeUndefined();
  });

  it("an oscillator carries no facing", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    expect(s.game.board.placements[0]).toEqual({ cell: O, module: "sine" });
  });

  it("turns clockwise and counter-clockwise through all six facings", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "flywheel", cell: O });
    const clockwise: number[] = [];
    for (let i = 0; i < 6; i++) {
      expect(applyIn(s, { type: "rotateModule", cell: O, turn: "clockwise" }).ok).toBe(true);
      clockwise.push(facingAt(s, O)!);
    }
    expect(clockwise).toEqual([1, 2, 3, 4, 5, 0]);
    const counter: number[] = [];
    for (let i = 0; i < 6; i++) {
      applyIn(s, { type: "rotateModule", cell: O, turn: "counterclockwise" });
      counter.push(facingAt(s, O)!);
    }
    expect(counter).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it("refuses rotation on an empty cell, a wall and an oscillator, leaving the state deep-equal", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    expectRefused(s, { type: "rotateModule", cell: E, turn: "clockwise" });
    expectRefused(s, { type: "rotateModule", cell: SHALE, turn: "clockwise" });
    expectRefused(s, { type: "rotateModule", cell: O, turn: "clockwise" });
    expect(apply(s, { type: "rotateModule", cell: O, turn: "clockwise" }).reason).toBe("Sine has no facing.");
  });

  it("refuses rotation in flow and paused", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "flywheel", cell: O });
    giveHabit(s, "Piano", "producer");
    begin(s, null, 1_000);
    expectRefused(s, { type: "rotateModule", cell: O, turn: "clockwise" });
    applyIn(s, { type: "pauseSession" });
    expect(s.game.mode).toBe("paused");
    expectRefused(s, { type: "rotateModule", cell: O, turn: "counterclockwise" });
  });
});
