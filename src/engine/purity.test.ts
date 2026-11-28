import { describe, expect, it } from "vitest";
import { advance } from "./advance";
import { apply } from "./apply";
import { createInitialState, cloneState } from "./state";
import { D } from "./num";

// The engine's two doors are pure (spec chunk 01): `apply` and `advance`
// return the next state and never touch the one they were given.
describe("apply and advance never mutate their input", () => {
  it("apply returns a new state and leaves the input as it was", () => {
    const s = createInitialState();
    const before = cloneState(s);
    const made = apply(s, { type: "createHabit", name: "Piano", habitClass: "engineer" });
    expect(made.ok).toBe(true);
    expect(s).toEqual(before);
    expect(made.state).not.toBe(s);
    expect(made.state.records.habits).toHaveLength(1);
  });

  it("a refusal returns the input state itself, untouched", () => {
    const s = createInitialState();
    const before = cloneState(s);
    const refused = apply(s, { type: "createHabit", name: "  " });
    expect(refused.ok).toBe(false);
    expect(refused.state).toBe(s);
    expect(s).toEqual(before);
  });

  it("advance returns the walked state and leaves the input as it was", () => {
    let s = createInitialState();
    s = apply(s, { type: "createHabit", name: "Piano", habitClass: "engineer" }).state;
    s = apply(s, { type: "startSession", habitId: s.records.habits[0]!.id, target: 1500, now: 0 }).state;
    const before = cloneState(s);
    const walked = advance(s, 600, "flow");
    expect(s).toEqual(before);
    expect(walked.state.game.session!.elapsed).toBe(600);
    expect(walked.state.records.classCredit.engineer).toBe(600);
  });

  it("a numeric fault in advance returns the input state, untouched, and names the figure", () => {
    let s = createInitialState();
    s = apply(s, { type: "createHabit", name: "Piano", habitClass: "engineer" }).state;
    s = apply(s, { type: "startSession", habitId: s.records.habits[0]!.id, target: 1500, now: 0 }).state;
    s.game.session!.accounting.provisionalNous = D(Number.NaN);
    const walked = advance(s, 600, "flow");
    expect(walked.fault).toBeDefined();
    expect(walked.state).toBe(s);
    expect(s.game.session!.elapsed).toBe(0);
  });
});
