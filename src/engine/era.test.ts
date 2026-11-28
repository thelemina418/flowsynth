import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECONCILIATION_FLOOR_SECONDS } from "./constants";
import { hasUnseen, isSeen } from "./encyclopedia";
import { prestigeGainOf } from "./era";
import { advanceIn, applyIn, begin, fresh, giveOscillators, openRoadie, ownCells } from "./fixtures";
import { goalOf } from "./goal";
import { BASALT_CELLS, FLINT_CELL, SCHIST_CELL, SHALE_CELL } from "./map";
import { D } from "./num";
import { deserialize, serialize } from "./save";
import type { GameState } from "./types";

const V16_CHUNK05 = readFileSync(new URL("./fixtures/saves/v16-chunk05.json", import.meta.url), "utf8");

// The era's ν (spec chunk 06, issue #61): everything made since the era
// began, whatever was spent. Trusted flow, provisional ν settled by a
// non-missed honesty answer, and a completed breather each add the ν they
// credit; buying a fader never lowers it.

const SINE = { kind: "channel", type: "sine" } as const;

// A lone Sine at the centre, under its walls' pressure.
function sineBoard(): GameState {
  const s = fresh();
  applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
  return s;
}

// What ten trusted minutes on that board make, before any fader.
const MADE = sineBoard().game.rates.total.toNumber() * 600;

describe("the era's ν", () => {
  it("starts at 0 and counts trusted flow ν", () => {
    const s = sineBoard();
    expect(s.game.eraNous.toNumber()).toBe(0);
    begin(s, 1_500, 0);
    advanceIn(s, 600, "flow");
    expect(s.game.nous.toNumber()).toBeCloseTo(MADE, 9);
    expect(s.game.eraNous.toNumber()).toBeCloseTo(MADE, 9);
  });

  it("is unchanged by buying a fader", () => {
    const s = sineBoard();
    begin(s, 1_500, 0);
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: 1_000 });
    applyIn(s, { type: "dismissSummary" });
    expect(applyIn(s, { type: "buyFader", fader: SINE, max: true }).ok).toBe(true);
    expect(s.game.nous.toNumber()).toBeLessThan(MADE);
    expect(s.game.eraNous.toNumber()).toBeCloseTo(MADE, 9);
  });
});

describe("provisional ν in the era's ν", () => {
  // A session past its target with an away gap waiting on the honesty report.
  function owing(): GameState {
    const s = sineBoard();
    begin(s, 600, 0);
    advanceIn(s, 600, "flow");
    advanceIn(s, RECONCILIATION_FLOOR_SECONDS * 2, "flow", "away");
    advanceIn(s, 0, "flow");
    return s;
  }

  it("is not counted while it waits", () => {
    const s = owing();
    expect(s.game.session!.accounting.provisionalNous.toNumber()).toBeGreaterThan(0);
    expect(s.game.eraNous.toNumber()).toBeCloseTo(MADE, 9);
  });

  for (const outcome of ["full", "planned"] as const) {
    it(`adds when settled ${outcome}`, () => {
      const s = owing();
      const held = s.game.session!.accounting.provisionalNous.toNumber();
      expect(applyIn(s, { type: "settleHonestyReport", outcome }).ok).toBe(true);
      expect(s.game.eraNous.toNumber()).toBeCloseTo(MADE + held, 9);
    });
  }

  it("adds nothing when settled missed", () => {
    const s = owing();
    expect(applyIn(s, { type: "settleHonestyReport", outcome: "missed" }).ok).toBe(true);
    expect(s.game.eraNous.toNumber()).toBeCloseTo(MADE, 9);
  });
});

describe("a breather in the era's ν", () => {
  // A 25-minute session banks a 5-minute breather.
  function banked(): GameState {
    const s = sineBoard();
    begin(s, 1_500, 0);
    advanceIn(s, 1_500, "flow");
    applyIn(s, { type: "endSession", now: 1_000 });
    applyIn(s, { type: "dismissSummary" });
    return s;
  }

  it("adds a completed breather's payout", () => {
    const s = banked();
    const before = s.game.eraNous;
    applyIn(s, { type: "takeBreather", now: 0 });
    advanceIn(s, 3_600, "breather");
    const paid = s.game.breather.result!.nous;
    expect(paid.toNumber()).toBeGreaterThan(0);
    expect(s.game.eraNous.sub(before).toNumber()).toBeCloseTo(paid.toNumber(), 9);
  });

  it("adds nothing for one ended early", () => {
    const s = banked();
    const before = s.game.eraNous;
    applyIn(s, { type: "takeBreather", now: 0 });
    advanceIn(s, 200, "breather");
    expect(applyIn(s, { type: "endBreatherEarly" }).ok).toBe(true);
    expect(s.game.eraNous.eq(before)).toBe(true);
  });
});

