import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { advanceIn, applyIn, begin, fresh, giveHabit, giveProducer } from "./fixtures";
import type { Cell } from "./hex";
import { deserialize, serialize } from "./save";
import type { GameState, SessionSummary } from "./types";

// The session's walls (spec chunk 05, issue #50), through the GameState
// seam: the running session tallies, for each wall it fought, the HP it
// lost and whether it was conquered, and the summary carries that list as
// `walls`, marking the wall still being fought at the end. Conquered walls
// come in conquest order. The list round-trips through the save, and a
// save without it reads `[]`.

const O = { q: 0, r: 0 };
const SE = { q: 0, r: 1 };
const SHALE = { q: -1, r: 1 };
const BASALT = { q: 0, r: -1 };
const V15 = readFileSync(new URL("./fixtures/saves/v15-migration.json", import.meta.url), "utf8");

function must(s: GameState, action: Parameters<typeof applyIn>[1]): void {
  const done = applyIn(s, action);
  if (!done.ok) throw new Error(`fixture ${action.type} failed: ${done.reason}`);
}

// Flywheels patched into their walls in the given order, and an Engineer
// session running. One Flywheel runs at 1 charge/s; two run at Producer
// Lv 2's 1.15.
function fighting(pairs: [Cell, Cell][]): GameState {
  const s = fresh();
  if (pairs.length > 1) giveProducer(s, { modulators: pairs.length, cables: pairs.length });
  for (const [source, target] of pairs) {
    must(s, { type: "placeModule", module: "flywheel", cell: source });
    must(s, { type: "patchCable", cable: "patch", source, target });
  }
  giveHabit(s, "Piano", "engineer");
  begin(s, null, 0);
  return s;
}

function ended(s: GameState): SessionSummary {
  must(s, { type: "endSession", now: 1 });
  return s.game.summary!;
}

function plain(walls: SessionSummary["walls"]) {
  return walls.map((w) => ({ ...w, lost: Number(w.lost.toNumber().toFixed(6)) }));
}

describe("the summary's walls", () => {
  it("lists the fought wall's lost HP: Shale at 0.9/s for 300 s lost 270", () => {
    const s = fighting([[O, SHALE]]);
    advanceIn(s, 300, "flow");
    expect(plain(ended(s).walls)).toEqual([{ cell: SHALE, lost: 270, conquered: false, fought: true }]);
  });

  it("marks a conquered wall, which is no longer fought", () => {
    const s = fighting([[O, SHALE]]);
    advanceIn(s, 1000, "flow");
    expect(plain(ended(s).walls)).toEqual([{ cell: SHALE, lost: 600, conquered: true, fought: false }]);
  });

  it("lists conquests in the order they happened, whatever order the walls were first fought in", () => {
    // Basalt is patched first, so it is fought first; Shale (net 1.05/s)
    // falls at 571 s, Basalt (net 0.15/s) at 40 000 s.
    const s = fighting([[O, BASALT], [SE, SHALE]]);
    advanceIn(s, 41_000, "flow");
    expect(plain(ended(s).walls)).toEqual([
      { cell: SHALE, lost: 600, conquered: true, fought: false },
      { cell: BASALT, lost: 6000, conquered: true, fought: false },
    ]);
  });

  it("a session that fought nothing has an empty list", () => {
    const s = fighting([]);
    advanceIn(s, 300, "flow");
    expect(ended(s).walls).toEqual([]);
  });
});

describe("the summary's walls in the save", () => {
  it("round-trips the summary's walls, and a running session's tally", () => {
    const s = fighting([[O, BASALT], [SE, SHALE]]);
    advanceIn(s, 1000, "flow");
    expect(s.game.session!.walls).toHaveLength(2);
    const running = deserialize(serialize(s, 1_000));
    expect(running.error).toBeUndefined();
    expect(running.state).toEqual(s);
    ended(s);
    const loaded = deserialize(serialize(s, 1_000));
    expect(loaded.state).toEqual(s);
    expect(loaded.state!.game.summary!.walls).toHaveLength(2);
  });

  it("defaults a save without the list to []", () => {
    const s = fighting([[O, SHALE]]);
    advanceIn(s, 300, "flow");
    const file = JSON.parse(serialize(s, 1_000));
    delete file.state.game.session.walls;
    const running = deserialize(JSON.stringify(file)).state!;
    expect(running.game.session!.walls).toEqual([]);
    ended(s);
    const summaryFile = JSON.parse(serialize(s, 1_000));
    delete summaryFile.state.game.summary.walls;
    expect(deserialize(JSON.stringify(summaryFile)).state!.game.summary!.walls).toEqual([]);
  });

  it("drops an unreadable entry", () => {
    const s = fighting([[O, SHALE]]);
    advanceIn(s, 300, "flow");
    ended(s);
    const file = JSON.parse(serialize(s, 1_000));
    const good = file.state.game.summary.walls[0];
    file.state.game.summary.walls = [good, { ...good, cell: { q: 0, r: 0 } }, { ...good, lost: 12 }, { ...good, conquered: "yes" }, null];
    expect(deserialize(JSON.stringify(file)).state!.game.summary!.walls).toEqual(s.game.summary!.walls);
  });

  it("the v15 migration loads with no walls in its summary or session", () => {
    const loaded = deserialize(V15).state!;
    expect(loaded.game.summary?.walls ?? []).toEqual([]);
    expect(loaded.game.session?.walls ?? []).toEqual([]);
  });
});
