import { describe, expect, it } from "vitest";
import { applyIn, giveOscillators } from "./fixtures";
import { creditedHoursOf, formatPaceReport, placeAllowanceGreedily, runPace, type MilestoneProbe } from "./pace";
import { createInitialState } from "./state";

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
  // Two synthetic milestones: one at the first session past 1h, the next at
  // the first past 4h. With 50-minute sessions they land at 1h40m and 4h10m.
  const synthetic: MilestoneProbe[] = [
    { id: "a", label: "A", target: "1h", reached: (s) => creditedHoursOf(s) >= 1 },
    { id: "b", label: "B", target: "4h", reached: (s) => creditedHoursOf(s) >= 4 },
  ];

  it("flags a stretch over 2 credited hours with no new milestone", () => {
    const report = runPace({ creditedHours: 5, milestones: synthetic });
    expect(report.dryStretches).toHaveLength(1);
    expect(report.dryStretches[0]!.fromHours).toBeCloseTo(5 / 3);
    expect(report.dryStretches[0]!.toHours).toBeCloseTo(25 / 6);
  });

  it("flags the tail from the last milestone to the end of the run", () => {
    const report = runPace({ creditedHours: 3, milestones: [] });
    expect(report.dryStretches).toEqual([{ fromHours: 0, toHours: expect.closeTo(10 / 3) }]);
  });
});

describe("the tending seams", () => {
  it("places the allowance once before the first session, then calls each named hook once per session, in order", () => {
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
      },
    });
    expect(calls).toEqual(["allowance", "breathers", "fader", "allowance", "patch"]);
  });
});

describe("placing the allowance", () => {
  it("places the opening allowance, and the report gives the board's ν/s and the era's ν", () => {
    // The two Sines and the Flywheel go down before the first session, the
    // Flywheel's reach on one Sine. Sessions alternate Engineer and
    // Producer, and the Flywheel's 1 charge/s grows by 0.1 per Producer hour
    // when a session ends: sessions 1–2 run at 2 + ln 2 ν/s, sessions 3–4
    // at 2 + ln(2 + 1/12), each 3000 s. The board ends at 2 + ln(2 + 1/6).
    const report = runPace({ creditedHours: 3 });
    expect(report.sessions).toBe(4);
    expect(report.placements).toHaveLength(3);
    expect(report.rate.toNumber()).toBeCloseTo(2.77319, 4);
    expect(report.nous.toNumber()).toBeCloseTo(32_562.7, 0);
  });

  it("finds a resonating layout given allowance 3", () => {
    // Three oscillators of base 1 make exactly 3 ν/s unless one resonates.
    const start = createInitialState();
    giveOscillators(start, { allowance: 3 });
    const report = runPace({ creditedHours: 3, start });
    expect(report.placements.filter((p) => p.module !== "flywheel")).toHaveLength(3);
    expect(report.rate.toNumber()).toBeGreaterThan(3);
  });

  it("prints the board's ν/s, its charge/s, its layout and the era's ν", () => {
    const text = formatPaceReport(runPace({ creditedHours: 3 }));
    // Rates read as the Hex detail reads them, truncated: 2.773… ν/s, and
    // the Flywheel's 1 + 0.1 × 5/3 Producer hours = 1.166… charge/s.
    expect(text).toContain(
      "Board: 2 oscillators, 1 modulator, 2.77 ν/s, 1.16 charge/s — Sine (0,0), Sine (1,0), Flywheel (0,1) facing NE\n",
    );
    expect(text).toContain("Era ν: 32 562");
  });

  it("prints each patched wall's damage/s and the cable on the board line", () => {
    // A Flywheel patched into Shale before the run delivers its 1 charge/s
    // there as damage, through one Engineer session.
    const start = createInitialState();
    applyIn(start, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 1 } });
    applyIn(start, { type: "patchCable", cable: "patch", source: { q: 0, r: 1 }, target: { q: -1, r: 1 } });
    const text = formatPaceReport(runPace({ creditedHours: 0.1, start }));
    expect(text).toContain(
      "Board: 2 oscillators, 1 modulator, 2.0 ν/s, 1.0 charge/s, Shale 1.0 damage/s — Flywheel (0,1) facing NE, Sine (0,0), Sine (1,0), Patch (0,1) → (-1,1)\n",
    );
  });

  it("places the Flywheel where its facing raises total ν/s over the oscillators alone", () => {
    // The opening owns four cells: the two Sines take (0,0) and (1,0), and
    // from either cell left the Flywheel's reach meets one Sine at most.
    // That Sine's charge factor is 1 + ln 2 at 1 charge/s, so the board
    // makes 1 + 1.693… ν/s before the first session.
    const report = runPace({ creditedHours: 0.1 });
    expect(report.placements).toEqual([
      { cell: { q: 0, r: 0 }, module: "sine" },
      { cell: { q: 1, r: 0 }, module: "sine" },
      { cell: { q: 0, r: 1 }, module: "flywheel", facing: 0 },
    ]);
    expect(report.rate.toNumber()).toBeCloseTo(2.6931, 4);
  });

  it("leaves the Patch unused when no Patch raises total ν/s", () => {
    // Patched, the Flywheel would deliver to one cell in place of its
    // reach: at best the same Sine, which raises nothing, and a wall, which
    // lowers ν/s. Wall-seeking is chunk 05's.
    const report = runPace({ creditedHours: 0.1 });
    expect(report.cables).toEqual([]);
  });

  it("patches a modulator whose reach meets nothing into the oscillator it most raises", () => {
    // A Flywheel already at (1,-1) faces NE, off the board's owned cells.
    // The Sines take (0,0) and (1,0); a Patch onto either gives it 1 + ln 2.
    const start = createInitialState();
    applyIn(start, { type: "placeModule", module: "flywheel", cell: { q: 1, r: -1 } });
    const report = runPace({ creditedHours: 0.1, start });
    expect(report.cables).toHaveLength(1);
    const [cable] = report.cables;
    expect(cable!.type).toBe("patch");
    expect(cable!.source).toEqual({ q: 1, r: -1 });
    const target = report.placements.find((p) => p.cell.q === cable!.target.q && p.cell.r === cable!.target.r);
    expect(target?.module).toBe("sine");
    expect(report.rate.toNumber()).toBeCloseTo(2.6931, 4);
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
