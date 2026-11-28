import { computed, signal } from "@preact/signals";
import { apply, type Action, type ApplyResult } from "../../engine/apply";
import type { FaderId } from "../../engine/console";
import type { Cell } from "../../engine/hex";
import { disclosureOf } from "../../engine/goal";
import { createInitialState } from "../../engine/state";
import { poolOutstanding, type Presence } from "../../engine/trust";
import type { BreatherState, EntryId, GameState, Habit, HabitClass, HonestyOutcome, SessionState, SessionSummary } from "../../engine/types";
import { Placing } from "../board/placing";
import { SharedSave, type SaveStorage } from "../shared-save";
import { SessionClock } from "./clock";

// The shell (issue #21): what opening the app owes before any game surface
// exists. It loads, migrates and saves through SharedSave (ADR-0032's
// stale-tab guard), offers the explicit recovery (ADR-0082) when a load
// requires it, and asks each habit awaiting a class for one. From upgrade
// mode it opens Begin flow, and in flow it runs the session clock's
// boundary (issue #39). At End it asks the honesty report when
// provisional time is owed, then shows the summary (issue #40). Between
// sessions it takes a banked breather, runs it on the same boundary, and
// shows its result on the next upgrade-mode view (issue #41).

export type Screen =
  | { kind: "recovery"; raw: string; lost: string[]; error: string | null }
  | { kind: "class"; habit: Habit; liveSeconds: number; open: HabitClass[]; error: string | null }
  | { kind: "begin"; error: string | null }
  | { kind: "flow"; error: string | null }
  | { kind: "honesty"; session: SessionState; error: string | null }
  | { kind: "summary"; summary: SessionSummary }
  | { kind: "breather"; running: NonNullable<BreatherState["running"]> }
  | { kind: "breather-result"; result: NonNullable<BreatherState["result"]> }
  | { kind: "almanac"; error: string | null }
  | { kind: "encyclopedia"; entry: EntryId | null }
  | { kind: "ready" };