describe("the era's ν in the save", () => {
  function earned(): GameState {
    const s = sineBoard();
    begin(s, 1_500, 0);
    advanceIn(s, 600, "flow");
    applyIn(s, { type: "endSession", now: 1_000 });
    applyIn(s, { type: "dismissSummary" });
    applyIn(s, { type: "buyFader", fader: SINE, max: true });
    return s;
  }

  function savedWith(eraNous: unknown): string {
    const file = JSON.parse(serialize(earned(), 1_000));
    if (eraNous === undefined) delete file.state.game.eraNous;
    else file.state.game.eraNous = eraNous;
    return JSON.stringify(file);
  }

  it("round-trips", () => {
    const s = earned();
    expect(s.game.eraNous.gt(s.game.nous)).toBe(true);
    const loaded = deserialize(serialize(s, 1_000)).state!;
    expect(loaded).toEqual(s);
    expect(loaded.game.eraNous.toNumber()).toBeCloseTo(MADE, 9);
  });

  it("loads a chunk-05 v16 save with the era's ν equal to its ν", () => {
    const loaded = deserialize(V16_CHUNK05);
    expect(loaded.error).toBeUndefined();
    const game = loaded.state!.game;
    expect(game.nous.toNumber()).toBeCloseTo(9338.666666666664, 9);
    expect(game.eraNous.eq(game.nous)).toBe(true);
  });

  it("reads an absent, non-finite, negative or unreadable era ν as the current ν", () => {
    const nous = earned().game.nous;
    const infinite = savedWith(7).replace('"eraNous":7', '"eraNous":1e999');
    const bad = [undefined, "-5", -5, "Infinity", "NaN", null, "lots", { e: 1 }];
    for (const text of [...bad.map(savedWith), infinite]) {
      const loaded = deserialize(text);
      expect(loaded.error).toBeUndefined();
      expect(loaded.state!.game.eraNous.eq(nous)).toBe(true);
    }
  });
});

// Every Sketch entry before Prestige done: Roadie open, Shale, a Basalt,
// Flint and the marked Schist owned, and a third oscillator placed.
function sketchDone(): GameState {
  const s = fresh();
  openRoadie(s);
  ownCells(s, [SHALE_CELL, BASALT_CELLS[0]!, FLINT_CELL, SCHIST_CELL]);
  giveOscillators(s, { allowance: 3 });
  for (const cell of [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }]) applyIn(s, { type: "placeModule", module: "sine", cell });
  return s;
}

describe("the Prestige Goal", () => {
  it("is the Goal at 1e6 era ν with every earlier Sketch entry done", () => {
    const s = sketchDone();
    expect(goalOf(s)).toBeNull();
    s.game.eraNous = D(999_999);
    expect(goalOf(s)).toBeNull();
    s.game.eraNous = D(1e6);
    expect(goalOf(s)).toBe("Prestige");
  });

  it("comes after Conquer Schist while Schist stands", () => {
    const s = fresh();
    openRoadie(s);
    ownCells(s, [SHALE_CELL, BASALT_CELLS[0]!, FLINT_CELL]);
    s.game.eraNous = D(1e6);
    expect(goalOf(s)).toBe("Conquer Schist");
  });

  it("follows the era's ν, not the balance", () => {
    const s = sketchDone();
    s.game.nous = D(0);
    s.game.eraNous = D(2e6);
    expect(goalOf(s)).toBe("Prestige");
    s.game.nous = D(5e6);
    s.game.eraNous = D(5e5);
    expect(goalOf(s)).toBeNull();
  });
});

describe("the Encyclopedia's Prestige entry", () => {
  it("is revealed, unseen, the first time the Goal is Prestige, and exactly once", () => {
    const s = sketchDone();
    begin(s, 1_500, 0);
    s.game.eraNous = D(1e6 - 1_000);
    advanceIn(s, 1, "flow");
    expect(s.game.encyclopedia.revealed).not.toContain("prestige");
    advanceIn(s, 1_000, "flow");
    expect(goalOf(s)).toBe("Prestige");
    expect(s.game.encyclopedia.revealed.filter((id) => id === "prestige")).toHaveLength(1);
    expect(isSeen(s, "prestige")).toBe(false);
    expect(hasUnseen(s)).toBe(true);
    applyIn(s, { type: "pauseSession" });
    expect(applyIn(s, { type: "readEntry", id: "prestige" }).ok).toBe(true);
    applyIn(s, { type: "resumeSession" });
    advanceIn(s, 60, "flow");
    expect(s.game.encyclopedia.revealed.filter((id) => id === "prestige")).toHaveLength(1);
    expect(isSeen(s, "prestige")).toBe(true);
  });

  it("is not revealed at 1e6 era ν while Schist stands", () => {
    const s = fresh();
    begin(s, 1_500, 0);
    s.game.eraNous = D(2e6);
    advanceIn(s, 60, "flow");
    expect(s.game.encyclopedia.revealed).not.toContain("prestige");
  });
});

describe("prestigeGainOf", () => {
  it("gives floor(sqrt(era ν / 1e6)) Arete: 0 below 1e6, 1 at 1e6, 3 at 9e6, 7 at 5e7", () => {
    const s = fresh();
    const at = (era: number) => {
      s.game.eraNous = D(era);
      return prestigeGainOf(s).toNumber();
    };
    expect(at(0)).toBe(0);
    expect(at(999_999)).toBe(0);
    expect(at(1e6)).toBe(1);
    expect(at(9e6)).toBe(3);
    expect(at(5e7)).toBe(7);
  });

  it("reads the era's ν, not the balance", () => {
    const s = fresh();
    s.game.nous = D(9e6);
    s.game.eraNous = D(4e6);
    expect(prestigeGainOf(s).toNumber()).toBe(2);
  });
});

