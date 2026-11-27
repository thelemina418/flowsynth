import { describe, expect, it } from "vitest";
import { creditedHoursOf, runPace, type MilestoneProbe } from "./pace";

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
  it("calls each named hook once per session, in order, with the engine's doors", () => {
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
    expect(calls).toEqual(["breathers", "fader", "allowance", "patch"]);
  });
});
