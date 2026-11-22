// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { endSession, pauseSession, placeWorldOccupant, prestige, startBreather, startSession } from "../engine/actions";
import { advance } from "../engine/advance";
import { hex } from "../engine/hex";
import { give } from "../engine/fixtures";
import { serialize, STORAGE_KEY } from "../engine/save";
import { createInitialState } from "../engine/state";
import { memorySaveStorage, SharedSave } from "./shared-save";
import { clickCell, createAppFixture, setAppWidth, setVisibility } from "./testing/app-fixture";

const fixture = createAppFixture();
const savedAt = 1_000_000;
afterEach(() => { fixture.release(); setVisibility("visible"); vi.restoreAllMocks(); });

function readyFight() {
  const state = createInitialState();
  state.eraEarned = 20_000_000;
  expect(prestige(state).ok).toBe(true);
  state.eraEarned = 20_000_000;
  expect(placeWorldOccupant(state, state.world.creatures[0]!.id, hex(0, 0)).ok).toBe(true);
  return state;
}

function reloadAfter(state: ReturnType<typeof readyFight>, seconds: number) {
  setVisibility("visible");
  vi.spyOn(Date, "now").mockReturnValue(savedAt + 1000 * seconds);
  const storage = memorySaveStorage();
  storage.setItem(STORAGE_KEY, serialize(state, savedAt));
  return fixture.boot(undefined, false, new SharedSave(storage));
}

it.each([[20, 20, 0], [700, 600, 100]])("planned reload after %ss reconciles credit without an offline duel", (seconds, credited, provisional) => {
  const state = readyFight();
  const resting = { ...state.world.creatures[0]!, id: "resting", pos: null, hp: 4, recovering: true };
  state.world.creatures.push(resting);
  expect(startSession(state, 600).ok).toBe(true);
  advance(state, 3, () => 0.3);
  const before = structuredClone(state.world);
  const app = reloadAfter(state, seconds);
  expect(app.state.session!.accounting.creditedSeconds).toBe(Math.min(600, 3 + credited));
  expect(app.state.session!.accounting.poolSeconds).toBe(provisional ? provisional + 3 : 0);
  expect(app.state.nous).toBeGreaterThan(state.nous);
  expect(app.state.world).toEqual(before);
});

it("planned import admits legacy charge and credit but does not retro-fight a wounded Shale", () => {
  const state = readyFight();
  give(state, "additive", hex(0, 1));
  give(state, "focusKeyed", hex(1, 0)).reserve = 30;
  const [column] = state.world.columns;
  const [blade] = state.world.weapons;
  expect(placeWorldOccupant(state, column!.id, hex(0, 1)).ok).toBe(true);
  expect(placeWorldOccupant(state, blade!.id, hex(1, 0)).ok).toBe(true);
  state.world.enemies.shale!.hp = 2;
  expect(startSession(state, 600).ok).toBe(true);
  vi.spyOn(Date, "now").mockReturnValue(savedAt + 10_000);
  const app = fixture.boot(undefined, false, new SharedSave(memorySaveStorage()));
  expect(app.importText(serialize(state, savedAt))).toBe(true);
  expect(app.state.session!.accounting.creditedSeconds).toBe(10);
  expect(app.state.world.weapons[0]!.store).toBeGreaterThan(0);
  expect(app.state.world.elapsed).toBe(0);
  expect(app.state.world.enemies.shale!.hp).toBe(2);
  expect(app.state.world.creatures[0]!.hp).toBe(24);
});

it("breather reload banks the clamped allowance without recovering or trading hits offline", () => {
  const state = readyFight();
  expect(startSession(state, 600).ok).toBe(true);
  // Mint a breather before placing the combatant, then carry its wounds in.
  state.world.creatures[0]!.pos = null;
  advance(state, 600, () => 0.3);
  expect(endSession(state, savedAt).ok).toBe(true);
  expect(placeWorldOccupant(state, state.world.creatures[0]!.id, hex(0, 0)).ok).toBe(true);
  state.world.enemies.shale!.hp = 25;
  expect(startBreather(state, savedAt).ok).toBe(true);
  const app = reloadAfter(state, 200);
  expect(app.state.mode).toBe("upgrade");
  expect(app.state.breatherSeconds).toBe(120);
  expect(app.state.nous).toBeGreaterThan(state.nous);
  expect(app.state.world).toEqual(state.world);
});

it("a cached page restore credits the closed stretch without attacking or healing", () => {
  const state = readyFight();
  state.world.enemies.shale!.hp = 2;
  expect(startSession(state, 600).ok).toBe(true);
  const app = reloadAfter(state, 0);
  const before = structuredClone(app.state.world);
  vi.mocked(Date.now).mockReturnValue(savedAt + 20_000);
  const restore = new Event("pageshow");
  Object.defineProperty(restore, "persisted", { value: true });
  window.dispatchEvent(restore);
  expect(app.state.session!.accounting.creditedSeconds).toBe(20);
  expect(app.state.world).toEqual(before);
});

