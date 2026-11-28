import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { atCap, costOf, faderName, masterFaders, masterShown } from "./console";
import { applyIn, fresh, giveOscillators } from "./fixtures";
import { D } from "./num";
import { deserialize, serialize } from "./save";
import { cloneState } from "./state";
import type { GameState } from "./types";

// The master section (spec chunk 06, issue #63): after the first prestige,
// three Arete faders. Channel Taper and Bus Taper take 0.03 a level off
// their section's cost growth (1.6, floored at 1.30); Drive multiplies all
// oscillator ν by ×1.5 a level. Each costs `level + 1` Arete and keeps its
// level across prestiges.

const CHANNEL_TAPER = { kind: "master", id: "channelTaper" } as const;
const BUS_TAPER = { kind: "master", id: "busTaper" } as const;
const DRIVE = { kind: "master", id: "drive" } as const;
const SINE = { kind: "channel", type: "sine" } as const;
const TRIANGLE = { kind: "channel", type: "triangle" } as const;
const OSC_BUS = { kind: "bus", category: "oscillator" } as const;

// A state after one prestige, holding `arete` Arete.
function prestiged(arete: number): GameState {
  const s = fresh();
  s.game.console.shown.console = true;
  s.game.prestiges = 1;
  s.game.arete = D(arete);
  return s;
}

describe("the master section's appearance", () => {
  it("is absent before the first prestige", () => {
    const s = fresh();
    s.game.arete = D(10);
    expect(masterShown(s)).toBe(false);
  });

  it("shows the three faders after it, costing 1 Arete at level 0", () => {
    const s = prestiged(0);
    expect(masterShown(s)).toBe(true);
    expect(masterFaders(s)).toEqual([CHANNEL_TAPER, BUS_TAPER, DRIVE]);
    expect(masterFaders(s).map(faderName)).toEqual(["Channel Taper", "Bus Taper", "Drive"]);
    for (const fader of masterFaders(s)) expect(costOf(s, fader).toNumber()).toBe(1);
  });
});

describe("buying a master fader", () => {
  it("spends level + 1 Arete and leaves ν alone", () => {
    const s = prestiged(10);
    s.game.nous = D(500);
    expect(applyIn(s, { type: "buyFader", fader: DRIVE }).ok).toBe(true);
    expect(s.game.console.master.drive).toBe(1);
    expect(costOf(s, DRIVE).toNumber()).toBe(2);
    expect(applyIn(s, { type: "buyFader", fader: DRIVE }).ok).toBe(true);
    expect(s.game.arete.toNumber()).toBe(7);
    expect(s.game.nous.toNumber()).toBe(500);
  });

  it("shift-click buys as many as the Arete pays for: 6 Arete buys 1 + 2 + 3", () => {
    const s = prestiged(6.5);
    expect(applyIn(s, { type: "buyFader", fader: CHANNEL_TAPER, max: true }).ok).toBe(true);
    expect(s.game.console.master.channelTaper).toBe(3);
    expect(s.game.arete.toNumber()).toBe(0.5);
  });

  it("is refused when unaffordable, before the first prestige, or outside upgrade mode", () => {
    const poor = prestiged(0.5);
    expect(apply(poor, { type: "buyFader", fader: DRIVE }).ok).toBe(false);
    const early = fresh();
    early.game.arete = D(5);
    expect(apply(early, { type: "buyFader", fader: DRIVE }).ok).toBe(false);
    const flowing = prestiged(5);
    flowing.game.mode = "flow";
    expect(apply(flowing, { type: "buyFader", fader: DRIVE }).ok).toBe(false);
    expect(flowing.game.arete.toNumber()).toBe(5);
  });

  it("caps a taper at level 10 (growth 1.30) and refuses past it; Drive has no cap", () => {
    const s = prestiged(1000);
    s.game.console.master.channelTaper = 10;
    s.game.console.master.drive = 30;
    expect(atCap(s, CHANNEL_TAPER)).toBe(true);
    expect(atCap(s, DRIVE)).toBe(false);
    expect(apply(s, { type: "buyFader", fader: CHANNEL_TAPER }).ok).toBe(false);
    expect(apply(s, { type: "buyFader", fader: CHANNEL_TAPER, max: true }).ok).toBe(false);
    expect(s.game.arete.toNumber()).toBe(1000);
    s.game.console.master.busTaper = 8;
    expect(applyIn(s, { type: "buyFader", fader: BUS_TAPER, max: true }).ok).toBe(true);
    expect(s.game.console.master.busTaper).toBe(10);
    expect(s.game.arete.toNumber()).toBe(1000 - 9 - 10);
    expect(applyIn(s, { type: "buyFader", fader: DRIVE }).ok).toBe(true);
    expect(s.game.console.master.drive).toBe(31);
  });
});

