# Sketch mechanics

Fully specified for the opening arc. All numbers can be tuned through the pace runner. Later arcs follow the framework in `progression-map.md` and are improvised within it.

## Board

- Axial hex coordinates. A cell's ring is its hex distance from (0,0).
- **Opening**: open cells at (0,0), (1,0), (0,1) and (1,−1). Every other cell up to the current arc's radius is a wall. Cells beyond that radius are dark.
- **Shale** sits at (−1,1), bordering (0,0) and (0,1). The two ring-1 **Basalts** sit at (−1,0), with `Pressure ×2`, and at (0,−1).
- **Flint** (which opens Roadie) sits at (0,−2), with `Only Arm damage`. It borders Basalt (0,−1) and no opening cell. The **marked Schist** (which opens Mixer) sits at (−2,1). The other ten ring-2 cells alternate Flint and Schist going clockwise, starting with Flint at (2,−2).
- Those are Sketch's two modifiers. At most 1 wall in 6 carries one (`src/engine/map.ts` holds the whole map).
- Modules and cables can be freely rearranged in upgrade mode. During flow and breathers, placement is locked.

## Rates (analytic)

The engine computes rates per second and recalculates them whenever the layout changes, never per tick. Time-shaped effects (warm-ups, breather-only effects) are closed-form in session time.

```
oscillator ν/s = base × resonance factor × charge factor × fader multipliers × (1 − pressure)
resonance factor = 1 + R × (1 + 0.5 + 0.25 + …)   // the first satisfied instance gives R, each further instance half the previous
charge factor = 1 + ln(1 + charge/s received)
```

## Oscillators (Engineer)

| Type | Arrives | Base ν/s | Pattern | R |
|---|---|---|---|---|
| Sine | Start | 1 | Partners on **two opposite sides**, both Triangles | 1.0 |
| Triangle | Start | 1 | Closes a **triangle**: two adjacent oscillators that also touch each other | 0.75 |
| Square | Engineer Lv 2 | 1.5 | **4 or more** of its 6 sides occupied, by any modules | 1.5 |
| Saw | Engineer Lv 4 | 2 | At the **end of a straight line of 3** oscillators, itself included | 2.0 |
| Release | Engineer Lv 6 | 0 in flow, 6 in breathers | Wakes only during breathers; no pattern | — |

The opening allowance is 2 oscillators. No resonance is possible until the first extra allowance arrives: a third oscillator lets a Sine–Triangle–Triangle close a triangle. A Sine line needs a conquered cell, because the cell opposite (1,0) across (0,0) is a wall. Both facts are deliberate.

## Modulators and cables (Producer)

| Type | Arrives | Output | Reach |
|---|---|---|---|
| Flywheel | Start | 1 charge/s, plus 0.1 per credited hour on Producer habits, up to 3 | 2 cells in a straight line in its facing (rotated in upgrade mode) |
| Pulsewell | Producer Lv 3 | 0.5 charge/s to each target | All 6 neighbours |
| Patch cable | Start (1), +1 at Producer Lv 2 and 5 | Carries one modulator's output to one target, replacing its reach | Max length 3, may not cross another cable |

- A modulator's charge can reach an **oscillator** (charge factor), an **Arm** (damage, see below) or a **wall** directly through a Patch. A wall hit directly takes charge as damage at 1:1. That's how the first wall falls before Roadie exists.
- Producer levels alternate: the non-milestone levels give +1 Modulator allowance and +1 cable in turn, starting with a Modulator at Lv 1, and skip the milestone (Lv 3, the Pulsewell). So Lv 1, 4, 6, 8… give +1 Modulator and Lv 2, 5, 7, 9… +1 cable.

## Arms (Roadie)

Roadie opens on first contact with Flint, when a conquest makes an open cell border it.

| Type | Arrives | Effect |
|---|---|---|
| Blade | Roadie Lv 0 | Deals 10 × charge/s received as damage to one bordering wall (rotated to choose) |
| Guard Plate | Roadie Lv 2 | Cancels pressure on its neighbours |

An Arm must sit on a cell that borders a wall. If it doesn't, it does nothing and its Hex detail says `No wall in reach`.

## Walls

| Wall | Band | HP | Regen /s | Pressure on bordering modules |
|---|---|---|---|---|
| Shale | ring 1 | 600 | 0.1 | 5% |
| Basalt | ring 1 | 6e3 | 1 | 8% |
| Flint | ring 1–2 | 6e4 | 10 | 10% |
| Schist | ring 2 | 1e6 | 100 | 12% |
| Gneiss | ring 2–3 | 3e7 | 2e3 | 15% |
| Obsidian | ring 3 | 1e9 | 5e4 | 20% |
| Granite | ring 3–4 | 1e11 | 3e6 | 25% |
| Quartz | ring 4 | 1e13 | 2e8 | 30% |
| Corundum | ring 4–5 | 1e16 | 1e11 | 40% |

- Damage and regen apply only during flow and breathers. Nothing happens to a wall in upgrade mode.
- Pressure from several walls on one module stacks additively, capped at 60%.
- A conquered wall leaves an open, empty cell, owned for life.
- In Sketch, the Goal points at the next wall in authored order.

## Console

- **Channel faders**: one per type the player has. Each level multiplies that type's output (ν for oscillators, charge for modulators, damage for Arms) by ×1.25.
- **Bus faders**: one per category. Each level multiplies the whole category by ×1.1.
- Cost is `base × 1.6^level`. Channel bases: Sine 10, Triangle 15, Flywheel 25, Square 200, Saw 1 500, Pulsewell 2 000, Blade 500, Guard Plate 3 000. Bus bases: 5 000 for each category.
- The console appears the first time any fader is affordable. Click buys +1; shift-click buys the most affordable.

## Prestige

- Available once the era's ν reaches 1e6.
- Arete gained = `floor(sqrt(era ν / 1e6))`.
- The master section (Arete): faders that make channel and bus costs grow more slowly, and one fader that multiplies all ν. The builder authors 3–5 master faders.
- It resets ν and fader levels only (ADR-0093).

## Sessions and breathers

- Flow presets are 25, 50 and 90 minutes, plus custom (10–180). Pause is allowed.
- Every session needs a habit (a name plus its class), which can be created inline. Only open classes can be chosen.
- Away time is reconciled by the existing trust accounting and honesty report (ADR-0019).
- A session with at least 10 credited minutes banks a breather. At most one is held, and a newer one replaces it. Starting a flow session does not consume it.
- Breather length is credited time ÷ 5, from a 5-minute minimum to a 15-minute maximum. During it the board runs ×2 and breather oscillators wake. It pays out only if completed, and its result appears the next time the app is opened.
