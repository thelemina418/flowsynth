import { describe, expect, it } from "vitest";
import { channelFaders, consoleShown, costOf, maxAffordable } from "./console";
import { apply } from "./apply";
import { advanceIn, applyIn, begin, fresh, giveHabit } from "./fixtures";
import { cloneState } from "./state";
import type { GameState } from "./types";
import { D } from "./num";

// The console (spec chunk 06, issue #58): channel faders, one per type the
// player has, appearing the first time any fader is affordable.

const SINE = { kind: "channel", type: "sine" } as const;
const TRIANGLE = { kind: "channel", type: "triangle" } as const;
const FLYWHEEL = { kind: "channel", type: "flywheel" } as const;

describe("the console's appearance", () => {
  it("is hidden on a fresh start", () => {
    const s = fresh();
    expect(consoleShown(s)).toBe(false);
  });

  it("shows Sine, Triangle and Flywheel channel faders once Sine is affordable at 10 ν", () => {
    const s = fresh();
    s.game.nous = D(9.99);
    expect(consoleShown(s)).toBe(false);
    s.game.nous = D(10);
    expect(consoleShown(s)).toBe(true);
    expect(channelFaders(s)).toEqual([SINE, TRIANGLE, FLYWHEEL]);
  });
});

describe("a fader's cost", () => {
  it("is base × 1.6^level from the authored bases: Sine 10, Triangle 15, Flywheel 25", () => {
    const s = fresh();
    expect(costOf(s, SINE).toNumber()).toBeCloseTo(10, 9);
    expect(costOf(s, TRIANGLE).toNumber()).toBeCloseTo(15, 9);
    expect(costOf(s, FLYWHEEL).toNumber()).toBeCloseTo(25, 9);
    s.game.console.channels.sine = 6;
    // 10 × 1.6⁶ = 167.77216
    expect(costOf(s, SINE).toNumber()).toBeCloseTo(167.77216, 6);
  });

  it("names the most levels ν affords: 3 with ν for 3.4", () => {
    const s = fresh();
    // 10 + 16 + 25.6 = 51.6 for three levels; the fourth costs 40.96.
    s.game.nous = D(51.6 + 0.4 * 40.96);
    expect(maxAffordable(s, SINE)).toBe(3);
    s.game.nous = D(9);
    expect(maxAffordable(s, SINE)).toBe(0);
  });
});

describe("buying a fader", () => {
  it("buys one level at exactly the cost and leaves ν 0", () => {
    const s = fresh();
    s.game.nous = D(10);
    const bought = applyIn(s, { type: "buyFader", fader: SINE });
    expect(bought.ok).toBe(true);
    expect(s.game.console.channels.sine).toBe(1);
    expect(s.game.nous.toNumber()).toBe(0);
  });
});

describe("refused purchases", () => {
  it("buys 3 levels on a max purchase with ν for 3.4, leaving the remainder", () => {
    const s = fresh();
    s.game.nous = D(51.6 + 0.4 * 40.96);
    expect(applyIn(s, { type: "buyFader", fader: SINE, max: true }).ok).toBe(true);
    expect(s.game.console.channels.sine).toBe(3);
    expect(s.game.nous.toNumber()).toBeCloseTo(0.4 * 40.96, 9);
  });

  it("refuses an unaffordable purchase, deep-equal", () => {
    const s = fresh();
    s.game.nous = D(10);
    s.game.console.shown.console = true;
    const result = apply(s, { type: "buyFader", fader: TRIANGLE });
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.state).toBe(s);
    expect(apply(s, { type: "buyFader", fader: TRIANGLE, max: true }).state).toBe(s);
  });

  it("refuses a fader for a type the player doesn't have", () => {
    const s = fresh();
    s.game.nous = D(1e9);
    expect(apply(s, { type: "buyFader", fader: { kind: "channel", type: "square" } }).ok).toBe(false);
  });

  it("refuses any purchase in flow, paused or a breather, deep-equal", () => {
    const s = fresh();
    giveHabit(s, "Piano", "engineer");
    begin(s, 1500, 0);
    s.game.nous = D(1e6);
    const flowing = cloneState(s);
    expect(applyIn(s, { type: "buyFader", fader: SINE }).ok).toBe(false);
    expect(s).toEqual(flowing);
    applyIn(s, { type: "pauseSession" });
    const paused = cloneState(s);
    expect(applyIn(s, { type: "buyFader", fader: SINE, max: true }).ok).toBe(false);
    expect(s).toEqual(paused);
    applyIn(s, { type: "resumeSession" });
    advanceIn(s, 1500, "flow");
    applyIn(s, { type: "endSession", now: 1_500_000 });
    applyIn(s, { type: "dismissSummary" });
    expect(applyIn(s, { type: "takeBreather", now: 1_600_000 }).ok).toBe(true);
    const breathing = cloneState(s);
    expect(applyIn(s, { type: "buyFader", fader: SINE }).ok).toBe(false);
    expect(s).toEqual(breathing);
  });
});

