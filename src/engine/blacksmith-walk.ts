import { endSession, placeWorldOccupant, retrieveWorldOccupant, startSession } from "./actions";
import { advance } from "./advance";
import { claimForgedWeapon, selectHabitClass, weaponChoicesOf } from "./classes";
import { createHabit, selectHabit } from "./habits";
import { hex } from "./hex";
import { activeWallOf } from "./world";
import { FORGE_WEAPONS, type ForgeWeapon } from "./weapons";
import type { GameState } from "./types";

// A declared preparation/combat comparison, not an acquisition-time
// calibration. The caller supplies the unplayed live World checkpoint.
export function walkBlacksmithShale(initial: GameState) {
  const state = structuredClone(initial);
  const accept = (action: string, result: { ok: boolean; reason?: string }) => {
    if (!result.ok) throw new Error(`Blacksmith walk: ${action}: ${result.reason}`);
  };
  const tick = (state: GameState, seconds: number) => {
    const result = advance(state, seconds, () => 0.3);
    if (result.fault) throw new Error(`Blacksmith walk: ${result.fault}`);
  };
  const beganAt = state.sessionRecords.at(-1)?.endedAt ?? 0;
  const { habit } = createHabit(state, "Practice");
  if (!habit || activeWallOf(state)?.key !== "shale") throw new Error("Expected a live Shale checkpoint.");
  accept("Select habit", selectHabit(state, habit.id));
  accept("Select Blacksmith", selectHabitClass(state, habit.id, "blacksmith"));
  accept("Start acquisition session", startSession(state, null, beganAt));
  tick(state, 600);
  const credited = state.session!.accounting.creditedSeconds;
  accept("Finish acquisition session", endSession(state, beganAt + 600_000));
  const banked = weaponChoicesOf(habit);
  if (banked !== 1) throw new Error(`Expected one weapon choice after ${credited} credited seconds.`);

  // Match placement and reserves across branches. Shelve every Column so
  // the later difference proves the unfed role, not extra module supply.
  for (const column of state.world.columns) accept("Store Column", retrieveWorldOccupant(state, column.id));
  accept("Deploy Sentinel", placeWorldOccupant(state, state.world.creatures[0]!.id, hex(0, 0)));
  accept("Equip Guard Plate", placeWorldOccupant(state, state.world.armor[0]!.id, hex(0, 1)));
  const take = (type: ForgeWeapon | "chargeBlade") => {
    const branch = structuredClone(state);
    if (type !== "chargeBlade") accept(`Forge ${type}`, claimForgedWeapon(branch, habit.id, type));
    const weapon = branch.world.weapons.find(weapon => weapon.type === type)!;
    accept(`Place ${type}`, placeWorldOccupant(branch, weapon.id, hex(1, 0)));
    const sample = (second: number) => ({ second, wallHP: branch.world.enemies.shale!.hp,
      sentinelHP: branch.world.creatures[0]!.hp, recovering: branch.world.creatures[0]!.recovering, store: weapon.store });
    accept("Start fight", startSession(branch, null, beganAt + 600_000));
    const start = sample(0);
    tick(branch, 4);
    const firstBeat = sample(4);
    tick(branch, 28);
    return { type, start, firstBeat, outcome: sample(32) };
  };
  return { credited, banked, remainingArete: state.arete, branches: ["chargeBlade" as const, ...FORGE_WEAPONS].map(take) };
}
