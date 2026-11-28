import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIn, advanceIn, begin, fresh, giveOscillators, openRoadie, ownCells } from "./fixtures";
import { goalOf } from "./goal";
import { BASALT_CELLS, FLINT_CELL, SCHIST_CELL, SHALE_CELL } from "./map";
import { D } from "./num";
import { computeBoardRates } from "./rates";
import { deserialize, serialize } from "./save";
import { cloneState } from "./state";
import type { GameState } from "./types";

// Prestige (spec chunk 06, issue #62; ADR-0039, ADR-0093): ending the era
// banks floor(sqrt(era ν / 1e6)) Arete, counts the prestige, and zeroes ν,
// the era's ν and every channel and bus level. Everything else stays.

const SINE = { kind: "channel", type: "sine" } as const;
const OSC_BUS = { kind: "bus", category: "oscillator" } as const;

// Every Sketch entry before Prestige done, three Sines placed, a session
// played, a channel and a bus level bought, a breather banked, and the
// era's ν at 9.5e6 (3 Arete).
function readyToPrestige(): GameState {
  const s = fresh();
  openRoadie(s);
  ownCells(s, [SHALE_CELL, BASALT_CELLS[0]!, FLINT_CELL, SCHIST_CELL]);
  giveOscillators(s, { allowance: 3 });
  for (const cell of [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }]) applyIn(s, { type: "placeModule", module: "sine", cell });
  begin(s, 1_500, 0);
  advanceIn(s, 1_500, "flow");
  applyIn(s, { type: "endSession", now: 1_000 });
  applyIn(s, { type: "dismissSummary" });
  s.game.nous = D(1e6);
  s.game.eraNous = D(9.5e6);
  expect(applyIn(s, { type: "buyFader", fader: SINE }).ok).toBe(true);
  expect(applyIn(s, { type: "buyFader", fader: OSC_BUS }).ok).toBe(true);
  expect(s.game.breather.banked).not.toBeNull();
  return s;
}

describe("a prestige", () => {
  it("keeps the board, records, classes, breather and Encyclopedia; zeroes ν, era ν and faders; banks the Arete", () => {
    const s = readyToPrestige();
    const before = cloneState(s);
    expect(goalOf(s)).toBe("Prestige");
    const result = applyIn(s, { type: "prestige" });
    expect(result.ok).toBe(true);
    expect(s.game.board).toEqual(before.game.board);
    expect(s.records).toEqual(before.records);
    expect(s.game.openClasses).toEqual(before.game.openClasses);
    expect(s.game.breather).toEqual(before.game.breather);
    expect(s.game.encyclopedia).toEqual(before.game.encyclopedia);
    expect(s.game.nous.toNumber()).toBe(0);
    expect(s.game.eraNous.toNumber()).toBe(0);
    expect(s.game.console.channels).toEqual({});
    expect(s.game.console.buses).toEqual({});
    expect(s.game.arete.toNumber()).toBe(3);
    expect(s.game.prestiges).toBe(1);
  });

  it("then makes nothing in upgrade mode, and the next flow session's first second makes the board's fader-free rate", () => {
    const s = readyToPrestige();
    const faded = s.game.rates.total.toNumber();
    applyIn(s, { type: "prestige" });
    const after = cloneState(s);
    advanceIn(s, 1e6, "upgrade");
    expect(s).toEqual(after);
    const bare = computeBoardRates(s.game.board, s.records.classCredit.producer, { channels: {}, buses: {}, master: {}, shown: s.game.console.shown }).total.toNumber();
    expect(bare).toBeGreaterThan(0);
    expect(bare).toBeLessThan(faded);
    expect(s.game.rates.total.toNumber()).toBe(bare);
    begin(s, 1_500, 0);
    advanceIn(s, 1, "flow");
    expect(s.game.nous.toNumber()).toBeCloseTo(bare, 9);
    expect(s.game.eraNous.toNumber()).toBeCloseTo(bare, 9);
  });

  it("names the next Sketch entry or nothing as the Goal, never Prestige", () => {
    const s = readyToPrestige();
    applyIn(s, { type: "prestige" });
    expect(goalOf(s)).toBeNull();
    const early = fresh();
    early.game.eraNous = D(2e6);
    applyIn(early, { type: "prestige" });
    expect(goalOf(early)).toBe("Conquer Shale");
  });

  it("banks again on a second era, adding to the Arete held", () => {
    const s = readyToPrestige();
    applyIn(s, { type: "prestige" });
    s.game.eraNous = D(4e6);
    expect(applyIn(s, { type: "prestige" }).ok).toBe(true);
    expect(s.game.arete.toNumber()).toBe(5);
    expect(s.game.prestiges).toBe(2);
  });
});

describe("Arete and the prestige count in the save", () => {
  function prestiged(): GameState {
    const s = readyToPrestige();
    applyIn(s, { type: "prestige" });
    return s;
  }

  function savedWith(field: "arete" | "prestiges", value: unknown): string {
    const file = JSON.parse(serialize(prestiged(), 1_000));
    if (value === undefined) delete file.state.game[field];
    else file.state.game[field] = value;
    return JSON.stringify(file);
  }

  it("round-trip", () => {
    const s = prestiged();
    const loaded = deserialize(serialize(s, 1_000)).state!;
    expect(loaded).toEqual(s);
    expect(loaded.game.arete.toNumber()).toBe(3);
    expect(loaded.game.prestiges).toBe(1);
  });

  it("read an absent, non-finite, negative or unreadable Arete as 0", () => {
    const infinite = savedWith("arete", 7).replace('"arete":7', '"arete":1e999');
    const bad = [undefined, "-5", -5, "Infinity", "NaN", null, "lots", { e: 1 }];
    for (const text of [...bad.map((v) => savedWith("arete", v)), infinite]) {
      const loaded = deserialize(text);
      expect(loaded.error).toBeUndefined();
      expect(loaded.state!.game.arete.toNumber()).toBe(0);
    }
  });

  it("read an absent, negative, fractional or non-finite prestige count as 0", () => {
    for (const value of [undefined, -1, 1.5, "2", null]) {
      const loaded = deserialize(savedWith("prestiges", value));
      expect(loaded.error).toBeUndefined();
      expect(loaded.state!.game.prestiges).toBe(0);
    }
  });

  it("load an older save with no Arete and no prestige", () => {
    const loaded = deserialize(readFileSync(new URL("./fixtures/saves/v16-chunk05.json", import.meta.url), "utf8"));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state!.game.arete.toNumber()).toBe(0);
    expect(loaded.state!.game.prestiges).toBe(0);
  });
});

describe("a refused prestige", () => {
  it("is refused below 1e6 era ν, with the state as it was", () => {
    const s = readyToPrestige();
    s.game.eraNous = D(999_999);
    const before = cloneState(s);
    const result = applyIn(s, { type: "prestige" });
    expect(result.ok).toBe(false);
    expect(s).toEqual(before);
  });

  it("is refused in flow, paused and a breather, with the state as it was", () => {
    const flow = readyToPrestige();
    begin(flow, 1_500, 0);
    const paused = readyToPrestige();
    begin(paused, 1_500, 0);
    applyIn(paused, { type: "pauseSession" });
    const breather = readyToPrestige();
    applyIn(breather, { type: "takeBreather", now: 0 });
    for (const [s, mode] of [[flow, "flow"], [paused, "paused"], [breather, "breather"]] as const) {
      expect(s.game.mode).toBe(mode);
      const before = cloneState(s);
      expect(applyIn(s, { type: "prestige" }).ok).toBe(false);
      expect(s).toEqual(before);
    }
  });
});
