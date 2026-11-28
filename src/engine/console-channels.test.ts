import { describe, expect, it } from "vitest";
import { channelFaders, costOf } from "./console";
import { applyIn, fresh, openRoadie } from "./fixtures";
import type { Cell } from "./hex";
import type { GameState, HabitClass, ModuleType, StrikeRate } from "./types";

// Every type's channel fader (spec chunk 06, issue #59): each type the
// player has gets its fader as it arrives, and none shows for a type that
// hasn't arrived or a class that isn't open.

const HOUR = 3600;

function credited(hours: Partial<Record<HabitClass, number>>): GameState {
  const s = fresh();
  for (const [habitClass, h] of Object.entries(hours)) s.records.classCredit[habitClass as HabitClass] = h * HOUR;
  return s;
}

function types(s: GameState): ModuleType[] {
  return channelFaders(s).flatMap((f) => (f.kind === "channel" ? [f.type] : []));
}

describe("each type's channel fader arrives with its type", () => {
  it("Square at Engineer Lv 2, Saw at Lv 4, Release at Lv 6", () => {
    expect(types(credited({ engineer: 1.49 }))).toEqual(["sine", "triangle", "flywheel"]);
    expect(types(credited({ engineer: 1.5 }))).toEqual(["sine", "triangle", "flywheel", "square"]);
    expect(types(credited({ engineer: 5 }))).toEqual(["sine", "triangle", "flywheel", "square", "saw"]);
    expect(types(credited({ engineer: 12 }))).toEqual(["sine", "triangle", "flywheel", "square", "saw", "release"]);
  });

  it("Pulsewell at Producer Lv 3, and not at Lv 2", () => {
    expect(types(credited({ producer: 1.49 }))).not.toContain("pulsewell");
    expect(types(credited({ producer: 3 }))).toContain("pulsewell");
  });

  it("Blade when Roadie opens and Guard Plate at Roadie Lv 2; neither while Roadie is closed", () => {
    const closed = credited({ roadie: 12 });
    expect(types(closed)).not.toContain("blade");
    expect(types(closed)).not.toContain("guardPlate");
    const open = fresh();
    openRoadie(open);
    expect(types(open)).toContain("blade");
    expect(types(open)).not.toContain("guardPlate");
    open.records.classCredit.roadie = 1.5 * HOUR;
    expect(types(open)).toContain("guardPlate");
  });

  it("costs from the authored bases: Square 200, Saw 1 500, Release 10 000, Pulsewell 2 000, Blade 500, Guard Plate 3 000", () => {
    const s = fresh();
    const bases: [ModuleType, number][] = [["square", 200], ["saw", 1500], ["release", 10000], ["pulsewell", 2000], ["blade", 500], ["guardPlate", 3000]];
    for (const [type, base] of bases) expect(costOf(s, { kind: "channel", type }).toNumber()).toBe(base);
  });
});

function must(s: GameState, action: Parameters<typeof applyIn>[1]): void {
  const done = applyIn(s, action);
  if (!done.ok) throw new Error(`fixture ${action.type} failed: ${done.reason}`);
}

function place(s: GameState, module: ModuleType, cell: Cell): void {
  must(s, { type: "placeModule", module, cell });
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.q === b.q && a.r === b.r;
}

const O = { q: 0, r: 0 };
const SE = { q: 0, r: 1 };
const BASALT_W = { q: -1, r: 0 };

// Roadie open with these channel levels, set before anything is placed so
// each placement's rates read them.
function roadieWith(levels: Partial<Record<ModuleType, number>>): GameState {
  const s = fresh();
  openRoadie(s);
  s.game.console.channels = { ...levels };
  return s;
}

// A Blade on the centre turned clockwise to `facing` (4 = NW, Basalt
// (−1,0); 0 = NE, an open cell), fed by a fresh Flywheel on (0,1) patched
// into it: 1 charge/s.
function bladeAt(s: GameState, facing: number): StrikeRate {
  place(s, "blade", O);
  for (let i = 0; i < facing; i++) must(s, { type: "rotateModule", cell: O, turn: "clockwise" });
  place(s, "flywheel", SE);
  must(s, { type: "patchCable", cable: "patch", source: SE, target: O });
  const arm = s.game.rates.arms[0]!;
  if (arm.role !== "strike") throw new Error("expected a Blade");
  return arm;
}

describe("the Blade's channel fader", () => {
  it("at level 1, a Blade receiving 1 charge/s deals 11/s to the wall it faces", () => {
    const s = roadieWith({ blade: 1 });
    const blade = bladeAt(s, 4);
    expect(blade.chargeReceived.toNumber()).toBeCloseTo(1, 12);
    expect(blade.damage.toNumber()).toBeCloseTo(11, 12);
    expect(s.game.rates.walls.find((w) => sameCell(w.cell, BASALT_W))!.damage.toNumber()).toBeCloseTo(11, 12);
  });

  it("at level 1, facing an open cell, it deals nothing", () => {
    const s = roadieWith({ blade: 1 });
    expect(bladeAt(s, 0).damage.toNumber()).toBe(0);
    expect(s.game.rates.walls).toEqual([]);
  });
});

const NE = { q: 1, r: -1 };
const SHALE = { q: -1, r: 1 };

function oscillatorAt(s: GameState, cell: Cell) {
  return s.game.rates.oscillators.find((o) => sameCell(o.cell, cell))!;
}

