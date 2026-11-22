// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { endSession, pauseSession, placeWorldOccupant, prestige, startBreather, startSession } from "../engine/actions";
import { advance } from "../engine/advance";
import { hex } from "../engine/hex";
import { give } from "../engine/fixtures";
import { serialize, STORAGE_KEY } from "../engine/save";
import { createInitialState } from "../engine/state";
import { memorySaveStorage, SharedSave } from "./shared-save";
import { createAppFixture, setVisibility } from "./testing/app-fixture";

const fixture = createAppFixture();
const savedAt = 1_000_000;
afterEach(() => { fixture.release(); vi.restoreAllMocks(); });

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
