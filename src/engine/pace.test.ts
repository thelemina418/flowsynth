import { describe, expect, it } from "vitest";
import { applyIn, giveHabit, giveOscillators, giveProducer, openRoadie, ownCells } from "./fixtures";
import { buyCheapestFader, creditedHoursOf, DEFAULT_TENDING, followGoal, formatPaceReport, placeAllowanceGreedily, prestigeWhenWorthwhile, PROGRESSION_MILESTONES, runPace, type MilestoneProbe, type PaceTurn } from "./pace";
import { D } from "./num";
import { PRESTIGE_AT } from "./era";
import { createInitialState } from "./state";
import { advance } from "./advance";
import { apply } from "./apply";
import type { GameState } from "./types";

// The pace runner (spec chunk 01, issue #20): a scripted reasonable player
// driven through `apply` and `advance`. Its numbers are consulted, never
// asserted; these tests pin the report's shape and its dry-stretch flag.

describe("the pace report", () => {
  it("lists every progression-map milestone beside its target, reached or not", () => {
    const report = runPace({ creditedHours: 3 });
    const ids = report.milestones.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([
      "wall:shale", "wall:corundum",
      "class-open:engineer", "class-open:roadie", "class-open:mixer",
      "class-level-5:producer",
      "first-prestige",
      "gate:obsidian", "gate:corundum", "gate:master",
    ]));
    for (const m of report.milestones) {
      expect(typeof m.label).toBe("string");
      expect(typeof m.target).toBe("string");
      expect(m.reachedAtHours === null || typeof m.reachedAtHours === "number").toBe(true);
    }
    expect(report.creditedHours).toBeGreaterThanOrEqual(3);
    expect(report.sessions).toBeGreaterThan(0);
    expect(Array.isArray(report.dryStretches)).toBe(true);
  });
});

describe("dry stretches", () => {
  // Two synthetic milestones: one at 1h credited, the next at 4h. Flow is
  // read each minute, so they land on the hour.
  const synthetic: MilestoneProbe[] = [
    { id: "a", label: "A", target: "1h", reached: (s) => creditedHoursOf(s) >= 1 },
    { id: "b", label: "B", target: "4h", reached: (s) => creditedHoursOf(s) >= 4 },
  ];

  it("flags a stretch over 2 credited hours with no new milestone", () => {
    const report = runPace({ creditedHours: 5, milestones: synthetic });
    expect(report.dryStretches).toHaveLength(1);
    expect(report.dryStretches[0]!.fromHours).toBeCloseTo(1);
    expect(report.dryStretches[0]!.toHours).toBeCloseTo(4);
  });

  it("flags the tail from the last milestone to the end of the run", () => {
    const report = runPace({ creditedHours: 3, milestones: [] });
    expect(report.dryStretches).toEqual([{ fromHours: 0, toHours: expect.closeTo(10 / 3) }]);
  });
});

describe("the tending seams", () => {
  it("places the allowance once before the first session, then per session places, patches, buys faders, takes the breather and weighs prestige (ADR-0095)", () => {
    const calls: string[] = [];
    const hook = (name: string) => () => { calls.push(name); };
    runPace({
      creditedHours: 50 / 60,
      milestones: [],
      tending: {
        takeBankedBreathers: hook("breathers"),
        buyCheapestFader: hook("fader"),
        placeAllowance: hook("allowance"),
        patchChargeToNearestWall: hook("patch"),
        prestigeWhenWorthwhile: hook("prestige"),
      },
    });
    // The prestige step comes last, so the breather pays into the era it
    // ends (issue #64).
    expect(calls).toEqual(["allowance", "allowance", "patch", "fader", "breathers", "prestige"]);
  });
});