describe("the tapers", () => {
  it("a Channel Taper level lowers every channel fader's next cost at once: base × 1.57^level", () => {
    const s = prestiged(1);
    s.game.console.channels.sine = 3;
    s.game.console.channels.triangle = 2;
    s.game.console.buses.oscillator = 2;
    applyIn(s, { type: "buyFader", fader: CHANNEL_TAPER });
    expect(costOf(s, SINE).toNumber()).toBeCloseTo(10 * 1.57 ** 3, 9);
    expect(costOf(s, TRIANGLE).toNumber()).toBeCloseTo(15 * 1.57 ** 2, 9);
    expect(costOf(s, OSC_BUS).toNumber()).toBeCloseTo(5000 * 1.6 ** 2, 9);
  });

  it("a Bus Taper level does the same for buses only", () => {
    const s = prestiged(1);
    s.game.console.channels.sine = 3;
    s.game.console.buses.oscillator = 2;
    applyIn(s, { type: "buyFader", fader: BUS_TAPER });
    expect(costOf(s, OSC_BUS).toNumber()).toBeCloseTo(5000 * 1.57 ** 2, 9);
    expect(costOf(s, SINE).toNumber()).toBeCloseTo(10 * 1.6 ** 3, 9);
  });

  it("at the cap the growth is 1.30, and shift-click sums the reduced curve", () => {
    const s = prestiged(0);
    s.game.console.master.channelTaper = 10;
    s.game.console.channels.sine = 2;
    expect(costOf(s, SINE).toNumber()).toBeCloseTo(10 * 1.69, 9);
    // 16.9 + 21.97 = 38.87 buys two levels, not three (+28.561).
    s.game.nous = D(40);
    expect(applyIn(s, { type: "buyFader", fader: SINE, max: true }).ok).toBe(true);
    expect(s.game.console.channels.sine).toBe(4);
    expect(s.game.nous.toNumber()).toBeCloseTo(40 - 38.87, 9);
  });
});

describe("Drive", () => {
  it("multiplies oscillator ν, flow and breather, by ×1.5 a level, and nothing else", () => {
    const s = prestiged(3);
    giveOscillators(s, { allowance: 2 });
    applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
    applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 1, r: 0 } });
    const before = cloneState(s).game.rates;
    applyIn(s, { type: "buyFader", fader: DRIVE });
    applyIn(s, { type: "buyFader", fader: DRIVE });
    const after = s.game.rates;
    expect(after.total.toNumber()).toBeCloseTo(before.total.toNumber() * 2.25, 9);
    expect(after.breatherTotal.toNumber()).toBeCloseTo(before.breatherTotal.toNumber() * 2.25, 9);
    expect(after.oscillators[0]!.faders.toNumber()).toBeCloseTo(2.25, 9);
    expect(after.modulators).toEqual(before.modulators);
    expect(after.arms).toEqual(before.arms);
  });
});

describe("master levels across prestiges and saves", () => {
  it("survive a second prestige", () => {
    const s = prestiged(3);
    applyIn(s, { type: "buyFader", fader: DRIVE });
    applyIn(s, { type: "buyFader", fader: CHANNEL_TAPER });
    s.game.console.channels.sine = 4;
    s.game.eraNous = D(4e6);
    expect(applyIn(s, { type: "prestige" }).ok).toBe(true);
    expect(s.game.prestiges).toBe(2);
    expect(s.game.console.master).toEqual({ drive: 1, channelTaper: 1 });
    expect(s.game.console.channels).toEqual({});
    expect(s.game.arete.toNumber()).toBe(3);
  });

  it("round-trip through a save", () => {
    const s = prestiged(0);
    s.game.console.master = { channelTaper: 4, busTaper: 1, drive: 12 };
    expect(deserialize(serialize(s, 0)).state!.game.console.master).toEqual({ channelTaper: 4, busTaper: 1, drive: 12 });
  });

  it("clamp a taper past its cap to the cap and drop unknown ids and bad levels", () => {
    const s = prestiged(0);
    const raw = JSON.parse(serialize(s, 0));
    raw.state.game.console.master = { channelTaper: 14, busTaper: 2.5, drive: 40, gain: 3 };
    expect(deserialize(JSON.stringify(raw)).state!.game.console.master).toEqual({ channelTaper: 10, drive: 40 });
  });

  it("an old save without master levels loads with none", () => {
    const s = prestiged(0);
    const raw = JSON.parse(serialize(s, 0));
    delete raw.state.game.console.master;
    expect(deserialize(JSON.stringify(raw)).state!.game.console.master).toEqual({});
  });
});
