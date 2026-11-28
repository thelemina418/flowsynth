import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cellKind } from "./board";
import { advanceIn, applyIn, begin, fresh, giveHabit } from "./fixtures";
import { deserialize, serialize } from "./save";
import type { GameState } from "./types";

// Wall HP and conquered cells in the save (issue #49): additive v16
// fields. `board.walls` defaults to `[]`, so every wall is at full HP. On
// read, an HP entry is dropped (the wall is full again) when its cell isn't
// a wall inside the arc, or its HP isn't finite, is ≤ 0 or is ≥ full. A
// saved open cell is kept even on an authored wall's cell: it was
// conquered.

const O = { q: 0, r: 0 };
const SHALE = { q: -1, r: 1 };
const BASALT = { q: 0, r: -1 };
const V15 = readFileSync(new URL("./fixtures/saves/v15-migration.json", import.meta.url), "utf8");

// Shale fought for 100 s (510 HP), then the session ended.
function fought(): GameState {
  const s = fresh();
  applyIn(s, { type: "placeModule", module: "flywheel", cell: O });
  applyIn(s, { type: "patchCable", cable: "patch", source: O, target: SHALE });
  giveHabit(s, "Piano", "engineer");
  begin(s, null, 0);
  advanceIn(s, 100, "flow");
  applyIn(s, { type: "endSession", now: 1 });
  return s;
}

function savedWith(walls: unknown): string {
  const file = JSON.parse(serialize(fought(), 1_000));
  file.state.game.board.walls = walls;
  return JSON.stringify(file);
}

describe("wall HP in a v16 save", () => {
  it("round-trips wall HP exactly", () => {
    const s = fought();
    expect(s.game.board.walls).toHaveLength(1);
    const loaded = deserialize(serialize(s, 1_000));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state).toEqual(s);
    expect(loaded.state!.game.board.walls[0]!.hp.toNumber()).toBeCloseTo(510, 9);
  });

  it("round-trips a conquered cell as open", () => {
    const s = fought();
    applyIn(s, { type: "dismissSummary" });
    begin(s, null, 2);
    advanceIn(s, 1000, "flow");
    expect(cellKind(s.game.board, SHALE)).toBe("open");
    const loaded = deserialize(serialize(s, 1_000)).state!;
    expect(loaded).toEqual(s);
    expect(cellKind(loaded.game.board, SHALE)).toBe("open");
  });

  it("drops each kind of invalid HP entry, leaving that wall at full HP", () => {
    const bad = [
      { cell: { q: 0, r: 0 }, hp: "100" }, // an open cell
      { cell: { q: 0, r: 3 }, hp: "100" }, // a wall beyond Sketch's arc
      { cell: { q: 9, r: 9 }, hp: "100" }, // off the lifetime board
      { cell: SHALE, hp: "Infinity" },
      { cell: SHALE, hp: "0" },
      { cell: SHALE, hp: "-5" },
      { cell: SHALE, hp: "600" },
      { cell: SHALE, hp: "601" },
      { cell: SHALE, hp: "bogus" },
      { cell: SHALE, hp: null },
      { cell: "Shale", hp: "100" },
      "Shale",
    ];
    for (const entry of bad) {
      const loaded = deserialize(savedWith([entry]));
      expect(loaded.error, JSON.stringify(entry)).toBeUndefined();
      expect(loaded.state!.game.board.walls, JSON.stringify(entry)).toEqual([]);
    }
    const kept = deserialize(savedWith([{ cell: BASALT, hp: "12.5" }, { cell: SHALE, hp: "0" }])).state!;
    expect(kept.game.board.walls.map((w) => [w.cell, w.hp.toNumber()])).toEqual([[BASALT, 12.5]]);
  });

  it("keeps the first of two entries for one wall", () => {
    const loaded = deserialize(savedWith([{ cell: SHALE, hp: "100" }, { cell: SHALE, hp: "200" }])).state!;
    expect(loaded.game.board.walls.map((w) => w.hp.toNumber())).toEqual([100]);
  });

  it("a chunk-04 v16 save, written before wall HP, loads with every wall at full HP", () => {
    const file = JSON.parse(serialize(fought(), 1_000));
    delete file.state.game.board.walls;
    const loaded = deserialize(JSON.stringify(file));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state!.game.board.walls).toEqual([]);
  });

  it("the v15 fixture loads with every wall at full HP", () => {
    expect(deserialize(V15).state!.game.board.walls).toEqual([]);
  });
});
