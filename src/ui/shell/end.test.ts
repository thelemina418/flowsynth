// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { apply } from "../../engine/apply";
import { giveHabit, giveOscillators } from "../../engine/fixtures";
import { serialize, STORAGE_KEY } from "../../engine/save";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage, type SaveStorage } from "../shared-save";
import { App } from "./App";
import { Shell } from "./shell";

// The end of a session (issue #40): the honesty report, only at End and
// only when provisional time is owed, then the one-line summary, then
// upgrade mode. The clock boundary is driven with a fake wall clock.
const T0 = 5_000_000_000_000;
let t = T0;
let host: HTMLElement;
let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) {
    render(null, el);
    el.remove();
  }
  mounted = [];
  t = T0;
});

function mount(storage: SaveStorage): Shell {
  const shell = new Shell(storage, () => t);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  mounted.push(host);
  act(() => render(h(App, { shell }), host));
  return shell;
}

// Sine, Triangle, Triangle in a triangle: 4.5 ν/s, on Piano · Engineer
// (Engineer Lv 1 came with the third oscillator).
function laidOut(): GameState {
  let s = createInitialState();
  giveOscillators(s, { allowance: 3 });
  giveHabit(s, "Piano", "engineer");
  for (const [module, q, r] of [["sine", 0, 0], ["triangle", 1, 0], ["triangle", 0, 1]] as const) {
    s = apply(s, { type: "placeModule", module, cell: { q, r } }).state;
  }
  return s;
}

function saved(state: GameState): SaveStorage {
  const storage = memorySaveStorage();
  storage.setItem(STORAGE_KEY, serialize(state, T0));
  return storage;
}

function buttons(): string[] {
  return [...host.querySelectorAll("button")].map((b) => b.textContent ?? "");
}

function click(name: string): void {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent === name || b.textContent?.startsWith(name));
  if (!found) throw new Error(`no button ${name}: ${buttons().join(", ")}`);
  act(() => found.click());
}

function text(selector: string): string {
  return host.querySelector(selector)?.textContent ?? "";
}

// fmt groups thousands with a thin space; the tests read it as a space.
function line(): string {
  return text("[data-summary-line]").replace(/\s/g, " ");
}

function tick(shell: Shell, seconds: number, presence: "visible" | "away" = "visible"): void {
  t += seconds * 1000;
  act(() => shell.boundary(presence));
}

function begin25(shell: Shell): void {
  click("Begin flow");
  click("25");
  click("Begin");
  expect(shell.screen.value.kind).toBe("flow");
}

// 20 present minutes, then a 10-minute away gap: past the 25-minute plan,
// 5 of the away minutes are provisional.
function awayPastPlan(shell: Shell): void {
  begin25(shell);
  tick(shell, 1200);
  tick(shell, 600, "away");
}

describe("End with provisional time owed", () => {
  it("shows the honesty report, and Practiced the whole time credits 30 min at the board's rate", () => {
    const shell = mount(saved(laidOut()));
    awayPastPlan(shell);
    click("End");
    expect(shell.screen.value.kind).toBe("honesty");
    expect(text("h2")).toBe("While you were away");
    expect(buttons()).toEqual([
      expect.stringMatching(/^Didn't practice/),
      expect.stringMatching(/^Did what I planned/),
      expect.stringMatching(/^Practiced the whole time/),
    ]);
    click("Practiced the whole time");
    expect(shell.screen.value.kind).toBe("summary");
    // 4.5 ν/s × 1 800 credited seconds.
    expect(line()).toBe("+8 100 ν · Engineer +30 min");
    expect(shell.state.value.game.nous.toNumber()).toBe(8100);
    expect(shell.state.value.game.mode).toBe("upgrade");
  });

  it("Didn't practice drops the provisional ν from the summary and the total", () => {
    const shell = mount(saved(laidOut()));
    awayPastPlan(shell);
    click("End");
    click("Didn't practice");
    expect(line()).toBe("+6 750 ν · Engineer +25 min");
    expect(shell.state.value.game.nous.toNumber()).toBe(6750);
  });

  it("freezes the session clock while the report waits: reading it credits nothing", () => {
    const shell = mount(saved(laidOut()));
    awayPastPlan(shell);
    click("End");
    const elapsed = shell.state.value.game.session!.elapsed;
    tick(shell, 600);
    expect(shell.state.value.game.session!.elapsed).toBe(elapsed);
    click("Practiced the whole time");
    expect(line()).toBe("+8 100 ν · Engineer +30 min");
    expect(shell.state.value.game.nous.toNumber()).toBe(8100);
  });

  it("never shows the report mid-session", () => {
    const shell = mount(saved(laidOut()));
    awayPastPlan(shell);
    tick(shell, 0);
    expect(shell.state.value.game.session!.accounting.poolSeconds).toBe(300);
    expect(shell.screen.value.kind).toBe("flow");
  });
});

describe("End with nothing owed", () => {
  it("ends with no report", () => {
    const shell = mount(saved(laidOut()));
    begin25(shell);
    tick(shell, 600);
    click("End");
    expect(shell.screen.value.kind).toBe("summary");
    expect(line()).toBe("+2 700 ν · Engineer +10 min");
  });

  it("appends the level crossed", () => {
    const s = createInitialState();
    giveHabit(s, "Piano", "engineer");
    const shell = mount(saved(s));
    begin25(shell);
    tick(shell, 1800);
    click("End");
    expect(line()).toMatch(/^\+.+ ν · Engineer \+30 min → Lv 1$/);
  });
});

describe("the summary", () => {
  it("survives a reboot until dismissed; dismissing shows upgrade mode, and it never shows again", () => {
    const storage = saved(laidOut());
    const shell = mount(storage);
    begin25(shell);
    tick(shell, 600);
    click("End");
    const reopened = mount(storage);
    expect(reopened.screen.value.kind).toBe("summary");
    expect(line()).toBe("+2 700 ν · Engineer +10 min");
    // One dismiss control, and no reflection input.
    expect(buttons()).toEqual(["Continue"]);
    expect(host.querySelector("input, textarea")).toBeNull();
    click("Continue");
    expect(reopened.screen.value.kind).toBe("ready");
    expect(buttons()).toContain("Begin flow");
    const again = mount(storage);
    expect(again.screen.value.kind).toBe("ready");
  });
});
