import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { busFaders, busesShown, costOf, faderName, maxAffordable } from "./console";
import { applyIn, begin, fresh, giveHabit, giveProducer, openRoadie } from "./fixtures";
import { D } from "./num";
import { computeBoardRates } from "./rates";
import { deserialize, serialize } from "./save";
import type { GameState } from "./types";

// Bus faders (spec chunk 06, issue #60): one per category the player has,
// appearing the first time a bus fader is affordable (5 000 ν) and staying
// from then on. Each level multiplies its whole category by ×1.05.

const OSCILLATORS = { kind: "bus", category: "oscillator" } as const;
const MODULATORS = { kind: "bus", category: "modulator" } as const;
const ARMS = { kind: "bus", category: "arm" } as const;
const SINE = { kind: "channel", type: "sine" } as const;

describe("the bus section's appearance", () => {
  it("is hidden below 5 000 ν, then shows the Oscillators and Modulators buses", () => {
    const s = fresh();
    s.game.nous = D(4999.99);
    expect(busesShown(s)).toBe(false);
    s.game.nous = D(5000);
    expect(busesShown(s)).toBe(true);
    expect(busFaders(s)).toEqual([OSCILLATORS, MODULATORS]);
  });

  it("stays once shown after ν falls below 5 000", () => {
    const s = fresh();
    s.game.nous = D(5000);
    applyIn(s, { type: "buyFader", fader: SINE });
    expect(s.game.console.shown.buses).toBe(true);
    s.game.nous = D(0);
    expect(busesShown(s)).toBe(true);
  });

  it("flips on a bus purchase that spends ν to 0", () => {
    const s = fresh();
    s.game.nous = D(5000);
    expect(applyIn(s, { type: "buyFader", fader: OSCILLATORS }).ok).toBe(true);
    expect(s.game.nous.toNumber()).toBe(0);
    expect(s.game.console.buses.oscillator).toBe(1);
    expect(busesShown(s)).toBe(true);
  });

  it("adds the Arms bus only once Roadie has opened", () => {
    const s = fresh();
    s.game.nous = D(1e6);
    expect(busFaders(s)).toEqual([OSCILLATORS, MODULATORS]);
    openRoadie(s);
    expect(busFaders(s)).toEqual([OSCILLATORS, MODULATORS, ARMS]);
  });
});

describe("buying a bus fader", () => {
  it("costs 5 000 × 1.6^level, read as `Oscillators · 2 · 12 800`", () => {
    const s = fresh();
    expect(costOf(s, OSCILLATORS).toNumber()).toBeCloseTo(5000, 9);
    s.game.console.buses.oscillator = 2;
    expect(faderName(OSCILLATORS)).toBe("Oscillators");
    expect(costOf(s, OSCILLATORS).toNumber()).toBeCloseTo(12800, 6);
    expect(costOf(s, MODULATORS).toNumber()).toBeCloseTo(5000, 9);
    expect([faderName(MODULATORS), faderName(ARMS)]).toEqual(["Modulators", "Arms"]);
  });

  it("buys as many levels as ν affords on a max purchase: 2 with 5 000 + 8 000 + 1 000", () => {
    const s = fresh();
    s.game.nous = D(14000);
    expect(maxAffordable(s, MODULATORS)).toBe(2);
    expect(applyIn(s, { type: "buyFader", fader: MODULATORS, max: true }).ok).toBe(true);
    expect(s.game.console.buses.modulator).toBe(2);
    expect(s.game.nous.toNumber()).toBeCloseTo(1000, 6);
  });

  it("refuses an unaffordable one, the Arms bus before Roadie, and any in flow, deep-equal", () => {
    const s = fresh();
    s.game.nous = D(4999);
    s.game.console.shown.buses = true;
    const poor = apply(s, { type: "buyFader", fader: OSCILLATORS });
    expect(poor.ok).toBe(false);
    expect(poor.state).toBe(s);
    s.game.nous = D(1e9);
    expect(apply(s, { type: "buyFader", fader: ARMS }).state).toBe(s);
    giveHabit(s, "Piano", "engineer");
    begin(s, 1500, 0);
    expect(apply(s, { type: "buyFader", fader: OSCILLATORS, max: true }).state).toBe(s);
  });
});

