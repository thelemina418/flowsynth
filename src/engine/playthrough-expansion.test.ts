import { describe, expect, it } from "vitest";
import { composePlaythroughRecipe, runPlaythrough } from "./playthrough";

const firstDay = (sessionMinutes: number) => runPlaythrough(composePlaythroughRecipe({
  seed: 468,
  policyId: "pushing",
  budgetDays: 1,
  schedule: { sessionsPerDay: 2, sessionMinutes, breatherMinutes: 5 },
}));

describe("the scripted player's shared expansion", () => {
  it("puts the first nearby purchase to work after ordinary credited practice", () => {
    const record = firstDay(25);
    const bought = record.events.filter(e => e.ok && e.kind === "purchase" && e.label.startsWith("Cell at "));
    expect(bought).toHaveLength(1);
    const [cell] = bought;
    expect(cell!.credited).toBe(25 * 60);
    expect(record.events.some(e =>
      e.ok && e.kind === "placement" && e.credited === cell!.credited &&
      e.label.endsWith(` at ${cell!.label.slice("Cell at ".length)}`),
    )).toBe(true);
  });

  it("only adds a few usable seats at a break even when a long flow fills the tray", () => {
    const record = firstDay(600);
    const bought = record.events.filter(e => e.ok && e.kind === "purchase" && e.label.startsWith("Cell at "));
    expect(bought).toHaveLength(2);
    for (const event of bought) {
      expect(record.state.modules.some(m => m.pos && `${m.pos.q},${m.pos.r}` === event.label.slice("Cell at ".length))).toBe(true);
    }
    expect(record.state.modules.some(module => module.pos === null)).toBe(true);
  });
});
