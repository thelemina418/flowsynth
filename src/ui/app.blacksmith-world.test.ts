// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { endSession, prestige, startSession } from "../engine/actions";
import { advance } from "../engine/advance";
import { claimForgedWeapon, selectHabitClass } from "../engine/classes";
import { createHabit, selectHabit } from "../engine/habits";
import { createAppFixture } from "./testing/app-fixture";

const fixture = createAppFixture();
afterEach(() => fixture.release());

it("World tray names unfed versus powered hits and cadence before arming placement", () => {
  const app = fixture.boot();
  const { state } = app;
  state.eraEarned = 20_000_000;
  expect(prestige(state).ok).toBe(true);
  const habit = createHabit(state, "Piano").habit!;
  expect(selectHabit(state, habit.id).ok).toBe(true);
  expect(selectHabitClass(state, habit.id, "blacksmith").ok).toBe(true);
  expect(startSession(state, null).ok).toBe(true);
  expect(advance(state, 1200, () => 0.3).fault).toBeUndefined();
  expect(endSession(state).ok).toBe(true);
  expect(claimForgedWeapon(state, habit.id, "striker").ok).toBe(true);
  expect(claimForgedWeapon(state, habit.id, "maul").ok).toBe(true);
  app.setBoardLayer("world");
  app.ui.inventory.collapsed = false;
  app.render();
  for (const [type, effect] of [
    ["chargeBlade", "Charged hit · 4 HP for 1 charge · every 5 s · no hit unfed"],
    ["striker", "5 HP unfed · 8 HP for 1 charge · every 4 s"],
    ["maul", "12 HP unfed · 24 HP for 2 charge · every 8 s"],
  ]) {
    const copy = state.world.weapons.find(w => w.type === type)!;
    document.querySelector<HTMLButtonElement>(`[data-world-tray="${copy.id}"]`)!.click();
    const inspection = document.querySelector(".inventory-inspection")!;
    expect(inspection.textContent).toContain(effect);
    expect(inspection.textContent).toContain("needs an adjacent Sentinel");
    expect(inspection.querySelector(`[data-world-place="${copy.id}"]`)).not.toBeNull();
    expect(app.ui.worldArmed).toBeNull();
    expect(copy.pos).toBeNull();
    document.querySelector<HTMLButtonElement>("[data-world-back]")!.click();
  }
  expect(document.querySelector('[aria-label="Next weapon choice"]')).toBeNull();
});
