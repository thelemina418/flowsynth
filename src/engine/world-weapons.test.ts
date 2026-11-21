import { expect, it } from "vitest";
import { buyHoneRank, endSession, placeWorldOccupant, prestige, startSession } from "./actions";
import { advance } from "./advance";
import { hex } from "./hex";
import { deserialize, serialize } from "./save";
import { createInitialState, createWeapon } from "./state";
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
  for (const [banked, after, damage] of [[0, 0, 5], [0.99, 0.99, 5], [1, 0, 8], [20, 19, 8]] as const) {
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