describe("bus levels in the rates", () => {
  it("a Sine with channel 2 and oscillator bus 1 reads faders ×1.1² × 1.05", () => {
    const s = fresh();
    s.game.nous = D(1e6);
    applyIn(s, { type: "buyFader", fader: SINE });
    applyIn(s, { type: "buyFader", fader: SINE });
    applyIn(s, { type: "buyFader", fader: OSCILLATORS });
    applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
    applyIn(s, { type: "placeModule", module: "triangle", cell: { q: 1, r: 0 } });
    const [sine, triangle] = s.game.rates.oscillators;
    expect(sine!.faders.toNumber()).toBeCloseTo(1.21 * 1.05, 12);
    expect(triangle!.faders.toNumber()).toBeCloseTo(1.05, 12);
  });

  it("a modulator bus level multiplies every modulator's output", () => {
    const s = fresh();
    s.game.nous = D(1e6);
    giveProducer(s, { modulators: 2 });
    applyIn(s, { type: "buyFader", fader: MODULATORS });
    applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 0 } });
    applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 1, r: 0 } });
    const outputs = s.game.rates.modulators.map((m) => m.output.toNumber());
    expect(outputs).toHaveLength(2);
    const plain = computeBoardRates(s.game.board, s.records.classCredit.producer).modulators.map((m) => m.output.toNumber());
    for (const [i, output] of outputs.entries()) expect(output).toBeCloseTo(plain[i]! * 1.05, 12);
  });

  it("an Arms bus level multiplies every Blade's damage: 14/s becomes 14.7/s", () => {
    const s = fresh();
    openRoadie(s);
    s.records.classCredit.producer = 4 * 3600;
    s.game.nous = D(1e6);
    applyIn(s, { type: "buyFader", fader: ARMS });
    // A Blade on the centre facing NW onto Basalt (−1,0), fed 1.4 charge/s
    // by a Flywheel on (0,1) patched into it.
    applyIn(s, { type: "placeModule", module: "blade", cell: { q: 0, r: 0 } });
    for (let i = 0; i < 4; i++) applyIn(s, { type: "rotateModule", cell: { q: 0, r: 0 }, turn: "clockwise" });
    applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 1 } });
    applyIn(s, { type: "patchCable", cable: "patch", source: { q: 0, r: 1 }, target: { q: 0, r: 0 } });
    const blade = s.game.rates.arms[0]!;
    if (blade.role !== "strike") throw new Error("expected a Blade");
    expect(blade.chargeReceived.toNumber()).toBeCloseTo(1.4, 9);
    expect(blade.damage.toNumber()).toBeCloseTo(14.7, 9);
  });
});

describe("bus levels in a v16 save", () => {
  function boughtBuses(): GameState {
    const s = fresh();
    s.game.nous = D(5000 + 8000 + 5000);
    applyIn(s, { type: "buyFader", fader: OSCILLATORS, max: true });
    applyIn(s, { type: "buyFader", fader: MODULATORS });
    applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
    return s;
  }

  function savedWith(buses: unknown, shown?: unknown): string {
    const file = JSON.parse(serialize(boughtBuses(), 1_000));
    file.state.game.console.buses = buses;
    if (shown !== undefined) file.state.game.console.shown = shown;
    return JSON.stringify(file);
  }

  it("round-trips the bus levels and the bus disclosure flag with ν spent to 0, into the rates", () => {
    const s = boughtBuses();
    expect(s.game.nous.toNumber()).toBeCloseTo(0, 9);
    expect(s.game.console.buses).toEqual({ oscillator: 2, modulator: 1 });
    const loaded = deserialize(serialize(s, 1_000)).state!;
    expect(loaded).toEqual(s);
    expect(loaded.game.console.shown.buses).toBe(true);
    expect(busesShown(loaded)).toBe(true);
    expect(loaded.game.rates.oscillators[0]!.faders.toNumber()).toBeCloseTo(1.05 ** 2, 12);
  });

  it("keeps only `true` for the bus flag, recomputing it otherwise", () => {
    const poor = JSON.parse(serialize(fresh(), 0));
    poor.state.game.console.shown = { console: false, buses: "yes" };
    expect(deserialize(JSON.stringify(poor)).state!.game.console.shown.buses).toBe(false);
    poor.state.game.console.shown = { console: true, buses: true };
    expect(deserialize(JSON.stringify(poor)).state!.game.console.shown.buses).toBe(true);
    delete poor.state.game.console.shown.buses;
    poor.state.game.nous = "6000";
    expect(deserialize(JSON.stringify(poor)).state!.game.console.shown.buses).toBe(true);
  });

  it("drops a negative, non-integer, non-finite or unknown bus entry, reading 0", () => {
    const bad = { oscillator: -1, modulator: 1.5, arm: "2", sine: 3, bogus: 1 };
    const loaded = deserialize(savedWith(bad));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state!.game.console.buses).toEqual({});
    const infinite = savedWith({ oscillator: 4 }).replace('"oscillator":4', '"oscillator":1e999');
    expect(deserialize(infinite).state!.game.console.buses).toEqual({});
    for (const buses of [null, "oscillator", [3]]) expect(deserialize(savedWith(buses)).state!.game.console.buses).toEqual({});
    expect(deserialize(savedWith({ modulator: 3, oscillator: -2 })).state!.game.console.buses).toEqual({ modulator: 3 });
  });
});