describe("the console's disclosure", () => {
  it("stays after a purchase drops ν to 0", () => {
    const s = fresh();
    s.game.nous = D(10);
    applyIn(s, { type: "buyFader", fader: SINE });
    expect(s.game.nous.toNumber()).toBe(0);
    expect(consoleShown(s)).toBe(true);
    expect(s.game.console.shown.console).toBe(true);
  });

  it("flips during a flow session that crosses 10 ν", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
    giveHabit(s, "Piano", "engineer");
    begin(s, 1500, 0);
    advanceIn(s, 5, "flow");
    expect(s.game.console.shown.console).toBe(false);
    advanceIn(s, 60, "flow");
    expect(s.game.nous.toNumber()).toBeGreaterThan(10);
    expect(s.game.console.shown.console).toBe(true);
  });
});

// Channel levels in the rates: bought through `apply`, read from the
// cached BoardRates.
function withLevels(type: "sine" | "flywheel", count: number): GameState {
  const s = fresh();
  s.game.nous = D(1e9);
  for (let i = 0; i < count; i++) applyIn(s, { type: "buyFader", fader: { kind: "channel", type } });
  return s;
}

describe("channel levels in the rates", () => {
  it("a Sine with channel level 2 reads faders ×1.25² in its flow and breather rate", () => {
    const s = withLevels("sine", 2);
    applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
    const sine = s.game.rates.oscillators[0]!;
    expect(sine.faders.toNumber()).toBeCloseTo(1.5625, 12);
    const bare = fresh();
    applyIn(bare, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
    const plain = bare.game.rates.oscillators[0]!;
    expect(sine.rate.toNumber()).toBeCloseTo(plain.rate.toNumber() * 1.5625, 12);
    expect(sine.breatherRate.toNumber()).toBeCloseTo(plain.breatherRate.toNumber() * 1.5625, 12);
  });

  it("a Flywheel with level 1 delivers 1.25 × its output, and its target's charge factor reads 1 + ln(1 + 1.25 × output)", () => {
    const s = withLevels("flywheel", 1);
    applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
    applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 1 } });
    // Turned to face the Sine at (0,0).
    applyIn(s, { type: "rotateModule", cell: { q: 0, r: 1 }, turn: "counterclockwise" });
    const flywheel = s.game.rates.modulators[0]!;
    // A fresh Flywheel's output is 1 charge/s.
    expect(flywheel.output.toNumber()).toBeCloseTo(1.25, 12);
    expect(flywheel.deliveries[0]!.holds).toBe("sine");
    const sine = s.game.rates.oscillators[0]!;
    expect(sine.chargeReceived.toNumber()).toBeCloseTo(1.25, 12);
    expect(sine.charge.toNumber()).toBeCloseTo(1 + Math.log(1 + 1.25), 12);
  });

  it("a Patch into Shale from a Flywheel with level 1 deals 1.25 × its output", () => {
    const s = withLevels("flywheel", 1);
    applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 0 } });
    applyIn(s, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: -1, r: 1 } });
    expect(s.game.rates.walls[0]!.damage.toNumber()).toBeCloseTo(1.25, 12);
  });
});
