import { describe, expect, it } from "vitest";
import { applyIn, fresh, giveOscillators, ownCells } from "./fixtures";
import { cellsWithin, mirror, neighbours, rotate, type Hex } from "./hex";
import type { GameState, ModuleType, OscillatorRate } from "./types";

// Resonance and rates (spec chunk 02, issue #26), through the GameState
// seam: layouts are built with `apply`, and the BoardRates on the resulting
// state are what a player (and the Hex detail, and the pace runner) read.

function rateAt(s: GameState, cell: Hex): OscillatorRate {
  const rate = s.game.rates.oscillators.find((o) => o.cell.q === cell.q && o.cell.r === cell.r);
  if (!rate) throw new Error(`no oscillator rate at ${cell.q},${cell.r}`);
  return rate;
}

const O: Hex = { q: 0, r: 0 };
const at = (h: Hex) => `${h.q},${h.r}`;
const partnersOf = (rate: OscillatorRate) => rate.instances.map((i) => i.partners.map((p) => at(p.cell)).sort().join(" ")).sort();

// Every layout but the acceptance one owns the whole Sketch board (radius
// 2), standing in for chunk 05's conquest.
function build(layout: [ModuleType, Hex][], own = cellsWithin(2)): GameState {
  const s = fresh();
  ownCells(s, own);
  giveOscillators(s, { allowance: layout.length, arrive: layout.map(([module]) => module) });
  for (const [module, cell] of layout) {
    const made = applyIn(s, { type: "placeModule", module, cell });
    if (!made.ok) throw new Error(`fixture placement failed: ${made.reason}`);
  }
  return s;
}

describe("the acceptance layout", () => {
  it("Sine (0,0), Triangle (1,0), Triangle (0,1): both Triangles resonate ×1.75, the Sine does not", () => {
    const s = build([["sine", { q: 0, r: 0 }], ["triangle", { q: 1, r: 0 }], ["triangle", { q: 0, r: 1 }]], []);
    for (const cell of [{ q: 1, r: 0 }, { q: 0, r: 1 }]) {
      const triangle = rateAt(s, cell);
      expect(triangle.instances).toHaveLength(1);
      expect(triangle.resonance.toNumber()).toBe(1.75);
      expect(triangle.rate.toNumber()).toBe(1.75);
    }
    const sine = rateAt(s, { q: 0, r: 0 });
    expect(sine.instances).toHaveLength(0);
    expect(sine.resonance.toNumber()).toBe(1);
    expect(sine.rate.toNumber()).toBe(1);
    expect(s.game.rates.total.toNumber()).toBe(4.5);
  });

  it("shares the Sine as a partner of both Triangles' resonances", () => {
    const s = build([["sine", O], ["triangle", { q: 1, r: 0 }], ["triangle", { q: 0, r: 1 }]], []);
    expect(partnersOf(rateAt(s, { q: 1, r: 0 }))).toEqual(["0,0 0,1"]);
    expect(partnersOf(rateAt(s, { q: 0, r: 1 }))).toEqual(["0,0 1,0"]);
  });
});

describe("a pattern in every orientation", () => {
  // The acceptance Triangle's partners, relative to it, and a Saw's line:
  // each turned through hex.ts's own rotation and mirror.
  const shapes: { name: string; module: ModuleType; partners: Hex[]; factor: number }[] = [
    { name: "Triangle", module: "triangle", partners: [{ q: -1, r: 0 }, { q: -1, r: 1 }], factor: 1.75 },
    { name: "Saw", module: "saw", partners: [{ q: 1, r: -1 }, { q: 2, r: -2 }], factor: 3 },
  ];
  for (const shape of shapes) {
    for (const mirrored of [false, true]) {
      for (let k = 0; k < 6; k++) {
        it(`${shape.name}, turned ${k * 60}°${mirrored ? " and mirrored" : ""}, resonates ×${shape.factor}`, () => {
          const cells = shape.partners.map((p) => rotate(mirrored ? mirror(p) : p, k));
          const s = build([[shape.module, O], ...cells.map((c): [ModuleType, Hex] => ["sine", c])]);
          const rate = rateAt(s, O);
          expect(partnersOf(rate)).toEqual([cells.map(at).sort().join(" ")]);
          expect(rate.resonance.toNumber()).toBe(shape.factor);
        });
      }
    }
  }
});

const ring1 = (indices: number[]): Hex[] => indices.map((i) => neighbours(O)[i]!);
const around = (module: ModuleType, indices: number[]): [ModuleType, Hex][] => ring1(indices).map((c) => [module, c]);

