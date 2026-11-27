// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { advanceIn, applyIn, begin } from "../../engine/fixtures";
import { grantsOf } from "../../engine/levels";
import { serialize, STORAGE_KEY } from "../../engine/save";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage, type SaveStorage } from "../shared-save";
import { App } from "./App";
import { Shell } from "./shell";

// The Almanac (issue #43): a planning view with no effect on the board,
// reached from upgrade mode after the first completed session. Habits,
// Intentions, Notes and history, each its own surface.

const V15 = readFileSync(new NodeURL("../../engine/fixtures/saves/v15-migration.json", import.meta.url), "utf8");
// Wednesday 10 June 2026, 20:00 local.
const NOW = new Date(2026, 5, 10, 20).getTime();
const local = (d: number, hour: number) => new Date(2026, 5, d, hour).getTime();
let t = NOW;
let host: HTMLElement;
let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) {
    render(null, el);
    el.remove();
  }
  mounted = [];
  t = NOW;
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

function saved(state: GameState): SaveStorage {
  const storage = memorySaveStorage();
  storage.setItem(STORAGE_KEY, serialize(state, NOW));
  return storage;
}

function buttons(): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")];
}

function button(name: string, within: ParentNode = host): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find((b) => b.textContent === name || b.getAttribute("aria-label") === name);
  if (!found) throw new Error(`no button ${name}: ${[...within.querySelectorAll("button")].map((b) => b.textContent).join(", ")}`);
  return found;
}

function click(name: string, within: ParentNode = host): void {
  act(() => button(name, within).click());
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pick(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("[data-habit-row]")];
}

function row(name: string): HTMLElement {
  const found = rows().find((r) => r.querySelector("[data-habit-line]")!.textContent!.startsWith(`${name} ·`));
  if (!found) throw new Error(`no row ${name}: ${rows().map((r) => r.textContent).join(" | ")}`);
  return found;
}

function strip(of: HTMLElement, days: 7 | 30): number[] {
  return [...of.querySelectorAll<HTMLElement>(`[data-strip="${days}"] [data-day]`)].map((bar) => Number(bar.dataset.seconds));
}

// Piano · Engineer, one completed 90-minute session that ended yesterday
// evening (1.5 h of Engineer credit: Lv 2), then 30 manual minutes today.
function practised(): GameState {
  const s = createInitialState();
  const made = applyIn(s, { type: "createHabit", name: "Piano", habitClass: "engineer" });
  begin(s, 5400, local(9, 18), made.id);
  advanceIn(s, 5400, "flow");
  applyIn(s, { type: "endSession", now: local(9, 20) });
  applyIn(s, { type: "dismissSummary" });
  applyIn(s, { type: "logPractice", habitId: made.id!, minutes: 30, now: local(10, 9) });
  return s;
}

function openAlmanac(): void {
  click("Almanac");
}

describe("the Almanac door", () => {
  it("is absent before the first completed session, there after it in upgrade mode, and absent in flow", () => {
    mount(memorySaveStorage());
    expect(buttons().map((b) => b.textContent)).not.toContain("Almanac");
    render(null, host);

    const shell = mount(saved(practised()));
    expect(host.querySelector("[data-doors]")!.textContent).toContain("Almanac");
    click("Begin flow");
    click("25");
    click("Begin");
    expect(shell.screen.value.kind).toBe("flow");
    expect(buttons().map((b) => b.textContent)).not.toContain("Almanac");
    shell.openAlmanac();
    expect(shell.screen.value.kind).toBe("flow");
  });

  it("opens the Almanac and closes back to upgrade mode", () => {
    const shell = mount(saved(practised()));
    openAlmanac();
    expect(shell.screen.value.kind).toBe("almanac");
    expect(host.querySelector("[data-stage], .stage")).toBeNull();
    click("Close");
    expect(shell.screen.value.kind).toBe("ready");
  });
});

