import { EPS, WORLD_ENEMIES } from "./constants";
import { attackPowerOf, WEAPONS } from "./weapons";
import { adjacent } from "./hex";
import { addToSum, gapTo, requireFinite, resetSum } from "./numeric";
import type { GameState, Hex, WeaponCopy, WorldCombatCreature, WorldGear } from "./types";

export const COMBAT = {
  creature: { name: "Sentinel", hp: 24, damage: 3, cadence: 6, regeneration: 2 },
  enemyCadence: 4,
  armor: { name: "Guard Plate", remainingDamage: 0.5 },
  spell: { name: "Pulse", threshold: 6, damage: 11 },
  conduit: { name: "Conduit" },
};

// The old coordinates stay reserved so migration cannot displace an owned
// piece. The scenario uses the same fights, with only their activation
// timetable compressed, and stops at Basalt.
const identities = [
  [0, "shale", "Shale", "◈", 48, 0.20, 6, 0.35],
  [2, "basalt", "Basalt", "⬢", 35, 0.35, 8, 0.40],
  [1, "flint", "Flint", "△", 70, 0.25, 7, 0.55],
  [3, "schist", "Schist", "≋", 110, 0.30, 8, 0.75],
  [4, "gneiss", "Gneiss", "◇", 155, 0.35, 8, 1.25],
  [5, "obsidian", "Obsidian", "◐", 210, 0.40, 9, 2],
  [6, "granite", "Granite", "▧", 1400, 0.45, 9, 15],
  [7, "quartz", "Quartz", "✧", 2200, 0.50, 10, 20],
  [8, "corundum", "Corundum", "✦", 3600, 0.55, 8, 24],
] as const;

export interface CombatWall {
  key: string;
  name: string;
  symbol: string;
  pos: Hex;
  threshold: number;
  maxHp: number;
  pressure: number;
  damage: number;
  regeneration: number;
}

export const COMBAT_WALLS: readonly CombatWall[] = identities.map(
  ([slot, key, name, symbol, maxHp, pressure, damage, regeneration], index) => ({
    key, name, symbol, maxHp, pressure, damage, regeneration,
    pos: WORLD_ENEMIES[slot]!.pos,
    threshold: WORLD_ENEMIES[index]!.threshold,
  }),
);
const proofWalls = COMBAT_WALLS.slice(0, 2).map((wall, index) => ({ ...wall, threshold: [8, 18][index]! }));

export function worldEnemiesOf(state: GameState): readonly CombatWall[] {
  return state.world.proof ? proofWalls : COMBAT_WALLS;
}

export function frontierWallOf(state: GameState): CombatWall | undefined {
  return worldEnemiesOf(state).find((wall) => state.world.enemies[wall.key]!.hp > 0);
}

// The stored activation bit marks the start of a combat span. Production
// can cross a threshold during that span; activation runs after resolving
// the old wall, so the new one never attacks retroactively.
export function activeWallOf(state: GameState): CombatWall | undefined {
  const wall = frontierWallOf(state);
  return wall && state.world.enemies[wall.key]!.discovered ? wall : undefined;
}

export function syncWorldDiscoveries(state: GameState): number {
  const frontier = frontierWallOf(state);
  let activated = 0;
  for (const wall of worldEnemiesOf(state)) {
    const live = state.world.enemies[wall.key]!;
    if (live.hp === 0) continue;
    const current = wall === frontier && state.eraEarned >= wall.threshold;
    if (live.discovered !== current) {
      if (current) activated++;
      live.discovered = current;
    }
  }
  if (activated) resetDuelClocks(state);
  return activated;
}

export function discoverySecondsOf(state: GameState, rate: number): number {
  const wall = frontierWallOf(state);
  return wall && rate > 0 && state.eraEarned < wall.threshold
    ? Math.max(EPS, (wall.threshold - state.eraEarned) / rate)
    : Infinity;
}

export function adjacentBearersOf(state: GameState, gear: WorldGear): WorldCombatCreature[] {
  const pos = gear.pos;
  return pos ? state.world.creatures.filter((creature) => creature.pos && adjacent(creature.pos, pos)) : [];
}

export function bearerOf(state: GameState, gear: WorldGear): WorldCombatCreature | undefined {
  return adjacentBearersOf(state, gear).find((creature) => creature.id === gear.bearer);
}

export function reconcileWorldGear(state: GameState): void {
  const copies: (WorldGear | WeaponCopy)[] = [...state.world.weapons, ...state.world.armor, ...state.world.spells];
  for (const gear of copies) {
    const candidates = adjacentBearersOf(state, gear);
    const next = candidates.length === 1 ? candidates[0]!.id : candidates.some(({ id }) => id === gear.chosenBearer) ? gear.chosenBearer! : null;
    if (next === gear.bearer) continue;
    gear.bearer = next;
    if ("cooldown" in gear) resetSum(gear, "cooldown", 0);
  }
}

export function resetDuelClocks(state: GameState): void {
  resetSum(state.world, "enemyCooldown", 0);
  for (const creature of state.world.creatures) resetSum(creature, "cooldown", 0);
}

function fightersOf(state: GameState, wall: CombatWall): WorldCombatCreature[] {
  return state.world.creatures.filter(({ pos }) => pos && adjacent(pos, wall.pos));
}

