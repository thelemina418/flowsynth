import { describe, expect, it } from "vitest";
import { D, pow } from "./num";
import { begin, applyIn, advanceIn, fresh, giveHabit, giveOscillators } from "./fixtures";
import { grantsOf } from "./levels";
import { SAVE_VERSION } from "./constants";
import { deserialize, recoverLostSave, serialize, SaveRefusedError } from "./save";

// Save v16 (issue #18): the nested GameState round-trips exactly, Decimals
// included; the version gate refuses newer builds; a NaN refuses the write;
// a v16 file whose Decimal figures are unreadable is the lost-money class
// (ADR-0082) — refused by an ordinary load, repaired to zero by the
// explicit recovery.

function flowing() {
  const s = fresh();
  const { habit } = giveHabit(s, "Piano", "engineer");
  applyIn(s, { type: "createIntention", habitId: habit.id, minutes: 20, schedule: "daily", now: 1 });
  begin(s, 600, 1_000);
  advanceIn(s, 123.25, "flow");
  return s;
}

function v16(mutate: (state: { records: Record<string, unknown>; game: Record<string, unknown> }) => void): string {
  const file = JSON.parse(serialize(flowing(), 1_000));
  mutate(file.state);
  return JSON.stringify(file);
}

describe("save v16", () => {
  it("writes version 16 in the envelope", () => {
    expect(SAVE_VERSION).toBe(16);
    const file = JSON.parse(serialize(fresh(), 42));
    expect(file).toMatchObject({ app: "flowsynth", version: 16, savedAt: 42 });
    expect(Object.keys(file.state).sort()).toEqual(["game", "records"]);
  });

  it("round-trips to a deep-equal state with Decimals below and above 1e308", () => {
    for (const nous of [D(0), D(12.5), D("1.5e300"), pow(10, 400), D("ee12"), D(-3)]) {
      const s = flowing();
      s.game.nous = nous;
      s.game.session!.accounting.provisionalNous = pow(10, 5_000);
      const loaded = deserialize(serialize(s, 1_000));
      expect(loaded.error).toBeUndefined();
      expect(loaded.state).toEqual(s);
      expect(loaded.state!.game.nous.eq(nous)).toBe(true);
    }
  });

  it("a NaN Decimal refuses the write, naming its path", () => {
    const s = flowing();
    s.game.nous = D(NaN);
    expect(() => serialize(s, 0)).toThrow(SaveRefusedError);
    expect(() => serialize(s, 0)).toThrow(/game\.nous/);
  });

  it("refuses a save from a newer build", () => {
    const text = serialize(fresh(), 0).replace(`"version": 16`, `"version": 17`);
    const loaded = deserialize(text);
    expect(loaded.state).toBeUndefined();
    expect(loaded.newerVersion).toBe(true);
    expect(loaded.error).toMatch(/newer than this build/i);
  });

  it("rejects corrupt and foreign files with a clear message", () => {
    expect(deserialize("{nope").error).toBe("The save data is not valid JSON.");
    expect(deserialize('{"app":"other","version":16,"state":{}}').error).toBe("This file is not a FlowSynth save.");
    expect(deserialize("[]").error).toBe("This file is not a FlowSynth save.");
    expect(deserialize(v16((st) => { delete st.records.habits; })).error).toBe("The save data is incomplete.");
    expect(deserialize(v16((st) => { st.game.mode = "weird"; })).error).toMatch(/unknown session mode/);
  });
});

// The board is an additive v16 field (issue #24): SAVE_VERSION stays 16.
describe("the board in a v16 save", () => {
  it("round-trips the owned cells and the arc", () => {
    const s = flowing();
    s.game.board.open.push({ q: -1, r: 1 }, { q: 0, r: 3 });
    s.game.board.arc = "demo";
    const loaded = deserialize(serialize(s, 1_000));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state).toEqual(s);
    expect(loaded.state!.game.board).toEqual({ open: [...fresh().game.board.open, { q: -1, r: 1 }, { q: 0, r: 3 }], arc: "demo", placements: [], cables: [], walls: [] });
  });

  it("a v16 save written before the board loads the opening board", () => {
    const loaded = deserialize(v16((st) => { delete st.game.board; }));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state).toEqual(flowing());
    expect(loaded.state!.game.board).toEqual(fresh().game.board);
  });

  it("an unreadable board loads the opening board rather than an invented one", () => {
    for (const bad of [null, "board", { open: "x", arc: "sketch" }, { open: [{ q: 0 }], arc: "sketch" }, { open: [], arc: "sketch" }]) {
      const loaded = deserialize(v16((st) => { st.game.board = bad; }));
      expect(loaded.state!.game.board, JSON.stringify(bad)).toEqual(fresh().game.board);
    }
    const unknownArc = deserialize(v16((st) => { (st.game.board as { arc: string }).arc = "bootleg"; }));
    expect(unknownArc.state!.game.board.arc).toBe("sketch");
  });
});

