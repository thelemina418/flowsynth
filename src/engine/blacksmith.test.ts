import { expect, it } from "vitest";
import { endBreather, endSession, pauseSession, prestige, resumeSession, startBreather, startSession } from "./actions";
import { advance, advanceBreather } from "./advance";
import { claimForgedWeapon, selectHabitClass, totalPracticeRollsEarned, weaponChoicesOf } from "./classes";
import { addPracticeLog, createHabit, selectHabit } from "./habits";
import { deserialize, serialize } from "./save";
import { createInitialState } from "./state";
import { applyGap, flushPendingAway, resolveHonestyReport } from "./trust";
import type { GameState } from "./types";

const rng = () => 0.3;
const reload = (s: GameState) => deserialize(serialize(s, 10_000)).state!;
const bank = (s: GameState) => {
  s.eraEarned = 20_000_000; // construct a prestige-eligible checkpoint, not acquisition pacing
  expect(prestige(s).ok).toBe(true);
};
const tick = (s: GameState, seconds: number) => expect(advance(s, seconds, rng).fault).toBeUndefined();
const start = (s: GameState) => expect(startSession(s, null).ok).toBe(true);
const finish = (s: GameState) => expect(endSession(s).ok).toBe(true);

it("opens level-one Blacksmith only at permanent discovery and keeps each selected pair's credited progress across swaps, reload, and prestige", () => {
  let s = createInitialState();
  const piano = createHabit(s, "Piano").habit!.id;
  const drums = createHabit(s, "Drums").habit!.id;
  expect(selectHabitClass(s, piano, "blacksmith").ok).toBe(false);
  s.eraEarned = 20_000_000;
  expect(selectHabitClass(s, piano, "blacksmith").ok).toBe(false);
  bank(s);
  expect(selectHabitClass(s, piano, "blacksmith").ok).toBe(true);
  expect(selectHabitClass(s, drums, "blacksmith").ok).toBe(true);
  expect(s.habits[0]!.classes.blacksmith?.level).toBe(1);
  expect(selectHabit(s, piano).ok).toBe(true);
  start(s); tick(s, 450); finish(s);
  expect(selectHabit(s, drums).ok).toBe(true);
  start(s); tick(s, 50); finish(s);
  expect(selectHabitClass(s, piano, "engineer").ok).toBe(true);
  expect(selectHabit(s, piano).ok).toBe(true);
  start(s); tick(s, 180); finish(s);
  expect(totalPracticeRollsEarned(s)).toBe(1);
  expect(s.bankedRolls).toHaveLength(1);
  s = reload(s);
  bank(s);
  expect(selectHabitClass(s, piano, "blacksmith").ok).toBe(true);
  expect(s.habits.map(h => h.classes.blacksmith?.rollMeter.progress)).toEqual([450, 50]);
  start(s); tick(s, 149.5);
  expect(weaponChoicesOf(s.habits[0]!)).toBe(0);
  tick(s, 0.5);
  expect(weaponChoicesOf(s.habits[0]!)).toBe(1);
  expect(s.mode).toBe("flow");
  expect(s.world.weapons.map(w => w.type)).toEqual(["chargeBlade"]);
  expect(claimForgedWeapon(s, piano, "maul").ok).toBe(false);
  finish(s);
  expect(selectHabitClass(s, piano, "engineer").ok).toBe(true);
  expect(claimForgedWeapon(s, piano, "maul").ok).toBe(false);
  s = reload(s);
  bank(s);
  expect(selectHabitClass(s, piano, "blacksmith").ok).toBe(true);
  expect(weaponChoicesOf(s.habits[0]!)).toBe(1);
  expect(claimForgedWeapon(s, drums, "striker").ok).toBe(false);
  expect(claimForgedWeapon(s, piano, "maul").ok).toBe(true);
  expect(claimForgedWeapon(s, piano, "striker").ok).toBe(false);
  expect(reload(s).world.weapons.map(({ type, pos, store }) => ({ type, pos, store }))).toEqual([
    { type: "chargeBlade", pos: null, store: 0 }, { type: "maul", pos: null, store: 0 },
  ]);
  expect(weaponChoicesOf(reload(s).habits[0]!)).toBe(0);
  expect(totalPracticeRollsEarned(s)).toBe(1);
});

function selectedBlacksmith() {
  const state = createInitialState();
  const habit = createHabit(state, "Practice").habit!;
  bank(state);
  expect(selectHabit(state, habit.id).ok).toBe(true);
  expect(selectHabitClass(state, habit.id, "blacksmith").ok).toBe(true);
  return { state, habit };
}

