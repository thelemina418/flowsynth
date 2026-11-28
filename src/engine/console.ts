import { hasPrestiged } from "./era";
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
  return hasPrestiged(state);
}

// Each kind of fader, described once: how it is named, where its level
// lives, what its cost curve is and what it spends. Every reader below and
// the console's UI go through this table, never a switch on the kind.
interface FaderKind<F extends FaderId> {
  // Its handle in the DOM: the type, `bus-<category>`, `master-<id>`.
  key(fader: F): string;
  // The hue its fill wears: its category, or none (the Arete register).
  category(fader: F): ModuleCategory | undefined;
  name(fader: F): string;
  // Its one effect line, or null: only master faders carry one.
  effect(fader: F): string | null;
  level(console: ConsoleState, fader: F): number;
  setLevel(console: ConsoleState, fader: F, level: number): void;
  // Its highest level, or null when it has none.
  cap(fader: F): number | null;
  // The growth its costs climb by over the whole curve, or null for an
  // arithmetic curve whose next level costs base + level.
  growth(console: ConsoleState): number | null;
  base(fader: F): number;
  // The balance it spends, and that balance's name in copy.
  balance: "nous" | "arete";
  unit: "ν" | "Arete";
  // Whether the player has it (its type or category arrived), and whether
  // its section is on the console.
  has(state: GameState, fader: F): boolean;
  sectionShown(state: GameState): boolean;
}

// The growth a section's costs climb by: 1.6, less 0.03 a level of its
// taper. Read in hundredths so the cap lands on 1.30 exactly.
function taperedGrowth(console: ConsoleState, taper: MasterId): number {
  return (GROWTH_HUNDREDTHS - TAPER_STEP_HUNDREDTHS * Math.min(TAPER_CAP, console.master[taper] ?? 0)) / 100;
}

type KindOf<K extends FaderId["kind"]> = Extract<FaderId, { kind: K }>;

const KINDS: { [K in FaderId["kind"]]: FaderKind<KindOf<K>> } = {
  channel: {
    key: (f) => f.type,
    category: (f) => categoryOf(f.type),
    name: (f) => moduleName(f.type),
    effect: () => null,
    level: (console, f) => console.channels[f.type] ?? 0,
    setLevel: (console, f, level) => void (console.channels[f.type] = level),
    cap: () => null,
    growth: (console) => taperedGrowth(console, "channelTaper"),
    base: (f) => channelBaseOf(f.type) ?? 0,
    balance: "nous",
    unit: "ν",
    has: (state, f) => channelFaders(state).some((c) => c.kind === "channel" && c.type === f.type),
    sectionShown: (state) => consoleShown(state),
  },
  bus: {
    key: (f) => `bus-${f.category}`,
    category: (f) => f.category,
    name: (f) => BUS_NAMES[f.category],
    effect: () => null,
    level: (console, f) => console.buses[f.category] ?? 0,
    setLevel: (console, f, level) => void (console.buses[f.category] = level),
    cap: () => null,
    growth: (console) => taperedGrowth(console, "busTaper"),
    base: () => BUS_BASE,
    balance: "nous",
    unit: "ν",
    has: (state, f) => busFaders(state).some((b) => b.kind === "bus" && b.category === f.category),
    sectionShown: (state) => busesShown(state),
  },
  master: {
    key: (f) => `master-${f.id}`,
    category: () => undefined,
    name: (f) => MASTER[f.id].name,
    effect: (f) => MASTER[f.id].effect,
    level: (console, f) => console.master[f.id] ?? 0,
    setLevel: (console, f, level) => void (console.master[f.id] = level),
    cap: (f) => MASTER[f.id].cap,
    growth: () => null,
    base: () => 1,
    balance: "arete",
    unit: "Arete",
    has: () => true,
    sectionShown: (state) => masterShown(state),
  },
};

function kindOf<F extends FaderId>(fader: F): FaderKind<F> {
  return KINDS[fader.kind] as unknown as FaderKind<F>;
}

export function faderName(fader: FaderId): string {
  return kindOf(fader).name(fader);
}

// A master fader's one effect line; channels and buses have none.
export function faderEffect(fader: FaderId): string | null {
  return kindOf(fader).effect(fader);
}

// A fader's handle in the DOM: the type for a channel, `bus-<category>`
// for a bus, `master-<id>` for a master fader.
export function faderKey(fader: FaderId): string {
  return kindOf(fader).key(fader);
}

// The hue a fader's fill wears: its category, or none for a master fader
// (the Arete register).
export function faderCategory(fader: FaderId): ModuleCategory | undefined {
  return kindOf(fader).category(fader);
}

// The unit written after a fader's cost: Arete for the master section,
// none for ν, which the console's costs are unless they say otherwise.
export function costUnit(fader: FaderId): "Arete" | null {
  const unit = kindOf(fader).unit;
  return unit === "Arete" ? unit : null;
}

export function levelOf(state: GameState, fader: FaderId): number {
  return kindOf(fader).level(state.game.console, fader);
}

// Whether a fader has reached its cap and takes no more levels.
export function atCap(state: GameState, fader: FaderId): boolean {
  const cap = kindOf(fader).cap(fader);
  return cap !== null && levelOf(state, fader) >= cap;
}

// The next level's cost: base × g^level, g its section's growth; a master
// fader's is level + 1 Arete.
export function costOf(state: GameState, fader: FaderId): Num {
  const kind = kindOf(fader);
  const level = levelOf(state, fader);
  const growth = kind.growth(state.game.console);
  if (growth === null) return D(kind.base(fader) + level);
  return mul(kind.base(fader), pow(growth, level));
}

// What `count` levels from the current one cost together: the geometric
// sum c × (g^count − 1) / (g − 1), with one level read as its own cost so
// a balance of exactly that cost buys it. A master fader's is the
// arithmetic sum from level + 1 on.
function costOfLevels(state: GameState, fader: FaderId, count: number): Num {
  if (count === 0) return D(0);
  const next = costOf(state, fader);
  if (count === 1) return next;
  const growth = kindOf(fader).growth(state.game.console);
  if (growth === null) return add(mul(next, count), (count * (count - 1)) / 2);
  return div(mul(next, sub(pow(growth, count), 1)), growth - 1);
}

// The balance a fader spends: Arete for the master section, ν otherwise.
function balanceFor(state: GameState, fader: FaderId): Num {
  return state.game[kindOf(fader).balance];
}

export function affordable(state: GameState, fader: FaderId): boolean {
  return !atCap(state, fader) && lte(costOf(state, fader), balanceFor(state, fader));
}

// The most levels the balance buys at once: the closed form's estimate,
// settled against the sum itself, and never past a cap.
export function maxAffordable(state: GameState, fader: FaderId): number {
  const balance = balanceFor(state, fader);
  if (!affordable(state, fader)) return 0;
  const kind = kindOf(fader);
  const cap = kind.cap(fader);
  const room = cap === null ? Infinity : cap - levelOf(state, fader);
  let count = 1;
  const growth = kind.growth(state.game.console);
  if (growth !== null) {
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
  const kind = kindOf(fader);
  return kind.sectionShown(state) && kind.has(state, fader);
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
  const kind = kindOf(fader);
  if (count === 0) return { ok: false, reason: `Not enough ${kind.unit} for that fader.` };
  const cost = costOfLevels(state, fader, count);
  const level = levelOf(state, fader) + count;
  // What the balance showed before the spend stays shown after it.
  discloseConsole(state);
  state.game[kind.balance] = max(0, sub(state.game[kind.balance], cost));
  kind.setLevel(state.game.console, fader, level);
  return { ok: true };
}
