import { describe, expect, it } from "vitest";
import { deserialize, recoverLostSave, serialize } from "./save";
import { resolveHonestyReport } from "./trust";

// The lost-money recovery (ADR-0082, issue #494) at the interim boundary
// (issue #15). A v15 save whose monetary figures serialized to null is a
// distinct class: ordinary loading refuses it with the paths named and
// repairs nothing; the explicit recovery loads the real-life records and
// reports what was unreadable. The interim state carries no economy, so
// nothing is reconstructed and nothing is invented.

// A v15 save in the retired build's shape, its money lost to null the way
// the pre-integrity serializer wrote nonfinite figures.
function lostMoneyV15(state: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: "flowsynth",
    version: 15,
    savedAt: 1_000,
    state: {
      mode: "upgrade",
      sessionIndex: 1,
      sessionsCompleted: 1,
      nous: null,
      totalEarned: null,
      eraEarned: 4e14,
      arete: 4,
      modules: [{ id: "m1", type: "additive", level: 1504, invested: null, reserve: null }, { id: "m2", type: "mutatorForge", invested: null }],
      world: { frontier: null, weapons: [{ id: "w1", store: null }] },
      forge: { progress: null },
      habits: [{ id: "h1", name: "Piano", seconds: 7_200, archived: false, color: "vermillion" }],
      activeHabitId: "h1",
      practiceLog: [{ id: "p2", habitId: "h1", seconds: 1_200, source: "live", at: 500 }],
      notes: [{ id: "n3", text: "kept", sessionId: 0, atElapsed: 60, habitId: "h1", at: 600 }],
      goals: [],
      sessionRecords: [],
      session: null,
      summary: null,
      nextId: 4,
      ...state,
    },
  });
}

const LOST = ["nous", "totalEarned", "modules[0].invested", "modules[0].reserve", "world.frontier", "world.weapons[0].store", "forge.progress"];

describe("the lost-money recovery (ADR-0082)", () => {
  it("ordinary loading refuses with the lost paths named and repairs nothing", () => {
    const loaded = deserialize(lostMoneyV15());
    expect(loaded.recoveryRequired).toBe(true);
    expect(loaded.lost).toEqual(LOST);
    expect(loaded.state).toBeUndefined();
    expect(loaded.error).toMatch(/explicit recovery/);
  });

  it("the recovery loads the records and names exactly the figures it could not read", () => {
    const loaded = recoverLostSave(lostMoneyV15());
    expect(loaded.error).toBeUndefined();
    expect(loaded.recovered).toEqual({ fromVersion: 15, lost: LOST });
    const state = loaded.state!;
    expect(state.habits[0]!.seconds).toBe(7_200);
    expect(state.practiceLog).toHaveLength(1);
    expect(state.notes[0]!.text).toBe("kept");
    expect(state).not.toHaveProperty("nous");
  });

  it("the recovered bytes serialize finite and reload clean: no re-recovery", () => {
    const state = recoverLostSave(lostMoneyV15()).state!;
    const reloaded = deserialize(serialize(state, 2_000));
    expect(reloaded.error).toBeUndefined();
    expect(reloaded.recovered).toBeUndefined();
    expect(reloaded.state).toEqual(state);
  });

  it("bytes that need no repair read through the recovery door exactly as an ordinary load", () => {
    const text = lostMoneyV15({ nous: 5, totalEarned: 5, modules: [], world: {}, forge: {} });
    expect(recoverLostSave(text)).toEqual(deserialize(text));
  });

  it("a lost provisional bucket in a mid-flow save recovers without rewriting practice credit", () => {
    const source = lostMoneyV15({
      mode: "flow",
      session: { target: null, elapsed: 900, startedAt: 1, goalSeconds: {}, targetSignaled: false,
        accounting: { creditedSeconds: 300, poolSeconds: 600, bucketNous: null, pendingAwaySeconds: 0, events: [] } },
    });
    expect(deserialize(source).lost).toContain("session.accounting.bucketNous");
    const state = recoverLostSave(source).state!;
    expect(state.mode).toBe("flow");
    expect(state.session!.accounting).toEqual({ creditedSeconds: 300, poolSeconds: 600, pendingAwaySeconds: 0, events: [] });
    // Settling the report credits the minutes, never the retired money.
    expect(resolveHonestyReport(state, "full").ok).toBe(true);
    expect(state.session!.accounting.creditedSeconds).toBe(900);
    expect(state.habits[0]!.seconds).toBe(7_800);
  });

  it("missing session accounting refuses ordinary loading and fails recovery without inventing practice", () => {
    const source = lostMoneyV15({ mode: "flow", session: {} });
    const ordinary = deserialize(source);
    expect(ordinary.recoveryRequired).toBe(true);
    expect(ordinary.lost).toContain("session.accounting");
    const recovered = recoverLostSave(source);
    expect(recovered.error).toContain("practice accounting");
    expect(recovered.state).toBeUndefined();
    expect(recovered.recovered).toBeUndefined();
  });

  it("bytes too incomplete to read fail with the ordinary error before any recovery step", () => {
    const loaded = recoverLostSave(lostMoneyV15({ notes: "gone" }));
    expect(loaded.state).toBeUndefined();
    expect(loaded.error).toBe("The save data is incomplete.");
    expect(loaded.recovered).toBeUndefined();
  });

  it("bytes that are not a save at all fail with the ordinary error, adopting nothing", () => {
    const loaded = recoverLostSave("not a save at all");
    expect(loaded.state).toBeUndefined();
    expect(loaded.error).toBe("The save data is not valid JSON.");
    expect(loaded.recovered).toBeUndefined();
  });
});