// Roadie at Lv 2: the Guard Plate and 2 Arms.
function platedWith(levels: Partial<Record<ModuleType, number>>): GameState {
  const s = roadieWith(levels);
  s.records.classCredit.roadie = 1.5 * HOUR;
  return s;
}

describe("the Guard Plate's channel fader", () => {
  // Shale (−1,1), owned, borders ring-2 walls, so a Plate there is active
  // and shields the Sine on (0,1), which borders Schist and Flint. The
  // Sine on (1,−1) isn't beside it.
  it("at level 1, raises the shielded oscillator's ν by ×1.1 and no other's", () => {
    const s = platedWith({ guardPlate: 1 });
    place(s, "guardPlate", SHALE);
    place(s, "sine", SE);
    place(s, "sine", NE);
    const shielded = oscillatorAt(s, SE);
    expect(shielded.pressure.toNumber()).toBe(0);
    expect(shielded.faders.toNumber()).toBeCloseTo(1.1, 12);
    expect(shielded.rate.toNumber()).toBeCloseTo(1.1, 12);
    const other = oscillatorAt(s, NE);
    expect(other.faders.toNumber()).toBe(1);
    expect(other.pressure.toNumber()).toBeGreaterThan(0);
  });

  it("with two guarding Plates, a shielded oscillator takes the higher multiplier, never the product", () => {
    const s = platedWith({ guardPlate: 1 });
    place(s, "guardPlate", SHALE);
    place(s, "guardPlate", O);
    place(s, "sine", SE);
    expect(oscillatorAt(s, SE).faders.toNumber()).toBeCloseTo(1.1, 12);
    expect(oscillatorAt(s, SE).rate.toNumber()).toBeCloseTo(1.1, 12);
  });

  it("an oscillator beside an active Plate that no wall presses on gains nothing", () => {
    const s = platedWith({ guardPlate: 1 });
    // (1,0)'s three ring-2 walls owned, as if conquered: it borders none.
    s.game.board.open.push({ q: 2, r: 0 }, { q: 2, r: -1 }, { q: 1, r: 1 });
    place(s, "guardPlate", O);
    place(s, "sine", { q: 1, r: 0 });
    expect(oscillatorAt(s, { q: 1, r: 0 }).faders.toNumber()).toBe(1);
  });
});

describe("the Release's channel fader", () => {
  it("at level 1, raises its breather rate to 6 × 1.1 and leaves its flow rate 0", () => {
    const s = credited({ engineer: 12 });
    s.game.console.channels = { release: 1 };
    place(s, "release", NE);
    const release = oscillatorAt(s, NE);
    // (1,−1) borders three ring-2 walls: its pressure is the cap's share.
    const left = 1 - release.pressure.toNumber();
    expect(release.rate.toNumber()).toBe(0);
    expect(release.breatherRate.toNumber()).toBeCloseTo(6 * 1.1 * left, 12);
  });
});

describe("the Pulsewell's channel fader", () => {
  it("at level 1, delivers 0.5 × 1.1 charge/s to each target", () => {
    const s = credited({ producer: 3 });
    s.game.console.channels = { pulsewell: 1 };
    place(s, "pulsewell", O);
    place(s, "sine", NE);
    place(s, "sine", SE);
    expect(s.game.rates.modulators[0]!.output.toNumber()).toBeCloseTo(0.55, 12);
    for (const cell of [NE, SE]) expect(oscillatorAt(s, cell).chargeReceived.toNumber()).toBeCloseTo(0.55, 12);
  });
});

// Channel faders (#59) and bus faders (#60) together: a bus multiplies its
// whole category, so the Arms bus multiplies both a Blade's damage and a
// Guard Plate's shielding boost, and the Oscillators bus a Release's
// breather ν — each on top of the type's own channel.
describe("channel and bus faders together", () => {
  it("a Blade at channel 1 under Arms bus 1 deals 10 × 1.1 × 1.05 per charge", () => {
    const s = roadieWith({ blade: 1 });
    s.game.console.buses = { arm: 1 };
    expect(bladeAt(s, 4).damage.toNumber()).toBeCloseTo(11.55, 12);
  });

  it("a shielded oscillator takes the Guard Plate's channel × Arms bus", () => {
    const s = platedWith({ guardPlate: 1 });
    s.game.console.buses = { arm: 1 };
    place(s, "guardPlate", SHALE);
    place(s, "sine", SE);
    place(s, "sine", NE);
    expect(oscillatorAt(s, SE).faders.toNumber()).toBeCloseTo(1.1 * 1.05, 12);
    expect(oscillatorAt(s, NE).faders.toNumber()).toBe(1);
  });

  it("the Arms bus alone lifts an active Plate's shielded oscillator by ×1.05", () => {
    const s = platedWith({});
    s.game.console.buses = { arm: 1 };
    place(s, "guardPlate", SHALE);
    place(s, "sine", SE);
    expect(oscillatorAt(s, SE).faders.toNumber()).toBeCloseTo(1.05, 12);
  });

  it("a Release at channel 1 under Oscillators bus 1 earns 6 × 1.1 × 1.05 in a breather, 0 in flow", () => {
    const s = credited({ engineer: 12 });
    s.game.console.channels = { release: 1 };
    s.game.console.buses = { oscillator: 1 };
    place(s, "release", NE);
    const release = oscillatorAt(s, NE);
    const left = 1 - release.pressure.toNumber();
    expect(release.rate.toNumber()).toBe(0);
    expect(release.breatherRate.toNumber()).toBeCloseTo(6 * 1.1 * 1.05 * left, 12);
  });
});
