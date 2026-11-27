import { describe, expect, it } from "vitest";
import { giveOscillators } from "./fixtures";
import { creditedHoursOf, formatPaceReport, runPace, type MilestoneProbe } from "./pace";
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
    // Two oscillators of base 1 that don't resonate make 2 ν/s. The player
    // places them before the first session, so ν is 2 ν/s over all four
    // 50-minute sessions: 2 × 12 000 s.
    const report = runPace({ creditedHours: 3 });
    expect(report.sessions).toBe(4);
    expect(report.placements).toHaveLength(2);
    expect(report.rate.toNumber()).toBeCloseTo(2);
    expect(report.nous.toNumber()).toBeCloseTo(24_000);
  });

  it("finds a resonating layout given allowance 3", () => {
    // Three oscillators of base 1 make exactly 3 ν/s unless one resonates.
    const start = createInitialState();
    giveOscillators(start, { allowance: 3 });
    const report = runPace({ creditedHours: 3, start });
    expect(report.placements).toHaveLength(3);
    expect(report.rate.toNumber()).toBeGreaterThan(3);
  });

  it("prints the board's ν/s and the era's ν", () => {
    const text = formatPaceReport(runPace({ creditedHours: 3 }));
    // ν/s reads as the Hex detail reads it.
    expect(text).toContain("Board: 2 oscillators, 2.0 ν/s");
    expect(text).toContain("Era ν: 24 000");
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
