import { computed, signal, type ReadonlySignal } from "@preact/signals";
import { apply, type Action, type ApplyResult } from "../../engine/apply";
import { boardCells } from "../../engine/board";
import { hexKey, sameHex, type Hex } from "../../engine/hex";
import { categoryOf } from "../../engine/modules";
import { moduleAt, placedCount } from "../../engine/placement";
import type { GameState, ModuleType } from "../../engine/types";

// The pick (issue #25): what the player is holding between a click on a
// tray entry or a placed module and the click (or drop) that places it.
// Drag, click-to-pick and keyboard all end in `commit`, the shell's one
// `apply` path. A target's validity is that same `apply` run dry, so the
// outlines can never disagree with what a click would do.

export type Pick = { from: "tray"; module: ModuleType } | { from: "cell"; cell: Hex };

export type Target = "valid" | "invalid";

export class Placing {
  private readonly held = signal<Pick | null>(null);
  // The last refusal's reason, cleared by the next pick or placement.
  readonly note = signal<string | null>(null);

  // The layout is locked outside upgrade mode (ADR-0001): no pick survives.
  readonly locked = computed(() => this.state.value.game.mode !== "upgrade");
  readonly pick = computed<Pick | null>(() => (this.locked.value ? null : this.held.value));

  // Each owned or wall cell's standing as a target for the pick. Dark
  // cells stay quiet: they carry no detail.
  readonly targets = computed<ReadonlyMap<string, Target>>(() => {
    const pick = this.pick.value;
    const targets = new Map<string, Target>();
    if (!pick) return targets;
    const state = this.state.value;
    for (const { cell, kind } of boardCells(state.game.board)) {
      if (kind === "dark") continue;
      targets.set(hexKey(cell), apply(state, actionOnto(pick, cell)).ok ? "valid" : "invalid");
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
    const game = this.state.value.game;
    const category = categoryOf(module);
    return game.arrived.includes(module) && placedCount(game.board, category) < game.allowance[category];
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
  clickCell(cell: Hex): void {
    if (this.locked.value) return;
    const pick = this.pick.value;
    if (!pick) {
      if (moduleAt(this.state.value.game.board, cell)) this.pickCell(cell);
      return;
    }
    if (pick.from === "cell" && sameHex(pick.cell, cell)) {
      this.clear();
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

  pickCell(cell: Hex): void {
    if (this.locked.value || !moduleAt(this.state.value.game.board, cell)) return;
    this.note.value = null;
    this.held.value = { from: "cell", cell: { q: cell.q, r: cell.r } };
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

function actionOnto(pick: Pick, cell: Hex): Action {
  return pick.from === "tray" ? { type: "placeModule", module: pick.module, cell } : { type: "moveModule", from: pick.cell, to: cell };
}
