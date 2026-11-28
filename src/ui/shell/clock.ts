import { advance } from "../../engine/advance";
import { apply } from "../../engine/apply";
import type { Presence } from "../../engine/trust";
import type { GameState } from "../../engine/types";

// The session clock's boundary (issue #39), lifted out of the shell. It
// holds the last reading, the wall clock and the drift between the wall
// and performance clocks (both in ms), and turns the span since that
// reading into one `advance`. Null while no clock is running.

export type Step = { state: GameState } | { fault: string } | null;

// The planned target, marked the first time it is passed (spec chunk
// 04): once per session. The mark is saved, so a reload never marks it
// again, and the session runs on.
export function markTargetIfPassed(state: GameState): GameState {
  const session = state.game.session;
  if (!session || session.target === null || session.targetSignaled || session.elapsed < session.target) return state;
  const result = apply(state, { type: "signalTarget" });
  return result.ok ? result.state : state;
}

export class SessionClock {
  private lastWall: number | null = null;
  private lastDrift = 0;

  // `now` is the wall clock. `drift` is the wall clock minus the
  // performance clock, in ms (0 in tests): a step in it is time the page
  // slept through (trust.applyGap).
  constructor(
    private readonly now: () => number,
    private readonly drift: () => number,
  ) {}

  // Starts (or restarts) the clock from this instant.
  start(now: number = this.now()): void {
    this.lastWall = now;
    this.lastDrift = this.drift();
  }

  stop(): void {
    this.lastWall = null;
  }

  // A session saved mid-flow (the old console's resume from a save): the
  // wall-clock gap since the save is an offline absence, settled at once
  // by the trust rules, since the page is open again. Paused time credits
  // nothing. A breather saved running moves on by the same gap, and one
  // whose deadline passed while closed completes here (issue #41).
  catchUpSinceSave(state: GameState, savedAt: number): GameState {
    const mode = state.game.mode;
    const now = this.now();
    if (mode === "breather") {
      const ran = advance(state, Math.max(0, (now - savedAt) / 1000), "breather");
      this.start(now);
      return ran.fault === undefined ? ran.state : state;
    }
    if (mode !== "flow" && mode !== "paused") return state;
    let next = state;
    if (mode === "flow") {
      const away = advance(next, Math.max(0, (now - savedAt) / 1000), "flow", "offline", 0);
      if (away.fault === undefined) next = away.state;
      const back = advance(next, 0, "flow", "visible", 0);
      if (back.fault === undefined) next = back.state;
    }
    this.start(now);
    return markTargetIfPassed(next);
  }

  // One boundary: in flow or paused, the wall-clock gap and the drift
  // step since the last reading go to `advance` (paused time credits
  // nothing). In a breather the wall gap goes to `advance` as breather
  // time, which knows no presence (issue #41). Upgrade mode stops the
  // clock. A frozen clock (End's honesty report waiting) takes a fresh
  // reading and moves nothing, so the time spent answering never credits.
  // Null when nothing moved.
  step(state: GameState, presence: Presence, frozen: boolean): Step {
    const mode = state.game.mode;
    const now = this.now();
    if (mode === "upgrade") {
      this.stop();
      return null;
    }
    if (this.lastWall === null || frozen) {
      this.start(now);
      return null;
    }
    const drift = this.drift();
    const gap = Math.max(0, (now - this.lastWall) / 1000);
    const driftStep = (drift - this.lastDrift) / 1000;
    this.lastWall = now;
    this.lastDrift = drift;
    const walked = mode === "breather" ? advance(state, gap, "breather") : advance(state, gap, "flow", presence, driftStep);
    if (walked.fault !== undefined) return { fault: walked.fault };
    return { state: markTargetIfPassed(walked.state) };
  }
}
