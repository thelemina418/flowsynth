import { grantsOf } from "./levels";
import { channelBaseOf, moduleName } from "./modules";
import { add, D, div, floor, gt, log10, lte, max, mul, pow, sub, type Num } from "./num";
import type { ConsoleState, GameState, ModuleType } from "./types";

// The console (spec chunk 06, issue #58; GLOSSARY: Console, Fader;
// mechanics-sketch.md, Console): the whole rule set behind one small
// interface, which the rates, `apply`, the UI and the pace runner read.
// The catalogue's channel bases live beside the module catalogue
// (modules.ts), so a new type adds one row there.

// A fader, by the section it sits in. Chunk 06's later tickets add the
// bus and master kinds.
export type FaderId = { kind: "channel"; type: ModuleType };

// Each level multiplies by this, and each costs this many times the last.
const CHANNEL_STEP = 1.25;
const CHANNEL_GROWTH = 1.6;

export function emptyConsole(): ConsoleState {
  return { channels: {}, shown: { console: false } };
}

// The channel faders the player has: one per arrived type with a channel
// base, in arrival order.
export function channelFaders(state: GameState): FaderId[] {
  return grantsOf(state)
    .arrived.filter((type) => channelBaseOf(type) !== null)
    .map((type) => ({ kind: "channel", type }));
}

export function faderName(fader: FaderId): string {
  return moduleName(fader.type);
}

export function levelOf(state: GameState, fader: FaderId): number {
  return state.game.console.channels[fader.type] ?? 0;
}

// The next level's cost: base × 1.6^level.
export function costOf(state: GameState, fader: FaderId): Num {
  return mul(channelBaseOf(fader.type) ?? 0, pow(CHANNEL_GROWTH, levelOf(state, fader)));
}

// What `count` levels from the current one cost together: the geometric
// sum c × (g^count − 1) / (g − 1), with one level read as its own cost so
// a balance of exactly that cost buys it.
function costOfLevels(state: GameState, fader: FaderId, count: number): Num {
  if (count === 0) return D(0);
  const next = costOf(state, fader);
  if (count === 1) return next;
  return div(mul(next, sub(pow(CHANNEL_GROWTH, count), 1)), CHANNEL_GROWTH - 1);
}

export function affordable(state: GameState, fader: FaderId): boolean {
  return lte(costOf(state, fader), state.game.nous);
}

// The most levels the balance buys at once: the closed form's estimate,
// settled against the sum itself.
export function maxAffordable(state: GameState, fader: FaderId): number {
  const nous = state.game.nous;
  if (!affordable(state, fader)) return 0;
  const ratio = add(div(mul(nous, CHANNEL_GROWTH - 1), costOf(state, fader)), 1);
  let count = Math.max(1, floor(div(log10(ratio), Math.log10(CHANNEL_GROWTH))).toNumber());
  while (lte(costOfLevels(state, fader, count + 1), nous)) count++;
  while (count > 1 && gt(costOfLevels(state, fader, count), nous)) count--;
  return count;
}

// Whether the console is on the board: once shown it stays (the saved,
// monotonic flag), and before that it shows the moment any fader is
// affordable.
export function consoleShown(state: GameState): boolean {
  return state.game.console.shown.console || channelFaders(state).some((fader) => affordable(state, fader));
}

// Sets the disclosure flag once the console first shows. `apply` and
// `advance` run it on every commit, so it never flips back.
export function discloseConsole(state: GameState): void {
  if (!state.game.console.shown.console && consoleShown(state)) state.game.console.shown.console = true;
}

// The multiplier a type's channel level gives its output: ×1.25 a level.
export function channelMultiplier(console: ConsoleState, type: ModuleType): Num {
  return pow(CHANNEL_STEP, console.channels[type] ?? 0);
}

export interface FaderPurchase {
  ok: boolean;
  reason?: string;
}

// A purchase (the `buyFader` action): one level, or with `max` as many as
// the balance affords. Upgrade mode only, a fader on the console only,
// and never one the balance can't pay for. The caller recomputes the
// rates once on success.
export function buyFader(state: GameState, fader: FaderId, buyMax = false): FaderPurchase {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Faders are set between sessions." };
  const on = consoleShown(state) && channelFaders(state).some((f) => f.type === fader.type);
  if (!on) return { ok: false, reason: "That fader isn't on the console." };
  const count = buyMax ? maxAffordable(state, fader) : affordable(state, fader) ? 1 : 0;
  if (count === 0) return { ok: false, reason: "Not enough ν for that fader." };
  const cost = costOfLevels(state, fader, count);
  state.game.console.shown.console = true;
  state.game.nous = max(0, sub(state.game.nous, cost));
  state.game.console.channels[fader.type] = levelOf(state, fader) + count;
  return { ok: true };
}
