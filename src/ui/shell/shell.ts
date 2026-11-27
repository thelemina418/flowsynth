import { computed, signal } from "@preact/signals";
import { advance } from "../../engine/advance";
import { apply, type Action, type ApplyResult } from "../../engine/apply";
import type { Cell } from "../../engine/hex";
import { createInitialState } from "../../engine/state";
import { poolOutstanding, type Presence } from "../../engine/trust";
import type { GameState, Habit, HabitClass, HonestyOutcome, SessionState, SessionSummary } from "../../engine/types";
import { Placing } from "../board/placing";
import { SharedSave, type SaveStorage } from "../shared-save";

// The shell (issue #21): what opening the app owes before any game surface
// exists. It loads, migrates and saves through SharedSave (ADR-0032's
// stale-tab guard), offers the explicit recovery (ADR-0082) when a load
// requires it, and asks each habit awaiting a class for one. From upgrade
// mode it opens Begin flow, and in flow it runs the session clock's
// boundary (issue #39). At End it asks the honesty report when
// provisional time is owed, then shows the summary (issue #40).

export type Screen =
  | { kind: "recovery"; raw: string; lost: string[]; error: string | null }
  | { kind: "class"; habit: Habit; liveSeconds: number; open: HabitClass[]; error: string | null }
  | { kind: "begin"; error: string | null }
  | { kind: "flow"; error: string | null }
  | { kind: "honesty"; session: SessionState; error: string | null }
  | { kind: "summary"; summary: SessionSummary }
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
  // The cell the Hex detail reads (issue #27), or null while it is empty.
  readonly inspected = signal<Cell | null>(null);
  // The Begin flow panel (issue #39): open from upgrade mode, with the
  // last refusal as its one quiet line. The flow screen has its own line.
  private readonly beginOpen = signal(false);
  private readonly beginError = signal<string | null>(null);
  private readonly flowError = signal<string | null>(null);
  // Set by End while provisional time is owed (issue #40): the honesty
  // report shows only then, never mid-session. Not saved: a reload lands
  // on the flow screen, and End asks again.
  private readonly ending = signal(false);
  // The clock boundary's last reading: the wall clock and the drift
  // between the wall and performance clocks, both in ms. Null while no
  // session clock is running.
  private lastWall: number | null = null;
  private lastDrift = 0;

  readonly screen = computed<Screen>(() => {
    const offer = this.recovery.value;
    if (offer) return { kind: "recovery", raw: offer.raw, lost: offer.lost, error: offer.error };
    const state = this.state.value;
    const habit = state.records.habits.find((h) => h.habitClass === null);
    if (habit) {
      return { kind: "class", habit, liveSeconds: liveSeconds(state, habit.id), open: [...state.game.openClasses], error: this.classError.value };
    }
    const mode = state.game.mode;
    const session = state.game.session;
    if (mode === "flow" || mode === "paused") {
      if (this.ending.value && session && poolOutstanding(state)) return { kind: "honesty", session, error: this.flowError.value };
      return { kind: "flow", error: this.flowError.value };
    }
    const summary = state.game.summary;
    if (mode === "upgrade" && summary && !summary.seen) return { kind: "summary", summary };
    if (this.beginOpen.value) return { kind: "begin", error: this.beginError.value };
    return { kind: "ready" };
  });

  // `now` is the wall clock. `drift` is the wall clock minus the
  // performance clock, in ms (0 in tests): a step in it is time the page
  // slept through (trust.applyGap).
  constructor(
    storage: SaveStorage,
    private readonly now: () => number = () => Date.now(),
    private readonly drift: () => number = () => 0,
  ) {
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
    this.state.value = this.reconciled(parsed.state, parsed.savedAt);
    this.persist();
  }

  // A session saved mid-flow (the old console's resume from a save): the
  // wall-clock gap since the save is an offline absence, settled at once
  // by the trust rules, since the page is open again. Paused time credits
  // nothing.
  private reconciled(state: GameState, savedAt: number): GameState {
    const mode = state.game.mode;
    if (mode !== "flow" && mode !== "paused") return state;
    const now = this.now();
    let next = state;
    if (mode === "flow") {
      const away = advance(next, Math.max(0, (now - savedAt) / 1000), "flow", "offline", 0);
      if (away.fault === undefined) next = away.state;
      const back = advance(next, 0, "flow", "visible", 0);
      if (back.fault === undefined) next = back.state;
    }
    this.seed(now);
    return this.marked(next);
  }

  private seed(now: number): void {
    this.lastWall = now;
    this.lastDrift = this.drift();
  }

  // The planned target, marked the first time it is passed (spec chunk
  // 04): once per session. The mark is saved, so a reload never marks it
  // again, and the session runs on.
  private marked(state: GameState): GameState {
    const session = state.game.session;
    if (!session || session.target === null || session.targetSignaled || session.elapsed < session.target) return state;
    const result = apply(state, { type: "signalTarget" });
    return result.ok ? result.state : state;
  }

  // The clock boundary (issue #39): in flow or paused, the wall-clock gap
  // and the drift step since the last boundary go to `advance` (paused
  // time credits nothing). Upgrade mode moves nothing. Every step is
  // saved.
  boundary(presence: Presence): void {
    const state = this.state.peek();
    const mode = state.game.mode;
    const now = this.now();
    if (mode !== "flow" && mode !== "paused") {
      this.lastWall = null;
      return;
    }
    if (this.lastWall === null) {
      this.seed(now);
      return;
    }
    const drift = this.drift();
    const gap = Math.max(0, (now - this.lastWall) / 1000);
    const driftStep = (drift - this.lastDrift) / 1000;
    this.lastWall = now;
    this.lastDrift = drift;
    const walked = advance(state, gap, "flow", presence, driftStep);
    if (walked.fault !== undefined) {
      this.notice.value = `Time couldn't be counted · ${walked.fault}`;
      return;
    }
    this.state.value = this.marked(walked.state);
    this.persist();
  }

  openBegin(): void {
    if (this.state.peek().game.mode !== "upgrade") return;
    this.beginError.value = null;
    this.beginOpen.value = true;
  }

  closeBegin(): void {
    this.beginOpen.value = false;
    this.beginError.value = null;
  }

  // `+ New habit` in the Begin flow panel. A refusal is the panel's line.
  createHabit(name: string, habitClass: HabitClass): string | null {
    const result = this.act({ type: "createHabit", name, habitClass });
    this.beginError.value = result.ok ? null : (result.reason ?? null);
    return result.ok ? (result.id ?? null) : null;
  }

  // Begin: the habit and the planned length in minutes, in one action.
  beginFlow(habitId: string | null, minutes: number): void {
    const now = this.now();
    const result = this.act({ type: "startSession", habitId: habitId ?? "", target: minutes * 60, now });
    if (!result.ok) {
      this.beginError.value = result.reason ?? null;
      return;
    }
    this.closeBegin();
    this.flowError.value = null;
    this.inspected.value = null;
    this.placing.clear();
    this.seed(now);
  }

  // Pause and Resume close the span since the last boundary first, so a
  // paused span never credits and a live one is never lost.
  pause(): void {
    this.boundary("visible");
    this.act({ type: "pauseSession" });
  }

  resume(): void {
    this.boundary("visible");
    this.act({ type: "resumeSession" });
  }

  // End flushes a visible boundary. With provisional time owed it asks
  // the honesty report first; otherwise it ends the session.
  end(): void {
    this.boundary("visible");
    if (poolOutstanding(this.state.peek())) {
      this.flowError.value = null;
      this.ending.value = true;
      return;
    }
    this.finish();
  }

  // The honesty report's answer settles the pool, then the session ends.
  // A paused session resumes for the answer: the report settles in flow,
  // and no time passes between.
  answerHonesty(outcome: HonestyOutcome): void {
    if (this.state.peek().game.mode === "paused") this.act({ type: "resumeSession" });
    const result = this.act({ type: "settleHonestyReport", outcome });
    if (!result.ok) {
      this.flowError.value = result.reason ?? null;
      return;
    }
    this.ending.value = false;
    this.finish();
  }

  private finish(): void {
    const result = this.act({ type: "endSession", now: this.now() });
    this.flowError.value = result.ok ? null : (result.reason ?? null);
    if (!result.ok) return;
    this.lastWall = null;
    this.inspected.value = null;
  }

  // The summary's one control: dismissed, it leads to upgrade mode.
  dismissSummary(): void {
    this.act({ type: "dismissSummary" });
  }

  writeNote(text: string): ApplyResult {
    return this.act({ type: "writeNote", text, now: this.now() });
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

  // The one path for an action: apply, adopt and save on success. A
  // refusal leaves the state as it was.
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
