import { transact } from "./state";
import { dismissSummary, endSession, pauseSession, recordSummaryReflection, resumeSession, signalTarget, startSession } from "./actions";
import { addPracticeLog, archiveHabit, chooseHabitClass, createHabit, renameHabit, selectHabit, setHabitColor } from "./habits";
import { createIntention, deleteIntention, editIntention, retainIntentionChoice, rollIntentionOccurrences } from "./intentions";
import { writeNote } from "./notes";
import { moveModule, placeModule, removeModule } from "./placement";
import { computeBoardRates } from "./rates";
import { settleHonestyReport } from "./trust";
import type { Cell } from "./hex";
import type { GameState, IntentionSchedule, HabitClass, HabitColor, HonestyOutcome, ModuleType } from "./types";

// Every player intent and every boundary event that changes state, as one
// discriminated union. `now` is wall-clock epoch ms, passed in so the
// engine stays pure.
export type Action =
  // Habits (between sessions).
  | { type: "createHabit"; name: string; habitClass?: HabitClass }
  | { type: "renameHabit"; id: string; name: string }
  | { type: "recolorHabit"; id: string; color: HabitColor }
  | { type: "archiveHabit"; id: string }
  | { type: "selectHabit"; id: string | null }
  | { type: "chooseClass"; habitId: string; habitClass: HabitClass }
  | { type: "logPractice"; habitId: string; minutes: number; now: number }
  // The session.
  | { type: "startSession"; target: number | null; now: number }
  | { type: "pauseSession" }
  | { type: "resumeSession" }
  | { type: "endSession"; now: number }
  | { type: "signalTarget" }
  | { type: "settleHonestyReport"; outcome: HonestyOutcome }
  | { type: "reflect"; text?: string; slider?: number }
  | { type: "dismissSummary" }
  // Notes.
  | { type: "writeNote"; text: string; now: number }
  // Intentions and their calendar.
  | { type: "createIntention"; habitId: string | null; minutes: number; schedule: IntentionSchedule["kind"]; now: number }
  | { type: "editIntention"; id: string; minutes: number; schedule: IntentionSchedule["kind"]; now: number }
  | { type: "deleteIntention"; id: string }
  | { type: "retainIntention"; id: string }
  | { type: "rollIntentions"; now: number }
  // The board, in upgrade mode only (issue #25).
  | { type: "placeModule"; module: ModuleType; cell: Cell }
  | { type: "moveModule"; from: Cell; to: Cell }
  | { type: "removeModule"; cell: Cell };

export interface ApplyResult {
  ok: boolean;
  // The next state; on a refusal, the state given, untouched.
  state: GameState;
  // The refusal's reason, in player-facing copy.
  reason?: string;
  // The id a create action made.
  id?: string;
  // Intention occurrences the action completed.
  completions?: number;
}

type Step = Omit<ApplyResult, "state">;

function run(state: GameState, action: Action): Step {
  switch (action.type) {
    case "createHabit": {
      const made = createHabit(state, action.name, action.habitClass ?? null);
      return made.ok ? { ok: true, id: made.habit!.id } : { ok: false, reason: made.reason! };
    }
    case "renameHabit": return renameHabit(state, action.id, action.name);
    case "recolorHabit": return setHabitColor(state, action.id, action.color);
    case "archiveHabit": return archiveHabit(state, action.id);
    case "selectHabit": return selectHabit(state, action.id);
    case "chooseClass": return chooseHabitClass(state, action.habitId, action.habitClass);
    case "logPractice": return addPracticeLog(state, action.habitId, action.minutes, action.now);
    case "startSession": return startSession(state, action.target, action.now);
    case "pauseSession": return pauseSession(state);
    case "resumeSession": return resumeSession(state);
    case "endSession": return endSession(state, action.now);
    case "signalTarget": return signalTarget(state);
    case "settleHonestyReport": return settleHonestyReport(state, action.outcome);
    case "reflect": {
      const part: { text?: string; slider?: number } = {};
      if (action.text !== undefined) part.text = action.text;
      if (action.slider !== undefined) part.slider = action.slider;
      return recordSummaryReflection(state, part);
    }
    case "dismissSummary": return dismissSummary(state);
    case "writeNote": return writeNote(state, action.text, action.now);
    case "createIntention": {
      const made = createIntention(state, { habitId: action.habitId, minutes: action.minutes, schedule: action.schedule, now: action.now });
      return made.ok ? { ok: true, id: made.intention!.id } : { ok: false, reason: made.reason! };
    }
    case "editIntention": return editIntention(state, action.id, { minutes: action.minutes, schedule: action.schedule }, action.now);
    case "deleteIntention": return deleteIntention(state, action.id);
    case "retainIntention": return retainIntentionChoice(state, action.id);
    case "rollIntentions":
      rollIntentionOccurrences(state, action.now);
      return { ok: true };
    case "placeModule": return relaid(state, placeModule(state, action.module, action.cell));
    case "moveModule": return relaid(state, moveModule(state, action.from, action.to));
    case "removeModule": return relaid(state, removeModule(state, action.cell));
  }
}

// A layout change recomputes the board's rates once (issue #26); a
// refusal changed nothing, so it recomputes nothing.
function relaid(state: GameState, step: Step): Step {
  if (step.ok) state.game.rates = computeBoardRates(state.game.board);
  return step;
}

function refusalOnFault(action: Action): string {
  if (action.type === "settleHonestyReport") return "The provisional time cannot be credited safely, so nothing was credited.";
  return "That change can't be made safely, so nothing changed.";
}

// The only way state changes. Pure: the state given is never touched. A
// refusal — an invalid action, or a numeric fault (a nonfinite second, a
// NaN Decimal) — returns it as it was, with the reason.
export function apply(state: GameState, action: Action): ApplyResult {
  const done = transact(state, (draft) => run(draft, action), (step) => step.ok);
  if (done.fault !== undefined) return { ok: false, state, reason: refusalOnFault(action) };
  if (!done.result.ok) return { ok: false, state, reason: done.result.reason ?? "That can't be done right now." };
  return { ...done.result, state: done.state };
}
