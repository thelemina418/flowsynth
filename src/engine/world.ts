// Shared World reads for placement, production, time advance and UI.
import { BALANCE, EPS } from "./constants";
import { hexKey, neighbors, sameHex } from "./hex";
import { requireFinite } from "./numeric";
import type { GameState, Hex, RateSnapshot, WeaponCopy, WeaponType, WorldColumn, WorldCombatCreature, WorldConduit, WorldEnemyState, WorldGear, WorldSpell } from "./types";
import { activeWallOf, advanceCombat, combatBoundaryOf, COMBAT, discoverySecondsOf, worldEnemiesOf } from "./world-combat";
export { activeWallOf, discoverySecondsOf, syncWorldDiscoveries, worldEnemiesOf } from "./world-combat";

export function worldEnemyAt(state: GameState, pos: Hex) {
  return worldEnemiesOf(state).find((def) => sameHex(def.pos, pos));
}

export function worldCellReserved(state: GameState, pos: Hex): boolean {
  const def = worldEnemyAt(state, pos);
  return Boolean(def && !enemyDefeated(state, def.key));
}

export type WorldPiece =
  | { kind: "column"; copy: WorldColumn }
  | { kind: "armor"; copy: WorldGear }
  | { kind: "weapon"; copy: WeaponCopy }
  | { kind: "creature"; copy: WorldCombatCreature }
  | { kind: "conduit"; copy: WorldConduit }
  | { kind: "spell"; copy: WorldSpell };

export function worldPiecesOf(state: GameState): WorldPiece[] {
  const { columns, weapons, creatures, armor, spells, conduits } = state.world;
  return [
    ...columns.map((copy) => ({ kind: "column" as const, copy })),
    ...weapons.map((copy) => ({ kind: "weapon" as const, copy })),
    ...creatures.map((copy) => ({ kind: "creature" as const, copy })),
    ...armor.map((copy) => ({ kind: "armor" as const, copy })),
    ...spells.map((copy) => ({ kind: "spell" as const, copy })),
    ...conduits.map((copy) => ({ kind: "conduit" as const, copy })),
  ];
}

export function worldPieceOf(state: GameState, id: string): WorldPiece | undefined {
  return worldPiecesOf(state).find(({ copy }) => copy.id === id);
}

export function worldOccupantAt(state: GameState, pos: Hex): { kind: WorldPiece["kind"]; id: string } | undefined {
  const piece = worldPiecesOf(state).find(({ copy }) => copy.pos !== null && sameHex(copy.pos, pos));
  return piece && { kind: piece.kind, id: piece.copy.id };
}

export function enemyStateOf(state: GameState, key: string): WorldEnemyState {
  return state.world.enemies[key]!;
}

export function enemyDefeated(state: GameState, key: string): boolean {
  return enemyStateOf(state, key).hp === 0;
}

export function hasActiveWorldEnemy(state: GameState): boolean {
  return !!activeWallOf(state);
}

export function enemyPenaltyOf(state: GameState, key: string): number {
  const wall = activeWallOf(state);
  return wall?.key === key ? wall.pressure : 0;
}

export function worldFactorOf(state: GameState): number {
  return 1 - (activeWallOf(state)?.pressure ?? 0);
}

export function worldBoundarySeconds(state: GameState, rate: number, snapshot: Pick<RateSnapshot, "chargeStrength">): number {
  const threshold = discoverySecondsOf(state, rate);
  const combat = combatBoundaryOf(state);
  if (combat === Infinity || !state.world.spells.some(({ pos }) => pos !== null)) return Math.min(threshold, combat);
  const lift = columnLiftsOf(state, snapshot, undefined, true);
  if (!lift.bySpell.size) return Math.min(threshold, combat);
  const next = nextStoreFill(worldChargeStores(state), lift);
  return Math.min(threshold, combatBoundaryOf(state, lift.bySpell), Math.max(EPS, next));
}

export function honePowerAt(rank: number): number {
  return COMBAT.bladePower[rank] ?? COMBAT.bladePower[0];
}

export function attackPowerOf(state: GameState, type: WeaponType): number {
  return honePowerAt(state.world.hone[type]);
}

// Kept for historical balance tooling. The live purchase is retired.
export function columnCost(owned: number): number {
  if (owned < 0) throw new Error("owned must be non-negative");
  return BALANCE.world.columnFirstPrice * BALANCE.world.columnPriceGrowth ** owned;
}

export function honeCostOf(state: GameState, type: WeaponType): number | null {
  return BALANCE.world.honeCosts[state.world.hone[type]] ?? null;
}

export function advanceWorldCombat(state: GameState, spanSeconds: number): void {
  advanceCombat(state, spanSeconds, attackPowerOf(state, "chargeBlade"));
}