it("banks only credited time: excludes logs, breathers, pause, backward clocks and provisional time until accepted", () => {
  const { state, habit } = selectedBlacksmith();
  const progress = () => habit.classes.blacksmith!.rollMeter.progress;
  expect(addPracticeLog(state, habit.id, 20).ok).toBe(true);
  expect(selectHabit(state, null).ok).toBe(true);
  start(state); tick(state, 600); finish(state);
  expect(selectHabit(state, habit.id).ok).toBe(true);
  expect(startBreather(state).ok).toBe(true);
  expect(advanceBreather(state, 60, rng).fault).toBeUndefined();
  expect(endBreather(state).ok).toBe(true);
  expect(progress()).toBe(0);
  start(state);
  tick(state, 100);
  expect(pauseSession(state).ok).toBe(true);
  applyGap(state, 600, "visible", 0, rng);
  expect(resumeSession(state).ok).toBe(true);
  applyGap(state, 600, "visible", -600, rng);
  expect(progress()).toBe(100);
  applyGap(state, 900, "away", 0, rng);
  flushPendingAway(state, rng);
  expect(state.session!.accounting.poolSeconds).toBe(900);
  expect(progress()).toBe(100);
  expect(resolveHonestyReport(state, "missed", rng).ok).toBe(true);
  expect(progress()).toBe(100);
  // Dual-clock sleep while visible is away, not ambient earned time.
  applyGap(state, 1205, "visible", 1205, rng);
  expect(state.session!.accounting.poolSeconds).toBe(1205);
  expect(weaponChoicesOf(habit)).toBe(0);
  expect(resolveHonestyReport(state, "full", rng)).toMatchObject({ ok: true, rollsBanked: 0 });
  expect(resolveHonestyReport(state, "full", rng).ok).toBe(false);
  expect(state.session!.accounting.creditedSeconds).toBe(1305);
  expect(weaponChoicesOf(habit)).toBe(2);
  expect(progress()).toBe(105);
  expect(state.bankedRolls).toHaveLength(0);
  finish(state);
  for (const type of ["striker", "striker"] as const) expect(claimForgedWeapon(state, habit.id, type).ok).toBe(true);
  expect(claimForgedWeapon(state, habit.id, "maul").ok).toBe(false);
  expect(new Set(state.world.weapons.map(({ id }) => id)).size).toBe(3);
});

it("trusted away time to plan fills the meter but a planned answer adds no overrun", () => {
  const { state, habit } = selectedBlacksmith();
  expect(startSession(state, 600).ok).toBe(true);
  applyGap(state, 1200, "away", 0, rng);
  flushPendingAway(state, rng);
  expect(state.session!.accounting).toMatchObject({ creditedSeconds: 600, poolSeconds: 600 });
  expect(weaponChoicesOf(habit)).toBe(1);
  expect(resolveHonestyReport(state, "planned", rng).ok).toBe(true);
  expect(weaponChoicesOf(habit)).toBe(1);
  expect(habit.classes.blacksmith!.rollMeter.progress).toBe(0);
});

it("refuses an unrepresentable fill without partial credit or a duplicated choice", () => {
  const { state, habit } = selectedBlacksmith();
  // Construct the representable edge of the persisted count; a carried
  // full claim ledger must not skip an integer when one more fill lands.
  habit.classes.blacksmith!.rollMeter = { earned: Number.MAX_SAFE_INTEGER, progress: 599 };
  habit.classes.blacksmith!.weaponClaims = Number.MAX_SAFE_INTEGER;
  const loaded = reload(state);
  start(loaded);
  const before = structuredClone(loaded);
  expect(advance(loaded, 1, rng).fault).toMatch(/Blacksmith weapon choices/);
  expect(loaded).toEqual(before);
  expect(weaponChoicesOf(loaded.habits[0]!)).toBe(0);
});

it("old discovered saves retain Engineer and allow a fresh Blacksmith without a free choice", () => {
  const state = createInitialState();
  const habit = createHabit(state, "Legacy").habit!;
  bank(state);
  expect(selectHabit(state, habit.id).ok).toBe(true);
  start(state); tick(state, 90); finish(state);
  const old = JSON.parse(serialize(state, 10_000));
  old.version = 14;
  const result = deserialize(JSON.stringify(old));
  const loaded = result.state!;
  const carried = loaded.habits[0]!;
  expect(carried.classId).toBe("engineer");
  expect(carried.classes.engineer.rollMeter.progress).toBe(90);
  expect(carried.classes.blacksmith).toBeUndefined();
  expect(selectHabitClass(loaded, habit.id, "blacksmith").ok).toBe(true);
  expect(weaponChoicesOf(carried)).toBe(0);
  expect(loaded.world.weapons.map(w => w.type)).toEqual(["chargeBlade"]);
});
