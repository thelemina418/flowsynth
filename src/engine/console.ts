import { grantsOf } from "./levels";
import { categoryOf, channelBaseOf, moduleName } from "./modules";
import { add, D, div, floor, gt, log10, lte, max, mul, pow, sub, type Num } from "./num";
import type { ConsoleState, GameState, MasterId, ModuleCategory, ModuleType } from "./types";

// The console (spec chunk 06, issue #58; GLOSSARY: Console, Fader;
// mechanics-sketch.md, Console): the whole rule set behind one small
// interface, which the rates, `apply`, the UI and the pace runner read.
// The catalogue's channel bases live beside the module catalogue
// (modules.ts), so a new type adds one row there.

// A fader, by the section it sits in: a channel per type, a bus per
// category (issue #60), and the master section's Arete faders (issue #63).
export type FaderId = { kind: "channel"; type: ModuleType } | { kind: "bus"; category: ModuleCategory } | { kind: "master"; id: MasterId };

// Each level multiplies by its step, and each costs a growth times the
// last.
const CHANNEL_STEP = 1.1;
const BUS_STEP = 1.05;
// The growth, in hundredths so a tapered growth is exact: 1.60 less 0.03 a
// taper level.
const GROWTH_HUNDREDTHS = 160;
// A taper level takes 0.03 off its section's growth, down to 1.30: ten
// levels, its cap.
const TAPER_STEP_HUNDREDTHS = 3;
const TAPER_CAP = 10;
// Drive multiplies all oscillator ν by ×1.5 a level, uncapped.
const DRIVE_STEP = 1.5;
// Every category's bus starts at 5 000 ν.
const BUS_BASE = 5000;

const BUS_NAMES: Record<ModuleCategory, string> = { oscillator: "Oscillators", modulator: "Modulators", arm: "Arms" };
const CATEGORY_ORDER: readonly ModuleCategory[] = ["oscillator", "modulator", "arm"];

// The master faders (issue #63; GLOSSARY: Taper, Drive), in console order,
// each with its name, its cap (null: uncapped) and its one effect line.
const MASTER: Record<MasterId, { name: string; cap: number | null; effect: string }> = {
  channelTaper: { name: "Channel Taper", cap: TAPER_CAP, effect: "channel growth −0.03" },
  busTaper: { name: "Bus Taper", cap: TAPER_CAP, effect: "bus growth −0.03" },
  drive: { name: "Drive", cap: null, effect: "oscillator ν ×1.5" },
};
const MASTER_ORDER: readonly MasterId[] = ["channelTaper", "busTaper", "drive"];

export function isMasterId(value: unknown): value is MasterId {
  return typeof value === "string" && (MASTER_ORDER as readonly string[]).includes(value);
}

// A master fader's highest level, or null when it has none.
export function masterCap(id: MasterId): number | null {
  return MASTER[id].cap;
}

