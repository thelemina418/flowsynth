import type { GameState } from "./types";

// The interim fresh state (issue #15): no board, no economy — the real-life
// records start empty and the mode starts between sessions.
export function createInitialState(): GameState {
  return {
    mode: "upgrade",
    sessionIndex: 0,
    sessionsCompleted: 0,
    muted: false,
    notificationAsked: false,
    notes: [],
    habits: [],
    activeHabitId: null,
    practiceLog: [],
    sessionRecords: [],
    goals: [],
    session: null,
    summary: null,
    nextId: 1,
  };
}
