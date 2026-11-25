import { expect, it } from "vitest";
import { buyHoneRank, endSession, pauseSession, placeWorldOccupant, prestige, resumeSession, setWorldConduitDirection, startSession } from "./actions";
import { advance } from "./advance";
import { hex } from "./hex";
import { writeNote } from "./notes";
import { deserialize, serialize } from "./save";
import { createInitialState, createWeapon } from "./state";
import { scenarioOf } from "./scenarios";
import { applyGap, flushPendingAway, resolveHonestyReport } from "./trust";
import type { GameState, WeaponType } from "./types";

const reload = (state: GameState) => deserialize(serialize(state, 0)).state!;
const tick = (state: GameState, seconds: number) => expect(advance(state, seconds, () => 0.3).fault).toBeUndefined();

function openingFight(): GameState {
  const state = createInitialState();
  state.eraEarned = 20_000_000;
  expect(prestige(state).ok).toBe(true);
  state.eraEarned = 20_000_000;
  const ready = reload(state);
  expect(placeWorldOccupant(ready, ready.world.creatures[0]!.id, hex(0, 0)).ok).toBe(true);
  return ready;
}

function equip(state: GameState, type: WeaponType, store: number) {
  // Controlled input: the equipment and its reserve at the start of a duel.
  const weapon = createWeapon(state, type);
  state.world.weapons.push(weapon);
  weapon.store = store;
  expect(placeWorldOccupant(state, weapon.id, hex(1, 0)).ok).toBe(true);
  expect(startSession(state, null).ok).toBe(true);
  return weapon;
}

it("Striker strikes unfed on its own cadence and spends only a discrete charge payment when funded", () => {
  for (const [banked, after, damage] of [[0, 0, 5], [1 - Number.EPSILON, 1 - Number.EPSILON, 5], [1, 0, 8], [20, 19, 8]] as const) {
    const state = openingFight();
    const weapon = equip(state, "striker", banked);
    tick(state, 3.99);
    expect(state.world.enemies.shale!.hp).toBe(48);
    expect(weapon.store).toBe(banked);
    tick(state, 0.01);
    expect(state.world.enemies.shale!.hp).toBe(48 - damage);
    expect(weapon.store).toBe(after);
    expect(endSession(state).ok).toBe(true);
    expect(reload(state).world.weapons.find(({ id }) => id === weapon.id)).toMatchObject({ type: "striker", store: after, bearer: state.world.creatures[0]!.id });
  }
});

it.each([
  ["chargeBlade", 1, 10, 0.1, 5, 4, 0],
  ["striker", 1, 10, 0.1, 4, 8, 5],
  ["maul", 2, 400, 0.005, 8, 24, 12],
] as const)(
  "funds %s on the same beat after whole or fine spans, including reload; refuses genuine shortfall",
  (type, cost, steps, dt, cadence, powered, unfed) => {
  const state = scenarioOf("world-combat")!.build(0);
    const weapon = createWeapon(state, type);
    state.world.weapons.push(weapon);
    for (const [id, q, r] of [[state.world.creatures[0]!.id, 0, 0], [state.world.columns[0]!.id, 1, 1], [weapon.id, 0, 1]] as const) {
      expect(placeWorldOccupant(state, id, hex(q, r)).ok).toBe(true);
    }
    // The Column lifts 1/s; the carried beat is one cost away.
    weapon.cooldown = cadence - cost;
    expect(startSession(state, null).ok).toBe(true);
    const single = structuredClone(state);
    const short = structuredClone(state);
    const shortReserve = cost - 5e-10;
    short.modules.find(m => m.type === "focusKeyed")!.reserve = shortReserve;
    tick(single, cost);
    tick(short, cost);
    const store = (s: GameState) => s.world.weapons.find(w => w.id === weapon.id)!.store;
    const hp = (s: GameState) => s.world.enemies.shale!.hp;
    expect([hp(single), store(single)]).toEqual([48 - powered, 0]);
    let reloaded = structuredClone(state);
    for (let i = 0; i < steps; i++) {
      tick(state, dt);
      tick(reloaded, dt);
      if (i === steps / 2 - 1) reloaded = reload(reloaded);
    }
    expect(hp(state)).toBe(48 - powered);
    expect(hp(reloaded)).toBe(48 - powered);
    expect(store(state)).toBeCloseTo(0, 14);
    expect(store(reloaded)).toBeCloseTo(0, 14);
    // The generator empties genuinely short, even below the generic EPS.
    expect(hp(short)).toBeCloseTo(48 - unfed, 8);
    expect(store(short)).toBeCloseTo(shortReserve, 14);
  },
);

