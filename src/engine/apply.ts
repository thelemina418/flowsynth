import { NumFault } from "./num";
import { cloneState, requireNoNaN, restoreState } from "./state";
import { dismissSummary, endSession, pauseSession, recordSummaryReflection, resumeSession, signalTarget, startSession } from "./actions";
import { addPracticeLog, archiveHabit, chooseHabitClass, createHabit, renameHabit, selectHabit, setHabitColor } from "./habits";
import { createGoal, deleteGoal, editGoal, retainGoalChoice, rollGoalOccurrences } from "./goals";
import { writeNote } from "./notes";
import { settleHonestyReport } from "./trust";
import type { GameState, GoalSchedule, HabitClass, HabitColor, HonestyOutcome } from "./types";

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
  | { type: "createIntention"; habitId: string | null; minutes: number; schedule: GoalSchedule["kind"]; now: number }
  | { type: "editIntention"; id: string; minutes: number; schedule: GoalSchedule["kind"]; now: number }
  | { type: "deleteIntention"; id: string }
  | { type: "retainIntention"; id: string }
  | { type: "rollIntentions"; now: number };

export interface ApplyResult {
  ok: boolean;
  // The refusal's reason, in player-facing copy.
  reason?: string;
  // The id a create action made.
  id?: string;
  // Intention occurrences the action completed.
  completions?: number;
}

function run(state: GameState, action: Action): ApplyResult {
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
      const made = createGoal(state, { habitId: action.habitId, minutes: action.minutes, schedule: action.schedule, now: action.now });
      return made.ok ? { ok: true, id: made.goal!.id } : { ok: false, reason: made.reason! };
    }
    case "editIntention": return editGoal(state, action.id, { minutes: action.minutes, schedule: action.schedule }, action.now);
    case "deleteIntention": return deleteGoal(state, action.id);
    case "retainIntention": return retainGoalChoice(state, action.id);
    case "rollIntentions":
      rollGoalOccurrences(state, action.now);
      return { ok: true };
  }
}

function refusalOnFault(action: Action): string {
  if (action.type === "settleHonestyReport") return "The provisional time cannot be credited safely, so nothing was credited.";
  return "That change can't be made safely, so nothing changed.";
}

// The only way state changes. A refusal — an invalid action, or a numeric
// fault (a nonfinite second, a NaN Decimal) — leaves the state exactly as it
// was given.
export function apply(state: GameState, action: Action): ApplyResult {
  const pristine = cloneState(state);
  try {
    const result = run(state, action);
    if (!result.ok) {
      restoreState(state, pristine);
      return { ok: false, reason: result.reason ?? "That can't be done right now." };
    }
    requireNoNaN(state);
    return result;
  } catch (error) {
    if (!(error instanceof NumFault)) throw error;
    restoreState(state, pristine);
    return { ok: false, reason: refusalOnFault(action) };
  }
}