describe("the breather step", () => {
  it("takes each banked breather in full: take, run it to its length, dismiss the result", () => {
    // Three 50-minute sessions each bank a 10-minute breather. The player
    // takes it, runs breather time for its whole 600 s, and lands back in
    // upgrade mode with the result dismissed.
    const seen: { mode: string; seconds: number; after: string; result: boolean }[] = [];
    const report = runPace({
      creditedHours: 2.5,
      milestones: [],
      tending: {
        takeBankedBreathers: (turn) =>
          DEFAULT_TENDING.takeBankedBreathers({
            get state() { return turn.state; },
            get now() { return turn.now; },
            get eraStartHours() { return turn.eraStartHours; },
            apply: (action) => turn.apply(action),
            advance: (seconds, mode) => {
              const r = turn.advance(seconds, mode);
              seen.push({ mode, seconds, after: turn.state.game.mode, result: turn.state.game.breather.result !== null });
              return r;
            },
          }),
      },
    });
    expect(report.sessions).toBe(3);
    expect(seen).toEqual(Array.from({ length: 3 }, () => ({ mode: "breather", seconds: 600, after: "upgrade", result: true })));
    expect(report.breathersTaken).toBe(3);
  });

  it("pays the breather's ν into the era", () => {
    // No prestige: an era ended mid-run would zero the ν compared.
    const without = runPace({ creditedHours: 2.5, milestones: [], tending: { takeBankedBreathers: () => {}, prestigeWhenWorthwhile: () => {} } });
    const taken = runPace({ creditedHours: 2.5, milestones: [], tending: { prestigeWhenWorthwhile: () => {} } });
    expect(without.breathersTaken).toBe(0);
    expect(taken.nous.toNumber()).toBeGreaterThan(without.nous.toNumber());
  });

  it("prints the breathers taken and each open class's level", () => {
    // Four 50-minute sessions alternate Engineer and Producer: 100 minutes
    // each, past 0.5 h and 1.5 h, so both classes read Lv 2.
    // No faders: they bring Basalt down sooner, and Roadie opening would
    // share the rotation.
    const text = formatPaceReport(runPace({ creditedHours: 3, milestones: [], tending: { buyCheapestFader: () => {} } }));
    expect(text).toContain("Breathers taken: 4\n");
    expect(text).toContain("Classes: Engineer Lv 2, Producer Lv 2\n");
  });
});

describe("the class-level probes", () => {
  it("report Engineer and Producer level 5 with the credited hours they were reached at", () => {
    // Lv 5 is 8 h on the class. Sessions alternate, Engineer first, so
    // Engineer passes 8 h 30 minutes into its 10th session, the run's 19th
    // (15h30m credited), and Producer 30 minutes into the 20th (16h20m).
    // The ν/s greedy player fights no wall, so Roadie never opens to share
    // the rotation.
    const report = runPace({ creditedHours: 20, tending: { placeAllowance: placeAllowanceGreedily } });
    const at = (id: string) => report.milestones.find((m) => m.id === id)!;
    expect(at("class-level-5:engineer").tracked).toBe(true);
    expect(at("class-level-5:engineer").reachedAtHours).toBeCloseTo(15.5);
    expect(at("class-level-5:producer").reachedAtHours).toBeCloseTo(16 + 20 / 60);
    expect(at("class-level-5:roadie").reachedAtHours).toBeNull();
  });
});

// The greedy placement before the first session only: the board the
// opening allowance makes, before any class level grants more. No breather
// is taken, so the era's ν is flow ν alone.
function openingOnly(): { tending: { placeAllowance: (turn: PaceTurn) => void; takeBankedBreathers: () => void; buyCheapestFader: () => void } } {
  let first = true;
  return {
    tending: {
      placeAllowance: (turn) => {
        if (first) placeAllowanceGreedily(turn);
        first = false;
      },
      takeBankedBreathers: () => {},
      // No faders: these pin the layout's own figures (issue #64).
      buyCheapestFader: () => {},
    },
  };
}

// The Goal-following layout before the first session only.
function openingOnlyGoal(): { tending: { placeAllowance: (turn: PaceTurn) => void; takeBankedBreathers: () => void; buyCheapestFader: () => void } } {
  let first = true;
  return {
    tending: {
      placeAllowance: (turn) => {
        if (first) followGoal(turn);
        first = false;
      },
      takeBankedBreathers: () => {},
      // No faders: these pin the layout's own figures (issue #64).
      buyCheapestFader: () => {},
    },
  };
}

