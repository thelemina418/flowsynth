import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIn, fresh, giveProducer } from "./fixtures";
import { grantsOf } from "./levels";
import type { Cell } from "./hex";
import { deserialize, serialize } from "./save";
import type { GameState } from "./types";

// Cables in a v16 save (issue #33): an additive field. A saved cable the
// board can't hold is unplugged back to the allowance rather than failing
// the load, read in saved order.

const V15 = readFileSync(new URL("./fixtures/saves/v15-migration.json", import.meta.url), "utf8");

const W = { q: -1, r: 0 };
const O = { q: 0, r: 0 };
const NE = { q: 1, r: -1 };
const FAR = { q: 2, r: -2 };
const AIM = { q: 2, r: -1 };

function must(s: GameState, action: Parameters<typeof applyIn>[1]): void {
  const done = applyIn(s, action);
  if (!done.ok) throw new Error(`fixture ${action.type} failed: ${done.reason}`);
}

// Flywheels on W, NE and FAR, a Sine on the centre's SE neighbour, every
// Sketch cell owned, Producer credit for 3 modulators and 2 cables (Lv 4),
// two cables: W → O and NE → AIM.
function patched(): GameState {
  const s = fresh();
  for (const cell of [O, W, NE, FAR, AIM, { q: -1, r: 1 }, { q: -1, r: 2 }]) {
    if (!s.game.board.open.some((c) => c.q === cell.q && c.r === cell.r)) s.game.board.open.push({ ...cell });
  }
  giveProducer(s, { modulators: 3, cables: 2 });
  for (const cell of [W, NE, FAR]) must(s, { type: "placeModule", module: "flywheel", cell });
  must(s, { type: "placeModule", module: "sine", cell: { q: 1, r: 0 } });
  must(s, { type: "patchCable", cable: "patch", source: W, target: O });
  must(s, { type: "patchCable", cable: "patch", source: NE, target: AIM });
  return s;
}

function cable(source: Cell, target: Cell, type: unknown = "patch") {
  return { type, source, target };
}

function saved(s: GameState, mutate: (game: Record<string, unknown> & { board: Record<string, unknown> }) => void): string {
  const file = JSON.parse(serialize(s, 1_000));
  mutate(file.state.game);
  return JSON.stringify(file);
}

describe("cables in a v16 save", () => {
  it("round-trip exactly, with the allowance, the arrived types and the patched rates", () => {
    const s = patched();
    const loaded = deserialize(serialize(s, 1_000));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state).toEqual(s);
    expect(loaded.state!.game.board.cables).toEqual([cable(W, O), cable(NE, AIM)]);
    expect(grantsOf(loaded.state!).cableAllowance).toBe(2);
    expect(grantsOf(loaded.state!).arrivedCables).toEqual(["patch"]);
  });

  it("unplug each saved cable the board can't hold, reading in saved order", () => {
    const loaded = deserialize(saved(patched(), (game) => {
      game.board.cables = [
        cable(W, O),
        cable(NE, AIM, "mult"),
        cable({ q: 1, r: 0 }, AIM),
        cable({ q: 0, r: 1 }, AIM),
        cable(W, { q: -1, r: 1 }),
        cable(NE, { q: 3, r: -1 }),
        cable(NE, NE),
        cable(FAR, { q: -1, r: 2 }),
        cable(NE, { q: -1, r: 1 }),
        cable(NE, AIM),
        cable(FAR, AIM),
        { type: "patch", source: { q: 0 }, target: O },
        "patch",
      ];
    }));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state).toEqual(patched());
  });

  it("ignores a saved cable allowance or arrived list: both derive from class credit (issue #38)", () => {
    for (const mutate of [
      (game: Record<string, unknown>) => {
        delete game.cableAllowance;
        delete game.arrivedCables;
      },
      (game: Record<string, unknown>) => {
        game.cableAllowance = 1;
        game.arrivedCables = ["kazoo"];
      },
    ]) {
      const loaded = deserialize(saved(patched(), mutate));
      expect(loaded.error).toBeUndefined();
      expect(loaded.state).toEqual(patched());
      expect(grantsOf(loaded.state!).cableAllowance).toBe(2);
    }
  });

  it("a chunk-02 save with no cables loads with the Patch arrived and unused", () => {
    const loaded = deserialize(saved(patched(), (game) => {
      delete game.board.cables;
    }));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state!.game.board.cables).toEqual([]);
    expect(grantsOf(loaded.state!).arrivedCables).toEqual(["patch"]);
  });

  it("the v15 fixture loads with the Patch unused", () => {
    const loaded = deserialize(V15);
    expect(loaded.error).toBeUndefined();
    expect(loaded.state!.game.board.cables).toEqual([]);
    expect(grantsOf(loaded.state!).cableAllowance).toBe(1);
    expect(grantsOf(loaded.state!).arrivedCables).toEqual(["patch"]);
  });
});
