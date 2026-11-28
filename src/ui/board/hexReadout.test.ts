import { describe, expect, it } from "vitest";
import { apply } from "../../engine/apply";
import { giveOscillators } from "../../engine/fixtures";
import { lifetimeCells, type Cell } from "../../engine/hex";
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

const T = "\u2009";
const read = (s: GameState, cell: Cell) => hexDetail(s.game.board, s.game.rates, cell);
const texts = (s: GameState, cell: Cell) => read(s, cell).map((line) => line.text);

describe("the Hex detail readout", () => {
  it("reads the acceptance layout's Triangle at ×1.75 resonance, under the opening's 34% pressure", () => {
    expect(texts(laid(ACCEPTANCE), { q: 1, r: 0 })).toEqual([
      "Triangle · Oscillator",
      "Resonating ×1 · closes Sine–Triangle",
      "1.0 ν/s base · ×1.75 resonance · −34% pressure",
      "1.15 ν/s",
    ]);
  });

  it("reads a non-resonating Sine with what it needs, its base and its pressure leg (issue #52)", () => {
    expect(texts(laid(ACCEPTANCE), { q: 0, r: 0 })).toEqual([
      "Sine · Oscillator",
      "Not resonating · needs Triangles on opposite sides",
      "1.0 ν/s base · −29% pressure",
      "0.71 ν/s",
    ]);
  });

  it("leaves the pressure leg out of an oscillator no wall presses on", () => {
    // (0,1)'s bordering walls owned, as a conquest leaves them, all but none.
    const s = createInitialState();
    for (const [q, r] of [[1, 1], [0, 2], [-1, 2], [-1, 1]]) s.game.board.open.push({ q, r });
    const placed = apply(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 1 } }).state;
    expect(texts(placed, { q: 0, r: 1 })).toEqual(["Sine · Oscillator", "Not resonating · needs Triangles on opposite sides", "1.0 ν/s"]);
  });

  it("reads a wall's pressure on the modules it reduces: Shale on 2, the doubled Basalt on 1 (issue #52)", () => {
    const s = laid(ACCEPTANCE);
    expect(texts(s, { q: -1, r: 1 })).toEqual(["Shale · Wall · ring 1", "600 / 600 HP · regen 0.1/s", "Pressure 5% on 2 modules"]);
    expect(texts(s, { q: -1, r: 0 })).toEqual(["Basalt · Wall · ring 1", `6${T}000 / 6${T}000 HP · regen 1.0/s`, "Pressure ×2", "Pressure 16% on 1 module"]);
    // A modulator beside a wall isn't reduced, so it isn't counted.
    const flywheel = laid([["flywheel", 0, 0]]);
    expect(texts(flywheel, { q: -1, r: 1 })).toContain("Pressure 5%");
  });

  it("reads an empty open cell and a dark cell in one terse line each, and a dark cell names no kind", () => {
    const s = laid([]);
    expect(texts(s, { q: 1, r: -1 })).toEqual(["Open cell"]);
    expect(texts(s, { q: 3, r: 0 })).toEqual(["Dark cell · beyond this arc"]);
    expect(texts(s, { q: 0, r: -3 })).toEqual(["Dark cell · beyond this arc"]);
  });

  it("reads a full-HP Shale's static lines (issue #48)", () => {
    expect(read(laid([]), { q: -1, r: 1 })).toEqual([
      { text: "Shale · Wall · ring 1" },
      { text: "600 / 600 HP · regen 0.1/s" },
      { text: "Pressure 5%" },
    ]);
  });

  it("names a wall's modifier, and counts a doubled pressure twice", () => {
    expect(texts(laid([]), { q: -1, r: 0 })).toEqual(["Basalt · Wall · ring 1", `6${T}000 / 6${T}000 HP · regen 1.0/s`, "Pressure ×2", "Pressure 16%"]);
    // The word itself is never copy, only the modifiers' names.
    for (const cell of lifetimeCells()) expect(texts(laid([]), cell).join("\n")).not.toMatch(/modifier/i);
  });

  it("names the class a marked wall opens", () => {
    expect(texts(laid([]), { q: 0, r: -2 })).toEqual(["Flint · Wall · ring 2 · opens Roadie", `60${T}000 / 60${T}000 HP · regen 10.0/s`, "Only Arm damage", "Pressure 10%"]);
    expect(texts(laid([]), { q: -2, r: 1 })).toEqual(["Schist · Wall · ring 2 · opens Mixer", "1e6 / 1e6 HP · regen 100.0/s", "Pressure 12%"]);
  });

  it("adds the damage a patched wall takes as its effect line", () => {
    const s = laid([["flywheel", 0, 0]]);
    const done = apply(s, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: -1, r: 1 } });
    expect(read(done.state, { q: -1, r: 1 })).toEqual([
      { text: "Shale · Wall · ring 1" },
      { text: "600 / 600 HP · regen 0.1/s" },
      { text: "Pressure 5%" },
      { text: "Taking 1.0/s", effect: true },
    ]);
  });

  it("reads a Release as making nothing in flow", () => {
    // Its pressure still shows: breather rates take it (issue #52).
    expect(texts(laid([["release", 0, 0]]), { q: 0, r: 0 })).toEqual(["Release · Oscillator", "No resonance pattern", "0.0 ν/s base · −29% pressure", "0.0 ν/s"]);
  });

  it("keeps every cell kind to five lines with at most one effect line, and no charge leg or fader leg on a module", () => {
    const s = laid(ACCEPTANCE);
    const cells: Cell[] = [
      { q: 1, r: 0 },
      { q: 0, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: -2 },
      { q: -1, r: 0 },
      { q: 1, r: -1 },
      { q: 3, r: 0 },
    ];
    for (const cell of cells) {
      const lines = read(s, cell);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(5);
      expect(lines.filter((l) => l.effect).length).toBeLessThanOrEqual(1);
      if (s.game.board.open.some((o) => o.q === cell.q && o.r === cell.r)) expect(lines.map((l) => l.text).join("\n")).not.toMatch(/charge|fader/i);
    }
  });
});

describe("a patched modulator's readout (issue #33)", () => {
  function patched(target: Cell): GameState {
    const s = laid([["flywheel", 0, 0], ["triangle", 0, 1]]);
    const result = apply(s, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target });
    expect(result.ok, result.reason).toBe(true);
    return result.state;
  }

  it("names the Patch's target in place of the reach", () => {
    expect(texts(patched({ q: 0, r: 1 }), { q: 0, r: 0 })).toEqual(["Flywheel · Modulator · facing NE", "1.0 charge/s · patched → Triangle"]);
  });

  it("names an empty target as an open cell", () => {
    expect(texts(patched({ q: 1, r: 0 }), { q: 0, r: 0 })).toEqual(["Flywheel · Modulator · facing NE", "1.0 charge/s · patched → Open cell"]);
  });
});