// Placements (issue #25) are additive v16 fields too. The allowance and
// arrived types derive from class credit (issue #38): never written, and
// ignored on read.
describe("placements in a v16 save", () => {
  function laidOut() {
    const s = fresh();
    giveOscillators(s, { allowance: 3, arrive: ["square"] });
    applyIn(s, { type: "placeModule", module: "triangle", cell: { q: 1, r: 0 } });
    applyIn(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } });
    applyIn(s, { type: "placeModule", module: "square", cell: { q: 1, r: -1 } });
    return s;
  }

  function saved(mutate: (game: Record<string, unknown> & { board: { placements: unknown[] } }) => void): string {
    const file = JSON.parse(serialize(laidOut(), 1_000));
    mutate(file.state.game);
    return JSON.stringify(file);
  }

  it("round-trips the layout exactly, with the allowance and arrived types derived from class credit", () => {
    const s = laidOut();
    const loaded = deserialize(serialize(s, 1_000));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state).toEqual(s);
    expect(loaded.state!.game.board.placements).toEqual([
      { cell: { q: 1, r: 0 }, module: "triangle" },
      { cell: { q: 0, r: 0 }, module: "sine" },
      { cell: { q: 1, r: -1 }, module: "square" },
    ]);
    // Engineer Lv 2 (1.5 h): 3 oscillators and the Square.
    expect(grantsOf(loaded.state!).allowance).toEqual({ oscillator: 3, modulator: 1, arm: 0 });
    expect(grantsOf(loaded.state!).arrived).toEqual(["sine", "triangle", "flywheel", "square"]);
  });

  it("writes none of the old allowance or arrived fields", () => {
    const game = JSON.parse(serialize(laidOut(), 1_000)).state.game;
    for (const field of ["allowance", "arrived", "cableAllowance", "arrivedCables"]) expect(game).not.toHaveProperty(field);
  });

  it("a v16 save written before placements loads an empty board", () => {
    const loaded = deserialize(saved((game) => {
      delete (game.board as Record<string, unknown>).placements;
    }));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state!.game.board.placements).toEqual([]);
  });

  it("returns a placement with an unknown type, or off an owned open cell, to unplaced", () => {
    const loaded = deserialize(saved((game) => {
      game.board.placements.push(
        { cell: { q: 0, r: 1 }, module: "kazoo" },
        { cell: { q: -1, r: 1 }, module: "sine" },
        { cell: { q: 4, r: 0 }, module: "sine" },
        { cell: { q: 0, r: 0 }, module: "triangle" },
        { cell: { q: 0 }, module: "sine" },
        "sine",
      );
    }));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state).toEqual(laidOut());
  });

  it("a chunk-03 save's allowance and arrived fields are ignored: allowance derives from its class credit", () => {
    for (const mutate of [
      (game: Record<string, unknown>) => {
        game.allowance = { oscillator: 9, modulator: 9 };
        game.arrived = ["sine", "triangle", "flywheel", "saw", "release"];
        game.cableAllowance = 9;
        game.arrivedCables = ["patch"];
      },
      (game: Record<string, unknown>) => {
        game.allowance = { oscillator: -1, modulator: 1.5 };
        game.arrived = ["sine", "kazoo", "sine"];
      },
    ]) {
      const loaded = deserialize(saved(mutate));
      expect(loaded.error).toBeUndefined();
      expect(loaded.state).toEqual(laidOut());
      expect(grantsOf(loaded.state!)).toEqual({
        allowance: { oscillator: 3, modulator: 1, arm: 0 },
        cableAllowance: 1,
        arrived: ["sine", "triangle", "flywheel", "square"],
        arrivedCables: ["patch"],
      });
    }
  });
});

