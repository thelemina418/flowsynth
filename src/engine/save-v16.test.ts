import { describe, expect, it } from "vitest";
import { D, pow } from "./num";
import { applyIn, advanceIn, fresh, giveHabit } from "./fixtures";
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
  applyIn(s, { type: "startSession", target: 600, now: 1_000 });
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
    expect(() => serialize(s)).toThrow(SaveRefusedError);
    expect(() => serialize(s)).toThrow(/game\.nous/);
  });

  it("refuses a save from a newer build", () => {
    const text = serialize(fresh()).replace(`"version": 16`, `"version": 17`);
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