describe("placing the allowance", () => {
  it("places the opening allowance, and the report gives the board's ν/s and the era's ν", () => {
    // The two Sines and the Flywheel go down before the first session, the
    // Flywheel's reach on the Sine at (0,0). Sessions alternate Engineer and
    // Producer, and the Flywheel's 1 charge/s grows by 0.1 per Producer hour
    // when a session ends. The opening's walls press 29% on (0,0) and 34%
    // on (1,0) (issue #52): sessions 1–2 run at 0.71 × (1 + ln 2) + 0.66
    // ν/s, sessions 3–4 at 0.71 × (1 + ln(2 + 1/12)) + 0.66, each 3000 s.
    // The board ends at 0.71 × (1 + ln(2 + 1/6)) + 0.66.
    const report = runPace({ creditedHours: 3, ...openingOnly() });
    expect(report.sessions).toBe(4);
    expect(report.placements).toHaveLength(3);
    expect(report.rate.toNumber()).toBeCloseTo(1.91896, 4);
    expect(report.nous.toNumber()).toBeCloseTo(22_519.5, 0);
  });

  it("reads the era's ν for the report, not the balance (issue #61)", () => {
    // The same run from an era already 5e5 ν in, all of it spent.
    const start = createInitialState();
    start.game.eraNous = D(5e5);
    const report = runPace({ creditedHours: 3, start, ...openingOnly() });
    expect(report.nous.toNumber()).toBeCloseTo(522_519.5, 0);
  });

  it("places the third oscillator Engineer Lv 1 grants after the first session, and resonates (issue #38)", () => {
    // One 50-minute Engineer session passes 0.5 h: Lv 1, a third
    // oscillator. The greedy player lays a Triangle beside both Sines.
    const report = runPace({ creditedHours: 0.1 });
    expect(report.placements.filter((p) => p.module !== "flywheel")).toHaveLength(3);
    expect(report.rate.toNumber()).toBeGreaterThan(3);
  });

  it("finds a resonating layout given allowance 3", () => {
    // Three oscillators of base 1 make exactly 3 ν/s unless one resonates.
    const start = createInitialState();
    giveOscillators(start, { allowance: 3 });
    const report = runPace({ creditedHours: 3, start, tending: { placeAllowance: placeAllowanceGreedily } });
    expect(report.placements.filter((p) => p.module !== "flywheel")).toHaveLength(3);
    expect(report.rate.toNumber()).toBeGreaterThan(3);
  });

  it("prints the board's ν/s, its charge/s, its layout and the era's ν", () => {
    const text = formatPaceReport(runPace({ creditedHours: 3, ...openingOnly() }));
    // Rates read as the Hex detail reads them, truncated: 1.918… ν/s, and
    // the Flywheel's 1 + 0.1 × 5/3 Producer hours = 1.166… charge/s.
    expect(text).toContain(
      "Board: 2 oscillators, 1 modulator, 1.91 ν/s, 1.16 charge/s — Sine (0,0), Sine (1,0), Flywheel (0,1) facing N\n",
    );
    expect(text).toContain("Era ν: 22 519");
  });

  it("prints each patched wall's damage/s and the cable on the board line", () => {
    // A Flywheel patched into Basalt before the run delivers its 1 charge/s
    // there as damage, through one Engineer session. Basalt's regen matches
    // it, so the wall still stands at the end (Shale would fall, issue #49).
    // The Sines make 0.71 and 0.66 ν/s under the opening's pressure (issue #52).
    const start = createInitialState();
    applyIn(start, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 1 } });
    applyIn(start, { type: "patchCable", cable: "patch", source: { q: 0, r: 1 }, target: { q: 0, r: -1 } });
    const text = formatPaceReport(runPace({ creditedHours: 0.1, start, ...openingOnly() }));
    expect(text).toContain(
      "Board: 2 oscillators, 1 modulator, 1.37 ν/s, 1.0 charge/s, Basalt 1.0 damage/s — Flywheel (0,1) facing NE, Sine (0,0), Sine (1,0), Patch (0,1) → (0,-1)\n",
    );
  });

  it("places the Flywheel where its facing raises total ν/s over the oscillators alone", () => {
    // The opening owns four cells: the two Sines take (0,0) and (1,0), and
    // from either cell left the Flywheel's reach meets one Sine at most.
    // Facing N from (0,1), it charges the Sine at (0,0), the less pressed
    // of the two (29% to 34%, issue #52): 1 + ln 2 at 1 charge/s, so the
    // board makes 0.71 × (1 + ln 2) + 0.66 = 1.862… ν/s.
    const report = runPace({ creditedHours: 0.1, ...openingOnly() });
    expect(report.placements).toEqual([
      { cell: { q: 0, r: 0 }, module: "sine" },
      { cell: { q: 1, r: 0 }, module: "sine" },
      { cell: { q: 0, r: 1 }, module: "flywheel", facing: 5 },
    ]);
    expect(report.rate.toNumber()).toBeCloseTo(1.8621, 4);
  });

  it("leaves the Patch unused when no Patch raises total ν/s", () => {
    // Patched, the Flywheel would deliver to one cell in place of its
    // reach: at best the same Sine, which raises nothing, and a wall, which
    // lowers ν/s. Wall-seeking is chunk 05's.
    const report = runPace({ creditedHours: 0.1, ...openingOnly() });
    expect(report.cables).toEqual([]);
  });

  it("patches a modulator whose reach meets nothing into the oscillator it most raises", () => {
    // A Flywheel already at (1,-1) faces NE, off the board's owned cells.
    // The Sines take (0,0) and (1,0); a Patch onto either gives it 1 + ln 2,
    // and onto (0,0), the less pressed, raises the most (issue #52).
    const start = createInitialState();
    applyIn(start, { type: "placeModule", module: "flywheel", cell: { q: 1, r: -1 } });
    const report = runPace({ creditedHours: 0.1, start, ...openingOnly() });
    expect(report.cables).toHaveLength(1);
    const [cable] = report.cables;
    expect(cable!.type).toBe("patch");
    expect(cable!.source).toEqual({ q: 1, r: -1 });
    const target = report.placements.find((p) => p.cell.q === cable!.target.q && p.cell.r === cable!.target.r);
    expect(target?.module).toBe("sine");
    expect(cable!.target).toEqual({ q: 0, r: 0 });
    expect(report.rate.toNumber()).toBeCloseTo(1.8621, 4);
  });

  it("applies only actions the engine takes", () => {
    // Every candidate goes through `apply`; a refused one is never kept.
    const results: boolean[] = [];
    runPace({
      creditedHours: 0.1,
      tending: {
        placeAllowance: (turn) =>
          placeAllowanceGreedily({
            get state() { return turn.state; },
            get now() { return turn.now; },
            get eraStartHours() { return turn.eraStartHours; },
            apply: (action) => { const r = turn.apply(action); results.push(r.ok); return r; },
            advance: (s, m) => turn.advance(s, m),
          }),
      },
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(Boolean)).toBe(true);
  });

  it("yields the same report for the same script", () => {
    const script = () => {
      const start = createInitialState();
      giveOscillators(start, { allowance: 3 });
      return { creditedHours: 5, start };
    };
    expect(formatPaceReport(runPace(script()))).toBe(formatPaceReport(runPace(script())));
  });
});