it.each([0, 1])("spends exactly two generator charge (Flywheel Lv. %i) on Maul's beat across live ticks and reload, but not a short reserve", level => {
  for (const reserve of [2, 2 - Number.EPSILON, 2 - 5e-10]) {
    const state = scenarioOf("world-combat")!.build(0);
    const weapon = createWeapon(state, "maul");
    state.world.weapons.push(weapon);
    for (const [id, q, r] of [[state.world.creatures[0]!.id, 0, 0], [state.world.columns[0]!.id, 1, 1], [weapon.id, 0, 1]] as const) {
      expect(placeWorldOccupant(state, id, hex(q, r)).ok).toBe(true);
    }
    const generator = state.modules.find(m => m.type === "focusKeyed")!;
    generator.reserve = reserve;
    generator.level = level;
    weapon.cooldown = 6; // Maul's eight-second beat is due at t=2 s.
    expect(startSession(state, null).ok).toBe(true);
    for (const partition of ["whole", "ticks", "reload", ...(level === 0 ? ["depletion tail"] : [])]) {
      let run = structuredClone(state);
      if (partition === "whole") tick(run, 2);
      else if (partition === "depletion tail") {
        tick(run, 2 - 2 ** -32);
        expect(run.world.enemies.shale!.hp).toBe(48);
        run = reload(run);
        tick(run, 2 ** -32);
      } else for (let i = 0; i < 20; i++) {
        tick(run, 0.1);
        if (i === 9 && partition === "reload") run = reload(run);
      }
      expect(run.modules.find(m => m.id === generator.id)!.reserve).toBe(0);
      expect(run.world.enemies.shale!.hp, `${reserve}, ${partition}`).toBeCloseTo(reserve === 2 ? 24 : 36, 12);
      const store = run.world.weapons.find(w => w.id === weapon.id)!.store;
      if (reserve === 2) expect(store).toBeCloseTo(0, 25);
      else expect(store).toBe(reserve);
    }
  }
});

it("delivers the unused generator reserve plus note and session-end credits once after reload", () => {
  const state = scenarioOf("world-combat")!.build(0);
  const generator = state.modules.find(m => m.type === "focusKeyed")!;
  generator.reserve = 1;
  expect(placeWorldOccupant(state, state.world.weapons[0]!.id, hex(0, 1)).ok).toBe(true);
  expect(placeWorldOccupant(state, state.world.columns[0]!.id, hex(1, 1)).ok).toBe(true);
  expect(startSession(state, null).ok).toBe(true);
  tick(state, 0.1);
  expect(endSession(state).ok).toBe(true); // 0.01 Flywheel charge from 0.1 credited seconds.
  expect(writeNote(state, "x").ok).toBe(true); // 0.2 more from one character.
  const ready = reload(state);
  expect(startSession(ready, null).ok).toBe(true);
  tick(ready, 2);
  expect(ready.modules.find(m => m.id === generator.id)!.reserve).toBe(0);
  expect(ready.world.weapons[0]!.store).toBe(1.21);
  tick(ready, 2);
  expect(ready.world.weapons[0]!.store).toBe(1.21);
});

it("retains individually sub-ulp charge deliveries across a save and reload", () => {
  const state = scenarioOf("world-combat")!.build(0);
  const [weapon] = state.world.weapons;
  weapon!.store = 2;
  expect(placeWorldOccupant(state, weapon!.id, hex(0, 1)).ok).toBe(true);
  expect(placeWorldOccupant(state, state.world.columns[0]!.id, hex(1, 1)).ok).toBe(true);
  expect(startSession(state, null).ok).toBe(true);
  // Lift is 1/s. Four touches of 2^-54 add half an ULP at 2, and
  // still round to 2. Read that save back before the next four.
  for (let i = 0; i < 4; i++) tick(state, 2 ** -54);
  expect(weapon!.store).toBe(2);
  const resumed = reload(state);
  for (let i = 0; i < 4; i++) tick(resumed, 2 ** -54);
  expect(resumed.world.weapons[0]!.store).toBe(2 + 2 ** -51);
});

