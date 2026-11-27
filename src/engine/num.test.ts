import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  abs, add, cmp, D, div, eq, floor, fmt, fmtRate, fromSave, gt, gte, log10, lt, lte, max, min, mul, neg,
  NumFault, pow, requireNotNaN, sub, toSave,
} from "./num";
import type { Num } from "./num";

const THIN = " ";

describe("D", () => {
  it("builds a Decimal from a number, a string or a Decimal", () => {
    expect(fmt(D(12480))).toBe(`12${THIN}480`);
    expect(fmt(D("ee12"))).toBe("ee12");
    const value = D("1.23e45");
    expect(eq(D(value), value)).toBe(true);
  });
});

describe("arithmetic", () => {
  it("adds, subtracts, multiplies and divides, accepting plain numbers and strings", () => {
    expect(fmt(add(2, "3"))).toBe("5");
    expect(fmt(sub(D(10), 4))).toBe("6");
    expect(fmt(mul("1.5e200", "2e200"))).toBe("e400");
    expect(fmt(div(7, 2))).toBe("3");
    expect(eq(div(7, 2), 3.5)).toBe(true);
  });

  it("raises powers and takes base-10 logs past the double range", () => {
    expect(fmt(pow(10, 400))).toBe("e400");
    expect(fmt(pow(10, "1e12"))).toBe("ee12");
    expect(eq(log10("e400"), 400)).toBe(true);
  });

  it("negates, takes absolute values, floors, and picks min and max", () => {
    expect(fmt(neg(5))).toBe("-5");
    expect(fmt(abs(-5))).toBe("5");
    expect(eq(floor(-2.5), -3)).toBe(true);
    expect(fmt(min("e400", "1e45"))).toBe("1e45");
    expect(fmt(max("e400", "1e45"))).toBe("e400");
  });
});

describe("comparison", () => {
  it("orders values across every range", () => {
    expect(cmp("1e45", "e400")).toBe(-1);
    expect(cmp("ee12", "e400")).toBe(1);
    expect(cmp(3, "3")).toBe(0);
    expect(lt(-1, 0)).toBe(true);
    expect(lte(2, 2)).toBe(true);
    expect(gt("e1.2e308", "ee12")).toBe(true);
    expect(gte(2, 3)).toBe(false);
    expect(eq(0.5, "0.5")).toBe(true);
  });
});

describe("fmt", () => {
  it("formats zero as 0", () => {
    expect(fmt(D(0))).toBe("0");
  });

  it("formats small integers as plain digits", () => {
    expect(fmt(D(7))).toBe("7");
    expect(fmt(D(999))).toBe("999");
  });

  it("groups digits below 1e6 with a thin space", () => {
    expect(fmt(D(12480))).toBe(`12${THIN}480`);
    expect(fmt(D(1000))).toBe(`1${THIN}000`);
    expect(fmt(D(999999))).toBe(`999${THIN}999`);
  });

  it("switches to mantissa-exponent form at 1e6", () => {
    expect(fmt(D(999999.99))).toBe(`999${THIN}999`);
    expect(fmt(D(1e6))).toBe("1e6");
    expect(fmt(D(1234567))).toBe("1.23e6");
  });

  it("formats mid-range values as 1.23e45, truncated to two decimals", () => {
    expect(fmt(D("1.23e45"))).toBe("1.23e45");
    expect(fmt(D("1.239e45"))).toBe("1.23e45");
    expect(fmt(D("1.2e45"))).toBe("1.2e45");
    expect(fmt(D("9.999e99"))).toBe("9.99e99");
  });

  it("switches to e-prefixed exponents at e308", () => {
    expect(fmt(D("9.99e307"))).toBe("9.99e307");
    expect(fmt(D("1e308"))).toBe("e308");
    expect(fmt(D("e400"))).toBe("e400");
  });

  it("writes a large exponent in mantissa form: e1.2e308", () => {
    expect(fmt(D("e1.2e308"))).toBe("e1.2e308");
    expect(fmt(D("e4.56e20"))).toBe("e4.56e20");
  });

  it("writes an exponent that is a bare power of ten as e12: ee12", () => {
    expect(fmt(D("ee12"))).toBe("ee12");
    expect(fmt(D("ee6"))).toBe("ee6");
  });

  it("keeps stacking e-prefixes past the double range", () => {
    expect(fmt(D("ee400"))).toBe("ee400");
    expect(fmt(D("eee12"))).toBe("eee12");
  });

  it("truncates fractions below 1e6 without losing exact integers", () => {
    expect(fmt(D(2.9))).toBe("2");
    expect(fmt(D(0.4))).toBe("0");
    expect(fmt(D(0.1).add(0.2).mul(10))).toBe("3");
  });

  it("formats negatives as a minus sign before the same rules", () => {
    expect(fmt(D(-12480))).toBe(`-12${THIN}480`);
    expect(fmt(D("-1.23e45"))).toBe("-1.23e45");
    expect(fmt(D("-ee12"))).toBe("-ee12");
  });

  it("never shows a signed zero", () => {
    expect(fmt(D(-0))).toBe("0");
    expect(fmt(D(-0.4))).toBe("0");
  });

  it("names NaN and infinity instead of looping on them", () => {
    expect(fmt(D(Number.NaN))).toBe("NaN");
    expect(fmt(D(Number.POSITIVE_INFINITY))).toBe("∞");
    expect(fmt(D(Number.NEGATIVE_INFINITY))).toBe("-∞");
  });
});