// The Goal-following player (spec chunk 05, issue #55): while the Goal
// names a wall, the layout makes that wall fall soonest.
describe("fighting the Goal's wall", () => {
  it("conquers Shale in the first session: the opening Flywheel patched into it nets 0.9/s", () => {
    // 600 HP at 1 − 0.1 = 0.9/s falls 667 s in, inside the first 50-minute
    // session. Milestones are read each minute of flow, so at 12 min.
    const report = runPace({ creditedHours: 0.1 });
    const shale = report.milestones.find((m) => m.id === "wall:shale")!;
    expect(shale.tracked).toBe(true);
    expect(shale.reachedAtHours).toBeCloseTo(12 / 60);
  });
});

describe("the Goal-following player's ties", () => {
  it("brings down the Basalt beside the marked Flint, so Roadie opens with the first Basalt", () => {
    // Both Basalts fall equally soon to the same patches; the one at
    // (0,−1) also serves the next Goal, `Reach Flint`.
    const report = runPace({ creditedHours: 6 });
    const at = (id: string) => report.milestones.find((m) => m.id === id)!.reachedAtHours;
    expect(at("wall:basalt")).not.toBeNull();
    expect(at("class-open:roadie")).toBe(at("wall:basalt"));
  });
});

describe("the fight layout", () => {
  it("keeps every feeder on the Blade: the ν/s pass never re-patches one away", () => {
    // Roadie open with Shale and Basalt (0,−1) owned: the Goal is
    // `Conquer Flint`. A Blade at (0,−1) faces it; both Flywheels feed the
    // Blade, so it receives their whole output.
    const start = createInitialState();
    openRoadie(start);
    giveProducer(start, { modulators: 2, cables: 2 });
    const report = runPace({ creditedHours: 0.1, start, ...openingOnlyGoal() });
    expect(report.walls.map((w) => w.name)).toEqual(["Flint"]);
    expect(report.walls[0]!.damage.toNumber()).toBeCloseTo(10 * report.charge.toNumber(), 6);
  });
});

