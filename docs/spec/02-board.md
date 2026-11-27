# 02: Board

## Geometry

- Axial hex coordinates. Ring = hex distance from (0,0). The lifetime maximum is radius 5 (91 cells).
- A cell is `open` (owned; empty or holding one module), `wall`, or `dark` (beyond the current arc's radius).
- Opening map and positions: as in `mechanics-sketch.md`. The rest of the authored map arrives in chunk 05. Until then, every other cell is a placeholder wall.
- In upgrade mode modules move freely (drag, or click to pick and click to place). In flow and breathers they're locked.

## Resonance

- Each oscillator type has one pattern (see `mechanics-sketch.md`). Patterns are tested **relative to the oscillator**, in all 6 rotations. Mirror images count, except where a pattern says otherwise.
- A module can be a partner in any number of patterns.
- Count the satisfied instances per oscillator, then apply the resonance factor with halving returns.
- Rates are analytic: `BoardRates` is recomputed when the layout changes, never per tick.

## Rendering

- SVG, flat-top hexes, The Rack tokens. Each module shows its category hue plus a glyph.
- While a resonance is satisfied, its member cells share a thin engraved outline in the oscillator's hue, and in flow the outline pulses slowly. The resonance factor is never floated over the board.
- Walls are unlit stone carrying their name initial. A wall that opens a class carries that class's mark.

## Hex detail

Clicking a cell fills the fixed Hex detail panel. Example:

```
Triangle · Oscillator
Resonating ×1 · closes Sine–Triangle
1.0 ν/s base · ×1.75 resonance · ×1.69 charge
2.96 ν/s
```

It has at most 5 lines and only one effect line. Numbers update live in flow.

## Acceptance

- Sine at (0,0), Triangle at (1,0), Triangle at (0,1): both Triangles resonate (×1.75). The Sine does not, because the cells opposite it hold no Triangle pair.
- Rotating a valid pattern still satisfies it.
- A layout change recomputes rates once; a tick never recomputes them.
