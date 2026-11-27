import { describe, expect, it } from "vitest";
import { RECONCILIATION_FLOOR_SECONDS } from "./constants";
import { applyIn, advanceIn, fresh, giveHabit } from "./fixtures";
import { D, eq } from "./num";
import { cloneState } from "./state";
import type { GameState } from "./types";

// The GameState seam (spec chunk 01, issue #17): `apply` is the only way
// state changes, `advance` the only way time passes.

function flowing(): GameState {
  const s = fresh();
  giveHabit(s, "Piano", "engineer");
  applyIn(s, { type: "startSession", target: 1_500, now: 1_000 });
  advanceIn(s, 600, "flow");
  return s;
}

describe("a fresh state", () => {
  it("starts between sessions with no nous, no legacy line and two open classes", () => {
    const s = fresh();
    expect(s.game.mode).toBe("upgrade");
    expect(eq(s.game.nous, 0)).toBe(true);
    expect(s.game.legacyLine).toBeNull();
    expect(s.game.openClasses).toEqual(["engineer", "producer"]);
    expect(s.records.classCredit).toEqual({ engineer: 0, producer: 0, mixer: 0, roadie: 0 });
  });
});

describe("advance in upgrade mode freezes the game", () => {
  it("leaves the game state deep-equal from a state with nous and a session in progress", () => {
    const s = flowing();
    s.game.nous = D("1.5e400");
    s.game.session!.accounting.provisionalNous = D(42);
    const before = cloneState(s);
    advanceIn(s, 3600, "upgrade");
    expect(s.game).toEqual(before.game);
    expect(s).toEqual(before);
  });

  it("breather time is reserved: it moves nothing yet", () => {
    const s = flowing();
    const before = cloneState(s);
    advanceIn(s, 3600, "breather");
    expect(s).toEqual(before);
  });
});

describe("flow time", () => {
  it("accrues session accounting, the active habit's credited time and its class credit", () => {
    const s = flowing();
    expect(s.game.session!.elapsed).toBe(600);
    expect(s.game.session!.accounting.creditedSeconds).toBe(600);
    expect(s.records.habits[0]!.seconds).toBe(600);
    expect(s.records.classCredit.engineer).toBe(600);
  });

  it("a habit awaiting its class accrues credited time but no class credit", () => {
    const s = fresh();
    giveHabit(s);
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 300, "flow");
    expect(s.records.habits[0]!.seconds).toBe(300);
    expect(s.records.classCredit).toEqual({ engineer: 0, producer: 0, mixer: 0, roadie: 0 });
  });

  it("settled provisional time is credited flow time, so it reaches the class", () => {
    const s = flowing();
    advanceIn(s, 900, "flow");
    advanceIn(s, RECONCILIATION_FLOOR_SECONDS * 2, "flow", "away");
    advanceIn(s, 0, "flow");
    expect(s.game.session!.accounting.poolSeconds).toBeGreaterThan(0);
    expect(applyIn(s, { type: "settleHonestyReport", outcome: "full" }).ok).toBe(true);
    expect(s.records.classCredit.engineer).toBe(1_500 + RECONCILIATION_FLOOR_SECONDS * 2);
  });
});

describe("manual practice logs", () => {
  it("add credited time to the habit and never add class credit", () => {
    const s = fresh();
    const { habit } = giveHabit(s, "Piano", "producer");
    expect(applyIn(s, { type: "logPractice", habitId: habit.id, minutes: 30, now: 0 }).ok).toBe(true);
    expect(s.records.habits[0]!.seconds).toBe(1_800);
    expect(s.records.classCredit.producer).toBe(0);
  });
});

