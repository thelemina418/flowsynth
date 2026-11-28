import { grantsOf } from "./levels";
import { categoryOf, channelBaseOf, moduleName } from "./modules";
import { add, D, div, floor, gt, log10, lte, max, mul, pow, sub, type Num } from "./num";
import type { ConsoleState, GameState, ModuleCategory, ModuleType } from "./types";

// The console (spec chunk 06, issue #58; GLOSSARY: Console, Fader;
// mechanics-sketch.md, Console): the whole rule set behind one small
// interface, which the rates, `apply`, the UI and the pace runner read.
// The catalogue's channel bases live beside the module catalogue
// (modules.ts), so a new type adds one row there.

// A fader, by the section it sits in: a channel per type, a bus per
// category (issue #60). Chunk 06's later tickets add the master kind.
export type FaderId = { kind: "channel"; type: ModuleType } | { kind: "bus"; category: ModuleCategory };

// Each level multiplies by its step, and each costs this many times the
// last.
const CHANNEL_STEP = 1.25;
const BUS_STEP = 1.1;
const GROWTH = 1.6;
// Every category's bus starts at 5 000 ν.
const BUS_BASE = 5000;

const BUS_NAMES: Record<ModuleCategory, string> = { oscillator: "Oscillators", modulator: "Modulators", arm: "Arms" };
const CATEGORY_ORDER: readonly ModuleCategory[] = ["oscillator", "modulator", "arm"];

export function emptyConsole(): ConsoleState {
  return { channels: {}, buses: {}, shown: { console: false, buses: false } };
}

// The channel faders the player has: one per arrived type with a channel
// base, in arrival order.
export function channelFaders(state: GameState): FaderId[] {
  return grantsOf(state)
    .arrived.filter((type) => channelBaseOf(type) !== null)
    .map((type) => ({ kind: "channel", type }));
}

// The bus faders the player has: one per category among the arrived
// types (Arms once Roadie opens), in category order.
export function busFaders(state: GameState): FaderId[] {
  const has = new Set(grantsOf(state).arrived.map(categoryOf));
  return CATEGORY_ORDER.filter((category) => has.has(category)).map((category) => ({ kind: "bus", category }));
}

export function faderName(fader: FaderId): string {
  return fader.kind === "channel" ? moduleName(fader.type) : BUS_NAMES[fader.category];
}

export function levelOf(state: GameState, fader: FaderId): number {
  const console = state.game.console;
  return (fader.kind === "channel" ? console.channels[fader.type] : console.buses[fader.category]) ?? 0;
}

function baseOf(fader: FaderId): number {
  return fader.kind === "channel" ? (channelBaseOf(fader.type) ?? 0) : BUS_BASE;
}

// The next level's cost: base × 1.6^level.
export function costOf(state: GameState, fader: FaderId): Num {
  return mul(baseOf(fader), pow(GROWTH, levelOf(state, fader)));
}

// What `count` levels from the current one cost together: the geometric
// sum c × (g^count − 1) / (g − 1), with one level read as its own cost so
// a balance of exactly that cost buys it.
function costOfLevels(state: GameState, fader: FaderId, count: number): Num {
  if (count === 0) return D(0);
  const next = costOf(state, fader);
  if (count === 1) return next;
  return div(mul(next, sub(pow(GROWTH, count), 1)), GROWTH - 1);
}

export function affordable(state: GameState, fader: FaderId): boolean {
  return lte(costOf(state, fader), state.game.nous);
}

// The most levels the balance buys at once: the closed form's estimate,
// settled against the sum itself.
export function maxAffordable(state: GameState, fader: FaderId): number {
  const nous = state.game.nous;
  if (!affordable(state, fader)) return 0;
  const ratio = add(div(mul(nous, GROWTH - 1), costOf(state, fader)), 1);
  let count = Math.max(1, floor(div(log10(ratio), Math.log10(GROWTH))).toNumber());
  while (lte(costOfLevels(state, fader, count + 1), nous)) count++;
  while (count > 1 && gt(costOfLevels(state, fader, count), nous)) count--;
  return count;
}

// Whether the bus section is on the console: once shown it stays (its own
// saved, monotonic flag), and before that it shows the moment any bus
// fader is affordable (issue #60).
export function busesShown(state: GameState): boolean {
  return state.game.console.shown.buses || busFaders(state).some((fader) => affordable(state, fader));
}

// Whether the console is on the board: once shown it stays (the saved,
// monotonic flag), and before that it shows the moment any fader is
// affordable.
export function consoleShown(state: GameState): boolean {
  return state.game.console.shown.console || channelFaders(state).some((fader) => affordable(state, fader)) || busesShown(state);
}

// Whether a fader is on the console now: its section shows, and the
// player has its type or category.
function faderOn(state: GameState, fader: FaderId): boolean {
  if (fader.kind === "channel") return consoleShown(state) && channelFaders(state).some((f) => f.kind === "channel" && f.type === fader.type);
  return busesShown(state) && busFaders(state).some((f) => f.kind === "bus" && f.category === fader.category);
}

// Sets the disclosure flags once each section first shows. `apply` and
// `advance` run it on every commit, so neither flips back.
export function discloseConsole(state: GameState): void {
  const shown = state.game.console.shown;
  if (!shown.console && consoleShown(state)) shown.console = true;
  if (!shown.buses && busesShown(state)) shown.buses = true;
}

// The multiplier a type's channel level gives its output: ×1.25 a level.
export function channelMultiplier(console: ConsoleState, type: ModuleType): Num {
  return pow(CHANNEL_STEP, console.channels[type] ?? 0);
}

// The multiplier a category's bus level gives every module in it: ×1.1 a
// level (issue #60).
export function busMultiplier(console: ConsoleState, category: ModuleCategory): Num {
  return pow(BUS_STEP, console.buses[category] ?? 0);
}

// A type's whole console multiplier: its channel times its category's bus.
export function faderMultiplier(console: ConsoleState, type: ModuleType): Num {
  return mul(channelMultiplier(console, type), busMultiplier(console, categoryOf(type)));
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
  if (!faderOn(state, fader)) return { ok: false, reason: "That fader isn't on the console." };
  const count = buyMax ? maxAffordable(state, fader) : affordable(state, fader) ? 1 : 0;
  if (count === 0) return { ok: false, reason: "Not enough ν for that fader." };
  const cost = costOfLevels(state, fader, count);
  const level = levelOf(state, fader) + count;
  // What the balance showed before the spend stays shown after it.
  discloseConsole(state);
  state.game.nous = max(0, sub(state.game.nous, cost));
  const console = state.game.console;
  if (fader.kind === "channel") console.channels[fader.type] = level;
  else console.buses[fader.category] = level;
  return { ok: true };
}
