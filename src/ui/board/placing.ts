import { computed, signal, type ReadonlySignal } from "@preact/signals";
import type { Action, ApplyResult } from "../../engine/apply";
import { cableFrom, cableRefusal, jackRefusal } from "../../engine/cables";
import { cellKey, lifetimeCells, sameCell, type Cell } from "../../engine/hex";
import { hasFacing } from "../../engine/modules";
import { moduleAt, placementRefusal, trayRefusal, type Turn } from "../../engine/placement";
import type { CableType, GameState, ModuleType } from "../../engine/types";

// The pick (issue #25): what the player is holding between a click on a
// tray entry or a placed module and the click (or drop) that places it.
// Drag, click-to-pick and keyboard all end in `commit`, the shell's one
// `apply` path. A target's validity is the engine's `placementRefusal`,
// the rules `apply` itself runs first, so the outlines can never disagree
// with what a click would do, and holding a pick never recomputes rates.
//
// A cable (issue #33) is three clicks: the tray's cable entry (`cable`),
// a modulator's jack (`jack`), then a target. A placed cable is picked by
// its plug (`plug`), then re-aimed at a new target or unplugged on the
// tray. Its outlines read the engine's `cableRefusal` the same way.

export type Pick =
  | { from: "tray"; module: ModuleType }
  | { from: "cell"; cell: Cell }
  | { from: "cable"; cable: CableType }
  | { from: "jack"; cable: CableType; source: Cell }
  | { from: "plug"; source: Cell };

export type Target = "valid" | "invalid";

export class Placing {
  private readonly held = signal<Pick | null>(null);
  // The last refusal's reason, cleared by the next pick or placement.
  readonly note = signal<string | null>(null);

  // The layout is locked outside upgrade mode (ADR-0001): no pick survives.
  readonly locked = computed(() => this.state.value.game.mode !== "upgrade");
  readonly pick = computed<Pick | null>(() => (this.locked.value ? null : this.held.value));

  // Every cell's standing as a target for the pick: open, wall or dark.
  readonly targets = computed<ReadonlyMap<string, Target>>(() => {
    const pick = this.pick.value;
    const targets = new Map<string, Target>();
    if (!pick) return targets;
    const state = this.state.value;
    for (const cell of lifetimeCells()) targets.set(cellKey(cell), refusalOnto(state, pick, cell) === null ? "valid" : "invalid");
    return targets;
  });

  // The jack a held cable runs from, while one is plugged or picked.
  readonly source = computed<Cell | null>(() => {
    const pick = this.pick.value;
    return pick?.from === "jack" || pick?.from === "plug" ? pick.source : null;
  });

  constructor(
    private readonly state: ReadonlySignal<GameState>,
    private readonly commit: (action: Action) => ApplyResult,
  ) {}

  // A tray entry is available while its category has allowance left, or as
  // the place a picked module (or plug) returns to.
  canTake(module: ModuleType): boolean {
    if (this.locked.value) return false;
    const pick = this.pick.value;
    if (pick?.from === "cell" || pick?.from === "plug") return true;
    return trayRefusal(this.state.value, module) === null;
  }

  // The cable allowance not yet patched (issue #33).
  unusedCables(): number {
    const game = this.state.value.game;
    return Math.max(0, game.cableAllowance - game.board.cables.length);
  }

  // A cable entry is available while allowance is left, or as the place a
  // picked plug (or module) returns to.
  canTakeCable(): boolean {
    if (this.locked.value) return false;
    const pick = this.pick.value;
    return pick?.from === "cell" || pick?.from === "plug" || this.unusedCables() > 0;
  }

  clear(): void {
    this.held.value = null;
  }

  // A tray entry: returns a picked module to unplaced, unplugs a picked
  // plug, or picks (and un-picks) its type.
  clickTray(module: ModuleType): void {
    if (this.locked.value) return;
    const pick = this.pick.value;
    if (pick?.from === "cell" || pick?.from === "plug") {
      this.returnToTray();
      return;
    }
    this.note.value = null;
    this.held.value = pick?.from === "tray" && pick.module === module ? null : { from: "tray", module };
  }

  // The cable entry: the same, for the cable.
  clickCable(cable: CableType): void {
    if (this.locked.value) return;
    const pick = this.pick.value;
    if (pick?.from === "cell" || pick?.from === "plug") {
      this.returnToTray();
      return;
    }
    this.note.value = null;
    const holding = pick?.from === "cable" || pick?.from === "jack";
    this.held.value = holding || this.unusedCables() === 0 ? null : { from: "cable", cable };
  }

