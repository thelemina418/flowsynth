import { describe, expect, it } from "vitest";
import { apply } from "../../engine/apply";
import { giveOscillators } from "../../engine/fixtures";
import type { Hex } from "../../engine/hex";
import { createInitialState } from "../../engine/state";
import type { GameState, ModuleType } from "../../engine/types";
import { hexDetail } from "./hexReadout";

// The Hex detail's readout (issue #27): a pure function of the board and
// its BoardRates, so the numbers are whatever the cached rates say. At
// most five lines in `name · number · effect` form, one of them the
// effect line; only legs that exist are shown.

function laid(placements: [ModuleType, number, number][], allowance = 3): GameState {
  let s = createInitialState();
  giveOscillators(s, { allowance, arrive: ["sine", "triangle", "square", "saw", "release"] });
  for (const [module, q, r] of placements) {
    const result = apply(s, { type: "placeModule", module, cell: { q, r } });
    expect(result.ok, `${module} at ${q},${r}`).toBe(true);
    s = result.state;
  }
  return s;
}

const ACCEPTANCE: [ModuleType, number, number][] = [
  ["sine", 0, 0],
  ["triangle", 1, 0],
  ["triangle", 0, 1],
];

const read = (s: GameState, cell: Hex) => hexDetail(s.game.board, s.game.rates, cell);
const texts = (s: GameState, cell: Hex) => read(s, cell).map((line) => line.text);

describe("the Hex detail readout", () => {
  it("reads the acceptance layout's Triangle at ×1.75 resonance and 1.75 ν/s", () => {
    expect(texts(laid(ACCEPTANCE), { q: 1, r: 0 })).toEqual([
      "Triangle · Oscillator",
      "Resonating ×1 · closes Sine–Triangle",
      "1.0 ν/s base · ×1.75 resonance",
      "1.75 ν/s",
    ]);
  });

  it("reads a non-resonating Sine with what it needs and its base rate alone", () => {
    expect(texts(laid(ACCEPTANCE), { q: 0, r: 0 })).toEqual(["Sine · Oscillator", "Not resonating · needs Triangles on opposite sides", "1.0 ν/s"]);
  });

  it("reads walls, an empty open cell and a dark cell in one terse line each", () => {
    const s = laid([]);
    expect(texts(s, { q: -1, r: 1 })).toEqual(["Shale · Wall"]);
    expect(texts(s, { q: 2, r: -1 })).toEqual(["Flint · Wall · opens Roadie"]);
    expect(texts(s, { q: -1, r: 0 })).toEqual(["Wall"]);
    expect(texts(s, { q: 1, r: -1 })).toEqual(["Open cell"]);
    expect(texts(s, { q: 3, r: 0 })).toEqual(["Dark cell · beyond this arc"]);
  });

  it("reads a Release as making nothing in flow", () => {
    expect(texts(laid([["release", 0, 0]]), { q: 0, r: 0 })).toEqual(["Release · Oscillator", "No resonance pattern", "0.0 ν/s"]);
  });

  it("keeps every cell kind to five lines with at most one effect line, and no charge leg", () => {
    const s = laid(ACCEPTANCE);
    const cells: Hex[] = [
      { q: 1, r: 0 },
      { q: 0, r: 0 },
      { q: -1, r: 1 },
      { q: 2, r: -1 },
      { q: -1, r: 0 },
      { q: 1, r: -1 },
      { q: 3, r: 0 },
    ];
    for (const cell of cells) {
      const lines = read(s, cell);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(5);
      expect(lines.filter((l) => l.effect).length).toBeLessThanOrEqual(1);
      expect(lines.map((l) => l.text).join("\n")).not.toMatch(/charge|fader|pressure/i);
    }
  });
});