export interface WorldLift {
  byColumn: Map<string, number>;
  byWeapon: Map<string, number>;
  bySpell: Map<string, number>;
}

type WorldMove = { id: string; pos: Hex | null };
type ChargeStore = { copy: WorldColumn & { store: number }; cap: number; kind: "weapon" | "spell" };

function worldChargeStores(state: GameState): ChargeStore[] {
  return [
    ...state.world.weapons.map((copy) => ({ copy, cap: BALANCE.world.storageCap, kind: "weapon" as const })),
    ...state.world.spells.map((copy) => ({ copy, cap: COMBAT.spell.threshold, kind: "spell" as const })),
  ];
}

function worldLiftRoutes(state: GameState, snapshot: Pick<RateSnapshot, "chargeStrength">, override?: WorldMove) {
  const positionOf = (copy: WorldColumn): Hex | null => override?.id === copy.id ? override.pos : copy.pos;
  const conduits = new Map(state.world.conduits.flatMap((copy) => {
    const p = positionOf(copy);
    return p ? [[hexKey(p), copy] as const] : [];
  }));
  const stores = worldChargeStores(state);
  const storesAt = new Map(stores.flatMap((entry) => {
    const pos = positionOf(entry.copy);
    return pos ? [[hexKey(pos), entry] as const] : [];
  }));
  return state.world.columns.flatMap((column) => {
    const pos = positionOf(column);
    if (!pos) return [];
    const module = state.modules.find((m) => m.pos !== null && sameHex(m.pos, pos));
    const supply = module ? snapshot.chargeStrength.get(module.id) ?? 0 : 0;
    if (supply <= 0) return [];
    const visited = new Set<string>();
    const consumers: ChargeStore[] = [];
    // A conduit only forwards along its selected edge. Traversing each
    // position once prevents loops and direct + indirect paths from
    // counting the same terminal twice for this Column.
    for (let next of neighbors(pos)) {
      while (!visited.has(hexKey(next))) {
        const key = hexKey(next);
        visited.add(key);
        const store = storesAt.get(key);
        if (store) consumers.push(store);
        const conduit = conduits.get(key);
        if (!conduit) break;
        next = neighbors(next)[conduit.direction]!;
      }
    }
    return [{ column, supply, consumers }];
  });
}

type LiftRoutes = ReturnType<typeof worldLiftRoutes>;
function liftRates(routes: LiftRoutes, bounded: boolean): WorldLift {
  const lift: WorldLift = { byColumn: new Map(), byWeapon: new Map(), bySpell: new Map() };
  for (const { column, supply, consumers } of routes) {
    lift.byColumn.set(column.id, supply);
    const open = consumers.filter(({ copy, cap }) => !bounded || copy.store < cap);
    for (const { copy, kind } of open) {
      const rates = kind === "weapon" ? lift.byWeapon : lift.bySpell;
      rates.set(copy.id, requireFinite((rates.get(copy.id) ?? 0) + supply / open.length, "World charge per second"));
    }
  }
  return lift;
}

export function columnLiftsOf(
  state: GameState,
  snapshot: Pick<RateSnapshot, "chargeStrength">,
  override?: WorldMove,
  bounded = false,
): WorldLift {
  return liftRates(worldLiftRoutes(state, snapshot, override), bounded);
}

function rateFor(store: ChargeStore, lift: WorldLift): number {
  return (store.kind === "weapon" ? lift.byWeapon : lift.bySpell).get(store.copy.id) ?? 0;
}

function nextStoreFill(stores: readonly ChargeStore[], lift: WorldLift): number {
  let next = Infinity;
  for (const store of stores) {
    const rate = rateFor(store, lift);
    if (rate > 0) next = Math.min(next, (store.cap - store.copy.store) / rate);
  }
  return next;
}

// Integrate all Columns simultaneously so a shared full reserve releases
// exactly its left-over share. This also runs on provisional spans; only
// the damage and recovery leg is gated by trusted World time.
export function advanceWorldCharge(state: GameState, snapshot: RateSnapshot, spanSeconds: number): void {
  if (!state.world.columns.length || !snapshot.chargeStrength.size) return;
  const routes = worldLiftRoutes(state, snapshot);
  const stores = worldChargeStores(state);
  let remaining = spanSeconds;
  while (remaining > 0) {
    const lift = liftRates(routes, true);
    const fill = nextStoreFill(stores, lift);
    if (fill === Infinity) return;
    const span = Math.min(fill, remaining);
    for (const store of stores) {
      const rate = rateFor(store, lift);
      if (rate <= 0) continue;
      if ((store.cap - store.copy.store) / rate <= span) store.copy.store = store.cap;
      else store.copy.store = Math.min(store.cap, store.copy.store + rate * span);
    }
    remaining -= span;
  }
}
