import { SHORTCUTS } from "./shortcuts";
// World shares the Modules hex chassis. All combat and routing reads come
// from the engine; only preparation exposes configuration controls.
import { columnLiftsOf, enemyStateOf, worldCellReserved, worldEnemiesOf, worldEnemyAt, worldOccupantAt, worldPieceOf, worldPiecesOf, type WorldLift, type WorldPiece } from "../engine/world";
import { neighbors, sameHex } from "../engine/hex";
import { COMBAT, type CombatWall } from "../engine/world-combat";
import { cellNoteOf } from "../engine/lattice";
import { displayedRates } from "../engine/economy";
import type { GameState, Hex, RateSnapshot } from "../engine/types";
import type { App } from "./app";
import { startPointerDrag } from "./pointer-drag";
import { HEX_RADIUS, boardPoint, hexPoints } from "./face";
import { COLUMN_SHORT } from "./meta";
import { WEAPONS } from "../engine/weapons";
import { formatNumber } from "./format";
import { wireTooltips } from "./instrument";
import { COMBAT_GLYPHS, enemyPenaltyFigure, worldPieceRead, worldPieceName } from "./world-combat";

/* ── The layer's liveness ───────────────────────────── */

// Permanent discovery follows the first positive prestige bank (ADR-0087),
// independent of this era's depth, current wallet or Catalog ownership.
export function worldEntered(state: GameState): boolean {
  return state.world.unlocked;
}

// The layer standing on the board: entered and selected — whatever the
// session mode. Flow reads it read-only; upgrade alone edits it. While it
// stands the renderer draws the layer's plates alone.
export function worldBoardLive(app: App): boolean {
  return worldEntered(app.state) && app.ui.boardLayer === "world";
}

// The editing liveness: upgrade mode on the standing layer — the tray
// strip, the arm pill, the target controls. The board may show the layer
// during a session; the edit furniture never rides along.
export function worldLayerLive(app: App): boolean {
  return app.state.mode === "upgrade" && worldBoardLive(app);
}

/* ── The vertical layer legend ────────────────────────
   The one World / Modules switch: a vertical strip of layer symbols shared
   by the grid and the Hex detail — the grid reads ui.boardLayer, the
   detail reads ui.detail.face, and one builder renders both so the
   vocabulary can never drift. World leads the pair (the co-listing order:
   World leads, as Mutators led). Every mode's furniture: the legend stands
   through flow and pause after discovery. Before discovery only Modules
   stands: there is no locked World symbol, preview or reveal-threshold door. */

export function layerLegendActiveFace(app: App): "modules" | "world" {
  return app.ui.detail ? app.ui.detail.face : app.ui.boardLayer;
}

