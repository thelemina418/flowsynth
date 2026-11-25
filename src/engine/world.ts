// Shared World reads for placement, production, time advance and UI.
import { BALANCE } from "./constants";
import { hexKey, neighbors, sameHex } from "./hex";
import { addToSum, gapTo, NumericFault, requireFinite, resetSum } from "./numeric";
import { addCharge, divideCharge, noCharge, scaleCharge, type ChargeAmount } from "./charge-amount";
import type { GameState, Hex, RateSnapshot, WeaponCopy, WeaponType, WorldColumn, WorldCombatCreature, WorldConduit, WorldEnemyState, WorldGear, WorldSpell } from "./types";
import { activeWallOf, advanceCombat, combatBoundaryOf, COMBAT, discoverySecondsOf, worldEnemiesOf } from "./world-combat";
export { activeWallOf, discoverySecondsOf, syncWorldDiscoveries, worldEnemiesOf } from "./world-combat";
export { attackPowerOf, honePowerAt } from "./weapons";

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
  // Pulse acts at full store, and an earlier full sink can change its lift.
  return Math.min(threshold, combat, nextStoreFill(worldChargeStores(state), lift));
}

// Kept for historical balance tooling. The live purchase is retired.
export function columnCost(owned: number): number {
  if (owned < 0) throw new Error("owned must be non-negative");
  return BALANCE.world.columnFirstPrice * BALANCE.world.columnPriceGrowth ** owned;
}

export function honeCostOf(state: GameState, type: WeaponType): number | null {
  return type === "chargeBlade" ? BALANCE.world.honeCosts[state.world.hone.chargeBlade] ?? null : null;
}

export function advanceWorldCombat(state: GameState, spanSeconds: number): void {
  advanceCombat(state, spanSeconds);
}

export interface WorldLift {
  byColumn: Map<string, number>;
  byWeapon: Map<string, number>;
  bySpell: Map<string, number>;
}

type WorldMove = { id: string; pos: Hex | null };
type ChargeStore =
  | { copy: WeaponCopy; cap: number; kind: "weapon" }
  | { copy: WorldSpell; cap: number; kind: "spell" };

function worldChargeStores(state: GameState): ChargeStore[] {
  return [
    ...state.world.weapons.map((copy) => ({ copy, cap: BALANCE.world.storageCap, kind: "weapon" as const })),
    ...state.world.spells.map((copy) => ({ copy, cap: COMBAT.spell.threshold, kind: "spell" as const })),
  ];
}

function worldLiftRoutes(state: GameState, override?: WorldMove) {
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
    if (!module) return [];
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
    return [{ column, hostId: module.id, consumers }];
  });
}

export function connectedWorldChargeHosts(state: GameState): Set<string> {
  return new Set(worldLiftRoutes(state).filter(({ consumers }) => consumers.length > 0).map(({ hostId }) => hostId));
}

function suppliedRoutes(state: GameState, snapshot: Pick<RateSnapshot, "chargeStrength">, override?: WorldMove) {
  return worldLiftRoutes(state, override).flatMap(route => {
    const supply = snapshot.chargeStrength.get(route.hostId) ?? 0;
    return supply <= 0 ? [] : [{ ...route, supply }];
  });
}

function openStores(consumers: ChargeStore[]): ChargeStore[] {
  return consumers.filter(({ copy, cap }) => copy.store < cap);
}

function liftRates(routes: ReturnType<typeof suppliedRoutes>, bounded: boolean): WorldLift {
  const lift: WorldLift = { byColumn: new Map(), byWeapon: new Map(), bySpell: new Map() };
  for (const { column, supply, consumers } of routes) {
    lift.byColumn.set(column.id, supply);
    const open = bounded ? openStores(consumers) : consumers;
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
  return liftRates(suppliedRoutes(state, snapshot, override), bounded);
}

function rateFor(store: ChargeStore, lift: WorldLift): number {
  return (store.kind === "weapon" ? lift.byWeapon : lift.bySpell).get(store.copy.id) ?? 0;
}

function nextStoreFill(stores: readonly ChargeStore[], lift: WorldLift): number {
  let next = Infinity;
  for (const store of stores) {
    const rate = rateFor(store, lift);
    if (rate > 0) next = Math.min(next, Math.max(Number.MIN_VALUE, gapTo(store.copy, "store", store.cap) / rate));
  }
  return next;
}

// Integrate all Columns simultaneously so a shared full reserve releases
// its remaining share. Rates decide the split boundaries; the live board
// supplies the actual quantities at those boundaries, including the last
// debit of a generator. Only damage and recovery require trusted time.
export function advanceWorldCharge(
  state: GameState, snapshot: Pick<RateSnapshot, "chargeStrength">, spanSeconds: number,
  settle?: (seconds: number, last: boolean, hosts: ReadonlySet<string>) => ReadonlyMap<string, ChargeAmount>,
): void {
  const routes = suppliedRoutes(state, snapshot);
  const stores = worldChargeStores(state);
  let remaining = spanSeconds;
  while (remaining > 0) {
    const lift = liftRates(routes, true);
    const fill = nextStoreFill(stores, lift);
    if (fill === Infinity) {
      settle?.(remaining, true, new Set());
      return;
    }
    const span = Math.min(fill, remaining);
    const openRoutes = routes.map(({ consumers, ...route }) => ({ ...route, open: openStores(consumers) }))
      .filter(({ open }) => open.length > 0);
    const amounts = settle?.(span, span === remaining, new Set(openRoutes.map(({ hostId }) => hostId)));
    const deposits = new Map<ChargeStore, ChargeAmount>();
    for (const { hostId, supply, open } of openRoutes) {
      const amountsAtHost = amounts ? amounts.get(hostId) ?? noCharge : scaleCharge([supply, 0], span);
      const share = divideCharge(amountsAtHost, open.length);
      for (const store of open) deposits.set(store, addCharge(deposits.get(store) ?? noCharge, share));
    }
    let stored = false;
    for (const [{ copy, cap }, [amount, low]] of deposits) {
      const before = copy.store, carry = copy.storeCarry;
      addToSum(copy, "store", amount, "World stored charge", low);
      if (copy.store >= cap) resetSum(copy, "store", cap);
      stored ||= before !== copy.store || carry !== copy.storeCarry;
    }
    const rest = remaining - span;
    if (rest === remaining && !stored) throw new NumericFault("World charge cannot advance to its next store boundary");
    remaining = rest;
  }
}