  // A drop or click on the tray: a picked module returns to unplaced, a
  // picked plug unplugs; anything else is let go.
  returnToTray(): void {
    const pick = this.pick.value;
    if (pick?.from === "cell") this.run({ type: "removeModule", cell: pick.cell });
    else if (pick?.from === "plug") this.run({ type: "unplugCable", source: pick.source });
    else this.clear();
  }

  // A cell: places, moves or patches the pick there, or picks the module
  // it holds.
  clickCell(cell: Cell): void {
    if (this.locked.value) return;
    const pick = this.pick.value;
    if (!pick) {
      if (moduleAt(this.state.value.game.board, cell)) this.pickCell(cell);
      return;
    }
    if (pick.from === "cable") {
      // The second click: a modulator's jack takes the cable.
      const refused = jackRefusal(this.state.value.game.board, cell);
      if (refused === null) this.held.value = { from: "jack", cable: pick.cable, source: { q: cell.q, r: cell.r } };
      this.note.value = refused;
      return;
    }
    if (pick.from === "jack" && sameCell(pick.source, cell)) {
      // A click on the plugged jack lets the cable go.
      this.clear();
      return;
    }
    if (pick.from === "cell" && sameCell(pick.cell, cell)) {
      // A click on the picked modulator turns it and keeps the pick
      // (issue #31); on any other module it drops the pick.
      const module = moduleAt(this.state.value.game.board, cell)?.module;
      if (module && hasFacing(module)) this.rotate(cell, "clockwise");
      else this.clear();
      return;
    }
    this.run(actionOnto(pick, cell)!);
  }

  // The drag's start: the dragged thing is picked as a click would pick it.
  pickModule(module: ModuleType): void {
    if (this.locked.value || !this.canTake(module) || this.pick.value?.from === "plug") return;
    this.note.value = null;
    this.held.value = { from: "tray", module };
  }

  pickCell(cell: Cell): void {
    if (this.locked.value || !moduleAt(this.state.value.game.board, cell)) return;
    this.note.value = null;
    this.held.value = { from: "cell", cell: { q: cell.q, r: cell.r } };
  }

  // A placed cable's plug (issue #33): a click picks it, or lets it go
  // when it is already picked; a drag picks it on its start.
  clickPlug(source: Cell): void {
    const pick = this.pick.value;
    if (pick?.from === "plug" && sameCell(pick.source, source)) this.clear();
    else this.pickPlug(source);
  }

  pickPlug(source: Cell): void {
    if (this.locked.value || !cableFrom(this.state.value.game.board, source)) return;
    this.note.value = null;
    this.held.value = { from: "plug", source: { q: source.q, r: source.r } };
  }

  // Turns the module on the cell (issue #31): the picked modulator by click
  // or R, or with nothing picked the one in the Hex detail. The pick, if
  // any, stays; a refusal (an oscillator, an empty cell) only leaves its
  // note when something was picked, so a stray R stays quiet.
  rotate(cell: Cell, turn: Turn): void {
    if (this.locked.value) return;
    const result = this.commit({ type: "rotateModule", cell, turn });
    this.note.value = result.ok || !this.pick.value ? null : (result.reason ?? null);
  }

  // The cell R turns: the picked placed module, else the inspected one.
  rotationCell(inspected: Cell | null): Cell | null {
    const pick = this.pick.value;
    if (pick?.from === "cell") return pick.cell;
    return pick ? null : inspected;
  }

  private run(action: Action): void {
    const result = this.commit(action);
    if (result.ok) {
      this.note.value = null;
      this.clear();
    } else {
      this.note.value = result.reason ?? null;
    }
  }
}

// The action a click on `cell` would take with this pick; a held cable
// entry takes none until a jack is plugged.
function actionOnto(pick: Pick, cell: Cell): Action | null {
  switch (pick.from) {
    case "tray": return { type: "placeModule", module: pick.module, cell };
    case "cell": return { type: "moveModule", from: pick.cell, to: cell };
    case "cable": return null;
    case "jack": return { type: "patchCable", cable: pick.cable, source: pick.source, target: cell };
    case "plug": return { type: "repatchCable", source: pick.source, target: cell };
  }
}

// Why a click on `cell` would be refused: the placement or cable rules
// `apply` runs first, or, with the cable entry held, whether that cell's
// jack can take a cable.
function refusalOnto(state: GameState, pick: Pick, cell: Cell): string | null {
  const action = actionOnto(pick, cell);
  if (action === null) return jackRefusal(state.game.board, cell);
  switch (action.type) {
    case "patchCable":
    case "repatchCable":
      return cableRefusal(state, action);
    case "placeModule":
    case "moveModule":
      return placementRefusal(state, action);
    default:
      return null;
  }
}
