import { describe, expect, it } from "vitest";
import { cellKind } from "./board";
import { apply } from "./apply";
import { advanceIn, applyIn, begin, fresh, giveHabit, giveOscillators, giveProducer, woundWall } from "./fixtures";
import { unplacedOf } from "./placement";
import { deserialize, serialize } from "./save";
import { cloneState } from "./state";
import { entriesOf } from "./encyclopedia";
import { goalOf } from "./goal";
import { grantsOf } from "./levels";
import type { Cell } from "./hex";
import type { BladeRate, GameState, ModuleType } from "./types";

// Roadie opens, and the Blade (spec chunk 05, issue #53), through the
// GameState seam: a conquest that leaves an open cell bordering the marked
// Flint (0,−2) opens Roadie; Roadie's ladder grants the Blade and Arm
// allowance; a Blade turns the charge it receives into 10× damage on the
// wall it faces.

const O = { q: 0, r: 0 };
const NE = { q: 1, r: -1 };
const BASALT_N = { q: 0, r: -1 };
const BASALT_W = { q: -1, r: 0 };
const SHALE = { q: -1, r: 1 };

function must(s: GameState, action: Parameters<typeof applyIn>[1]): void {
  const done = applyIn(s, action);
  if (!done.ok) throw new Error(`fixture ${action.type} failed: ${done.reason}`);
}

function place(s: GameState, module: ModuleType, cell: Cell): void {
  must(s, { type: "placeModule", module, cell });
}

// A Flywheel at the centre patched into a wall worn to 1 HP, then 100 s
// of Engineer flow: the wall falls, and the session is ended and
// dismissed. Producer Lv 1 lifts the Flywheel to 1.05 charge/s, past a
// Basalt's regen of 1.
function conquer(s: GameState, wall: Cell): void {
  giveProducer(s, { modulators: 2 });
  woundWall(s, wall, 1);
  const flywheel = s.game.board.placements.find((p) => p.module === "flywheel");
  if (!flywheel) place(s, "flywheel", O);
  const source = flywheel?.cell ?? O;
  if (s.game.board.cables.length > 0) must(s, { type: "unplugCable", source });
  must(s, { type: "patchCable", cable: "patch", source, target: wall });
  if (!s.records.habits.some((h) => h.habitClass === "engineer")) giveHabit(s, "Piano", "engineer");
  begin(s, null, 0);
  advanceIn(s, 100, "flow");
  if (cellKind(s.game.board, wall) !== "open") throw new Error("fixture conquest failed");
  must(s, { type: "endSession", now: 100 });
  must(s, { type: "dismissSummary" });
}

describe("Roadie opens", () => {
  it("conquering Basalt (0,−1) opens Roadie, and the Goal moves past Reach Flint to Conquer Flint", () => {
    const s = fresh();
    conquer(s, SHALE);
    conquer(s, BASALT_N);
    expect(s.game.openClasses).toContain("roadie");
    expect(goalOf(s)).toBe("Conquer Flint");
  });

  it("conquering Basalt (−1,0) alone doesn't, and the Goal reads Reach Flint", () => {
    const s = fresh();
    conquer(s, SHALE);
    conquer(s, BASALT_W);
    expect(s.game.openClasses).not.toContain("roadie");
    expect(goalOf(s)).toBe("Reach Flint");
  });
});

// Roadie open, through the conquest of Shale and then Basalt (0,−1).
function roadieOpen(): GameState {
  const s = fresh();
  conquer(s, SHALE);
  conquer(s, BASALT_N);
  return s;
}

const HOUR = 3600;