// The abstract board symbols share a chassis too. The inner mark, not
// the cut, distinguishes the layer when no specific occupant is shown.
function layerSymbol(mark: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><polygon transform="translate(12 12)" points="${hexPoints(9.4)}"/><path d="${mark}"/></svg>`;
}
export const LAYER_WORLD_SVG = layerSymbol("M8.5 15.5v-4.2l3.5-3.3 3.5 3.3v4.2z");
export const LAYER_MODULES_SVG = layerSymbol("M12 8.2v7.6M8.4 10.1l7.2 3.8M15.6 10.1l-7.2 3.8");

export function layerLegendHtml(app: App): string {
  const { state } = app;
  const active = layerLegendActiveFace(app);
  const locked = !worldEntered(state);
  const worldSelected = active === "world";
  // Discovery reveals a real door, never a locked preview.
  return `${locked ? "" : `<button class="legend-symbol${worldSelected ? " active" : ""}" data-legend-layer="world" aria-pressed="${worldSelected}" aria-label="World layer" title="World — enemies, weapons, Columns · ${SHORTCUTS.layer.label} cycles layers">${LAYER_WORLD_SVG}</button>`}
    <button class="legend-symbol${active === "modules" ? " active" : ""}" data-legend-layer="modules" aria-pressed="${active === "modules"}" aria-label="Modules layer" title="Modules — the production grid · ${SHORTCUTS.layer.label} cycles layers">${LAYER_MODULES_SVG}</button>`;
}

const boundLegends = new WeakSet<HTMLElement>();

export function renderLayerLegend(app: App): void {
  const host = document.getElementById("layer-legend");
  if (!host) return;
  host.hidden = Boolean(app.ui.detail);
  if (app.ui.detail) return;
  wireTooltips(host, app.signal);
  // Every mode's furniture: the strip stands through flow and pause,
  // switching grid layers and emphasizing detail faces read-only.
  const key = `${layerLegendActiveFace(app)}:${worldEntered(app.state)}:${app.state.mode === "upgrade"}`;
  if (host.dataset.renderKey === key) {
    host.hidden = false;
    return;
  }
  host.dataset.renderKey = key;
  host.hidden = false;
  host.innerHTML = layerLegendHtml(app);
  // The rebuild replaces the buttons, so the switch re-binds with it; the
  // WeakSet only keeps a stale test document from doubling the binding.
  if (boundLegends.has(host)) return;
  boundLegends.add(host);
  host.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest?.("[data-legend-layer]");
    if (!button) return;
    const layer = button.getAttribute("data-legend-layer") as "modules" | "world";
    if (app.ui.detail && !app.released) app.detailFace(layer);
    else if (!app.released) app.setBoardLayer(layer);
  });
}

/* ── The World faces ──────────────────────────────────
   One steel hex per coordinate: reserved, discovered, cleared, occupant
   and open. The World amendment changes the visible plate only; the
   coordinate projection, full-cell hits and engine footprint stay intact.
   The shared chassis wears World steel, paired side slots and functional
   glyphs instead of category rails, rarity marks or merge rings. */

// The plates' content rhythm (the design round's): the nameplate in the
// top band, the glyph or bar at center, the figures beneath, the verdict
// (when a face has one) in the bottom band.
const NAME_Y = -24;
const VERDICT_Y = 39;

// The occupants' and enemies' stroke glyphs, drawn centered on the origin
// in the layer's register — the tray tiles, the drag ghost, and the Hex
// detail's chassis share them.
export const WORLD_GLYPH = {
  enemy: '<path d="M-11-7 0 3 11-7"/><path d="M-11 1 0 11 11 1"/>',
  weapon: '<path d="M-3-13 5-9 3 9-5 13-3-9Z"/><path d="M-8 13h10"/>',
  column: '<rect x="-7" y="-12" width="14" height="24"/><path d="M-11-12h22M-11 12h22"/>',
};

type WorldGlyphKind = keyof typeof WORLD_GLYPH | keyof typeof COMBAT_GLYPHS;

function worldGlyph(kind: WorldGlyphKind, dimmed: boolean, scale = 1, rotation = 0): string {
  const glyph = kind in COMBAT_GLYPHS ? COMBAT_GLYPHS[kind as keyof typeof COMBAT_GLYPHS] : WORLD_GLYPH[kind as keyof typeof WORLD_GLYPH];
  return `<g class="world-glyph${dimmed ? " dimmed" : ""}" transform="scale(${scale})${rotation ? ` rotate(${rotation})` : ""}">${glyph}</g>`;
}

const WORLD_SIDE_SLOTS = '<path class="world-side-slots" d="M-47-6h13m-13 12h13M34-6h13m-13 12h13"/>';
const WORLD_RESERVATION_HATCH = '<path class="world-hatch" d="M-30 14l10-10m0 10 10-10m0 10 10-10m0 10 10-10m0 10 10-10m0 10 10-10"/>';

function plate(cls: string): string {
  const inset = cls === "reserved" ? WORLD_RESERVATION_HATCH : cls === "firm" || cls === "engraved" ? WORLD_SIDE_SLOTS : "";
  return `<polygon class="world-plate ${cls}" points="${hexPoints(HEX_RADIUS)}"/>${inset}`;
}

// The reserved cell's face: claimed-but-unknown — the hatch says the
// position stands set aside, and no identity renders. Never confusable
// with a discovered enemy's firm plate.
function reservedFaceHtml(pos: Hex): string {
  return `${plate("reserved")}
    <text class="world-word" y="-6" text-anchor="middle">RESERVED</text>
    <polygon class="world-hit" tabindex="0" role="button" aria-label="World cell at ${cellNoteOf(pos)}" data-world-cell="${pos.q},${pos.r}" points="${hexPoints(HEX_RADIUS)}" fill="none" stroke="none"/>`;
}

function clearedFaceHtml(wall: CombatWall): string {
  return `${plate("engraved")}
    <text class="world-word" y="${NAME_Y}" text-anchor="middle">${wall.name}</text>
    <text class="world-fig engraved-fig" y="10" text-anchor="middle">✓</text>
    <text class="world-word" y="30" text-anchor="middle">CLEARED</text>`;
}

// The open cell's face: quiet dashed hairline — owned space a placement
// can take. While an arm stands, the eligible faces pulse (the arm's pick
// targets, the Mutator Grid's own pattern).
function openFaceHtml(pos: Hex, armed: boolean): string {
  return `${plate(armed ? "open pulse" : "open")}
    <polygon class="world-hit" tabindex="0" role="button" aria-label="World cell at ${cellNoteOf(pos)}" data-world-cell="${pos.q},${pos.r}" points="${hexPoints(HEX_RADIUS)}" fill="none" stroke="none"/>`;
}

function combatEngraving(name: string, mark: string, read: string, verdict: string, large: boolean): string {
  return `${plate("firm")}
    <text class="world-word" y="${large ? -27 : NAME_Y}" text-anchor="middle">${name}</text>
    <g transform="translate(0,${large ? -10 : -5})">${mark}</g>
    <text class="world-fig" y="${large ? 22 : 17}" text-anchor="middle">${read}</text>
    <text class="world-fig" y="${large ? 36 : VERDICT_Y}" text-anchor="middle">${verdict}</text>`;
}

function pieceEngraving(state: GameState, piece: WorldPiece, lift: WorldLift, large: boolean) {
  const name = worldPieceName(piece);
  const label = piece.kind === "column" ? COLUMN_SHORT : piece.kind === "weapon" ? WEAPONS[piece.copy.type].plate : name;
  const { read, stateWord, tip } = worldPieceRead(state, piece, lift);
  let rotation = 0;
  if (piece.kind === "conduit" && piece.copy.pos) {
    const [x, y] = boardPoint(piece.copy.pos);
    const [toX, toY] = boardPoint(neighbors(piece.copy.pos)[piece.copy.direction]!);
    rotation = Math.atan2(toY - y, toX - x) * (180 / Math.PI);
  }
  const mark = worldGlyph(piece.kind, false, large ? 1.15 : 0.8, rotation);
  return { inner: combatEngraving(label, mark, read, stateWord, large), name, read, stateWord, tip };
}

function wallEngraving(state: GameState, wall: CombatWall, large: boolean) {
  const read = `${Math.ceil(enemyStateOf(state, wall.key).hp)}/${wall.maxHp} HP`;
  const pressure = enemyPenaltyFigure(state, wall.key);
  const mark = wall.key === "shale" || wall.key === "basalt" ? worldGlyph(wall.key, false, large ? 1.15 : 0.8) : `<text class="world-word" y="4" text-anchor="middle">${wall.symbol}</text>`;
  return { inner: combatEngraving(wall.name, mark, read, pressure, large), label: `${wall.name} · ${read} · ${pressure}` };
}

function wallMechanic(wall: CombatWall): string {
  return `Hits for ${wall.damage} HP / ${COMBAT.enemyCadence} s · heals ${wall.regeneration} HP/s`;
}

function worldGridHit(pos: Hex, label: string): string {
  return `<polygon class="world-hit" tabindex="0" role="button" aria-label="${label} · ${cellNoteOf(pos)}" data-world-cell="${pos.q},${pos.r}" points="${hexPoints(HEX_RADIUS)}" fill="none" stroke="none"/>`;
}

/* ── The grid decorations ───────────────────────────── */

// The layer's one drawing pass, the Mutator Grid's discipline: while the
// World layer stands, this is all the board renders. Every authored enemy
// position wears its state face; every owned cell wears its occupant or
// open face. The lift read arrives from the render's snapshot — the same
// pass the rate ledger shows, never a second derivation.
export function worldGridDecorations(app: App, snapshot: RateSnapshot): string {
  const { state, ui } = app;
  if (!worldBoardLive(app)) return "";
  const lift = columnLiftsOf(state, snapshot);
  const armed = worldLayerLive(app) && ui.worldArmed !== null;
  const parts: string[] = [];
  for (const def of worldEnemiesOf(state)) {
    if (!worldCellReserved(state, def.pos)) continue;
    const [x, y] = boardPoint(def.pos);
    const live = enemyStateOf(state, def.key);
    let face: string;
    if (!live.discovered) face = reservedFaceHtml(def.pos);
    else {
      const { inner, label } = wallEngraving(state, def, false);
      face = inner + worldGridHit(def.pos, label);
    }
    parts.push(`<g data-key="world-${def.key}" transform="translate(${x.toFixed(2)},${y.toFixed(2)})">${face}</g>`);
  }
  for (const pos of state.cells) {
    if (worldCellReserved(state, pos)) continue;
    const [x, y] = boardPoint(pos);
    const occupant = worldOccupantAt(state, pos);
    if (!occupant) {
      const cleared = worldEnemyAt(state, pos);
      const face = cleared && !armed ? clearedFaceHtml(cleared) + worldGridHit(pos, `${cleared.name} cleared · open World cell`) : openFaceHtml(pos, armed);
      parts.push(`<g data-key="world-open-${pos.q},${pos.r}" transform="translate(${x.toFixed(2)},${y.toFixed(2)})">${face}</g>`);
      continue;
    }
    const engraving = pieceEngraving(state, worldPieceOf(state, occupant.id)!, lift, false);
    const inner = engraving.inner + worldGridHit(pos, [engraving.name, engraving.read, engraving.stateWord].filter(Boolean).join(" · "));
    parts.push(`<g data-key="world-occ-${pos.q},${pos.r}" class="world-occupant" transform="translate(${x.toFixed(2)},${y.toFixed(2)})">${inner}</g>`);
  }
  return `<g data-key="world-grid">${parts.join("")}</g>`;
}

// The lens's World extent: the authored positions sit on coordinates the
// owned patch may not cover, so the board's bounds read includes them
// while the layer stands — zoom and pan hold the whole face.
export function worldLensCoordinates(state: GameState): Hex[] {
  return worldEnemiesOf(state).filter((def) => worldCellReserved(state, def.pos)).map((def) => def.pos);
}

/* ── The reserved readout's ask ─────────────────────── */

// Hovering a plate asks its deeper routing and reset facts into the reserved
// readout — one spot, never floating over the board. The weapons carry
// their routing (fed, by whom); the enemies their threat; the reserved
// cells their silence.
export function worldAskHtml(app: App, pos: Hex, snapshot: RateSnapshot): string {
  const { state } = app;
  const def = worldEnemyAt(state, pos);
  const occupant = worldOccupantAt(state, pos);
  let read = `Open World cell · ${cellNoteOf(pos)}`;
  if (def && worldCellReserved(state, pos)) {
    read = enemyStateOf(state, def.key).discovered ? wallMechanic(def) : "Reserved cell";
  } else if (occupant) {
    const item = worldPieceOf(state, occupant.id)!;
    const facts = worldPieceRead(state, item, columnLiftsOf(state, snapshot));
    read = `${worldPieceName(item)} · ${facts.tip}`;
  } else if (def) read = `${def.name} cleared · open World cell`;
  return `<span class="chord-readout-chip mono" style="--cc:var(--world)">${read}</span>`;
}

/* ── The placement preview ────────────────────────────
    The one-authoritative-pass rule (ADR-0054): the preview asks the
    engine's lift function with the move applied — the same conservation
    split the walk runs — and reports what changes for the moved occupant
    and its neighbors. It never recomputes splits. */

export interface WorldPreview {
  moved: string;
  rows: string[];
}

// The preview for hovering `pos` with `id` carried — a placement the
// engine would take. Null off valid targets (the register shows nothing).
export function worldPlacementPreview(state: GameState, id: string, pos: Hex | null): WorldPreview | null {
  if (pos === null || state.mode !== "upgrade") return null;
  const piece = worldPieceOf(state, id);
  if (!piece || (piece.kind === "creature" && piece.copy.recovering)) return null;
  if (worldCellReserved(state, pos) || !state.cells.some((cell) => sameHex(cell, pos))) return null;
  const occupant = worldOccupantAt(state, pos);
  if (occupant && occupant.id !== id) return null;
  const snapshot = displayedRates(state, true);
  const before = columnLiftsOf(state, snapshot);
  const after = columnLiftsOf(state, snapshot, { id, pos });
  const rows: string[] = [];
  for (const item of worldPiecesOf(state)) {
    if (item.kind !== "column" && item.kind !== "spell" && item.kind !== "weapon") continue;
    const rates = (lift: WorldLift) => (item.kind === "column" ? lift.byColumn : item.kind === "spell" ? lift.bySpell : lift.byWeapon).get(item.copy.id) ?? 0;
    const prior = rates(before), moved = rates(after);
    if (item.copy.id === id || Math.abs(prior - moved) > 1e-9) rows.push(`${worldPieceName(item)}: ⌁${formatNumber(prior)}/s → ⌁${formatNumber(moved)}/s`);
  }
  return { moved: id, rows };
}

export function worldPreviewHtml(preview: WorldPreview): string {
  return preview.rows
    .map((row) => `<span class="chord-readout-chip mono" style="--cc:var(--world)">${row}</span>`)
    .join("");
}

/* ── The World tray ───────────────────────────────────
    The unplaced occupants' browser, sharing the tray column's switch like
    the Mutator tray it replaces: click inspects, Place arms, drag places,
    drag out retrieves; collapsed, it keeps the symbol and stored count —
    the inventory's own grammar, one count, nowhere doubled. */

// Inventory and the real pointer ghost share the board's steel hex.
export function worldTileInner(kind: WorldPiece["kind"]): string {
  return `<polygon class="world-tile-plate" points="${hexPoints(HEX_RADIUS)}"/>
    ${WORLD_SIDE_SLOTS}${worldGlyph(kind, false, 1.9)}`;
}

export function worldTileSvg(kind: WorldPiece["kind"]): string {
  return `<svg viewBox="-70 -70 140 140" aria-hidden="true">${worldTileInner(kind)}</svg>`;
}

// The collapsed tray's one mark: the plate symbol + the stored count — the
// inventory's own collapsed grammar.
const WORLD_TRAY_ICON = LAYER_WORLD_SVG;

function worldInspectHtml(app: App): string {
  const { state } = app;
  const id = app.ui.worldTray.inspect!;
  const piece = worldPieceOf(state, id);
  if (!piece || piece.copy.pos) return `<button data-world-back>Back to tray</button>`;
  const { read, stateWord, tip } = worldPieceRead(state, piece);
  const isRecovering = piece.kind === "creature" && piece.copy.recovering;
  const preview = app.ui.detail && worldPlacementPreview(state, id, app.ui.detail.pos);
  return `<button data-world-back>Back to tray</button>
    <div class="inventory-inspection">
      <div class="inventory-detail-face">${worldTileSvg(piece.kind)}</div>
      <h3 class="inventory-detail-name">${worldPieceName(piece)}</h3>
      ${read && piece.kind !== "column" ? `<p class="mono">${piece.kind === "creature" ? `${read} · ${stateWord}` : read}</p>` : ""}
      <p>${tip}</p>
      ${preview?.rows.length ? `<div class="world-placement-preview" aria-label="Placement supply preview">${worldPreviewHtml(preview)}</div>` : ""}
      <button class="primary" data-world-place="${id}"${state.mode !== "upgrade" || isRecovering ? " disabled" : ""}>Place</button>
    </div>`;
}

// The occupants' placement and readiness share the inspect and arm key.
function trayKey(app: App): string {
  const { state, ui } = app;
  return JSON.stringify([
    state.mode,
    ui.worldTray.inspect,
    ui.worldArmed,
    ui.detail?.pos,
    worldPiecesOf(state),
    state.world.hone,
  ]);
}

// The tray column and phone sheet share every content builder.
export function renderWorldTrayContent(app: App, host: HTMLElement, sheet: boolean, bindDrag: (element: Element, id: string) => void): void {
  const { state, ui } = app;
  const locked = state.mode !== "upgrade";
  const collapsed = !sheet && ui.inventory.collapsed && !ui.inventory.dragOpen;
  const pieces = worldPiecesOf(state).filter(({ copy }) => copy.pos === null);
  const count = pieces.length;
  const key = trayKey(app) + JSON.stringify([sheet, collapsed, count]);
  if (host.dataset.worldKey === key) return;
  const active = document.activeElement;
  const focusKey = active instanceof HTMLElement && host.contains(active) ? active.dataset.worldFocus : undefined;
  host.dataset.worldKey = key;
  host.classList.toggle("inventory-collapsed", collapsed);
  host.classList.add("inventory-browser", ...(sheet ? [] : ["inst-panel"]));
  host.classList.toggle("inventory-subview", ui.worldTray.inspect !== null);
  const row = (id: string, kind: WorldPiece["kind"], name: string, read: string): string =>
    `<div class="inventory-row"><button class="inventory-copy world-tile" data-world-tray="${id}" aria-label="Inspect ${name}${read ? ` · ${read}` : ""}">
      <span class="inventory-mark">${worldTileSvg(kind)}</span><span class="inventory-copy-read"><strong>${name}</strong>${read ? `<span class="inventory-level mono">${read}</span>` : ""}</span>
    </button></div>`;
  const browse = `<div class="inventory-list" data-world-scroll>${
    pieces.sort((a, b) => Number(a.kind === "column") - Number(b.kind === "column")).map((piece) => {
      const facts = worldPieceRead(state, piece);
      const label = piece.kind === "creature" ? `${facts.read} · ${facts.stateWord}` : piece.kind === "column" ? "" : facts.read;
      return row(piece.copy.id, piece.kind, worldPieceName(piece), label);
    }).join("")
    || `<p class="inventory-empty">No stored World occupants.</p>`
  }</div>`;
  const subview = ui.worldTray.inspect !== null ? worldInspectHtml(app) : browse;
  host.innerHTML = `${sheet ? "" : '<div class="inventory-frame inst-panel-face">'}<div class="inventory-head"><button data-world-collapse aria-expanded="${!collapsed}" aria-label="${sheet ? "Close tray" : collapsed ? "Expand tray" : "Collapse tray"}, ${count} stored">${collapsed ? WORLD_TRAY_ICON : "World tray"}&nbsp;<span class="mono">${count}</span>${collapsed ? "" : `<span aria-hidden="true">${sheet ? "×" : "−"}</span>`}</button></div>${collapsed ? "" : `<div class="inventory-body">${subview}</div>`}${sheet ? "" : "</div>"}`;
  host.querySelectorAll<HTMLElement>("button").forEach((node) => {
    const attr = node.getAttributeNames().find((name) => name.startsWith("data-"));
    node.dataset.worldFocus = attr ? `${attr}:${node.getAttribute(attr)}` : node.getAttribute("aria-label") ?? "";
  });
  const on = (selector: string, fn: (el: HTMLElement) => void) => host.querySelectorAll<HTMLElement>(selector).forEach((el) => app.listen(el, "click", () => fn(el)));
  on("[data-world-collapse]", () => {
    if (sheet) app.closeModal();
    else { ui.inventory.collapsed = !ui.inventory.collapsed; app.render(); }
  });
  on("[data-world-back]", () => { ui.worldTray.inspect = null; app.render(); });
  on("[data-world-tray]", (el) => { ui.worldTray.inspect = el.dataset.worldTray!; app.render(); });
  on("[data-world-place]", (el) => {
    if (locked) return;
    const id = el.dataset.worldPlace!;
    ui.worldTray.inspect = null;
    if (app.ui.detail) {
      if (sheet) app.closeModal();
      app.detailPlaceWorld(id);
      return;
    }
    if (sheet) app.closeModal();
    app.worldArmTray(id);
  });
  if (!locked) host.querySelectorAll<HTMLElement>("[data-world-tray]").forEach((el) => bindDrag(el, el.dataset.worldTray!));
  if (locked) host.querySelectorAll<HTMLButtonElement>("[data-world-place]").forEach((el) => { el.disabled = true; });
  wireTooltips(host, app.signal);
  if (focusKey !== undefined) {
    const target = [...host.querySelectorAll<HTMLElement>("[data-world-focus]")].find((el) => el.dataset.worldFocus === focusKey);
    (target ?? host.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
  }
}

// The armed tray tile's pill (the Mutator Grid's own pattern): the arm is
// the click-shaped placement's cost spot — World placement is free, so the
// pill only carries the cancel.
export function renderWorldPill(app: App): void {
  const host = document.getElementById("world-place-pill");
  if (!host) return;
  if (!worldLayerLive(app) || app.ui.worldArmed === null) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  const piece = worldPieceOf(app.state, app.ui.worldArmed);
  host.innerHTML = `Place ${piece ? worldPieceName(piece) : "occupant"} · free<span class="pill-esc">Cancel · Esc</span>`;
  if (host.dataset.bound) return;
  host.dataset.bound = "true";
  app.listen(host, "click", () => app.worldCancelGestures());
}

/* ── Gestures ─────────────────────────────────────────
    The layer's own bindings on the board svg: clicks resolve through
    app.worldPickCell, right-click retrieves, and a held occupant (or tray
    tile) starts a live drag whose release lands as place or retrieval.
    The module board's cells never enter the svg while the layer stands,
    so the two gesture families never collide. */

const boundWorldNodes = new WeakSet<Element>();

export function bindWorldLayer(app: App, svg: SVGSVGElement): void {
  svg.querySelectorAll<SVGGElement>("[data-world-cell], [data-world-arm]").forEach((node) => {
    if (boundWorldNodes.has(node)) return;
    boundWorldNodes.add(node);
    const position = (): Hex => hexFromAttr(node.getAttribute("data-world-cell") ?? node.getAttribute("data-world-arm"))!;
    app.listen(node, "keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter" || (event as KeyboardEvent).key === " ") {
        event.preventDefault();
        app.worldPickCell(position());
      }
    });
    app.listen(node, "click", () => app.worldPickCell(position()));
    app.listen(node, "contextmenu", (event) => {
      event.preventDefault();
      app.worldRightClickCell(position());
    });
    app.listen(node, "pointerdown", (baseEvent: Event) => {
      const event = baseEvent as PointerEvent;
      if (event.button !== 0) return;
      const pos = position();
      const occupant = worldOccupantAt(app.state, pos);
      if (!occupant) return;
      startWorldDrag(app, event, occupant.id, pos);
    });
  });
  refreshWorldPreview(app);
}

export function hexFromAttr(raw: string | null | undefined): Hex | null {
  const [q, r] = (raw ?? "").split(",").map(Number);
  return Number.isFinite(q) && Number.isFinite(r) ? { q: q!, r: r! } : null;
}

// Drag binding: press a tile (tray origin) or a placed occupant's face
// (its own cell), drag it to an open face or back to the tray.
export function bindWorldDrag(app: App, element: Element, id: string, origin: "tray" | Hex): void {
  app.listen(element, "pointerdown", (baseEvent: Event) => {
    const event = baseEvent as PointerEvent;
    if (event.button !== 0) return;
    startWorldDrag(app, event, id, origin);
  });
}

function startWorldDrag(app: App, event: PointerEvent, id: string, origin: Hex | "tray"): void {
  // The drag is an edit's first half: a session's board reads, it never
  // carries — the guard sits here where both drag entries land.
  if (app.state.mode !== "upgrade") return;
  if (app.ui.worldArmed !== null) return;
  app.cancelWorldDrag?.();
  const cellAt = (ev: PointerEvent): Hex | null => {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-world-cell]");
    return hexFromAttr(hit?.getAttribute("data-world-cell"));
  };
  const trayHitAt = (ev: PointerEvent): Element | null => {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    return hit?.closest("#world-tray, #inventory-zone") ?? (app.ui.modal === "inventory" ? hit?.closest("#modal-content") ?? null : null);
  };
  const overTray = (ev: PointerEvent): boolean => trayHitAt(ev) !== null;
  const tray = document.getElementById("world-tray");
  const sheet = () => (app.ui.modal === "inventory" ? document.getElementById("modal-content") : null);
  const piece = worldPieceOf(app.state, id);
  if (!piece || (piece.kind === "creature" && piece.copy.recovering)) return;
  const kind = piece.kind;
  app.cancelWorldDrag = startPointerDrag(app, event, {
    start: () => {
      app.ui.worldCarrying = id;
      const ghost = document.createElement("div");
      ghost.className = "drag-ghost world-ghost";
      ghost.innerHTML = worldTileSvg(kind);
      return ghost;
    },
    move: (ev) => {
      const pos = cellAt(ev);
      app.setWorldDropHover(id, pos);
      const over = overTray(ev);
      tray?.classList.toggle("drag-over", over);
      sheet()?.classList.toggle("drag-over", over && !tray?.classList.contains("drag-over"));
    },
    cleanup: () => {
      app.cancelWorldDrag = null;
      if (app.ui.inventory.dragOpen) {
        app.ui.inventory.dragOpen = false;
        queueMicrotask(() => { if (!app.released) app.render(); });
      }
      tray?.classList.remove("drag-over");
      sheet()?.classList.remove("drag-over");
      app.ui.worldCarrying = null;
      app.setWorldDropHover(null, null);
    },
    drop: (ev) => {
      const pos = cellAt(ev);
      if (pos) {
        if (origin !== "tray" && sameHex(origin as Hex, pos)) return;
        app.worldPlace(id, pos);
        return;
      }
      if (overTray(ev) && origin !== "tray") {
        app.worldRetrieve(id);
      }
    },
  });
}

// The live drop preview: the hovered face wears its land register — clear
// for open, the muted refusal otherwise — refreshed in place, never a
// render; the reserved readout carries the lift preview.
function refreshWorldPreviewIn(scope: ParentNode, app: App): void {
  scope.querySelectorAll(".world-land-open, .world-land-blocked").forEach((node) =>
    node.classList.remove("world-land-open", "world-land-blocked"),
  );
  const hover = app.ui.worldDropHover;
  if (!hover || hover.pos === null) return;
  const face = scope.querySelector(`[data-world-cell="${hover.pos.q},${hover.pos.r}"]`)?.closest("g");
  if (!face) return;
  const plateNode = face.querySelector(".world-plate") ?? face.firstElementChild;
  if (!plateNode) return;
  if (worldPlacementPreview(app.state, hover.id, hover.pos)) plateNode.classList.add("world-land-open");
  else plateNode.classList.add("world-land-blocked");
}

// The app's one entry to the in-place refresh (app.setWorldDropHover
// calls this; the drag handlers never touch the DOM preview directly).
export function refreshWorldPreview(app: App): void {
  const grid = document.querySelector('[data-key="world-grid"]');
  if (grid) refreshWorldPreviewIn(grid, app);
  const detail = document.getElementById("hex-detail");
  if (detail) refreshWorldPreviewIn(detail, app);
}

export function worldCountBadge(app: App): number {
  const { state } = app;
  return worldPiecesOf(state).filter(({ copy }) => copy.pos === null).length;
}

const WORLD_DETAIL_MARKER = `<polygon class="hex-stack-marker" points="${hexPoints(HEX_RADIUS - 3)}"/>`;

// The Hex detail's World chassis: the coordinate's plate at readable
// scale, its state spoken once in the tooltip. Pre-reveal the plate is
// the locked one — the layer has not arrived, whatever the coordinate.
export function worldChassisHtml(state: GameState, pos: Hex, snapshot: RateSnapshot): { chassis: string; tip: string } {
  if (!worldEntered(state)) {
    return {
      chassis: `<svg class="world-stack locked" viewBox="-70 -70 140 140" aria-hidden="true">${plate("locked")}<g class="world-glyph dimmed" transform="translate(0,-6) scale(1.6)"><rect x="-4.5" y="-1" width="9" height="7"/><path d="M-2.6-1v-2.2a2.6 2.6 0 0 1 5.2 0V-1"/></g><text class="world-word" y="22" text-anchor="middle">LOCKED</text>${WORLD_DETAIL_MARKER}</svg>`,
      tip: "A prestige that banks Arete discovers World",
    };
  }
  const def = worldEnemyAt(state, pos);
  const reserved = worldCellReserved(state, pos);
  const wrap = (content: string) => `<svg class="world-stack" viewBox="-70 -70 140 140" aria-hidden="true">${content}${WORLD_DETAIL_MARKER}</svg>`;
  if (def && reserved) {
    if (!enemyStateOf(state, def.key).discovered) return { chassis: wrap(plate("reserved") + `<text class="world-word" y="-7" text-anchor="middle">RESERVED</text>`), tip: "Reserved for a future wall" };
    const { inner } = wallEngraving(state, def, true);
    return { chassis: wrap(inner), tip: wallMechanic(def) };
  }
  const occupant = worldOccupantAt(state, pos);
  if (!occupant) return def
    ? { chassis: wrap(clearedFaceHtml(def)), tip: "Lifetime victory · released for World placement" }
    : { chassis: wrap(plate("open")), tip: "Open World cell" };
  const lift = columnLiftsOf(state, snapshot);
  const { inner, tip } = pieceEngraving(state, worldPieceOf(state, occupant.id)!, lift, true);
  return { chassis: wrap(inner), tip };
}
