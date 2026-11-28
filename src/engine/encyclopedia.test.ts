import { describe, expect, it } from "vitest";
import { advance } from "./advance";
import { apply } from "./apply";
import { entriesOf, hasUnseen } from "./encyclopedia";
import { advanceIn, applyIn, begin, fresh, giveOscillators } from "./fixtures";
import type { Cell } from "./hex";
import type { GameState, ModuleType } from "./types";

// The Encyclopedia (spec chunk 04, issue #44): entries revealed when their
// concept first appears in play, read through `apply`/`advance` and the
// state they return.

const ids = (state: GameState) => entriesOf(state).map((e) => e.id);

const O = { q: 0, r: 0 };
const E = { q: 1, r: 0 };
const SE = { q: 0, r: 1 };
const NE = { q: 1, r: -1 };

function place(s: GameState, module: ModuleType, cell: Cell): void {
  const done = applyIn(s, { type: "placeModule", module, cell });
  if (!done.ok) throw new Error(`fixture ${module} failed: ${done.reason}`);
}

// One completed session of `minutes` on the default Engineer habit.
function session(s: GameState, minutes: number, now = 0): void {
  if (!begin(s, Math.max(10, minutes) * 60, now).ok) throw new Error("fixture session failed");
  advanceIn(s, minutes * 60, "flow");
  const ended = applyIn(s, { type: "endSession", now: now + minutes * 60_000 });
  if (!ended.ok) throw new Error(`fixture end failed: ${ended.reason}`);
}

describe("Encyclopedia reveals", () => {
  it("a fresh start has only Walls, Sine and Triangle revealed, none seen", () => {
    const s = fresh();
    expect(ids(s).sort()).toEqual(["sine", "triangle", "walls"]);
    expect(s.game.encyclopedia.seen).toEqual([]);
    expect(hasUnseen(s)).toBe(true);
  });

  it("Resonance: the first satisfied pattern, and it stays after the layout is taken apart", () => {
    const s = fresh();
    giveOscillators(s, { allowance: 3 });
    place(s, "sine", O);
    place(s, "triangle", E);
    expect(ids(s)).not.toContain("resonance");
    place(s, "triangle", SE);
    expect(ids(s)).toContain("resonance");
    expect(applyIn(s, { type: "removeModule", cell: SE }).ok).toBe(true);
    expect(s.game.rates.oscillators.every((o) => o.instances.length === 0)).toBe(true);
    expect(ids(s)).toContain("resonance");
  });

  it("Charge: an oscillator first receiving charge, kept after the modulator is removed", () => {
    const s = fresh();
    place(s, "flywheel", O);
    expect(ids(s)).not.toContain("charge");
    place(s, "triangle", NE);
    expect(ids(s)).toContain("charge");
    expect(applyIn(s, { type: "removeModule", cell: O }).ok).toBe(true);
    expect(ids(s)).toContain("charge");
  });

  it("Cables: the first cable placed, kept after it is unplugged", () => {
    const s = fresh();
    place(s, "flywheel", O);
    expect(ids(s)).not.toContain("cables");
    expect(applyIn(s, { type: "patchCable", cable: "patch", source: O, target: E }).ok).toBe(true);
    expect(ids(s)).toContain("cables");
    expect(applyIn(s, { type: "unplugCable", source: O }).ok).toBe(true);
    expect(s.game.board.cables).toEqual([]);
    expect(ids(s)).toContain("cables");
  });

  it("Classes and Breather: the first completed session, and the breather it banks; kept once it is taken", () => {
    const s = fresh();
    begin(s, 1500, 0);
    advanceIn(s, 1500, "flow");
    expect(ids(s)).not.toContain("classes");
    expect(applyIn(s, { type: "endSession", now: 1_500_000 }).ok).toBe(true);
    expect(ids(s)).toEqual(expect.arrayContaining(["classes", "breather"]));
    expect(applyIn(s, { type: "dismissSummary" }).ok).toBe(true);
    expect(applyIn(s, { type: "takeBreather", now: 2_000_000 }).ok).toBe(true);
    advanceIn(s, 3600, "breather");
    expect(applyIn(s, { type: "dismissBreatherResult" }).ok).toBe(true);
    expect(s.game.breather.banked).toBeNull();
    expect(ids(s)).toContain("breather");
  });

  it("a session under 10 credited minutes reveals Classes but no Breather", () => {
    const s = fresh();
    session(s, 9);
    expect(ids(s)).toContain("classes");
    expect(ids(s)).not.toContain("breather");
  });

  it("Square arrives with Engineer Lv 2, at the end of the session that reaches it", () => {
    const s = fresh();
    session(s, 90);
    expect(ids(s)).toContain("square");
    expect(ids(s)).not.toContain("saw");
  });

  it("Saw and Release arrive with their levels, at the next commit", () => {
    const s = fresh();
    giveOscillators(s, { arrive: ["saw"] });
    expect(applyIn(s, { type: "selectHabit", id: null }).ok).toBe(true);
    expect(ids(s)).toContain("saw");
    expect(ids(s)).not.toContain("release");
    giveOscillators(s, { arrive: ["release"] });
    expect(applyIn(s, { type: "selectHabit", id: null }).ok).toBe(true);
    expect(ids(s)).toContain("release");
  });

  it("a flow advance is a commit too", () => {
    const s = fresh();
    begin(s, 1500, 0);
    giveOscillators(s, { arrive: ["square"] });
    advanceIn(s, 1, "flow");
    expect(ids(s)).toContain("square");
  });

  it("Pressure and Prestige are not revealed in chunk 04", () => {
    const s = fresh();
    session(s, 90);
    expect(ids(s)).not.toContain("pressure");
    expect(ids(s)).not.toContain("prestige");
  });

  it("an upgrade-mode advance stays deep-equal", () => {
    const s = fresh();
    expect(advance(s, 3600, "upgrade").state).toEqual(s);
  });
});

describe("readEntry", () => {
  it("marks a revealed entry seen, and the unseen-dot shows only while one is unread", () => {
    const s = fresh();
    for (const id of ["walls", "sine"] as const) expect(applyIn(s, { type: "readEntry", id }).ok).toBe(true);
    expect(s.game.encyclopedia.seen).toEqual(["walls", "sine"]);
    expect(hasUnseen(s)).toBe(true);
    expect(applyIn(s, { type: "readEntry", id: "triangle" }).ok).toBe(true);
    expect(hasUnseen(s)).toBe(false);
    // Reading again changes nothing.
    expect(applyIn(s, { type: "readEntry", id: "triangle" }).state.game.encyclopedia.seen).toEqual(["walls", "sine", "triangle"]);
    // A new reveal brings the dot back.
    place(s, "flywheel", O);
    expect(applyIn(s, { type: "patchCable", cable: "patch", source: O, target: E }).ok).toBe(true);
    expect(hasUnseen(s)).toBe(true);
  });

  it("refuses an unrevealed entry and changes nothing", () => {
    const s = fresh();
    const result = apply(s, { type: "readEntry", id: "prestige" });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(s);
  });
});
