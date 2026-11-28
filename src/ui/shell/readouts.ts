import { formatClock } from "../../engine/clock";
import { className } from "../../engine/habits";
import { div, fmt, gt } from "../../engine/num";
import { wallAt } from "../../engine/map";
import type { FoughtWall } from "../../engine/fought";
import { classLevel, grantsOf } from "../../engine/levels";
import { unplacedOf } from "../../engine/placement";
import type { BreatherState, GameState, Habit, SessionState, SessionSummary, SummaryWall } from "../../engine/types";

// The flow screen's readouts (issue #39): the session class's line, the
// Ready count and the ported console clock. Readouts, not sentences.

const BAR_CELLS = 9;

// Whole minutes, truncated like every shown figure: 59.9 s reads 0.
export function wholeMinutes(seconds: number): number {
  return Math.max(0, Math.floor(seconds / 60 + 1e-9));
}

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
  const unplaced = unplacedOf(state);
  return unplaced.oscillator + unplaced.modulator + Math.max(0, grantsOf(state).cableAllowance - state.game.board.cables.length);
}

const HP_CELLS = 10;

// The fought wall's HP row (issue #50), `Shale ▕███████░░░▏ 412 / 600 HP`:
// a fixed 10-cell bar and the HP against full. A cell stays lit while any
// HP is left, so the bar empties only at the conquest. `width` is the
// figures' widest text for this wall, `<full> / <full> HP`, so the row
// holds its size while the HP falls (ADR-0031).
export function hpRow(wall: FoughtWall): { name: string; bar: string; figures: string; width: number } {
  const lit = Math.max(0, Math.min(HP_CELLS, Math.ceil(div(wall.hp, wall.full).toNumber() * HP_CELLS - 1e-9)));
  const full = fmt(wall.full);
  return {
    name: wall.name,
    bar: `▕${"█".repeat(lit)}${"░".repeat(HP_CELLS - lit)}▏`,
    figures: `${fmt(wall.hp)} / ${full} HP`,
    width: `${full} / ${full} HP`.length,
  };
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
// minutes. Then the walls (issue #50): ` · <Wall> conquered` for each
// conquest, in the order they happened, and ` · <Wall> −<n> HP` for the
// wall still fought at the end, if it lost HP.
export function summaryLine(summary: SessionSummary): string {
  const practice = summary.habitClass === null ? `+${wholeMinutes(summary.seconds)} min` : `${className(summary.habitClass)} +${wholeMinutes(summary.classSeconds)} min`;
  const crossed = summary.levelAfter > summary.levelBefore ? ` → Lv ${summary.levelAfter}` : "";
  return `+${fmt(summary.nous)} ν · ${practice}${crossed}${wallsSegment(summary.walls)}`;
}

function wallsSegment(walls: readonly SummaryWall[]): string {
  const name = (wall: SummaryWall) => wallAt(wall.cell)?.name ?? "";
  const conquered = walls.filter((w) => w.conquered).map((w) => ` · ${name(w)} conquered`);
  const fought = walls.find((w) => w.fought && !w.conquered && gt(w.lost, 0));
  const lost = fought && fmt(fought.lost) !== "0" ? [` · ${name(fought)} −${fmt(fought.lost)} HP`] : [];
  return [...conquered, ...lost].join("");
}

// `10 min`: a breather's length, truncated, for `Breather banked · 10 min`
// and `Take breather · 10 min` (issue #41).
export function breatherMinutes(seconds: number): string {
  return `${wholeMinutes(seconds)} min`;
}

// The calm screen's countdown, `9:41`: the time left, minutes unpadded.
export function breatherClock(running: NonNullable<BreatherState["running"]>): string {
  return formatClock(Math.ceil(running.seconds - running.elapsed - 1e-9)).replace(/^0(?=\d:)/, "");
}

// `Breather complete · +31 400 ν · Shale −220 HP`: the walls segment is
// the summary's (issue #51).
export function breatherResultLine(result: NonNullable<BreatherState["result"]>): string {
  return `Breather complete · +${fmt(result.nous)} ν${wallsSegment(result.walls)}`;
}