describe("Roadie's ladder", () => {
  it("grants nothing before Roadie opens, however much Roadie credit there is", () => {
    const s = fresh();
    s.records.classCredit.roadie = 30 * HOUR;
    expect(grantsOf(s).allowance.arm).toBe(0);
    expect(grantsOf(s).arrived).not.toContain("blade");
  });

  it("Lv 0 brings the Blade and 1 Arm; Lv 1 +1 Arm; Lv 2 no Arm (it brings the Guard Plate); then +1 Arm a level", () => {
    const s = roadieOpen();
    expect(grantsOf(s).arrived).toContain("blade");
    const arms = [0, 0.5, 1.5, 3, 5].map((h) => {
      s.records.classCredit.roadie = h * HOUR;
      return grantsOf(s).allowance.arm;
    });
    expect(arms).toEqual([1, 2, 2, 3, 4]);
  });

  it("a habit can be created for Roadie, or reattuned to it, once it's open, and not before", () => {
    const closed = fresh();
    expect(applyIn(closed, { type: "createHabit", name: "Drums", habitClass: "roadie" }).ok).toBe(false);
    const s = roadieOpen();
    expect(applyIn(s, { type: "createHabit", name: "Drums", habitClass: "roadie" }).ok).toBe(true);
    const piano = s.records.habits.find((h) => h.habitClass === "engineer")!;
    expect(applyIn(s, { type: "reattuneHabit", habitId: piano.id, habitClass: "roadie" }).ok).toBe(true);
  });
});

// A Blade on `at`, turned clockwise to `facing` (0 = NE, 4 = NW, 5 = N),
// fed by a Flywheel on (0,1) patched into it: Producer credit of 4 h lifts
// the Flywheel to 1.4 charge/s.
function bladeAt(s: GameState, at: Cell, facing: number): void {
  s.records.classCredit.producer = 4 * HOUR;
  for (const p of [...s.game.board.placements]) must(s, { type: "removeModule", cell: p.cell });
  place(s, "blade", at);
  for (let i = 0; i < facing; i++) must(s, { type: "rotateModule", cell: at, turn: "clockwise" });
  place(s, "flywheel", SE);
  must(s, { type: "patchCable", cable: "patch", source: SE, target: at });
}

const SE = { q: 0, r: 1 };
const FLINT = { q: 0, r: -2 };
const NW = 4;
const N = 5;

// The first placed Arm's rate, which these tests make a Blade.
function bladeRate(s: GameState): BladeRate {
  const arm = s.game.rates.arms[0]!;
  if (arm.module !== "blade") throw new Error("expected a Blade");
  return arm;
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.q === b.q && a.r === b.r;
}

describe("the Blade", () => {
  it("a new Blade faces NE", () => {
    const s = roadieOpen();
    place(s, "blade", NE);
    expect(s.game.board.placements.find((p) => p.module === "blade")!.facing).toBe(0);
  });

  it("receiving 1.4 charge/s and facing Basalt, it deals 14/s to it", () => {
    const s = roadieOpen();
    bladeAt(s, O, NW);
    const arm = bladeRate(s);
    expect(arm.chargeReceived.toNumber()).toBeCloseTo(1.4, 9);
    expect(arm.facesWall).toBe(true);
    expect(arm.damage.toNumber()).toBeCloseTo(14, 9);
    const wall = s.game.rates.walls.find((w) => sameCell(w.cell, BASALT_W))!;
    expect(wall.damage.toNumber()).toBeCloseTo(14, 9);
  });

  it("facing an open cell, it deals nothing", () => {
    const s = roadieOpen();
    bladeAt(s, O, 0);
    expect(sameCell(bladeRate(s).faces, NE)).toBe(true);
    expect(bladeRate(s).facesWall).toBe(false);
    expect(bladeRate(s).damage.toNumber()).toBe(0);
    expect(s.game.rates.walls).toEqual([]);
  });

  it("a Blade damages Flint, while a Patch into Flint stays refused", () => {
    const s = roadieOpen();
    bladeAt(s, BASALT_N, N);
    expect(s.game.rates.walls.find((w) => sameCell(w.cell, FLINT))!.damage.toNumber()).toBeCloseTo(14, 9);
    must(s, { type: "unplugCable", source: SE });
    const refused = applyIn(s, { type: "patchCable", cable: "patch", source: SE, target: FLINT });
    expect(refused).toMatchObject({ ok: false, reason: "Only Arm damage." });
  });

  it("a Blade's damage wears the faced wall down in flow", () => {
    const s = roadieOpen();
    bladeAt(s, O, NW);
    begin(s, null, 0);
    advanceIn(s, 100, "flow");
    // 6000 − (14 − 1) × 100.
    expect(s.game.board.walls.find((w) => sameCell(w.cell, BASALT_W))!.hp.toNumber()).toBeCloseTo(4700, 6);
  });
});

