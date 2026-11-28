import type { ActionResult } from "./actions";
import { grantsOf } from "./levels";
import { gt } from "./num";
import type { EncyclopediaState, EntryId, GameState, OscillatorType } from "./types";

export type { EntryId };

// The Encyclopedia (spec chunk 04, issue #44): the voluntary reference,
// authored as data. Each entry is a title, a few short readout lines and a
// reveal predicate over the state. Reveals are a union that only grows:
// every apply/advance commit and every load adds the entries whose
// predicate holds, and nothing takes one back, so an entry stays after
// the layout that revealed it is gone. Opening an entry marks it seen.

export interface Entry {
  id: EntryId;
  title: string;
  lines: readonly string[];
  revealed: (state: GameState) => boolean;
}

const arrived = (module: OscillatorType) => (s: GameState) => grantsOf(s).arrived.includes(module);
// Declared now; chunks 05 (pressure) and 06 (prestige) wire the predicates.
const later = () => false;

export const ENTRIES: readonly Entry[] = [
  {
    id: "resonance",
    title: "Resonance",
    lines: [
      "Pattern satisfied → rate × resonance",
      "First instance · +R",
      "Each further instance · half the one before",
      "One module · several resonances at once",
    ],
    revealed: (s) => s.game.rates.oscillators.some((o) => o.instances.length > 0),
  },
  {
    id: "sine",
    title: "Sine",
    lines: ["Base · 1 ν/s", "Pattern · Triangles on both cells of one opposite pair of neighbours", "R · 1"],
    revealed: arrived("sine"),
  },
  {
    id: "triangle",
    title: "Triangle",
    lines: ["Base · 1 ν/s", "Pattern · oscillators on two neighbours that border each other", "R · 0.75"],
    revealed: arrived("triangle"),
  },
  {
    id: "square",
    title: "Square",
    lines: ["Base · 1.5 ν/s", "Pattern · any module on 4 or more of its 6 neighbours", "R · 1.5 · one instance at most", "Engineer Lv 2"],
    revealed: arrived("square"),
  },
  {
    id: "saw",
    title: "Saw",
    lines: ["Base · 2 ν/s", "Pattern · oscillators on the next two cells in one direction", "R · 2", "Engineer Lv 4"],
    revealed: arrived("saw"),
  },
  {
    id: "release",
    title: "Release",
    lines: ["Flow · 0 ν/s", "Breather · 6 ν/s", "No pattern", "Engineer Lv 6"],
    revealed: arrived("release"),
  },
  {
    id: "charge",
    title: "Charge",
    lines: [
      "Made by modulators from practice",
      "Flywheel · 1 charge/s, +0.1 per Producer hour, up to 3 · 2 cells in its facing",
      "Pulsewell · 0.5 charge/s to each of its 6 neighbours",
      "Oscillator rate × (1 + ln(1 + charge/s))",
    ],
    revealed: (s) => s.game.rates.oscillators.some((o) => gt(o.chargeReceived, 0)),
  },
  {
    id: "cables",
    title: "Cables",
    lines: ["Patch · a modulator's whole output to one target, in place of its reach", "Length · 3 at most", "Cables never cross", "Allowance · Producer levels"],
    revealed: (s) => s.game.board.cables.length > 0,
  },
  {
    id: "walls",
    title: "Walls",
    lines: ["A wall holds a cell", "HP · regen · pressure", "Conquered · the cell is yours for good", "Shale first, outward to Corundum"],
    revealed: () => true,
  },
  {
    id: "pressure",
    title: "Pressure",
    lines: ["A wall's reduction of ν", "Applies to the modules bordering it"],
    revealed: later,
  },
  {
    id: "arms",
    title: "Arms",
    lines: ["Roadie's craft · opened by reaching Flint", "Arms work only beside a wall", "Blade · 10 × charge received as damage", "Turn a Blade to choose its wall"],
    revealed: (s) => s.game.openClasses.includes("roadie"),
  },
  {
    id: "classes",
    title: "Classes",
    lines: [
      "Habit → one class · credited flow time → class level",
      "Engineer · Oscillators",
      "Producer · Modulators and Cables",
      "Lv at 0.5 · 1.5 · 3 · 5 · 8 · 12 · 17 · 23 · 30 h",
      "Nous never buys a level",
    ],
    revealed: (s) => s.records.sessionsCompleted > 0,
  },
  {
    id: "breather",
    title: "Breather",
    lines: [
      "Banked at End · 10 credited min or more",
      "Length · credited time ÷ 5 · 5–15 min",
      "One banked at most · a newer one replaces it",
      "Board × 2 · Release wakes",
      "Pays only when complete",
    ],
    revealed: (s) => s.game.breather.banked !== null || s.game.breather.running !== null || s.game.breather.result !== null,
  },
  {
    id: "prestige",
    title: "Prestige",
    lines: ["Ends an era", "Resets ν and faders", "Board, cables, class levels and allowance stay"],
    revealed: later,
  },
];

export function emptyEncyclopedia(): EncyclopediaState {
  return { revealed: [], seen: [] };
}

export function isEntryId(value: unknown): value is EntryId {
  return ENTRIES.some((e) => e.id === value);
}

// Adds every entry whose predicate now holds. Never removes one.
export function revealEntries(state: GameState): void {
  const book = state.game.encyclopedia;
  for (const entry of ENTRIES) if (!book.revealed.includes(entry.id) && entry.revealed(state)) book.revealed.push(entry.id);
}

// The revealed entries, in authored order. An unrevealed entry is absent.
export function entriesOf(state: GameState): Entry[] {
  const revealed = state.game.encyclopedia.revealed;
  return ENTRIES.filter((e) => revealed.includes(e.id));
}

export function isSeen(state: GameState, id: EntryId): boolean {
  return state.game.encyclopedia.seen.includes(id);
}

// Whether any revealed entry is unread: the door's one quiet dot.
export function hasUnseen(state: GameState): boolean {
  const { revealed, seen } = state.game.encyclopedia;
  return revealed.some((id) => !seen.includes(id));
}

// `readEntry`: opening an entry marks it seen. Only a revealed entry opens.
export function readEntry(state: GameState, id: EntryId): ActionResult {
  const book = state.game.encyclopedia;
  if (!book.revealed.includes(id)) return { ok: false, reason: "That entry isn't in the Encyclopedia yet." };
  if (!book.seen.includes(id)) book.seen.push(id);
  return { ok: true };
}