describe("the habits surface", () => {
  it("reads each habit's class, level and credited hours, and its 7- and 30-day strips by local day", () => {
    mount(saved(practised()));
    openAlmanac();
    // 1.5 h live + 0.5 h manual: 2.0h credited; Engineer at 1.5 h is Lv 2.
    expect(row("Piano").querySelector("[data-habit-line]")!.textContent).toBe("Piano · Engineer Lv 2 · 2.0h");
    expect(strip(row("Piano"), 7)).toEqual([0, 0, 0, 0, 0, 5400, 1800]);
    const month = strip(row("Piano"), 30);
    expect(month).toHaveLength(30);
    expect(month.slice(-2)).toEqual([5400, 1800]);
    expect(month.slice(0, -2).every((s) => s === 0)).toBe(true);
    // No habit colours are drawn.
    expect(host.querySelector("[style*='--habit-']")).toBeNull();
  });

  it("logs practice manually into today's bar and the habit's hours, never its class", () => {
    const shell = mount(saved(practised()));
    openAlmanac();
    const credit = { ...shell.state.value.records.classCredit };
    click("Log practice", row("Piano"));
    type(row("Piano").querySelector<HTMLInputElement>("input[name=log-minutes]")!, "45");
    click("Log", row("Piano"));
    expect(strip(row("Piano"), 7).at(-1)).toBe(1800 + 2700);
    expect(row("Piano").querySelector("[data-habit-line]")!.textContent).toBe("Piano · Engineer Lv 2 · 2.7h");
    expect(shell.state.value.records.classCredit).toEqual(credit);
  });

  it("creates, renames, re-attunes and archives a habit", () => {
    const shell = mount(saved(practised()));
    openAlmanac();
    click("+ New habit");
    type(host.querySelector<HTMLInputElement>("input[name=new-habit-name]")!, "Chess");
    click("Producer", host.querySelector("[data-new-habit]")!);
    expect(row("Chess").querySelector("[data-habit-line]")!.textContent).toBe("Chess · Producer Lv 0 · 0.0h");

    click("Rename", row("Chess"));
    type(row("Chess").querySelector<HTMLInputElement>("input[name=rename]")!, "Go");
    click("Save", row("Chess"));
    expect(row("Go")).toBeTruthy();

    const credit = { ...shell.state.value.records.classCredit };
    click("Re-attune", row("Piano"));
    // Only the other open classes are offered.
    expect([...row("Piano").querySelectorAll("[data-reattune] button")].map((b) => b.textContent)).toEqual(["Producer"]);
    click("Producer", row("Piano").querySelector("[data-reattune]")!);
    expect(row("Piano").querySelector("[data-habit-line]")!.textContent).toBe("Piano · Producer Lv 0 · 2.0h");
    expect(shell.state.value.records.classCredit).toEqual(credit);

    click("Archive", row("Go"));
    expect(rows().map((r) => r.querySelector("[data-habit-line]")!.textContent)).toEqual(["Piano · Producer Lv 0 · 2.0h"]);
  });

  it("shows a refusal as one quiet line", () => {
    mount(saved(practised()));
    openAlmanac();
    click("+ New habit");
    click("Engineer", host.querySelector("[data-new-habit]")!);
    expect([...host.querySelectorAll("[data-refusal]")].map((p) => p.textContent)).toEqual(["Give the habit a name."]);
  });
});

describe("the Intentions surface", () => {
  it("reads `Piano · 40 / 60 min today` for a daily one and `this week` for a weekly one, completed engraved", () => {
    const shell = mount(saved(practised()));
    openAlmanac();
    click("Intentions");
    click("+ Intention");
    type(host.querySelector<HTMLInputElement>("input[name=intention-minutes]")!, "60");
    click("Set");
    // Practice before the Intention existed doesn't count.
    expect(host.querySelector("[data-intention]")!.textContent).toBe("Piano · 0 / 60 min today");
    const piano = shell.state.value.records.habits[0]!.id;
    act(() => void shell.almanacAct((now) => ({ type: "logPractice", habitId: piano, minutes: 40, now })));
    expect(host.querySelector("[data-intention]")!.textContent).toBe("Piano · 40 / 60 min today");
    expect(host.querySelector("[data-intention]")!.hasAttribute("data-complete")).toBe(false);

    click("Edit");
    pick(host.querySelector<HTMLSelectElement>("select[name=intention-schedule]")!, "weekly");
    type(host.querySelector<HTMLInputElement>("input[name=intention-minutes]")!, "40");
    click("Set");
    // A cadence change reads the week's practice since Monday, past the
    // target: the line holds at the target, engraved.
    expect(host.querySelector("[data-intention]")!.textContent).toBe("Piano · 40 / 40 min this week");
    expect(host.querySelector("[data-intention]")!.hasAttribute("data-complete")).toBe(true);

    click("Delete");
    expect(host.querySelector("[data-intention]")).toBeNull();
    expect(button("+ Intention")).toBeTruthy();
  });
});