it("Charge Blade skips an unfed beat, then all copies use the same purchased Hone at the original cadence", () => {
  const state = openingFight();
  const blade = equip(state, "chargeBlade", 0);
  tick(state, 5);
  expect(state.world.enemies.shale!.hp).toBe(48);
  expect(endSession(state).ok).toBe(true);
  expect(buyHoneRank(state, "striker").ok).toBe(false);
  expect(buyHoneRank(state, "chargeBlade").ok).toBe(true);
  blade.store = 1;
  const future = createWeapon(state, "chargeBlade");
  future.store = 1;
  state.world.weapons.push(future);
  expect(placeWorldOccupant(state, future.id, hex(0, 1)).ok).toBe(true);
  const ready = reload(state);
  expect(startSession(ready, null).ok).toBe(true);
  tick(ready, 5);
  // Sentinel's carried beat lands after one second, followed by four
  // seconds of regeneration and the two six-HP Blade hits at second five.
  expect(ready.world.enemies.shale!.hp).toBeCloseTo(34.4);
  expect(ready.world.weapons.map(({ store }) => store)).toEqual([0, 0, 0]);
});

it("resolves two adjacent ordinary copies at their own beats and never spends on a dead target", () => {
  const state = openingFight();
  const first = equip(state, "striker", 1);
  expect(endSession(state).ok).toBe(true);
  const second = createWeapon(state, "striker");
  second.store = 1;
  state.world.weapons.push(second);
  expect(placeWorldOccupant(state, second.id, hex(0, 1)).ok).toBe(true);
  expect(first.bearer).toBe(second.bearer);
  state.world.enemies.shale!.hp = 20;
  expect(startSession(state, null).ok).toBe(true);
  tick(state, 4);
  expect(state.world.enemies.shale!.hp).toBeCloseTo(5.4);
  expect([first.store, second.store]).toEqual([0, 0]);
  expect(endSession(state).ok).toBe(true);
  // A funded first hit finishes this same living wall; the second copy
  // does not pay into an already won duel.
  first.store = second.store = 1;
  expect(startSession(state, null).ok).toBe(true);
  tick(state, 4);
  expect(state.world.enemies.shale!.hp).toBe(0);
  expect([first.store, second.store]).toEqual([0, 1]);
});

it("one Column shares conserved charge across two ordinary weapons without an unbound hit", () => {
  // Fixed routing fixture with one charge per second reaching the Column.
  const state = scenarioOf("world-combat")!.build(0);
  const [column] = state.world.columns;
  const [conduit] = state.world.conduits;
  const striker = createWeapon(state, "striker");
  const maul = createWeapon(state, "maul");
  state.world.weapons.push(striker, maul);
  for (const [id, q, r] of [[column!.id, 1, 1], [conduit!.id, 1, 0], [striker.id, 1, -1], [maul.id, 0, 1]] as const) {
    expect(placeWorldOccupant(state, id, hex(q, r)).ok).toBe(true);
  }
  expect(startSession(state, null).ok).toBe(true);
  tick(state, 8);
  expect([striker.store, maul.store, state.world.enemies.shale!.hp]).toEqual([4, 4, 48]);
  expect(endSession(state).ok).toBe(true);
  expect(setWorldConduitDirection(state, conduit!.id, 5).ok).toBe(true);
  expect(startSession(state, null).ok).toBe(true);
  tick(state, 8);
  expect([striker.store, maul.store]).toEqual([4, 12]);
});

it("does not advance an ordinary weapon on paused or provisional clocks, even after honesty credit", () => {
  const state = openingFight();
  const striker = equip(state, "striker", 1);
  const rng = () => 0.3;
  tick(state, 3);
  expect(pauseSession(state).ok).toBe(true);
  applyGap(state, 600, "visible", 0, rng);
  expect(resumeSession(state).ok).toBe(true);
  applyGap(state, 600, "away", 0, rng);
  flushPendingAway(state, rng);
  expect(resolveHonestyReport(state, "full", rng).ok).toBe(true);
  expect([striker.store, state.world.enemies.shale!.hp]).toEqual([1, 48]);
  tick(state, 1);
  expect([striker.store, state.world.enemies.shale!.hp]).toEqual([0, 40]);
});
