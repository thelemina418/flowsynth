// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { STORAGE_KEY } from "../../engine/save";
import { memorySaveStorage } from "../shared-save";
import { App } from "./App";
import { Shell } from "./shell";

// The rendered shell: what a returning player sees and clicks.
// happy-dom replaces the URL global, so the fixture is read through node:url.
const V15 = readFileSync(new NodeURL("../../engine/fixtures/saves/v15-migration.json", import.meta.url), "utf8");

let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
});

function mount(storage: ReturnType<typeof memorySaveStorage>): Shell {
  const shell = new Shell(storage, () => 5_000_000_000_000);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  act(() => render(h(App, { shell }), host));
  return shell;
}

function buttons(): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")];
}

describe("the class choice on screen", () => {
  it("names the habit and its credited flow time, and offers only the open classes", () => {
    const storage = memorySaveStorage();
    storage.setItem(STORAGE_KEY, V15);
    mount(storage);
    expect(host.textContent).toContain("Habit A");
    expect(host.textContent).toContain("1 h 45 min");
    expect(buttons().map((b) => b.textContent)).toEqual([
      expect.stringContaining("Engineer"),
      expect.stringContaining("Producer"),
    ]);
  });

  it("a click attunes the habit and moves on to the next one", () => {
    const storage = memorySaveStorage();
    storage.setItem(STORAGE_KEY, V15);
    mount(storage);
    act(() => buttons()[1]!.click());
    expect(host.textContent).toContain("Habit B");
    expect(host.textContent).not.toContain("Habit A");
  });
});

describe("the recovery choice on screen", () => {
  it("explains before it asks, and the save is replaced only on Recover", () => {
    const file = JSON.parse(V15) as { version: number; state: Record<string, unknown> };
    file.state.nous = "banana";
    const text = JSON.stringify(file);
    const storage = memorySaveStorage();
    storage.setItem(STORAGE_KEY, text);
    mount(storage);
    expect(host.textContent).toContain("nous");
    expect(buttons().map((b) => b.textContent)).toEqual(["Recover", "Download original", "Not now"]);
    expect(storage.getItem(STORAGE_KEY)).toBe(text);
    act(() => buttons()[0]!.click());
    expect(storage.getItem(STORAGE_KEY)).not.toBe(text);
    expect(host.textContent).toContain("Habit A");
  });
});