describe("turning and moving a Blade", () => {
  it("rotating a Blade is refused in flow and while paused", () => {
    const s = roadieOpen();
    bladeAt(s, O, NW);
    begin(s, null, 0);
    const before = cloneState(s);
    expect(apply(s, { type: "rotateModule", cell: O, turn: "clockwise" })).toMatchObject({ ok: false, state: before });
    must(s, { type: "pauseSession" });
    const paused = cloneState(s);
    expect(apply(s, { type: "rotateModule", cell: O, turn: "counterclockwise" })).toMatchObject({ ok: false, state: paused });
  });

  it("moving a Blade keeps its facing", () => {
    const s = roadieOpen();
    bladeAt(s, O, NW);
    must(s, { type: "moveModule", from: O, to: NE });
    expect(s.game.board.placements.find((p) => p.module === "blade")).toMatchObject({ cell: NE, facing: NW });
  });
});

describe("Arms on the board", () => {
  it("count for the Square's any-module pattern", () => {
    const s = roadieOpen();
    giveOscillators(s, { allowance: 4, arrive: ["square"] });
    giveProducer(s, { modulators: 3 });
    for (const p of [...s.game.board.placements]) must(s, { type: "removeModule", cell: p.cell });
    // The Square at the centre; around it a Blade, a Flywheel and two
    // Sines: 4 of 6 neighbours hold a module only with the Blade.
    place(s, "square", O);
    place(s, "sine", { q: 1, r: 0 });
    place(s, "sine", SE);
    place(s, "flywheel", { q: -1, r: 1 });
    expect(s.game.rates.oscillators.find((o) => o.module === "square")!.instances).toHaveLength(0);
    place(s, "blade", NE);
    expect(s.game.rates.oscillators.find((o) => o.module === "square")!.instances).toHaveLength(1);
  });

  it("if Roadie opens mid-flow, its Blade counts as unplaced at once", () => {
    const s = fresh();
    conquer(s, SHALE);
    giveProducer(s, { modulators: 2 });
    woundWall(s, BASALT_N, 1);
    must(s, { type: "unplugCable", source: O });
    must(s, { type: "patchCable", cable: "patch", source: O, target: BASALT_N });
    begin(s, null, 0);
    expect(unplacedOf(s).arm).toBe(0);
    advanceIn(s, 100, "flow");
    expect(s.game.mode).toBe("flow");
    expect(s.game.openClasses).toContain("roadie");
    expect(unplacedOf(s).arm).toBe(1);
  });

  it("Roadie and a placed Blade round-trip through the save", () => {
    const s = roadieOpen();
    bladeAt(s, O, NW);
    const loaded = deserialize(serialize(s, 1_000)).state!;
    expect(loaded.game.openClasses).toContain("roadie");
    expect(loaded.game.board.placements).toEqual(s.game.board.placements);
    expect(loaded.game.board.cables).toEqual(s.game.board.cables);
    expect(bladeRate(loaded).damage.toNumber()).toBeCloseTo(14, 9);
  });
});

describe("the Arms entry", () => {
  it("is revealed when Roadie opens, and not before", () => {
    const s = fresh();
    conquer(s, SHALE);
    conquer(s, BASALT_W);
    expect(entriesOf(s).map((e) => e.id)).not.toContain("arms");
    conquer(s, BASALT_N);
    const arms = entriesOf(s).find((e) => e.id === "arms")!;
    expect(arms.title).toBe("Arms");
    expect(arms.lines).toContain("Blade · 10 × charge received as damage");
  });
});
