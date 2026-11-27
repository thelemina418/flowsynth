import { EPS } from "./constants";
import { add, mul, NumFault } from "./num";
import type { ActionResult } from "./actions";
import type { GameState } from "./types";

// The breather (spec chunk 04, issue #41; ADR-0095). A session banks one
// (actions.endSession); the player takes it from upgrade mode, and the
// board runs ×2 with Release awake until its length has passed. Breather
// time is pretrusted (ADR-0073): no presence, no honesty report, and no
// practice, class or Intention credit. The payout is closed-form at the
// deadline, since the board is locked and the rate constant. Nothing here
// recomputes the board's rates.

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
// breather on. At its length it completes at the deadline, paying
// breatherTotal × length once; seconds past the deadline do nothing.
// Outside a running breather it changes nothing.
export function runBreather(state: GameState, seconds: number): void {
  const game = state.game;
  const running = game.breather.running;
  if (game.mode !== "breather" || !running) return;
  if (!Number.isFinite(seconds)) throw new NumFault("the breather's seconds");
  if (seconds <= 0) return;
  running.elapsed = Math.min(running.seconds, running.elapsed + seconds);
  if (running.elapsed < running.seconds - EPS) return;
  const paid = mul(game.rates.breatherTotal, running.seconds);
  game.nous = add(game.nous, paid);
  game.breather.result = { nous: paid };
  game.breather.running = null;
  game.mode = "upgrade";
}