describe("the provisional nous", () => {
  function owing(): GameState {
    const s = flowing();
    advanceIn(s, 900, "flow");
    advanceIn(s, RECONCILIATION_FLOOR_SECONDS * 2, "flow", "away");
    advanceIn(s, 0, "flow");
    s.game.nous = D(10);
    s.game.session!.accounting.provisionalNous = D(5);
    return s;
  }

  it("is held aside, then banked into nous when the report credits the time", () => {
    const s = owing();
    expect(applyIn(s, { type: "settleHonestyReport", outcome: "planned" }).ok).toBe(true);
    expect(eq(s.game.nous, 15)).toBe(true);
    expect(eq(s.game.session!.accounting.provisionalNous, 0)).toBe(true);
  });

  it("is dropped when the report says the time wasn't practice", () => {
    const s = owing();
    expect(applyIn(s, { type: "settleHonestyReport", outcome: "missed" }).ok).toBe(true);
    expect(eq(s.game.nous, 10)).toBe(true);
    expect(eq(s.game.session!.accounting.provisionalNous, 0)).toBe(true);
  });

  it("a NaN figure refuses the settlement and leaves the state unchanged", () => {
    const s = owing();
    s.game.session!.accounting.provisionalNous = D(Number.NaN);
    const before = cloneState(s);
    const result = applyIn(s, { type: "settleHonestyReport", outcome: "full" });
    expect(result.ok).toBe(false);
    expect(s).toEqual(before);
  });
});

describe("choosing a habit's class", () => {
  function withLog(): { s: GameState; id: string } {
    const s = fresh();
    const { habit } = giveHabit(s);
    applyIn(s, { type: "startSession", target: null, now: 0 });
    advanceIn(s, 1_200, "flow");
    applyIn(s, { type: "endSession", now: 1_200_000 });
    applyIn(s, { type: "logPractice", habitId: habit.id, minutes: 10, now: 1_300_000 });
    return { s, id: habit.id };
  }

  it("credits only the habit's live credited flow seconds to the chosen class", () => {
    const { s, id } = withLog();
    expect(applyIn(s, { type: "chooseClass", habitId: id, habitClass: "producer" }).ok).toBe(true);
    expect(s.records.habits[0]!.habitClass).toBe("producer");
    expect(s.records.classCredit.producer).toBe(1_200);
  });

  it("refuses a class that isn't open, leaving the habit awaiting", () => {
    const { s, id } = withLog();
    const before = cloneState(s);
    expect(applyIn(s, { type: "chooseClass", habitId: id, habitClass: "mixer" })).toMatchObject({ ok: false });
    expect(s).toEqual(before);
  });

  it("can't be repeated", () => {
    const { s, id } = withLog();
    applyIn(s, { type: "chooseClass", habitId: id, habitClass: "engineer" });
    const before = cloneState(s);
    expect(applyIn(s, { type: "chooseClass", habitId: id, habitClass: "producer" })).toMatchObject({ ok: false });
    expect(s).toEqual(before);
  });

  it("a habit created with an open class is attuned from the start; a closed one is refused", () => {
    const s = fresh();
    expect(applyIn(s, { type: "createHabit", name: "Drums", habitClass: "roadie" })).toMatchObject({ ok: false });
    const made = applyIn(s, { type: "createHabit", name: "Drums", habitClass: "engineer" });
    expect(made.ok).toBe(true);
    expect(s.records.habits).toEqual([expect.objectContaining({ id: made.id, name: "Drums", habitClass: "engineer" })]);
  });
});

describe("the target signal", () => {
  it("is marked once per planned session and persists", () => {
    const s = flowing();
    expect(applyIn(s, { type: "signalTarget" }).ok).toBe(true);
    expect(s.game.session!.targetSignaled).toBe(true);
    expect(applyIn(s, { type: "signalTarget" }).ok).toBe(false);
  });
});

describe("refusals leave the state unchanged", () => {
  it("an invalid action returns a refusal with a reason", () => {
    const s = flowing();
    const before = cloneState(s);
    const result = applyIn(s, { type: "renameHabit", id: s.records.habits[0]!.id, name: "Cello" });
    expect(result).toMatchObject({ ok: false, reason: "Habits are managed between sessions." });
    expect(s).toEqual(before);
  });
});
