import { describe, expect, it } from "vitest";
import { apply, type Action } from "./apply";
import { begin, applyIn, fresh, giveProducer, ownCells } from "./fixtures";
import { cellsWithin, type Cell } from "./hex";
import { cloneState } from "./state";
import type { GameState, ModuleType } from "./types";

// Patch cables (spec chunk 03, issue #33), through the GameState seam: a
// Patch carries a modulator's whole output to one target cell in place of
// its reach. patchCable, repatchCable and unplugCable share one refusal.

const O = { q: 0, r: 0 };
const NE = { q: 1, r: -1 };
const SE = { q: 1, r: 0 };
const S = { q: 0, r: 1 };

function place(s: GameState, module: ModuleType, cell: Cell): void {
  const done = applyIn(s, { type: "placeModule", module, cell });
  if (!done.ok) throw new Error(`fixture ${module} failed: ${done.reason}`);
}

function patch(s: GameState, source: Cell, target: Cell) {
  return applyIn(s, { type: "patchCable", cable: "patch", source, target });
}

function oscillatorAt(s: GameState, cell: Cell) {
  return s.game.rates.oscillators.find((o) => o.cell.q === cell.q && o.cell.r === cell.r)!;
}

// A Flywheel at the centre facing NE, with a Triangle in its reach (NE)
// and one outside it (S).
function twoTriangles(): GameState {
  const s = fresh();
  place(s, "flywheel", O);
  place(s, "triangle", NE);
  place(s, "triangle", S);
  return s;
}

describe("a Patch carries the whole output to its target, in place of the reach", () => {
  it("a Patch to a Triangle outside the reach charges only that Triangle, and the reach Triangle's factor returns to 1", () => {
    const s = twoTriangles();
    expect(oscillatorAt(s, NE).chargeReceived.toNumber()).toBe(1);
    expect(patch(s, O, S).ok).toBe(true);
    expect(s.game.board.cables).toEqual([{ type: "patch", source: O, target: S }]);
    expect(oscillatorAt(s, S).chargeReceived.toNumber()).toBe(1);
    expect(oscillatorAt(s, S).charge.toNumber()).toBeCloseTo(1 + Math.log(2), 12);
    expect(oscillatorAt(s, NE).chargeReceived.toNumber()).toBe(0);
    expect(oscillatorAt(s, NE).charge.toNumber()).toBe(1);
    expect(s.game.rates.modulators[0]!.deliveries).toEqual([{ cell: S, holds: "triangle" }]);
  });

  it("a Patch to the Triangle already in its reach delivers to it once", () => {
    const s = twoTriangles();
    expect(patch(s, O, NE).ok).toBe(true);
    expect(oscillatorAt(s, NE).chargeReceived.toNumber()).toBe(1);
    expect(oscillatorAt(s, S).chargeReceived.toNumber()).toBe(0);
  });

  it("an empty open cell is a target, and charges nothing", () => {
    const s = fresh();
    place(s, "flywheel", O);
    place(s, "triangle", NE);
    expect(patch(s, O, SE).ok).toBe(true);
    expect(s.game.rates.modulators[0]!.deliveries).toEqual([{ cell: SE, holds: "empty" }]);
    expect(oscillatorAt(s, NE).chargeReceived.toNumber()).toBe(0);
  });
});

// Every cell within ring 2 owned, Producer credit for a modulator
// allowance and cable allowance of at least `n`, and a Flywheel on each of
// `sources`.
function patchboard(sources: Cell[], n = 3): GameState {
  const s = fresh();
  ownCells(s, cellsWithin(2));
  giveProducer(s, { modulators: n, cables: n });
  for (const source of sources) place(s, "flywheel", source);
  return s;
}

function refusal(s: GameState, action: Action): string | undefined {
  const done = apply(s, action);
  expect(done.ok).toBe(false);
  expect(done.state).toBe(s);
  return done.reason;
}

