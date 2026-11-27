import { computed, signal, type ReadonlySignal } from "@preact/signals";
import type { Action, ApplyResult } from "../../engine/apply";
import { cellKey, lifetimeCells, sameCell, type Cell } from "../../engine/hex";
import { hasFacing } from "../../engine/modules";
import { moduleAt, placementRefusal, trayRefusal, type PlacementAction, type Turn } from "../../engine/placement";
import type { GameState, ModuleType } from "../../engine/types";

// The pick (issue #25): what the player is holding between a click on a
// tray entry or a placed module and the click (or drop) that places it.
// Drag, click-to-pick and keyboard all end in `commit`, the shell's one
// `apply` path. A target's validity is the engine's `placementRefusal`,
// the rules `apply` itself runs first, so the outlines can never disagree
// with what a click would do, and holding a pick never recomputes rates.

export type Pick = { from: "tray"; module: ModuleType } | { from: "cell"; cell: Cell };

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
    for (const cell of lifetimeCells()) {
      targets.set(cellKey(cell), placementRefusal(state, actionOnto(pick, cell)) === null ? "valid" : "invalid");
    }
    return targets;
  });

  constructor(
    private readonly state: ReadonlySignal<GameState>,
    private readonly commit: (action: Action) => ApplyResult,
  ) {}

  // A tray entry is available while its category has allowance left, or as
  // the place a picked module returns to.
  canTake(module: ModuleType): boolean {
    if (this.locked.value) return false;
    if (this.pick.value?.from === "cell") return true;
    return trayRefusal(this.state.value, module) === null;
  }

  clear(): void {
    this.held.value = null;
  }

  // A tray entry: returns a picked module to unplaced, or picks (and
  // un-picks) its type.
  clickTray(module: ModuleType): void {
    if (this.locked.value) return;
    const pick = this.pick.value;
    if (pick?.from === "cell") {
      this.returnToTray();
      return;
    }
    this.note.value = null;
    this.held.value = pick?.module === module ? null : { from: "tray", module };
  }

  returnToTray(): void {
    const pick = this.pick.value;
    if (pick?.from !== "cell") {
      this.clear();
      return;
    }
    this.run({ type: "removeModule", cell: pick.cell });
  }

  // A cell: places or moves the pick there, or picks the module it holds.
  clickCell(cell: Cell): void {
    if (this.locked.value) return;
    const pick = this.pick.value;
    if (!pick) {
      if (moduleAt(this.state.value.game.board, cell)) this.pickCell(cell);
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
    this.run(actionOnto(pick, cell));
  }

  // The drag's start: the dragged thing is picked as a click would pick it.
  pickModule(module: ModuleType): void {
    if (this.locked.value || !this.canTake(module)) return;
    this.note.value = null;
    this.held.value = { from: "tray", module };
  }

  pickCell(cell: Cell): void {
    if (this.locked.value || !moduleAt(this.state.value.game.board, cell)) return;
    this.note.value = null;
    this.held.value = { from: "cell", cell: { q: cell.q, r: cell.r } };
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

function actionOnto(pick: Pick, cell: Cell): PlacementAction {
  return pick.from === "tray" ? { type: "placeModule", module: pick.module, cell } : { type: "moveModule", from: pick.cell, to: cell };
}