describe("fmtRate", () => {
  it("shows a rate or factor to two decimals with at least one", () => {
    expect(fmtRate(D(1))).toBe("1.0");
    expect(fmtRate(D(1.75))).toBe("1.75");
    expect(fmtRate(D(4.5))).toBe("4.5");
    expect(fmtRate(D(0))).toBe("0.0");
  });

  it("truncates like every shown figure, so it never exceeds the rate behind it", () => {
    expect(fmtRate(D(2.999))).toBe("2.99");
    expect(fmtRate(D(1.0049))).toBe("1.0");
    expect(fmtRate(D(3).sub(1e-12))).toBe("3.0");
  });

  it("reads as the game's usual figures from a thousand up", () => {
    expect(fmtRate(D(12_480.6))).toBe("12\u2009480");
  });
});

describe("requireNotNaN", () => {
  it("throws a NumFault naming the figure when the Decimal is NaN", () => {
    expect(() => requireNotNaN(D(0).div(0), "resonance")).toThrow(NumFault);
    expect(() => requireNotNaN(D(Number.NaN), "resonance")).toThrow(/resonance/);
  });

  it("returns the value unchanged otherwise, at any size or sign", () => {
    for (const text of ["0", "-5", "1.23e45", "e1.2e308", "-ee12"]) {
      const value = D(text);
      expect(requireNotNaN(value, "figure")).toBe(value);
    }
  });
});

describe("save serialisation", () => {
  const components = (value: Num) => [value.sign, value.layer, value.mag];

  const cases: Array<[string, Num]> = [
    ["zero", D(0)],
    ["a small integer", D(12480)],
    ["a negative fraction", D(-0.1)],
    ["an awkward double", D(0.1).add(0.2)],
    ["beyond 2^53", D(2 ** 60 + 1)],
    ["a mid-range value", D("1.2345678901234e45")],
    ["just below 1e308", D("1.7e308").div(1.0000001)],
    ["the result of mid-range arithmetic", D("3.3e200").mul("7.1e99")],
    ["just above 1e308", D("1.7e308").mul(3)],
    ["e1.2e308", D("e1.2e308")],
    ["ee12", D("ee12")],
    ["a negative giant", D("-eee7.5")],
    ["a tiny positive", D("1e-400")],
    ["infinity", D(Number.POSITIVE_INFINITY)],
    ["negative infinity", D(Number.NEGATIVE_INFINITY)],
  ];

  it.each(cases)("round-trips %s exactly", (_, value) => {
    const text = toSave(value);
    expect(typeof text).toBe("string");
    const back = fromSave(text);
    expect(components(back)).toEqual(components(value));
    expect(back.eq(value)).toBe(true);
  });

  it("survives a JSON round trip", () => {
    const value = D("e1.2e308");
    const back = fromSave(JSON.parse(JSON.stringify(toSave(value))) as string);
    expect(components(back)).toEqual(components(value));
  });

  it("refuses to write a NaN", () => {
    expect(() => toSave(D(Number.NaN))).toThrow(NumFault);
  });

  it("refuses to read malformed or NaN text", () => {
    for (const text of ["", "abc", "NaN", "e", "1.2.3", "ee", "e-NaN"]) {
      expect(() => fromSave(text), text).toThrow(NumFault);
    }
  });
});

describe("the numeric boundary", () => {
  it("is the only source module that imports break_eternity", () => {
    const root = join(import.meta.dirname, "..");
    const files = readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(ts|tsx|js|mjs)$/.test(file))
      .filter((file) => /from\s+["']break_eternity|import\(\s*["']break_eternity|require\(\s*["']break_eternity/
        .test(readFileSync(join(root, file), "utf8")))
      .map((file) => relative(root, join(root, file)).split("\\").join("/"));
    expect(files).toEqual(["engine/num.ts"]);
  });
});