describe("building up to a fall", () => {
  it("adds feeders that only together outpace the wall's regen", () => {
    // Shale, Basalt (0,−1) and the marked Flint owned: the Goal is
    // `Conquer Schist`. Two Flywheels at 1.15 charge/s (1.5 Producer
    // hours) and two cables. One feeding the Blade on (−1,1) deals 11.5/s
    // against Schist's regen 15, so it never falls; both net 8/s. Neither
    // alone shortens a fall, but each raises the damage.
    const start = createInitialState();
    openRoadie(start);
    ownCells(start, [{ q: 0, r: -2 }]);
    giveProducer(start, { modulators: 2, cables: 2 });
    const report = runPace({ creditedHours: 0.05, start, ...openingOnlyGoal() });
    expect(report.walls.map((w) => w.name)).toEqual(["Schist"]);
    expect(report.walls[0]!.damage.toNumber()).toBeCloseTo(23, 6);
  });
});

// A turn on one state, outside a run: the hooks' own seam.
function turnOn(start: GameState, eraStartHours = 0): PaceTurn {
  let state = start;
  return {
    get state() { return state; },
    get now() { return 0; },
    get eraStartHours() { return eraStartHours; },
    apply: (action) => { const r = apply(state, action); state = r.state; return r; },
    advance: (seconds, mode) => { const r = advance(state, seconds, mode); state = r.state; return r; },
  };
}

// The console (spec chunk 06, issue #64): between sessions the player buys
// the cheapest affordable fader, again and again, until none is.
describe("buying faders", () => {
  it("buys the cheapest affordable ν fader until none is affordable", () => {
    // A fresh start has the Sine (base 10), the Triangle (15) and the
    // Flywheel (25), each cost ×1.6 a level. 100 ν buys Sine 10, Triangle
    // 15, Sine 16, Triangle 24, Flywheel 25, leaving 10: under Sine's
    // 25.6, Triangle's 38.4 and Flywheel's 40.
    const start = createInitialState();
    start.game.nous = D(100);
    const turn = turnOn(start);
    buyCheapestFader(turn);
    expect(turn.state.game.console.channels).toEqual({ sine: 2, triangle: 2, flywheel: 1 });
    expect(turn.state.game.nous.toNumber()).toBeCloseTo(10, 6);
  });
});

// An era `hours` credited hours into the run, at `arete` squared times the
// divisor (PRESTIGE_AT), so the era is worth exactly `arete` Arete.
function eraAt(hours: number, arete: number): GameState {
  const state = createInitialState();
  giveHabit(state, "Piano", "engineer").habit.seconds = hours * 3600;
  state.game.eraNous = D(arete * arete * PRESTIGE_AT);
  return state;
}

// Moves the run to `hours` credited, at an era worth `arete`.
function later(turn: PaceTurn, hours: number, arete: number): void {
  turn.state.records.habits[0]!.seconds = hours * 3600;
  turn.state.game.eraNous = D(arete * arete * PRESTIGE_AT);
}