describe("the one refusal", () => {
  it("refuses all three outside upgrade mode, in flow and paused", () => {
    const s = patchboard([O]);
    patch(s, O, SE);
    begin(s, null, 0);
    for (const mode of ["flow", "paused"]) {
      if (mode === "paused") applyIn(s, { type: "pauseSession" });
      expect(s.game.mode).toBe(mode);
      expect(refusal(s, { type: "patchCable", cable: "patch", source: O, target: S })).toBe("The board is locked while a session runs.");
      expect(refusal(s, { type: "repatchCable", source: O, target: S })).toBe("The board is locked while a session runs.");
      expect(refusal(s, { type: "unplugCable", source: O })).toBe("The board is locked while a session runs.");
    }
  });

  it("refuses a target beyond length 3, a dark cell and the source's own cell", () => {
    const from = { q: -2, r: 0 };
    const s = patchboard([from]);
    s.game.board.arc = "demo";
    ownCells(s, [{ q: 2, r: 0 }]);
    expect(refusal(s, { type: "patchCable", cable: "patch", source: from, target: { q: 2, r: 0 } })).toBe("That cable is longer than 3.");
    s.game.board.arc = "sketch";
    expect(refusal(s, { type: "patchCable", cable: "patch", source: from, target: { q: -3, r: 0 } })).toBe("That cell is dark.");
    expect(refusal(s, { type: "patchCable", cable: "patch", source: from, target: from })).toBe("A cable can't end where it starts.");
    expect(patch(s, from, { q: 1, r: 0 }).ok).toBe(true);
    expect(refusal(s, { type: "repatchCable", source: from, target: from })).toBe("A cable can't end where it starts.");
    expect(refusal(s, { type: "repatchCable", source: from, target: { q: -3, r: 0 } })).toBe("That cell is dark.");
    expect(refusal(s, { type: "repatchCable", source: from, target: { q: 2, r: -1 } })).toBe("That cable is longer than 3.");
  });

  it("refuses a source that isn't a modulator, or already carries a Patch", () => {
    const s = patchboard([O]);
    place(s, "sine", SE);
    expect(refusal(s, { type: "patchCable", cable: "patch", source: SE, target: S })).toBe("Only a modulator has a jack.");
    expect(refusal(s, { type: "patchCable", cable: "patch", source: NE, target: S })).toBe("Only a modulator has a jack.");
    expect(patch(s, O, S).ok).toBe(true);
    expect(refusal(s, { type: "patchCable", cable: "patch", source: O, target: SE })).toBe("That modulator is already patched.");
  });

  it("refuses a cable beyond the allowance", () => {
    // Producer Lv 1: 2 modulators, 1 cable.
    const s = fresh();
    ownCells(s, cellsWithin(2));
    giveProducer(s, { modulators: 2 });
    for (const source of [O, { q: -1, r: 0 }]) place(s, "flywheel", source);
    expect(patch(s, O, SE).ok).toBe(true);
    expect(refusal(s, { type: "patchCable", cable: "patch", source: { q: -1, r: 0 }, target: { q: -1, r: 1 } })).toBe("Cable allowance is full.");
  });

  it("refuses repatching or unplugging a jack with no cable", () => {
    const s = patchboard([O]);
    expect(refusal(s, { type: "repatchCable", source: O, target: S })).toBe("No cable runs from that cell.");
    expect(refusal(s, { type: "unplugCable", source: O })).toBe("No cable runs from that cell.");
  });
});