function setClock() {
  const monotonic = vi.spyOn(performance, "now").mockReturnValue(0);
  return (seconds: number) => {
    vi.mocked(Date.now).mockReturnValue(savedAt + seconds * 1000);
    monotonic.mockReturnValue(seconds * 1000);
  };
}

it.each(["second touch", "unfocused touch", "Escape", "tap-away", "different Hex", "different layer", "Return and reopen"])(
  "keeps the inactive miniature's touch disclosure scoped across live detail rebuilds (%s)", (action) => {
    const state = readyFight();
    expect(startSession(state, null).ok).toBe(true);
    const clock = setClock();
    const app = reloadAfter(state, 0);
    setAppWidth(390);
    clickCell(0, 0);
    const mini = (face = "world") => document.querySelector<HTMLButtonElement>(`#hex-detail [data-legend-layer="${face}"]`)!;
    const body = (face = "world") => document.getElementById(mini(face).getAttribute("aria-describedby")!)!;
    const tap = (face = "world") => {
      const button = mini(face);
      button.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
      if (action !== "unfocused touch") button.focus(); // Mobile activation can also focus the trigger.
      button.dispatchEvent(new PointerEvent("click", { pointerType: "touch", detail: 1, bubbles: true }));
    };
    const first = mini();
    tap();
    expect(app.ui.detail?.face).toBe("modules");
    expect(body().classList.contains("inst-show")).toBe(true);
    if (action === "Escape") first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (action === "tap-away") document.querySelector("#hex-detail .hex-detail-corner")!.dispatchEvent(new PointerEvent("click", { pointerType: "touch", bubbles: true }));
    if (action === "different Hex") {
      // Navigate away and back without another touch on the miniature.
      app.openDetail(hex(1, 0), "modules");
      expect(mini().getAttribute("aria-expanded")).not.toBe("true");
      app.openDetail(hex(0, 0), "modules");
    }
    if (action === "different layer") {
      app.detailFace("world");
      expect(mini().hasAttribute("aria-describedby")).toBe(false);
      app.detailFace("modules");
    }
    if (action === "Return and reopen") {
      const firstTip = body();
      document.getElementById("hex-detail-return")!.click();
      expect(app.ui.detail).toBeNull();
      expect(firstTip.isConnected).toBe(false);
      clickCell(0, 0);
    }
    const carry = action === "second touch" || action === "unfocused touch";
    if (!carry) expect(mini().getAttribute("aria-expanded")).not.toBe("true");

    const beforeTick = mini();
    clock(0.1);
    app.tick();
    expect(app.state.world.elapsed).toBe(0.1);
    expect(mini()).not.toBe(beforeTick);
    expect(body().classList.contains("inst-show")).toBe(carry);
    expect(mini().getAttribute("aria-expanded")).toBe(String(carry));
    if (action === "Escape" || action === "tap-away") expect(document.activeElement).toBe(mini());
    tap();
    if (!carry) {
      expect(app.ui.detail?.face).toBe("modules");
      expect(body().classList.contains("inst-show")).toBe(true);
      clock(0.2);
      app.tick();
      tap();
    }
    expect(app.ui.detail?.face).toBe("world");
    expect(app.ui.boardLayer).toBe("world");
    expect(mini().hasAttribute("aria-describedby")).toBe(false);
  },
);

function visibility(state: "visible" | "hidden") {
  setVisibility(state);
  document.dispatchEvent(new Event("visibilitychange"));
}

function pageTransition(type: "pagehide" | "pageshow") {
  const event = new Event(type);
  Object.defineProperty(event, "persisted", { value: true });
  window.dispatchEvent(event);
}