// The prestige step (spec chunk 06, issue #64): the player reads the
// Arete the era would bank per credited hour of it at each visit, and ends
// the era at the first visit where that has stopped rising. Then it spends
// all its Arete on the master faders, cheapest first.
describe("prestiging when worthwhile", () => {
  it("waits while the era is worth no Arete", () => {
    const turn = turnOn(eraAt(8, 0.9));
    prestigeWhenWorthwhile(turn);
    later(turn, 9, 0.99);
    prestigeWhenWorthwhile(turn);
    expect(turn.state.game.prestiges).toBe(0);
  });

  it("keeps the era at its first Arete: Arete per hour has just risen from nothing", () => {
    const turn = turnOn(eraAt(8, 3));
    prestigeWhenWorthwhile(turn);
    expect(turn.state.game.prestiges).toBe(0);
  });

  it("keeps the era while Arete per hour still rises", () => {
    // 2 Arete in 8 hours is 0.25 an hour; 3 in 8.5 is 0.35.
    const turn = turnOn(eraAt(8, 2));
    prestigeWhenWorthwhile(turn);
    later(turn, 8.5, 3);
    prestigeWhenWorthwhile(turn);
    expect(turn.state.game.prestiges).toBe(0);
  });

  it("prestiges once Arete per hour stops rising, and spends the Arete cheapest first", () => {
    // 3 Arete in 8 hours is 0.375 an hour; still 3 at 9 hours is 0.33.
    // All three master faders cost 1 at level 0; ties keep the console's
    // order.
    const turn = turnOn(eraAt(8, 3));
    prestigeWhenWorthwhile(turn);
    later(turn, 9, 3);
    prestigeWhenWorthwhile(turn);
    expect(turn.state.game.prestiges).toBe(1);
    expect(turn.state.game.console.master).toEqual({ channelTaper: 1, busTaper: 1, drive: 1 });
    expect(turn.state.game.arete.toNumber()).toBe(0);
  });

  it("counts the era's hours from its start, not the run's", () => {
    // The era began at 7.5 h: 3 Arete in half an hour is 6 an hour, and 4
    // in one hour is 4: it prestiges. From the run's start, 3 in 8 hours
    // and 4 in 8.5 would still be rising.
    const turn = turnOn(eraAt(8, 3), 7.5);
    prestigeWhenWorthwhile(turn);
    later(turn, 8.5, 4);
    prestigeWhenWorthwhile(turn);
    expect(turn.state.game.prestiges).toBe(1);
  });

  it("records each era the run ends: where it ended, its length and its Arete", () => {
    // An era worth 3 Arete at the start. The first session's visit reads 3
    // Arete in 50 minutes; the second's, 3 in 100: it prestiges.
    const report = runPace({ creditedHours: 1.5, start: eraAt(0, 3), milestones: [] });
    expect(report.eras).toHaveLength(1);
    expect(report.eras[0]!.arete.toNumber()).toBe(3);
    expect(report.eras[0]!.endsAtHours).toBeCloseTo(100 / 60);
    expect(report.eras[0]!.lengthHours).toBeCloseTo(100 / 60);
  });
});

describe("the era milestones", () => {
  it("report the first prestige and the ends of the second and third eras at the hours they came", () => {
    // Each era is worth 3 Arete from its first breather on, so each ends
    // at its second session's visit. The probes read the prestige count.
    const probes = PROGRESSION_MILESTONES.filter((m) => ["first-prestige", "second-era-ends", "third-era-ends"].includes(m.id));
    expect(probes.map((m) => m.label)).toEqual(["First prestige (Sketch gate)", "Second era ends", "Third era ends"]);
    const report = runPace({
      creditedHours: 5,
      start: eraAt(0, 3),
      milestones: probes,
      tending: {
        takeBankedBreathers: (turn) => {
          DEFAULT_TENDING.takeBankedBreathers(turn);
          turn.state.game.eraNous = D(9 * PRESTIGE_AT);
        },
      },
    });
    expect(report.milestones.map((m) => m.reachedAtHours)).toEqual([
      expect.closeTo(100 / 60), expect.closeTo(200 / 60), expect.closeTo(300 / 60),
    ]);
    expect(report.eras.map((e) => e.lengthHours)).toEqual([expect.closeTo(100 / 60), expect.closeTo(100 / 60), expect.closeTo(100 / 60)]);
  });

  it("prints each era's length and Arete", () => {
    const report = runPace({ creditedHours: 1.5, start: eraAt(0, 3), milestones: [] });
    const text = formatPaceReport(report);
    expect(text).toContain("Era 1: 1.7h, 3 Arete, ended at 1.7h\n");
    expect(text).toContain("Era 2: 0.0h so far\n");
  });
});
