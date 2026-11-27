import { formatClock } from "../../engine/clock";
import { className } from "../../engine/habits";
import { fmt } from "../../engine/num";
import { classLevel, grantsOf } from "../../engine/levels";
import { placedCount } from "../../engine/placement";
import type { GameState, Habit, SessionState, SessionSummary } from "../../engine/types";

// The flow screen's readouts (issue #39): the session class's line, the
// Ready count and the ported console clock. Readouts, not sentences.

const BAR_CELLS = 9;

// Hours to one decimal, truncated: 0.85 h reads 0.8h.
export function hours(seconds: number): string {
  return `${(Math.floor(seconds / 360 + 1e-9) / 10).toFixed(1)}h`;
}

// `Engineer · Lv 1 ▕███░░░░░░▏ 0.8h / 1.5h`: the class's level, a fixed
// 9-cell bar of the way to the next threshold, and the class's credited
// hours against that threshold. Null for a habit still awaiting its class.
export function classLine(state: GameState, habit: Habit | undefined): string | null {
  if (!habit || habit.habitClass === null) return null;
  const credit = state.records.classCredit[habit.habitClass];
  const { level, current, next } = classLevel(state, habit.habitClass);
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.floor(((credit - current) / (next - current)) * BAR_CELLS + 1e-9)));
  const bar = `▕${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}▏`;
  return `${className(habit.habitClass)} · Lv ${level} ${bar} ${hours(credit)} / ${hours(next)}`;
}

// `Ready · N`: the unplaced module allowance plus the unused cable
// allowance. It reads live class credit, so a level crossed mid-flow counts
// at once (chunk 06 adds the affordable faders).
export function readyCount(state: GameState): number {
  const grants = grantsOf(state);
  const board = state.game.board;
  const modules = (["oscillator", "modulator"] as const).reduce((sum, category) => sum + Math.max(0, grants.allowance[category] - placedCount(board, category)), 0);
  return modules + Math.max(0, grants.cableAllowance - board.cables.length);
}

// The ported console clock (`8ecaeac^` render.ts sessionClockSeconds and
// focus.ts sessionCaption): a planned session counts down, then counts its
// overrun up from 0; an open-ended one counts up. The caption reads
// `paused`, `open-ended`, `overrun`, or the bare plan figure.
export function clockFigure(session: SessionState): string {
  const { elapsed, target } = session;
  if (target === null) return formatClock(elapsed);
  return formatClock(elapsed < target ? target - elapsed : elapsed - target);
}

export function clockCaption(session: SessionState, paused: boolean): string {
  if (paused) return "paused";
  if (session.target === null) return "open-ended";
  if (session.elapsed >= session.target) return "overrun";
  return formatClock(session.target);
}

// The summary line (issue #40): `+48 210 ν · Engineer +50 min`, with
// ` → Lv 2` when the session crossed a level. Minutes are truncated, like
// every shown figure. A habit still awaiting its class shows only its
// minutes. Chunk 05 appends the HP segment.
export function summaryLine(summary: SessionSummary): string {
  const minutes = Math.floor(summary.seconds / 60 + 1e-9);
  const practice = summary.habitClass === null ? `+${minutes} min` : `${className(summary.habitClass)} +${Math.floor(summary.classSeconds / 60 + 1e-9)} min`;
  const crossed = summary.levelAfter > summary.levelBefore ? ` → Lv ${summary.levelAfter}` : "";
  return `+${fmt(summary.nous)} ν · ${practice}${crossed}`;
}