export function emptyConsole(): ConsoleState {
  return { channels: {}, buses: {}, master: {}, shown: { console: false, buses: false } };
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

// The master faders the player has: all three, from the first prestige on.
export function masterFaders(state: GameState): FaderId[] {
  return masterShown(state) ? MASTER_ORDER.map((id) => ({ kind: "master", id })) : [];
}

// Whether the master section is on the console: after the first prestige.
export function masterShown(state: GameState): boolean {
  return state.game.prestiges > 0;
}

export function faderName(fader: FaderId): string {
  if (fader.kind === "master") return MASTER[fader.id].name;
  return fader.kind === "channel" ? moduleName(fader.type) : BUS_NAMES[fader.category];
}

// A master fader's one effect line; channels and buses have none.
export function faderEffect(fader: FaderId): string | null {
  return fader.kind === "master" ? MASTER[fader.id].effect : null;
}

export function levelOf(state: GameState, fader: FaderId): number {
  const console = state.game.console;
  if (fader.kind === "master") return console.master[fader.id] ?? 0;
  return (fader.kind === "channel" ? console.channels[fader.type] : console.buses[fader.category]) ?? 0;
}

// Whether a fader has reached its cap and takes no more levels.
export function atCap(state: GameState, fader: FaderId): boolean {
  if (fader.kind !== "master") return false;
  const cap = MASTER[fader.id].cap;
  return cap !== null && levelOf(state, fader) >= cap;
}

// The growth a section's costs climb by over the whole curve: 1.6, less
// 0.03 a level of its taper. Read in hundredths so the cap lands on 1.30
// exactly.
function growthOf(console: ConsoleState, fader: FaderId): number {
  if (fader.kind === "master") return 1;
  const taper = Math.min(TAPER_CAP, console.master[fader.kind === "channel" ? "channelTaper" : "busTaper"] ?? 0);
  return (GROWTH_HUNDREDTHS - TAPER_STEP_HUNDREDTHS * taper) / 100;
}

function baseOf(fader: FaderId): number {
  if (fader.kind === "master") return 1;
  return fader.kind === "channel" ? (channelBaseOf(fader.type) ?? 0) : BUS_BASE;
}

// The next level's cost: base × g^level, g its section's growth; a master
// fader's is level + 1 Arete.
export function costOf(state: GameState, fader: FaderId): Num {
  if (fader.kind === "master") return D(levelOf(state, fader) + 1);
  return mul(baseOf(fader), pow(growthOf(state.game.console, fader), levelOf(state, fader)));
}

// What `count` levels from the current one cost together: the geometric
// sum c × (g^count − 1) / (g − 1), with one level read as its own cost so
// a balance of exactly that cost buys it. A master fader's is the
// arithmetic sum from level + 1 on.
function costOfLevels(state: GameState, fader: FaderId, count: number): Num {
  if (count === 0) return D(0);
  const next = costOf(state, fader);
  if (count === 1) return next;
  if (fader.kind === "master") return add(mul(next, count), (count * (count - 1)) / 2);
  const growth = growthOf(state.game.console, fader);
  return div(mul(next, sub(pow(growth, count), 1)), growth - 1);
}

// The balance a fader spends: Arete for the master section, ν otherwise.
function balanceFor(state: GameState, fader: FaderId): Num {
  return fader.kind === "master" ? state.game.arete : state.game.nous;
}

export function affordable(state: GameState, fader: FaderId): boolean {
  return !atCap(state, fader) && lte(costOf(state, fader), balanceFor(state, fader));
}

// The most levels the balance buys at once: the closed form's estimate,
// settled against the sum itself, and never past a cap.
export function maxAffordable(state: GameState, fader: FaderId): number {
  const balance = balanceFor(state, fader);
  if (!affordable(state, fader)) return 0;
  const cap = fader.kind === "master" ? MASTER[fader.id].cap : null;
  const room = cap === null ? Infinity : cap - levelOf(state, fader);
  let count = 1;
  if (fader.kind !== "master") {
    const growth = growthOf(state.game.console, fader);
    const ratio = add(div(mul(balance, growth - 1), costOf(state, fader)), 1);
    count = Math.max(1, floor(div(log10(ratio), Math.log10(growth))).toNumber());
  }
  while (count < room && lte(costOfLevels(state, fader, count + 1), balance)) count++;
  while (count > 1 && (count > room || gt(costOfLevels(state, fader, count), balance))) count--;
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
  return state.game.console.shown.console || channelFaders(state).some((fader) => affordable(state, fader)) || busesShown(state) || masterShown(state);
}

// Whether a fader is on the console now: its section shows, and the
// player has its type or category.
function faderOn(state: GameState, fader: FaderId): boolean {
  if (fader.kind === "channel") return consoleShown(state) && channelFaders(state).some((f) => f.kind === "channel" && f.type === fader.type);
  if (fader.kind === "master") return masterShown(state);
  return busesShown(state) && busFaders(state).some((f) => f.kind === "bus" && f.category === fader.category);
}

// Sets the disclosure flags once each section first shows. `apply` and
// `advance` run it on every commit, so neither flips back.
export function discloseConsole(state: GameState): void {
  const shown = state.game.console.shown;
  if (!shown.console && consoleShown(state)) shown.console = true;
  if (!shown.buses && busesShown(state)) shown.buses = true;
}

// The multiplier a type's channel level gives its output: ×1.1 a level.
export function channelMultiplier(console: ConsoleState, type: ModuleType): Num {
  return pow(CHANNEL_STEP, console.channels[type] ?? 0);
}

// The multiplier a category's bus level gives every module in it: ×1.05 a
// level (issue #60).
export function busMultiplier(console: ConsoleState, category: ModuleCategory): Num {
  return pow(BUS_STEP, console.buses[category] ?? 0);
}

// A type's whole console multiplier: its channel times its category's bus.
export function faderMultiplier(console: ConsoleState, type: ModuleType): Num {
  return mul(channelMultiplier(console, type), busMultiplier(console, categoryOf(type)));
}

// Drive's multiplier on all oscillator ν (issue #63): ×1.5 a level.
export function driveMultiplier(console: ConsoleState): Num {
  return pow(DRIVE_STEP, console.master.drive ?? 0);
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
  if (atCap(state, fader)) return { ok: false, reason: "That fader is at max." };
  const count = buyMax ? maxAffordable(state, fader) : affordable(state, fader) ? 1 : 0;
  if (count === 0) return { ok: false, reason: fader.kind === "master" ? "Not enough Arete for that fader." : "Not enough ν for that fader." };
  const cost = costOfLevels(state, fader, count);
  const level = levelOf(state, fader) + count;
  // What the balance showed before the spend stays shown after it.
  discloseConsole(state);
  const console = state.game.console;
  if (fader.kind === "master") {
    state.game.arete = max(0, sub(state.game.arete, cost));
    console.master[fader.id] = level;
    return { ok: true };
  }
  state.game.nous = max(0, sub(state.game.nous, cost));
  if (fader.kind === "channel") console.channels[fader.type] = level;
  else console.buses[fader.category] = level;
  return { ok: true };
}
