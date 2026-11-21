import { BALANCE } from "./constants";
import { hex } from "./hex";
import { createInitialState, createModule, createWeapon, createWorldColumn, grantCombatStarter } from "./state";
import type { GameState } from "./types";
import { COMBAT } from "./world-combat";
import { syncWorldDiscoveries, worldPiecesOf } from "./world";

export function createWorldCombatScenario(): GameState {
  const state = createInitialState();
  state.eraEarned = BALANCE.world.entryNous * 10;
  state.totalEarned = state.eraEarned;
  state.arcCardSeen = true; // The prepared board is past the second-synth introduction.
  state.cells.push(hex(1, 1), hex(1, -1), hex(2, 0), hex(0, -1), hex(1, -2), hex(2, -2), hex(-1, 1), hex(-1, 0));
  // The proof grants a compact, connected patch and a charged Module rig.
  // It neither prices these cells nor claims this start can be earned live.
  const host = createModule(state, "additive");
  host.pos = hex(1, 1);
  const flywheel = createModule(state, "focusKeyed");
  flywheel.pos = hex(2, 0);
  flywheel.reserve = 240;
  state.modules.push(host, flywheel);
  state.world.unlocked = state.world.starterColumnGranted = state.world.starterWeaponGranted = true;
  state.world.columns.push(createWorldColumn(state));
  state.world.weapons.push(createWeapon(state, "chargeBlade"));
  state.world.proof = true;
  grantCombatStarter(state);
  // Stable fixture identifiers for #542's scripted reproduction.
  state.world.creatures[0]!.id = "sentinel";
  state.world.armor[0]!.id = "guard-plate";
  state.world.spells[0]!.id = "pulse";
  state.world.conduits[0]!.id = "conduit";
  syncWorldDiscoveries(state);
  return state;
}

export function assertWorldCombatScenario(state: GameState): void {
  const { proof, elapsed, creatures: [creature], enemies } = state.world;
  const pieces = worldPiecesOf(state);
  if (state.mode !== "upgrade" || !state.world.unlocked || !proof || elapsed !== 0 ||
      creature?.hp !== COMBAT.creature.hp || creature.recovering || enemies.shale?.hp !== 48 || !enemies.shale.discovered ||
      enemies.basalt?.hp !== 35 || enemies.basalt.discovered || state.world.hone.chargeBlade !== 0 ||
      state.world.columns.length !== 1 || state.world.weapons.length !== 1 || pieces.length !== 6 || pieces.some(({ copy }) => copy.pos !== null)) {
    throw new Error("World combat: expected a fresh, unplayed fixed kit at Shale.");
  }
}