describe("v16 lost-money recovery (ADR-0082)", () => {
  it("an unreadable nous refuses ordinary loading with the path named", () => {
    for (const bad of [null, "NaN", "banana", {}]) {
      const text = v16((st) => { st.game.nous = bad; });
      const loaded = deserialize(text);
      expect(loaded.state, String(bad)).toBeUndefined();
      expect(loaded.recoveryRequired).toBe(true);
      expect(loaded.lost).toEqual(["game.nous"]);
      expect(loaded.error).toMatch(/explicit recovery/);
    }
  });

  it("the recovery starts lost figures at zero, keeps the records and reports exactly what it repaired", () => {
    const text = v16((st) => {
      st.game.nous = null;
      (st.game.session as { accounting: Record<string, unknown> }).accounting.provisionalNous = null;
    });
    const loaded = recoverLostSave(text);
    expect(loaded.error).toBeUndefined();
    expect(loaded.recovered).toEqual({ fromVersion: 16, lost: ["game.nous", "game.session.accounting.provisionalNous"] });
    const expected = flowing();
    expected.game.session!.accounting.provisionalNous = D(0);
    expect(loaded.state).toEqual(expected);
    // The recovered state writes clean: no re-recovery.
    const reloaded = deserialize(serialize(loaded.state!, 2_000));
    expect(reloaded.recovered).toBeUndefined();
    expect(reloaded.state).toEqual(loaded.state);
  });

  it("a v16 session without accounting fails recovery without inventing practice", () => {
    const text = v16((st) => { delete (st.game.session as Record<string, unknown>).accounting; });
    expect(deserialize(text).lost).toContain("game.session.accounting");
    const recovered = recoverLostSave(text);
    expect(recovered.state).toBeUndefined();
    expect(recovered.error).toContain("practice accounting");
  });

  it("clean bytes read through the recovery door exactly as an ordinary load", () => {
    const text = serialize(flowing(), 1_000);
    expect(recoverLostSave(text)).toEqual(deserialize(text));
  });
});

// Facings (spec chunk 03, issue #31) are additive v16 fields: a placement
// gains an optional facing, the allowance a Modulator count, and the
// arrived types the Flywheel.
describe("facings in a v16 save", () => {
  function aimed() {
    const s = fresh();
    applyIn(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 0 } });
    applyIn(s, { type: "rotateModule", cell: { q: 0, r: 0 }, turn: "counterclockwise" });
    applyIn(s, { type: "placeModule", module: "sine", cell: { q: 1, r: 0 } });
    return s;
  }

  function saved(mutate: (game: Record<string, unknown> & { board: { placements: Record<string, unknown>[] } }) => void): string {
    const file = JSON.parse(serialize(aimed(), 1_000));
    mutate(file.state.game);
    return JSON.stringify(file);
  }

  it("round-trips the facing exactly", () => {
    const s = aimed();
    const loaded = deserialize(serialize(s, 1_000));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state).toEqual(s);
    expect(loaded.state!.game.board.placements).toEqual([
      { cell: { q: 0, r: 0 }, module: "flywheel", facing: 5 },
      { cell: { q: 1, r: 0 }, module: "sine" },
    ]);
  });

  it("loads a missing or invalid facing as NE, and drops a facing from a module without one", () => {
    for (const bad of [undefined, 6, -1, 2.5, "N", null]) {
      const loaded = deserialize(saved((game) => {
        if (bad === undefined) delete game.board.placements[0]!.facing;
        else game.board.placements[0]!.facing = bad;
        game.board.placements[1]!.facing = 3;
      }));
      expect(loaded.error, String(bad)).toBeUndefined();
      expect(loaded.state!.game.board.placements, String(bad)).toEqual([
        { cell: { q: 0, r: 0 }, module: "flywheel", facing: 0 },
        { cell: { q: 1, r: 0 }, module: "sine" },
      ]);
    }
  });

  it("a chunk-02 save loads with the Flywheel arrived and unplaced, and one Modulator allowance", () => {
    const loaded = deserialize(saved((game) => {
      game.board.placements = [{ cell: { q: 1, r: 0 }, module: "sine" }];
      game.allowance = { oscillator: 2 };
      game.arrived = ["sine", "triangle"];
    }));
    expect(loaded.error).toBeUndefined();
    expect(loaded.state!.game.board.placements).toEqual([{ cell: { q: 1, r: 0 }, module: "sine" }]);
    expect(grantsOf(loaded.state!).allowance.modulator).toBe(1);
    expect(grantsOf(loaded.state!).arrived).toContain("flywheel");
  });
});