describe("halving returns", () => {
  // Sine R 1.0: 1 + 1, then + 0.5, then + 0.25.
  it.each([
    [[0, 3], 1, 2],
    [[0, 3, 1, 4], 2, 2.5],
    [[0, 3, 1, 4, 2, 5], 3, 2.75],
  ])("Triangles on sides %j of a Sine: %i instances, ×%d", (sides, count, factor) => {
    const s = build([["sine", O], ...around("triangle", sides)]);
    const sine = rateAt(s, O);
    expect(sine.instances).toHaveLength(count);
    expect(sine.resonance.toNumber()).toBe(factor);
    expect(sine.rate.toNumber()).toBe(factor);
  });

  it("a Sine ringed by Triangles has 3 instances, one per opposite pair, not 6", () => {
    const s = build([["sine", O], ...around("triangle", [0, 1, 2, 3, 4, 5])]);
    expect(partnersOf(rateAt(s, O))).toEqual(["-1,0 1,0", "-1,1 1,-1", "0,-1 0,1"]);
  });

  it("a Sine whose opposite pair holds a Triangle and a Square does not resonate", () => {
    const s = build([["sine", O], ...around("triangle", [0]), ...around("square", [3])]);
    expect(rateAt(s, O).instances).toHaveLength(0);
  });
});

describe("Square: 4 or more of its 6 sides, by any modules", () => {
  it("does not resonate with 3 sides occupied", () => {
    const s = build([["square", O], ...around("sine", [0, 2, 4])]);
    expect(rateAt(s, O).instances).toHaveLength(0);
    expect(rateAt(s, O).rate.toNumber()).toBe(1.5);
  });

  it("resonates once with 4 sides occupied: ×2.5, 3.75 ν/s", () => {
    const s = build([["square", O], ...around("sine", [0, 2, 4, 5])]);
    expect(partnersOf(rateAt(s, O))).toEqual([ring1([0, 2, 4, 5]).map(at).sort().join(" ")]);
    expect(rateAt(s, O).resonance.toNumber()).toBe(2.5);
    expect(rateAt(s, O).rate.toNumber()).toBe(3.75);
  });

  it("still gives one instance with all 6 sides occupied", () => {
    const s = build([["square", O], ...around("triangle", [0, 1, 2, 3, 4, 5])]);
    expect(rateAt(s, O).instances).toHaveLength(1);
    expect(rateAt(s, O).instances[0]!.partners).toHaveLength(6);
  });
});

describe("Saw: the end of a straight line of three oscillators", () => {
  it("resonates at the line's end: ×3, 6 ν/s", () => {
    const s = build([["saw", O], ["sine", { q: 1, r: 0 }], ["triangle", { q: 2, r: 0 }]]);
    expect(rateAt(s, O).instances).toHaveLength(1);
    expect(rateAt(s, O).rate.toNumber()).toBe(6);
  });

  it("does not resonate in the line's middle", () => {
    const s = build([["sine", { q: -1, r: 0 }], ["saw", O], ["triangle", { q: 1, r: 0 }]]);
    expect(rateAt(s, O).instances).toHaveLength(0);
    expect(rateAt(s, O).rate.toNumber()).toBe(2);
  });

  it("does not resonate when the line bends", () => {
    const s = build([["saw", O], ["sine", { q: 1, r: 0 }], ["triangle", { q: 1, r: 1 }]]);
    expect(rateAt(s, O).instances).toHaveLength(0);
  });
});

describe("Release", () => {
  it("never resonates and makes 0, even ringed by oscillators", () => {
    const s = build([["release", O], ...around("triangle", [0, 1, 2, 3, 4, 5])]);
    expect(rateAt(s, O).instances).toHaveLength(0);
    expect(rateAt(s, O).rate.toNumber()).toBe(0);
  });

  it("is an oscillator, so it can stand as another's partner", () => {
    const s = build([["triangle", O], ...around("release", [0, 1])]);
    expect(rateAt(s, O).instances).toHaveLength(1);
  });
});

describe("walls and empty cells are never partners", () => {
  it("a Triangle and a Sine on the opening, sharing an empty open cell and a wall, do not resonate", () => {
    // (0,0) and (1,-1) share (1,0), open and empty, and (0,-1), a wall.
    const s = build([["triangle", O], ["sine", { q: 1, r: -1 }]], []);
    expect(rateAt(s, O).instances).toHaveLength(0);
    expect(s.game.rates.total.toNumber()).toBe(2);
  });

  it("a Square on the opening, with walls on most sides, does not resonate", () => {
    const s = build([["square", O], ["sine", { q: 1, r: 0 }], ["triangle", { q: 0, r: 1 }], ["sine", { q: 1, r: -1 }]], []);
    expect(rateAt(s, O).instances).toHaveLength(0);
  });
});
