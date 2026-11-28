import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIn, fresh, giveOscillators } from "./fixtures";
import { deserialize, serialize } from "./save";

// The Encyclopedia through the save (issue #44): the revealed and seen
// sets round-trip, and a save written before them gains its reveals from
// its state on load.

const V15 = readFileSync(new URL("./fixtures/saves/v15-migration.json", import.meta.url), "utf8");

function load(text: string) {
  const result = deserialize(text);
  expect(result.error).toBeUndefined();
  return result.state!;
}

describe("the Encyclopedia in the save", () => {
  it("round-trips the revealed and seen sets", () => {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 0 } });
    applyIn(s, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: 1, r: 0 } });
    applyIn(s, { type: "readEntry", id: "cables" });
    applyIn(s, { type: "unplugCable", source: { q: 0, r: 0 } });
    const back = load(serialize(s, 1));
    expect(back.game.encyclopedia).toEqual({ revealed: ["sine", "triangle", "walls", "cables"], seen: ["cables"] });
    expect(back).toEqual(s);
  });

  it("a chunk-03 save (no encyclopedia field) gains reveals from its state on load", () => {
    const s = fresh();
    giveOscillators(s, { arrive: ["square"] });
    s.records.sessionsCompleted = 2;
    const file = JSON.parse(serialize(s, 1));
    delete file.state.game.encyclopedia;
    const back = load(JSON.stringify(file));
    expect(back.game.encyclopedia.revealed).toEqual(["sine", "triangle", "square", "walls", "classes"]);
    expect(back.game.encyclopedia.seen).toEqual([]);
  });

  it("an unreadable set is read as empty, a stray id is dropped, and seen never exceeds revealed", () => {
    const file = JSON.parse(serialize(fresh(), 1));
    file.state.game.encyclopedia = { revealed: ["walls", "chords", 3], seen: ["walls", "prestige"] };
    const back = load(JSON.stringify(file));
    expect(back.game.encyclopedia).toEqual({ revealed: ["walls", "sine", "triangle"], seen: ["walls"] });
  });

  it("a v15 save gains reveals from its migrated state, and none of the retired entries", () => {
    const back = load(V15);
    expect(back.game.encyclopedia).toEqual({ revealed: ["sine", "triangle", "walls", "classes"], seen: [] });
  });
});
