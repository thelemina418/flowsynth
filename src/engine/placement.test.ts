import { describe, expect, it } from "vitest";
import { apply, type Action } from "./apply";
import { applyIn, fresh, giveHabit, giveOscillators } from "./fixtures";
import { lifetimeCells } from "./hex";
import { placementRefusal, trayRefusal, type PlacementAction } from "./placement";
import { cloneState } from "./state";
import type { GameState } from "./types";

// Placing, moving and removing oscillators (spec chunk 02, issue #25),
// through the GameState seam: `apply` is the one placement path.

const O = { q: 0, r: 0 };
const E = { q: 1, r: 0 };
const SE = { q: 0, r: 1 };
const NE = { q: 1, r: -1 };
const SHALE = { q: -1, r: 1 };
const DARK = { q: 3, r: 0 };

function placed(s: GameState) {
  return s.game.board.placements.map((p) => `${p.module}@${p.cell.q},${p.cell.r}`).sort();
}

// A refusal hands back the state given, deep-equal, with a reason.
function expectRefused(s: GameState, action: Action) {
  const before = cloneState(s);
  const result = apply(s, action);
  expect(result.ok).toBe(false);
  expect(result.reason).toMatch(/\w/);
  expect(result.state).toBe(s);
  expect(s).toEqual(before);
}

function inFlow(s: GameState) {
  giveHabit(s, "Piano", "engineer");
  applyIn(s, { type: "startSession", target: null, now: 1_000 });
}

describe("a fresh start", () => {
  it("allows two oscillators of the types it has, Sine and Triangle", () => {
    const s = fresh();
    expect(s.game.allowance.oscillator).toBe(2);
    expect(s.game.arrived.filter((m) => m !== "flywheel")).toEqual(["sine", "triangle"]);
    expect(s.game.board.placements).toEqual([]);
  });

  it("places two oscillators and refuses a third", () => {
    const s = fresh();
    expect(applyIn(s, { type: "placeModule", module: "sine", cell: O }).ok).toBe(true);
    expect(applyIn(s, { type: "placeModule", module: "triangle", cell: E }).ok).toBe(true);
    expectRefused(s, { type: "placeModule", module: "triangle", cell: SE });
    expect(placed(s)).toEqual(["sine@0,0", "triangle@1,0"]);
  });
});

describe("placing in upgrade mode", () => {
  it("puts an arrived type onto an empty open cell", () => {
    const s = fresh();
    const result = applyIn(s, { type: "placeModule", module: "sine", cell: O });
    expect(result.ok).toBe(true);
    expect(s.game.board.placements).toEqual([{ cell: O, module: "sine" }]);
  });

  it("refuses a wall, a dark cell and an occupied cell", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    expectRefused(s, { type: "placeModule", module: "triangle", cell: SHALE });
    expectRefused(s, { type: "placeModule", module: "triangle", cell: DARK });
    expectRefused(s, { type: "placeModule", module: "triangle", cell: O });
  });

  it("refuses a type the player doesn't have", () => {
    const s = fresh();
    expectRefused(s, { type: "placeModule", module: "square", cell: O });
  });

  it("places any arrived type once it has arrived", () => {
    const s = fresh();
    giveOscillators(s, { arrive: ["square"] });
    expect(applyIn(s, { type: "placeModule", module: "square", cell: O }).ok).toBe(true);
  });
});

describe("moving in upgrade mode", () => {
  it("moves a placed module to an empty open cell", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    expect(applyIn(s, { type: "moveModule", from: O, to: NE }).ok).toBe(true);
    expect(placed(s)).toEqual(["sine@1,-1"]);
  });

  it("swaps two modules when moved onto an occupied open cell", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    applyIn(s, { type: "placeModule", module: "triangle", cell: E });
    expect(applyIn(s, { type: "moveModule", from: O, to: E }).ok).toBe(true);
    expect(placed(s)).toEqual(["sine@1,0", "triangle@0,0"]);
  });

  it("refuses a wall, a dark cell, an empty origin and its own cell", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    expectRefused(s, { type: "moveModule", from: O, to: SHALE });
    expectRefused(s, { type: "moveModule", from: O, to: DARK });
    expectRefused(s, { type: "moveModule", from: E, to: NE });
    expectRefused(s, { type: "moveModule", from: O, to: O });
  });
});

describe("removing in upgrade mode", () => {
  it("returns a placed module to unplaced, freeing its allowance", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    applyIn(s, { type: "placeModule", module: "triangle", cell: E });
    expect(applyIn(s, { type: "removeModule", cell: O }).ok).toBe(true);
    expect(placed(s)).toEqual(["triangle@1,0"]);
    expect(applyIn(s, { type: "placeModule", module: "triangle", cell: SE }).ok).toBe(true);
  });

  it("refuses a cell with no module", () => {
    const s = fresh();
    expectRefused(s, { type: "removeModule", cell: O });
    expectRefused(s, { type: "removeModule", cell: SHALE });
  });
});

describe("the layout is locked outside upgrade mode (ADR-0001)", () => {
  function laidOut() {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    return s;
  }
  const actions: Action[] = [
    { type: "placeModule", module: "triangle", cell: E },
    { type: "moveModule", from: O, to: NE },
    { type: "removeModule", cell: O },
  ];

  it("refuses every placement action in flow", () => {
    const s = laidOut();
    inFlow(s);
    expect(s.game.mode).toBe("flow");
    for (const action of actions) expectRefused(s, action);
  });

  it("refuses every placement action while paused", () => {
    const s = laidOut();
    inFlow(s);
    applyIn(s, { type: "pauseSession" });
    expect(s.game.mode).toBe("paused");
    for (const action of actions) expectRefused(s, action);
  });
});

// The board's targets (issue #25) read the placement rules without
// running `apply`, so the rules alone must say what `apply` would do.
describe("the placement rules, read without applying", () => {
  function everyAction(): PlacementAction[] {
    const actions: PlacementAction[] = [];
    for (const cell of lifetimeCells()) {
      for (const module of ["sine", "triangle", "square"] as const) actions.push({ type: "placeModule", module, cell });
      for (const from of [O, E, NE]) actions.push({ type: "moveModule", from, to: cell });
      actions.push({ type: "removeModule", cell });
    }
    return actions;
  }

  function expectAgreement(s: GameState) {
    for (const action of everyAction()) {
      const result = apply(s, action);
      expect(placementRefusal(s, action), JSON.stringify(action)).toBe(result.ok ? null : result.reason);
    }
  }

  it("refuse exactly what apply refuses, with its reason, in upgrade mode", () => {
    const s = fresh();
    expectAgreement(s);
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    expectAgreement(s);
    applyIn(s, { type: "placeModule", module: "triangle", cell: E });
    expectAgreement(s);
  });

  it("refuse every action in flow", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    inFlow(s);
    expectAgreement(s);
  });

  it("say when the tray can give a type: arrived, with allowance left, in upgrade mode", () => {
    const s = fresh();
    expect(trayRefusal(s, "sine")).toBeNull();
    expect(trayRefusal(s, "square")).toMatch(/hasn't arrived/);
    applyIn(s, { type: "placeModule", module: "sine", cell: O });
    applyIn(s, { type: "placeModule", module: "sine", cell: E });
    expect(trayRefusal(s, "triangle")).toBe("Oscillator allowance is full.");
    const flowing = fresh();
    inFlow(flowing);
    expect(trayRefusal(flowing, "sine")).toBe("The board is locked while a session runs.");
  });
});