it.each(["resume first", "visibility first", "cache first"])("settles a document freeze once with both clocks advancing (%s)", (order) => {
  const state = readyFight();
  const sentinel = state.world.creatures[0]!;
  state.world.creatures.push({ ...sentinel, id: "resting", pos: null, hp: 4, recovering: true });
  expect(startSession(state, 600).ok).toBe(true);
  const clock = setClock();
  const app = reloadAfter(state, 0);
  const gap = () => app.state.session!.accounting;
  const world = () => app.state.world;

  clock(1); visibility("hidden");
  clock(2); document.dispatchEvent(new Event("freeze"));
  if (order === "cache first") pageTransition("pagehide");
  clock(12); app.tick(); // A queued tick cannot move the suspended boundary.
  expect(world().elapsed).toBe(1);
  expect(gap().pendingAwaySeconds).toBe(1);
  clock(22);
  if (order === "resume first") {
    document.dispatchEvent(new Event("resume"));
    // This now-running tab stays hidden another second.
    clock(23); visibility("visible");
  } else if (order === "visibility first") {
    visibility("visible");
    document.dispatchEvent(new Event("resume"));
  } else {
    pageTransition("pageshow");
    document.dispatchEvent(new Event("resume"));
    visibility("visible");
  }
  const online = order === "resume first" ? 3 : 2;
  expect(gap()).toMatchObject({ creditedSeconds: online + 20, poolSeconds: 0, pendingAwaySeconds: 0 });
  expect(world().elapsed).toBe(online);
  expect(app.state.nous).toBeCloseTo(state.nous + (online + 20) * 0.08, 8);
  expect(world().creatures.map(({ hp }) => hp)).toEqual([24, 4 + 2 * online]);
  expect(world().enemies.shale!.hp).toBe(48);

  clock(24); window.dispatchEvent(new Event("focus"));
  expect(gap()).toMatchObject({ creditedSeconds: 24, poolSeconds: 0, pendingAwaySeconds: 0 });
  expect(world().elapsed).toBe(4);
  expect(world().creatures.map(({ hp }) => hp)).toEqual([18, 12]);
});

it("applies the plan to the whole frozen absence and never retro-fights on its honesty answer", () => {
  const state = readyFight();
  expect(startSession(state, 600).ok).toBe(true);
  const clock = setClock();
  const app = reloadAfter(state, 0);
  clock(2); visibility("hidden");
  clock(3); document.dispatchEvent(new Event("freeze"));
  clock(603); document.dispatchEvent(new Event("resume"));
  clock(605); visibility("visible");
  const gap = () => app.state.session!.accounting;
  expect(gap()).toMatchObject({ creditedSeconds: 600, pendingAwaySeconds: 0, poolSeconds: 5 });
  expect(gap().bucketNous).toBeCloseTo(0.4, 9);
  expect(app.state.nous).toBeCloseTo(state.nous + 600 * 0.08, 8);
  expect(app.state.world.elapsed).toBe(3);
  expect(app.state.world.creatures[0]!.hp).toBe(24);
  app.resolveHonesty("full");
  expect(gap()).toMatchObject({ creditedSeconds: 605, poolSeconds: 0, bucketNous: 0 });
  expect(app.state.nous).toBeCloseTo(state.nous + 605 * 0.08, 8);
  expect(app.state.world.elapsed).toBe(3);
  expect(app.state.world.creatures[0]!.hp).toBe(24);
});

it("an observed bfcache departure preserves the active tail when resume precedes pageshow", () => {
  const state = readyFight();
  expect(startSession(state, 600).ok).toBe(true);
  const clock = setClock();
  const app = reloadAfter(state, 0);
  clock(2); visibility("hidden"); pageTransition("pagehide");
  clock(22); document.dispatchEvent(new Event("resume"));
  clock(24); pageTransition("pageshow"); visibility("visible");
  expect(app.state.session!.accounting.creditedSeconds).toBe(24);
  expect(app.state.world.elapsed).toBe(4);
  expect(app.state.world.creatures[0]!.hp).toBe(18);
});

it("a frozen breather banks the allowance without recovering, then returns to preparation", () => {
  const state = readyFight();
  const sentinel = state.world.creatures[0]!;
  expect(startSession(state, 600).ok).toBe(true);
  advance(state, 600, () => 0.3);
  expect(endSession(state, savedAt).ok).toBe(true);
  expect(sentinel.hp).toBe(24);
  // Carry a defeated creature into the breather's tray without changing
  // its earned allowance or the preparation commands under test.
  sentinel.hp = 4;
  sentinel.pos = null;
  sentinel.recovering = true;
  expect(startBreather(state, savedAt).ok).toBe(true);
  const clock = setClock();
  const app = reloadAfter(state, 0);
  const worldBefore = app.state.world.elapsed;
  clock(2); document.dispatchEvent(new Event("freeze"));
  clock(202); document.dispatchEvent(new Event("resume"));
  expect(app.state.mode).toBe("upgrade");
  expect(app.state.breatherSeconds).toBe(120);
  expect(app.state.nous).toBeGreaterThan(state.nous);
  expect(app.state.world.elapsed).toBe(worldBefore + 2);
  expect(app.state.world.creatures[0]!.hp).toBe(8);
});

it("paused reload does not bank time or fire a carried ready attack", () => {
  const state = readyFight();
  expect(startSession(state, 600).ok).toBe(true);
  advance(state, 3, () => 0.3);
  expect(pauseSession(state).ok).toBe(true);
  const app = reloadAfter(state, 20);
  expect(app.state.mode).toBe("paused");
  expect(app.state.session!.accounting.creditedSeconds).toBe(3);
  expect(app.state.nous).toBe(state.nous);
  expect(app.state.world).toEqual(state.world);
});
