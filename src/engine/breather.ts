import { EPS } from "./constants";
import { scaledWalls, stepWalls } from "./conquest";
import { earn } from "./era";
import { foughtWall } from "./fought";
import { add, D, mul, NumFault, requireNotNaN } from "./num";
import type { ActionResult } from "./actions";
import type { GameState, WallTally } from "./types";

// A breather doubles the damage walls take; regen stays as it is.
const BREATHER_DAMAGE = 2;

// The breather (spec chunk 04, issue #41; ADR-0095). A session banks one
// (actions.endSession); the player takes it from upgrade mode, and the
// board runs ×2 with Release awake until its length has passed. Breather
// time is pretrusted (ADR-0073): no presence, no honesty report, and no
// practice, class or Intention credit. The payout is closed-form at the
// deadline, since the board is locked: the rate is constant between
// conquests, and only a conquest recomputes the board's rates (issue #51).

function fail(reason: string): ActionResult {
  return { ok: false, reason };
}

export function takeBreather(state: GameState, now: number): ActionResult {
  const game = state.game;
  if (game.mode !== "upgrade") return fail("A breather is taken between sessions.");
  if (game.breather.running) return fail("A breather is already running.");
  if (!game.breather.banked) return fail("No breather is banked.");
  if (game.summary && !game.summary.seen) return fail("Read the session summary first.");
  game.breather.running = { seconds: game.breather.banked.seconds, elapsed: 0, startedAt: now };
  game.breather.banked = null;
  game.mode = "breather";
  return { ok: true };
}

// Ending early pays nothing and puts the same breather back in the bank.
export function endBreatherEarly(state: GameState): ActionResult {
  const game = state.game;
  const running = game.breather.running;
  if (game.mode !== "breather" || !running) return fail("No breather is running.");
  game.breather.banked = { seconds: running.seconds };
  game.breather.running = null;
  game.mode = "upgrade";
  return { ok: true };
}

export function dismissBreatherResult(state: GameState): ActionResult {
  if (!state.game.breather.result) return fail("No breather result to dismiss.");
  state.game.breather.result = null;
  return { ok: true };
}

// `advance(s, seconds, 'breather')`: the wall gap moves the running
// breather on. At its length it completes at the deadline, moving the
// walls and paying breatherTotal × length once (piecewise across
// conquests); seconds past the deadline do nothing.
// Outside a running breather it changes nothing.
export function runBreather(state: GameState, seconds: number): void {
  const game = state.game;
  const running = game.breather.running;
  if (game.mode !== "breather" || !running) return;
  if (!Number.isFinite(seconds)) throw new NumFault("the breather's seconds");
  if (seconds <= 0) return;
  running.elapsed = Math.min(running.seconds, running.elapsed + seconds);
  if (running.elapsed < running.seconds - EPS) return;
  // The breather fights walls (issue #51): its whole length runs through
  // the wall step at 2× damage (regen ×1). A conquest splits it, and each
  // piece pays at the breatherTotal that held through it.
  let paid = D(0);
  const walls: WallTally[] = [];
  stepWalls(state, running.seconds, (span) => {
    paid = requireNotNaN(add(paid, mul(game.rates.breatherTotal, span)), "the breather's nous");
  }, walls, BREATHER_DAMAGE);
  earn(state, paid);
  // The wall still fought at the end, under the breather's damage.
  const fought = foughtWall(game.board, scaledWalls(game.rates, BREATHER_DAMAGE));
  game.breather.result = {
    nous: paid,
    walls: walls.map((w) => ({ ...w, fought: !w.conquered && fought !== null && fought.cell.q === w.cell.q && fought.cell.r === w.cell.r })),
  };
  game.breather.running = null;
  game.mode = "upgrade";
}
