import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { consoleShown } from "./console";
import { applyIn, fresh } from "./fixtures";
import { D } from "./num";
import { deserialize, serialize } from "./save";

// The console in the save (issue #58): additive v16 fields. Absent levels
// read as 0 and an absent disclosure flag is recomputed from the loaded
// state. A level that is negative, non-integer or non-finite is dropped,
// and so is an entry for a type with no channel fader.

const V16_CHUNK05 = readFileSync(new URL("./fixtures/saves/v16-chunk05.json", import.meta.url), "utf8");

function bought() {
  const s = fresh();
  s.game.nous = D(100);
  // Triangle's 15, then 10 + 16 + 25.6 of the 85 left.
  applyIn(s, { type: "buyFader", fader: { kind: "channel", type: "triangle" } });
  applyIn(s, { type: "buyFader", fader: { kind: "channel", type: "sine" }, max: true });
  return s;
}

function savedWith(channels: unknown, shown?: unknown): string {
  const file = JSON.parse(serialize(bought(), 1_000));
  file.state.game.console.channels = channels;
  if (shown !== undefined) file.state.game.console.shown = shown;
  return JSON.stringify(file);
}

describe("the console in a v16 save", () => {
  it("round-trips fader levels and the disclosure flag, ν spent to 0 or not", () => {
    const s = bought();
    expect(s.game.console.channels).toEqual({ triangle: 1, sine: 3 });
    const loaded = deserialize(serialize(s, 1_000)).state!;
    expect(loaded).toEqual(s);
    s.game.nous = D(0);
    const spent = deserialize(serialize(s, 1_000)).state!;
    expect(spent.game.console.shown.console).toBe(true);
    expect(consoleShown(spent)).toBe(true);
  });

  it("reads the levels into the rates on load", () => {
    const s = bought();
    applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
    const loaded = deserialize(serialize(s, 1_000)).state!;
    expect(loaded.game.rates.oscillators[0]!.faders.toNumber()).toBeCloseTo(1.1 ** 3, 12);
  });

  it("loads a chunk-05 save with every fader at 0, the console shown from its ν, and nothing else changed", () => {
    const loaded = deserialize(V16_CHUNK05);
    expect(loaded.error).toBeUndefined();
    const state = loaded.state!;
    expect(state.game.console.channels).toEqual({});
    // Its 9 338 ν affords a fader, so the console shows.
    expect(state.game.console.shown.console).toBe(true);
    const fixture = JSON.parse(V16_CHUNK05);
    const reread = JSON.parse(serialize(state, fixture.savedAt));
    // 9 338 ν reaches a bus fader's 5 000 too (issue #60).
    expect(reread.state.game.console).toEqual({ channels: {}, buses: {}, master: {}, shown: { console: true, buses: true } });
    delete reread.state.game.console;
    // The era's ν (issue #61) is named too: the save's own ν.
    expect(reread.state.game.eraNous).toBe(fixture.state.game.nous);
    delete reread.state.game.eraNous;
    // No Arete and no prestige yet (issue #62).
    expect([reread.state.game.arete, reread.state.game.prestiges]).toEqual(["0", 0]);
    delete reread.state.game.arete;
    delete reread.state.game.prestiges;
    expect(reread).toEqual(fixture);
  });

  it("recomputes an absent disclosure flag from the loaded state", () => {
    const poor = JSON.parse(serialize(fresh(), 0));
    delete poor.state.game.console;
    expect(deserialize(JSON.stringify(poor)).state!.game.console).toEqual({ channels: {}, buses: {}, master: {}, shown: { console: false, buses: false } });
  });

  it("keeps a saved disclosure flag once set, and never trusts a non-boolean", () => {
    expect(deserialize(savedWith({}, { console: true })).state!.game.console.shown.console).toBe(true);
    const poor = JSON.parse(serialize(fresh(), 0));
    poor.state.game.console = { channels: {}, buses: {}, shown: { console: "yes", buses: false } };
    expect(deserialize(JSON.stringify(poor)).state!.game.console.shown.console).toBe(false);
  });

  it("drops a negative, non-integer, non-finite or unknown entry, reading 0", () => {
    const bad: Record<string, unknown> = {
      sine: -1,
      triangle: 1.5,
      flywheel: "2",
      bogus: 3,
    };
    const loaded = deserialize(savedWith(bad));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state!.game.console.channels).toEqual({});
    const infinite = savedWith({ sine: 4 }).replace('"sine":4', '"sine":1e999');
    expect(deserialize(infinite).state!.game.console.channels).toEqual({});
    for (const channels of [null, "sine", [3]]) expect(deserialize(savedWith(channels)).state!.game.console.channels).toEqual({});
    expect(deserialize(savedWith({ sine: 2, triangle: -4 })).state!.game.console.channels).toEqual({ sine: 2 });
  });
});