// The one panel open over upgrade mode, or none: Begin flow (issue #39)
// and the Almanac (issue #43), each with its last refusal as its one
// quiet line, and the Encyclopedia (issue #44) on its list (null) or on
// one entry. Opening one closes the others.
export type Panel = { kind: "begin"; error: string | null } | { kind: "almanac"; error: string | null } | { kind: "encyclopedia"; entry: EntryId | null };

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
  private readonly panel = signal<Panel | null>(null);
  // The flow screen's one quiet line.
  private readonly flowError = signal<string | null>(null);
  // Set by End while provisional time is owed (issue #40): the honesty
  // report shows only then, never mid-session, and the session clock
  // stands still until it is answered. Not saved: a reload lands on the
  // flow screen, and End asks again.
  private readonly ending = signal(false);
  private readonly clock: SessionClock;

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
    const running = state.game.breather.running;
    if (mode === "breather" && running) return { kind: "breather", running };
    const summary = state.game.summary;
    if (mode === "upgrade" && summary && !summary.seen) return { kind: "summary", summary };
    const result = state.game.breather.result;
    if (mode === "upgrade" && result) return { kind: "breather-result", result };
    return this.panel.value ?? { kind: "ready" };
  });

  // `now` is the wall clock. `drift` is the wall clock minus the
  // performance clock, in ms (0 in tests): a step in it is time the page
  // slept through (trust.applyGap).
  constructor(
    storage: SaveStorage,
    readonly now: () => number = () => Date.now(),
    drift: () => number = () => 0,
  ) {
    this.save = new SharedSave(storage, now);
    this.clock = new SessionClock(now, drift);
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
    this.state.value = this.clock.catchUpSinceSave(parsed.state, parsed.savedAt);
    this.persist();
  }

  // The clock boundary (issue #39): the span since the last one goes to
  // the session clock, frozen while End's honesty report waits. Every
  // step is saved.
  boundary(presence: Presence): void {
    const step = this.clock.step(this.state.peek(), presence, this.ending.peek());
    if (step === null) return;
    if ("fault" in step) {
      this.notice.value = `Time couldn't be counted · ${step.fault}`;
      return;
    }
    this.state.value = step.state;
    this.persist();
  }

  openBegin(): void {
    if (this.state.peek().game.mode !== "upgrade") return;
    this.panel.value = { kind: "begin", error: null };
  }

  closePanel(): void {
    this.panel.value = null;
  }

  // The Almanac's door shows in upgrade mode from the first completed
  // session on. Opening rolls the Intentions to today's occurrence, so
  // every line reads the current day or week.
  openAlmanac(): void {
    const state = this.state.peek();
    if (state.game.mode !== "upgrade" || !disclosureOf(state).doors) return;
    this.act({ type: "rollIntentions", now: this.now() });
    this.panel.value = { kind: "almanac", error: null };
  }

  // The Encyclopedia's door shows beside the Almanac's. It opens on the
  // list of revealed entries.
  openEncyclopedia(): void {
    const state = this.state.peek();
    if (state.game.mode !== "upgrade" || !disclosureOf(state).doors) return;
    this.panel.value = { kind: "encyclopedia", entry: null };
  }

  // Opening an entry marks it seen (`readEntry`); null goes back to the list.
  openEntry(id: EntryId | null): void {
    if (this.panel.peek()?.kind !== "encyclopedia") return;
    if (id !== null && !this.act({ type: "readEntry", id }).ok) return;
    this.panel.value = { kind: "encyclopedia", entry: id };
  }

  // A refusal is the open panel's line; a success clears it.
  private panelLine(kind: "begin" | "almanac", result: ApplyResult): void {
    const panel = this.panel.peek();
    if (panel && panel.kind === kind) this.panel.value = { ...panel, error: result.ok ? null : (result.reason ?? null) };
  }

  // An Almanac action, given the wall clock when it needs one. A refusal
  // is the Almanac's line; a success clears it.
  almanacAct(action: Action | ((now: number) => Action)): ApplyResult {
    const result = this.act(typeof action === "function" ? action(this.now()) : action);
    this.panelLine("almanac", result);
    return result;
  }

  // `+ New habit` in the Begin flow panel. A refusal is the panel's line.
  createHabit(name: string, habitClass: HabitClass): string | null {
    const result = this.act({ type: "createHabit", name, habitClass });
    this.panelLine("begin", result);
    return result.ok ? (result.id ?? null) : null;
  }

  // Begin: the habit and the planned length in minutes, in one action.
  beginFlow(habitId: string | null, minutes: number): void {
    const now = this.now();
    const result = this.act({ type: "startSession", habitId: habitId ?? "", target: minutes * 60, now });
    if (!result.ok) {
      this.panelLine("begin", result);
      return;
    }
    this.closePanel();
    this.flowError.value = null;
    this.inspected.value = null;
    this.placing.clear();
    this.clock.start(now);
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
    this.clock.stop();
    this.inspected.value = null;
  }

  // The summary's one control: dismissed, it leads to upgrade mode.
  dismissSummary(): void {
    this.act({ type: "dismissSummary" });
  }

  // `Take breather`: from upgrade mode while one is banked. The calm
  // screen's clock starts now.
  takeBreather(): void {
    const now = this.now();
    if (!this.act({ type: "takeBreather", now }).ok) return;
    this.closePanel();
    this.inspected.value = null;
    this.placing.clear();
    this.clock.start(now);
  }

  // `End early`: the span since the last boundary passes first, so a
  // breather whose deadline has come completes rather than re-banking.
  endBreatherEarly(): void {
    this.boundary("visible");
    if (this.act({ type: "endBreatherEarly" }).ok) this.clock.stop();
  }

  dismissBreatherResult(): void {
    this.act({ type: "dismissBreatherResult" });
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

  // A console fader (issue #58): one level, or with `max` (shift-click)
  // as many as ν affords. A refused purchase changes nothing and says
  // nothing: the fader is already drawn muted.
  buyFader(fader: FaderId, max: boolean): void {
    this.act({ type: "buyFader", fader, max });
  }

  // The prestige confirmation (issue #62), open over the board in upgrade
  // mode. It carries no amount: confirming applies `prestige`, which works
  // out the Arete from the state at that moment. Cancel and a refusal
  // change nothing.
  readonly confirmingPrestige = signal(false);

  openPrestige(): void {
    if (this.state.peek().game.mode === "upgrade") this.confirmingPrestige.value = true;
  }

  cancelPrestige(): void {
    this.confirmingPrestige.value = false;
  }

  prestige(): void {
    this.confirmingPrestige.value = false;
    this.act({ type: "prestige" });
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