function fightOf(state: GameState) {
  const wall = activeWallOf(state);
  if (!wall) return;
  const fighters = new Set(fightersOf(state, wall).map(({ id }) => id));
  if (!fighters.size) return;
  const fighting = (gear: WorldGear): boolean => {
    const bearer = bearerOf(state, gear);
    return Boolean(bearer && fighters.has(bearer.id));
  };
  return {
    wall,
    creatures: state.world.creatures.filter(({ id }) => fighters.has(id)),
    weapons: state.world.weapons.filter(fighting),
    spells: state.world.spells.filter(fighting),
  };
}

export function combatBoundaryOf(state: GameState): number {
  const fight = fightOf(state);
  if (!fight) return Infinity;
  let next = gapTo(state.world, "enemyCooldown", COMBAT.enemyCadence);
  for (const creature of fight.creatures) next = Math.min(next, gapTo(creature, "cooldown", COMBAT.creature.cadence));
  for (const weapon of fight.weapons) next = Math.min(next, gapTo(weapon, "cooldown", WEAPONS[weapon.type].cadence));
  // A carried, fully funded Pulse is ready now. An underfunded one has
  // no combat boundary until World charge actually fills its reserve.
  return fight.spells.some(({ store }) => store >= COMBAT.spell.threshold) ? 0 : next;
}

function heal(target: { hp: number; hpCarry?: number }, amount: number, cap: number): void {
  // Clamp before adding: very long recovery cannot overflow a bounded HP.
  if (amount < gapTo(target, "hp", cap)) addToSum(target, "hp", amount, "World recovery");
  else resetSum(target, "hp", cap);
  if (target.hp >= cap) resetSum(target, "hp", cap);
}

function damage(target: { hp: number; hpCarry?: number }, amount: number): void {
  addToSum(target, "hp", -amount, "World damage");
  if (target.hp <= 0) resetSum(target, "hp", 0);
}

function spend<K extends "store" | "cooldown" | "enemyCooldown">(
  owner: Record<K, number> & Partial<Record<`${K}Carry`, number>>, key: K, amount: number,
): void {
  addToSum(owner, key, -amount, "World action payment");
  if (owner[key] <= 0) resetSum(owner, key, 0);
}

// Attacks resolve before a simultaneous return hit. The wall hits the
// first adjacent creature in collection order until it falls; other
// creatures and their own gear continue to act independently.
export function advanceCombat(state: GameState, seconds: number): void {
  const { world } = state;
  world.elapsed = requireFinite(world.elapsed + seconds, "the World clock");
  for (const creature of world.creatures) {
    if (creature.pos || creature.hp === COMBAT.creature.hp) continue;
    heal(creature, COMBAT.creature.regeneration * seconds, COMBAT.creature.hp);
    if (creature.hp === COMBAT.creature.hp) creature.recovering = false;
  }
  for (const wall of worldEnemiesOf(state)) {
    const live = world.enemies[wall.key]!;
    if (live.hp > 0 && live.hp < wall.maxHp) heal(live, wall.regeneration * seconds, wall.maxHp);
  }
  const fight = fightOf(state);
  if (!fight) return;
  const live = world.enemies[fight.wall.key]!;
  addToSum(world, "enemyCooldown", seconds, "World enemy cadence");
  for (const creature of fight.creatures) {
    addToSum(creature, "cooldown", seconds, "World creature cadence");
    if (creature.cooldown < COMBAT.creature.cadence) continue;
    spend(creature, "cooldown", COMBAT.creature.cadence);
    damage(live, COMBAT.creature.damage);
  }
  for (const weapon of fight.weapons) {
    const { cadence, chargeCost, unfedDamage } = WEAPONS[weapon.type];
    addToSum(weapon, "cooldown", seconds, "World weapon cadence");
    if (weapon.cooldown < cadence) continue;
    spend(weapon, "cooldown", cadence);
    if (live.hp <= EPS) continue;
    // Compare at the hit, not at fill. A reserve buys exactly one authored
    // effect; neither extra charge nor an unbound copy changes the hit.
    const powered = weapon.store >= chargeCost;
    if (powered) spend(weapon, "store", chargeCost);
    damage(live, powered ? attackPowerOf(state, weapon.type) : unfedDamage);
  }
  for (const spell of fight.spells) {
    if (live.hp <= EPS || spell.store < COMBAT.spell.threshold) continue;
    resetSum(spell, "store", 0);
    damage(live, COMBAT.spell.damage);
  }
  if (live.hp <= EPS) {
    resetSum(live, "hp", 0);
    resetDuelClocks(state);
    return;
  }
  if (world.enemyCooldown < COMBAT.enemyCadence) return;
  spend(world, "enemyCooldown", COMBAT.enemyCadence);
  const target = fight.creatures[0]!;
  const armorCount = world.armor.filter((armor) => bearerOf(state, armor)?.id === target.id).length;
  const hit = fight.wall.damage * COMBAT.armor.remainingDamage ** armorCount;
  damage(target, hit);
  if (target.hp === 0) {
    target.pos = null;
    target.recovering = true;
    resetSum(target, "cooldown", 0);
  }
}
