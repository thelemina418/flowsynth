import { BALANCE } from "../engine/constants";
import { neighbors } from "../engine/hex";
import { cellNoteOf } from "../engine/lattice";
import { attackPowerOf, enemyPenaltyOf, type WorldLift, type WorldPiece } from "../engine/world";
import { adjacentBearersOf, bearerOf, COMBAT } from "../engine/world-combat";
import type { GameState, WorldGear } from "../engine/types";
import { formatNumber } from "./format";
import { COLUMN_WORD, WORLD_META } from "./meta";

export function worldPieceName(piece: WorldPiece): string {
  switch (piece.kind) {
    case "weapon": return WORLD_META[piece.copy.type].name;
    case "column": return COLUMN_WORD;
    default: return COMBAT[piece.kind].name;
  }
}

export const COMBAT_GLYPHS = {
  creature: '<path d="M-10 8V-2l5-6h10l5 6v10M-4 6h8M-5-1h1m8 0h1"/>',
  armor: '<path d="M-10-8h20v11L0 10-10 3Z M-5 0h10"/>',
  spell: '<path d="M-12 3h5l3-10 5 14 4-8h7"/>',
  conduit: '<path d="M-10 0H10M3-6l7 6-7 6"/>',
  shale: '<path d="M-11 5-4-8h10l5 13zM-5 5 0-3l5 8"/>',
  basalt: '<path d="M-9 8V-4l5-5 4 5 4-5 5 5V8ZM-4-1v9m8-9v9"/>',
};

export function enemyPenaltyFigure(state: GameState, key: string): string {
  return `−${Math.round(enemyPenaltyOf(state, key) * 100)}% ν`;
}

export function worldPieceRead(state: GameState, piece: WorldPiece, lift?: WorldLift): { read: string; stateWord: string; tip: string } {
  const { creature, armor, spell, bladeCadence } = COMBAT;
  const gearCopy = piece.kind === "weapon" || piece.kind === "spell" || piece.kind === "armor" ? piece.copy : null;
  const bearer = gearCopy ? bearerOf(state, gearCopy) : undefined;
  const gear = bearer ? "Bound" : gearCopy && adjacentBearersOf(state, gearCopy).length > 1 ? "Choose bearer" : "Unbound";
  const gearTip = (effect: string) => bearer?.pos ? `${effect} · Sentinel at ${cellNoteOf(bearer.pos)}` : effect;
  switch (piece.kind) {
    case "creature": {
      const stateWord = piece.copy.pos ? "Deployed" : piece.copy.recovering ? "Recovering" : "Ready";
      const read = `${Math.floor(piece.copy.hp)}/${creature.hp} HP`;
      return { read, stateWord, tip: piece.copy.recovering ? "Requires full HP to deploy" : `Hits adjacent walls · ${creature.damage} HP / ${creature.cadence} s` };
    }
    case "armor":
      return { read: `−${Math.round((1 - armor.remainingDamage) * 100)}% damage`, stateWord: gear, tip: gearTip("Guards an adjacent creature") };
    case "spell":
      return { read: `⌁${Math.floor(piece.copy.store)}/${spell.threshold}`, stateWord: bearer && lift && !lift.bySpell.get(piece.copy.id) ? "Unfed" : gear, tip: gearTip(`Bursts for ${spell.damage} HP at full charge`) };
    case "weapon":
      return { read: `⌁${Math.floor(piece.copy.store)}/${BALANCE.world.storageCap}`, stateWord: bearer && lift && !lift.byWeapon.get(piece.copy.id) ? "Unfed" : gear, tip: gearTip(`Charged hit · ${attackPowerOf(state, piece.copy.type)} HP / ${bladeCadence} s`) };
    case "column": {
      const pos = piece.copy.pos;
      const host = pos && state.modules.some(({ pos: m }) => m?.q === pos.q && m.r === pos.r);
      return { read: `⌁${formatNumber(lift?.byColumn.get(piece.copy.id) ?? 0)}/s`, stateWord: pos && !host ? "No host" : "Lift", tip: "Copies the module cell’s received charge" };
    }
    case "conduit": {
      const outlet = piece.copy.pos ? neighbors(piece.copy.pos)[piece.copy.direction]! : null;
      return { read: outlet ? `→ ${cellNoteOf(outlet)}` : "", stateWord: "", tip: "Forwards charge along its selected edge" };
    }
  }
}

export function gearBearersHtml(state: GameState, gear: WorldGear): string {
  const candidates = adjacentBearersOf(state, gear);
  if (candidates.length < 2) return "";
  return `<div class="hex-shift world-outlet" role="group" aria-label="Gear bearer"><span>Bearer</span>${candidates.map(({ id, pos }) =>
    `<button class="hex-shift-chip" data-world-bearer="${id}" aria-pressed="${gear.bearer === id}" aria-label="Equip Sentinel at ${cellNoteOf(pos!)} (${pos!.q}, ${pos!.r})">${cellNoteOf(pos!)}</button>`,
  ).join("")}</div>`;
}

export function conduitEdgesHtml(piece: Extract<WorldPiece, { kind: "conduit" }>): string {
  return `<div class="hex-shift world-outlet" role="group" aria-label="Conduit outlet"><span>Outlet</span>${neighbors(piece.copy.pos!).map((pos, edge) =>
    `<button class="hex-shift-chip" data-world-edge="${edge}" aria-pressed="${piece.copy.direction === edge}" aria-label="Route to ${cellNoteOf(pos)} at ${pos.q}, ${pos.r}">${cellNoteOf(pos)}</button>`,
  ).join("")}</div>`;
}
