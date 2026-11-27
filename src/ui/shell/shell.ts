import { computed, signal } from "@preact/signals";
import { apply, type Action, type ApplyResult } from "../../engine/apply";
import { createInitialState } from "../../engine/state";
import type { GameState, Habit, HabitClass } from "../../engine/types";
import { Placing } from "../board/placing";
import { SharedSave, type SaveStorage } from "../shared-save";

// The shell (issue #21): what opening the app owes before any game surface
// exists. It loads, migrates and saves through SharedSave (ADR-0032's
// stale-tab guard), offers the explicit recovery (ADR-0082) when a load
// requires it, and asks each habit awaiting a class for one.

export type Screen =
  | { kind: "recovery"; raw: string; lost: string[]; error: string | null }
  | { kind: "class"; habit: Habit; liveSeconds: number; open: HabitClass[]; error: string | null }
  | { kind: "ready" };

interface Offer {
  raw: string;
  lost: string[];
  error: string | null;
}

// A habit's live credited flow seconds: what the class choice credits.
export function liveSeconds(state: GameState, habitId: string): number {
  return state.records.practiceLog.reduce((sum, entry) => (entry.habitId === habitId && entry.source === "live" ? sum + entry.seconds : sum), 0);
}

export class Shell {
  readonly state = signal<GameState>(createInitialState());
  readonly recovery = signal<Offer | null>(null);
  readonly notice = signal<string | null>(null);
  private readonly classError = signal<string | null>(null);
  private readonly save: SharedSave;
  // The board's pick (issue #25); every placement goes through `act`.
  readonly placing = new Placing(this.state, (action) => this.act(action));

  readonly screen = computed<Screen>(() => {
    const offer = this.recovery.value;
    if (offer) return { kind: "recovery", raw: offer.raw, lost: offer.lost, error: offer.error };
    const state = this.state.value;
    const habit = state.records.habits.find((h) => h.habitClass === null);
    if (habit) {
      return { kind: "class", habit, liveSeconds: liveSeconds(state, habit.id), open: [...state.game.openClasses], error: this.classError.value };
    }
    return { kind: "ready" };
  });

  constructor(storage: SaveStorage, private readonly now: () => number = () => Date.now()) {
    this.save = new SharedSave(storage, now);
  }

  boot(): void {
    const parsed = this.save.load();
    if (parsed === null) return;
    if ("error" in parsed) {
      if (parsed.recoveryRequired) {
        this.recovery.value = { raw: parsed.raw ?? "", lost: parsed.lost ?? [], error: null };
        return;
      }
      this.notice.value = parsed.error;
      return;
    }
    this.save.incorporate(parsed.savedAt);
    this.state.value = parsed.state;
    this.persist();
  }

  // The explicit recovery (ADR-0082): the same bytes through the recovery
  // door. The original is kept before the recovered game is saved, and
  // nothing is adopted unless both land.
  recover(): void {
    const offer = this.recovery.peek();
    if (!offer) return;
    const parsed = this.save.parseRecovered(offer.raw);
    if ("error" in parsed) {
      this.recovery.value = { ...offer, error: parsed.error };
      return;
    }
    let adopted = false;
    try {
      adopted = this.save.adoptRecovered(offer.raw, parsed.state, parsed.savedAt);
    } catch (error) {
      this.recovery.value = { ...offer, error: error instanceof Error ? error.message : String(error) };
      return;
    }
    if (!adopted) {
      this.recovery.value = { ...offer, error: "The recovered game couldn't be saved. The original save is unchanged." };
      return;
    }
    this.state.value = parsed.state;
    this.recovery.value = null;
    const lost = parsed.recovered?.lost ?? offer.lost;
    this.notice.value = `Recovered · ${lost.join(", ")} started at 0`;
    this.persist();
  }

  // Declining adopts nothing: the save stays as it was, nothing writes
  // over it, and the next load offers the same choice.
  declineRecovery(): void {
    this.recovery.value = null;
  }

  chooseClass(habitId: string, habitClass: HabitClass): void {
    const result = apply(this.state.peek(), { type: "chooseClass", habitId, habitClass });
    if (!result.ok) {
      this.classError.value = result.reason ?? null;
      return;
    }
    this.classError.value = null;
    this.state.value = result.state;
    this.persist();
  }

  // The one placement path: apply, adopt and save on success. A refusal
  // leaves the state as it was.
  act(action: Action): ApplyResult {
    const result = apply(this.state.peek(), action);
    if (result.ok) {
      this.state.value = result.state;
      this.persist();
    }
    return result;
  }

  private persist(): void {
    const outcome = this.save.write(this.state.peek(), this.now());
    if (outcome === "refused") this.notice.value = "A newer save is open elsewhere. This tab won't save over it.";
    else if (outcome === "failed") this.notice.value = "The game couldn't be saved in this browser.";
  }
}
