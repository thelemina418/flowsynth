// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { STORAGE_KEY } from "../../engine/save";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// The Flywheel on screen (spec chunk 03, issue #31): its tray entry, its
// face with a facing pointer and a jack, turning it by a click on the
// picked Flywheel or by R and Shift+R, and its Hex detail line. Every
// route ends in the shell's one `apply` path.

let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
});

function mount(storage = memorySaveStorage()): { shell: Shell; storage: ReturnType<typeof memorySaveStorage> } {
  const shell = new Shell(storage, () => 5_000_000_000_000);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  act(() => render(h(App, { shell }), host));
  return { shell, storage };
}

const tray = () => [...host.querySelectorAll<HTMLButtonElement>(".tray button")];
const entry = (name: string) => tray().find((b) => b.textContent === name)!;
const cell = (key: string) => host.querySelector<SVGGElement>(`[data-cell="${key}"]`)!;
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const press = (k: string, shiftKey = false) => act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true })); });
const lines = () => [...host.querySelectorAll(".hex-detail-line")].map((l) => l.textContent);
const facing = (key: string) => cell(key).querySelector("[data-facing]")?.getAttribute("data-facing");

function placeFlywheel(at = "0,0") {
  click(entry("Flywheel"));
  click(cell(at));
}

describe("the Flywheel in the tray", () => {
  it("shows the Flywheel beside Sine and Triangle, with its glyph", () => {
    mount();
    expect(tray().map((b) => b.textContent)).toEqual(["Sine", "Triangle", "Flywheel"]);
    expect(entry("Flywheel").querySelector('svg[data-glyph="flywheel"]')).not.toBeNull();
    expect(entry("Flywheel").disabled).toBe(false);
  });

  it("mutes only the Flywheel once the Modulator allowance is spent", () => {
    mount();
    placeFlywheel();
    expect(entry("Flywheel").disabled).toBe(true);
    expect(entry("Sine").disabled).toBe(false);
  });
});

describe("the Flywheel's face", () => {
  it("wears the Modulator category, its glyph and nameplate, a pointer toward NE and a jack", () => {
    mount();
    placeFlywheel();
    const face = cell("0,0").querySelector('[data-module="flywheel"]')!;
    expect(face.getAttribute("data-category")).toBe("modulator");
    expect(face.querySelector('[data-glyph="flywheel"]')).not.toBeNull();
    expect(face.textContent).toBe("Flywheel");
    expect(facing("0,0")).toBe("NE");
    expect(face.querySelector("[data-jack]")).not.toBeNull();
  });

  it("an oscillator's face has no pointer and no jack", () => {
    mount();
    click(entry("Sine"));
    click(cell("1,0"));
    expect(cell("1,0").querySelector("[data-facing]")).toBeNull();
    expect(cell("1,0").querySelector("[data-jack]")).toBeNull();
  });
});

describe("turning the Flywheel in upgrade mode", () => {
  it("a click on the picked Flywheel turns it clockwise and keeps the pick, and saves", () => {
    const { storage } = mount();
    placeFlywheel();
    click(cell("0,0"));
    expect(cell("0,0").hasAttribute("data-picked")).toBe(true);
    click(cell("0,0"));
    expect(facing("0,0")).toBe("SE");
    expect(cell("0,0").hasAttribute("data-picked")).toBe(true);
    click(cell("0,0"));
    expect(facing("0,0")).toBe("S");
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).state.game.board.placements[0].facing).toBe(2);
  });

  it("R turns the picked Flywheel clockwise and Shift+R counter-clockwise", () => {
    mount();
    placeFlywheel();
    click(cell("0,0"));
    press("r");
    expect(facing("0,0")).toBe("SE");
    press("R", true);
    press("R", true);
    expect(facing("0,0")).toBe("N");
    expect(cell("0,0").hasAttribute("data-picked")).toBe(true);
  });

  it("with nothing picked, R turns the Flywheel in the Hex detail", () => {
    mount();
    // Placing ends the pick and leaves the placed cell in the Hex detail.
    placeFlywheel();
    expect(host.querySelector("[data-picked]")).toBeNull();
    press("r");
    expect(facing("0,0")).toBe("SE");
    press("R", true);
    expect(facing("0,0")).toBe("NE");
    // With neither a pick nor a modulator in the Hex detail, R does nothing.
    press("Escape");
    press("r");
    expect(facing("0,0")).toBe("NE");
  });

  it("R does nothing in flow; a click there only reads the cell", () => {
    const { shell } = mount();
    placeFlywheel();
    act(() => { shell.state.value = { ...shell.state.value, game: { ...shell.state.value.game, mode: "flow" } }; });
    click(cell("0,0"));
    press("r");
    click(cell("0,0"));
    expect(facing("0,0")).toBe("NE");
    expect(lines()).toEqual(["Flywheel · Modulator · facing NE"]);
  });
});

describe("the Flywheel's Hex detail", () => {
  it("reads its name, category and facing", () => {
    mount();
    placeFlywheel();
    expect(lines()).toEqual(["Flywheel · Modulator · facing NE"]);
    press("r");
    press("Escape");
    click(cell("0,0"));
    expect(lines()).toEqual(["Flywheel · Modulator · facing SE"]);
  });
});