describe("no crossing", () => {
  const W = { q: -1, r: 0 };
  const cases: [string, [Cell, Cell], [Cell, Cell]][] = [
    ["a proper X", [W, SE], [NE, { q: -1, r: 1 }]],
    ["collinear overlap", [W, SE], [O, { q: 2, r: 0 }]],
    ["touching the other's endpoint mid-segment", [W, SE], [NE, O]],
  ];
  for (const [name, first, second] of cases) {
    it(`refuses ${name} with no side effects`, () => {
      const s = patchboard([first[0], second[0]]);
      expect(patch(s, first[0], first[1]).ok).toBe(true);
      const before = cloneState(s);
      const done = apply(s, { type: "patchCable", cable: "patch", source: second[0], target: second[1] });
      expect(done).toMatchObject({ ok: false, reason: "That cable would cross another." });
      expect(done.state).toBe(s);
      expect(s).toEqual(before);
      expect(s.game.board.cables).toHaveLength(1);
    });
  }

  it("counts a crossing for a re-aimed cable too, but never against itself", () => {
    const s = patchboard([W, NE]);
    expect(patch(s, W, SE).ok).toBe(true);
    expect(patch(s, NE, { q: 2, r: -1 }).ok).toBe(true);
    expect(refusal(s, { type: "repatchCable", source: NE, target: { q: -1, r: 1 } })).toBe("That cable would cross another.");
    expect(applyIn(s, { type: "repatchCable", source: W, target: O }).ok).toBe(true);
    expect(s.game.board.cables[0]!.target).toEqual(O);
  });

  it("lets two cables share a target, or meet end to end", () => {
    const s = patchboard([W, NE, { q: 2, r: 0 }]);
    expect(patch(s, W, O).ok).toBe(true);
    expect(patch(s, NE, O).ok).toBe(true);
    expect(patch(s, { q: 2, r: 0 }, SE).ok).toBe(true);
    expect(s.game.board.cables).toHaveLength(3);
  });

  it("lets two cables meet head-on at a shared target on one line", () => {
    const s = patchboard([W, SE]);
    expect(patch(s, W, O).ok).toBe(true);
    expect(patch(s, SE, O).ok).toBe(true);
  });
});

describe("repatch and unplug", () => {
  it("re-aims a placed cable and moves its charge with it", () => {
    const s = twoTriangles();
    patch(s, O, S);
    expect(applyIn(s, { type: "repatchCable", source: O, target: SE }).ok).toBe(true);
    expect(s.game.board.cables).toEqual([{ type: "patch", source: O, target: SE }]);
    expect(oscillatorAt(s, S).chargeReceived.toNumber()).toBe(0);
  });

  it("unplugs a cable back to the allowance, and the reach returns", () => {
    const s = twoTriangles();
    patch(s, O, S);
    expect(applyIn(s, { type: "unplugCable", source: O }).ok).toBe(true);
    expect(s.game.board.cables).toEqual([]);
    expect(oscillatorAt(s, NE).chargeReceived.toNumber()).toBe(1);
    expect(patch(s, O, SE).ok).toBe(true);
  });
});

describe("moving modules", () => {
  it("moving, swapping or removing a patched modulator unplugs its cable", () => {
    const moved = twoTriangles();
    patch(moved, O, S);
    expect(applyIn(moved, { type: "moveModule", from: O, to: SE }).ok).toBe(true);
    expect(moved.game.board.cables).toEqual([]);

    const swapped = twoTriangles();
    patch(swapped, O, S);
    expect(applyIn(swapped, { type: "moveModule", from: NE, to: O }).ok).toBe(true);
    expect(swapped.game.board.cables).toEqual([]);

    const removed = twoTriangles();
    patch(removed, O, S);
    expect(applyIn(removed, { type: "removeModule", cell: O }).ok).toBe(true);
    expect(removed.game.board.cables).toEqual([]);
  });

  it("moving the module on the target cell leaves the cable aimed at its cell", () => {
    const s = twoTriangles();
    patch(s, O, S);
    expect(applyIn(s, { type: "moveModule", from: S, to: SE }).ok).toBe(true);
    expect(s.game.board.cables).toEqual([{ type: "patch", source: O, target: S }]);
    expect(s.game.rates.modulators[0]!.deliveries).toEqual([{ cell: S, holds: "empty" }]);
  });
});
