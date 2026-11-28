import { describe, expect, it } from "vitest";
import { apply } from "../../engine/apply";
import { giveOscillators, openRoadie } from "../../engine/fixtures";
import { lifetimeCells, type Cell } from "../../engine/hex";
import { D } from "../../engine/num";
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

  it("shows a Faders line while the channel isn't ×1 (issue #58)", () => {
    let s = laid(ACCEPTANCE);
    s.game.nous = D(26);
    for (const max of [false, false]) s = apply(s, { type: "buyFader", fader: { kind: "channel", type: "sine" }, max }).state;
    expect(s.game.console.channels.sine).toBe(2);
    // 0.71 × 1.25² = 1.109…
    expect(texts(s, { q: 0, r: 0 })).toEqual([
      "Sine · Oscillator",
      "Not resonating · needs Triangles on opposite sides",
      "1.0 ν/s base · −29% pressure",
      "Faders ×1.56",
      "1.1 ν/s",
    ]);
    // A Triangle with no channel level shows none.
    expect(texts(s, { q: 1, r: 0 }).some((t) => t.startsWith("Faders"))).toBe(false);
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
    expect(texts(laid([]), { q: -2, r: 1 })).toEqual(["Schist · Wall · ring 2 · opens Mixer", `300${T}000 / 300${T}000 HP · regen 15.0/s`, "Pressure 12%"]);
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

  it("reads the spec's wall detail: Shale at 412 / 600 HP, pressing on 2 oscillators, taking 1.4/s (spec chunk 05)", () => {
    // Two Sines beside Shale, and a Flywheel at 4 h of Producer credit
    // (1.0 + 0.1 × 4 charge/s) patched into it from across the opening.
    const s = laid([["sine", 0, 0], ["sine", 0, 1]]);
    s.game.board.walls.push({ cell: { q: -1, r: 1 }, hp: D(412) });
    s.records.classCredit.producer = 4 * 3600;
    const placed = apply(s, { type: "placeModule", module: "flywheel", cell: { q: 1, r: 0 } });
    expect(placed.ok, placed.reason).toBe(true);
    const done = apply(placed.state, { type: "patchCable", cable: "patch", source: { q: 1, r: 0 }, target: { q: -1, r: 1 } });
    expect(done.ok, done.reason).toBe(true);
    expect(read(done.state, { q: -1, r: 1 })).toEqual([
      { text: "Shale · Wall · ring 1" },
      { text: "412 / 600 HP · regen 0.1/s" },
      { text: "Pressure 5% on 2 modules" },
      { text: "Taking 1.4/s", effect: true },
    ]);
  });

  it("rounds a wall's HP up, so it reads 0 only at the conquest", () => {
    const s = laid([]);
    s.game.board.walls.push({ cell: { q: -1, r: 1 }, hp: D(0.4) });
    expect(texts(s, { q: -1, r: 1 })[1]).toBe("1 / 600 HP · regen 0.1/s");
    s.game.board.walls[0]!.hp = D(411.2);
    expect(texts(s, { q: -1, r: 1 })[1]).toBe("412 / 600 HP · regen 0.1/s");
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

// Channel levels in the Arm and modulator lines (issue #59): the Hex
// detail reads the multiplied figures from the cached rates.
describe("the multiplied figures in the Hex detail (issue #59)", () => {
  // A Blade on the centre turned to NW (Basalt (−1,0)), fed through a
  // Patch by a Flywheel on (0,1) at 1.4 charge/s (4 credited Producer
  // hours), with these channel levels.
  function fedBlade(levels: Partial<Record<ModuleType, number>>): GameState {
    let s = createInitialState();
    openRoadie(s);
    s.game.console.channels = { ...levels };
    s.records.classCredit.producer = 4 * 3600;
    const steps: Parameters<typeof apply>[1][] = [
      { type: "placeModule", module: "blade", cell: { q: 0, r: 0 } },
      ...Array.from({ length: 4 }, () => ({ type: "rotateModule", cell: { q: 0, r: 0 }, turn: "clockwise" }) as const),
      { type: "placeModule", module: "flywheel", cell: { q: 0, r: 1 } },
      { type: "patchCable", cable: "patch", source: { q: 0, r: 1 }, target: { q: 0, r: 0 } },
    ];
    for (const step of steps) {
      const result = apply(s, step);
      expect(result.ok, result.reason).toBe(true);
      s = result.state;
    }
    return s;
  }

  it("a Blade at channel level 1 reads 1.4 × 10 × 1.25 = 17.5/s to Basalt", () => {
    expect(texts(fedBlade({ blade: 1 }), { q: 0, r: 0 })).toEqual(["Blade · Arm · facing NW", "1.4 charge/s received", "17.5/s to Basalt"]);
  });

  it("a Flywheel at channel level 1 reads 1.4 × 1.25 = 1.75 charge/s, and the Blade receives it", () => {
    const s = fedBlade({ flywheel: 1 });
    expect(texts(s, { q: 0, r: 1 })).toEqual(["Flywheel · Modulator · facing NE", "1.75 charge/s · patched → Blade"]);
    expect(texts(s, { q: 0, r: 0 })).toEqual(["Blade · Arm · facing NW", "1.75 charge/s received", "17.5/s to Basalt"]);
  });
});