describe("the Almanac and the board", () => {
  it("changes nothing on the board, the rates, ν or the allowance", () => {
    const shell = mount(saved(practised()));
    const before = shell.state.value;
    const board = () => {
      const s = shell.state.value;
      return structuredClone({ board: s.game.board, rates: s.game.rates, nous: s.game.nous, grants: grantsOf(s) });
    };
    const was = board();
    openAlmanac();
    click("+ New habit");
    type(host.querySelector<HTMLInputElement>("input[name=new-habit-name]")!, "Chess");
    click("Producer", host.querySelector("[data-new-habit]")!);
    click("Re-attune", row("Piano"));
    click("Producer", row("Piano").querySelector("[data-reattune]")!);
    click("Log practice", row("Chess"));
    type(row("Chess").querySelector<HTMLInputElement>("input[name=log-minutes]")!, "600");
    click("Log", row("Chess"));
    click("Intentions");
    click("+ Intention", host.querySelector(`[data-intention-habit='${shell.state.value.records.habits[0]!.id}']`)!);
    type(host.querySelector<HTMLInputElement>("input[name=intention-minutes]")!, "20");
    click("Set");
    click("Notes");
    type(host.querySelector<HTMLTextAreaElement>("textarea")!, "Scales felt even.");
    click("Capture note");
    click("Habits");
    click("Archive", row("Chess"));
    expect(shell.state.value).not.toBe(before);
    expect(board()).toEqual(was);
  });
});

describe("Notes and history", () => {
  // The v15 fixture with its three habits attuned on first load.
  function migrated(): Shell {
    const storage = memorySaveStorage();
    storage.setItem(STORAGE_KEY, V15);
    const shell = mount(storage);
    act(() => { for (const id of ["h2", "h3", "h4"]) shell.chooseClass(id, "engineer"); });
    expect(shell.screen.value.kind).toBe("ready");
    return shell;
  }

  it("renders migrated v15 history: the legacy line, newest first, and a saved reflection", () => {
    migrated();
    openAlmanac();
    click("History");
    expect(host.querySelector("[data-legacy]")!.textContent).toBe("Legacy era · 4 modules · archived");
    const list = [...host.querySelectorAll<HTMLElement>("[data-session]")];
    expect(list.map((r) => r.dataset.session)).toEqual(["7", "6", "5", "4", "3", "2", "1"]);
    expect(list[0]!.textContent).toContain("Habit A");
    expect(list[0]!.textContent).toContain("25 / 25 min");
    expect(list[3]!.textContent).toContain("unstructured");
    act(() => list.at(-1)!.click());
    expect(host.textContent).toContain("Session 1 · Habit A");
    expect(host.textContent).toContain('"Placeholder reflection." · felt great');
    click("← History");
    act(() => host.querySelector<HTMLElement>("[data-session='3']")!.click());
    expect(host.textContent).toContain("10 min away · didn't practice");
  });

  it("renders migrated v15 notes on the Notes surface", () => {
    migrated();
    openAlmanac();
    click("Notes");
    click("LOGGED");
    const notes = [...host.querySelectorAll(".note-entry p")].map((p) => p.textContent);
    expect(notes).toHaveLength(9);
    expect(notes[0]).toBe("Placeholder in-flow note 9.");
  });
});
