import { BALANCE } from "./constants";
import type { GameState } from "./types";

interface WeaponProfile {
  name: string;
  plate: string;
  cadence: number;
  // Zero denotes a charge-required weapon, not a timed zero-damage hit.
  unfedDamage: number;
  chargeCost: number;
  // An array denotes persistent, type-wide Hone ranks (including rank 0).
  poweredDamage: number | readonly number[];
}

export const WEAPONS = {
  chargeBlade: {
    name: "Charge Blade", plate: "BLADE", cadence: 5, unfedDamage: 0,
    chargeCost: BALANCE.world.attackCost,
    poweredDamage: [BALANCE.world.attackBase, 6, 8, 32, 512],
  },
  striker: { name: "Striker", plate: "STRIKER", cadence: 4, unfedDamage: 5, chargeCost: 1, poweredDamage: 8 },
  maul: { name: "Maul", plate: "MAUL", cadence: 8, unfedDamage: 12, chargeCost: 2, poweredDamage: 24 },
} as const satisfies Record<string, WeaponProfile>;

export type WeaponType = keyof typeof WEAPONS;
export const FORGE_WEAPONS = ["striker", "maul"] as const satisfies readonly WeaponType[];
export type ForgeWeapon = typeof FORGE_WEAPONS[number];

export function isWeaponType(type: unknown): type is WeaponType {
  return typeof type === "string" && Object.hasOwn(WEAPONS, type);
}

export function honePowerAt(rank: number): number {
  const hits: readonly number[] = WEAPONS.chargeBlade.poweredDamage;
  return hits[rank] ?? hits[0]!;
}

export function attackPowerOf(state: GameState, type: WeaponType): number {
  return type === "chargeBlade" ? honePowerAt(state.world.hone.chargeBlade) : WEAPONS[type].poweredDamage;
}
