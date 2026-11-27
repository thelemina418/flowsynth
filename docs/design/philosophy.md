# Design philosophy

The rules for how Flowsynth looks, speaks and reveals itself. They bind every surface. Where a brief or spec is silent, these rules decide, not defaults. `PRODUCT.md` (brand and voice) and `DESIGN.md` (tokens) remain the sources for The Rack's look. This document supersedes `docs/instrument-standards.md`, which is archived.

## Cadence is the product

| Phase | The player | The board |
|---|---|---|
| Flow session | Practises in real life. Glances if they want to. No input needed. | Produces. Resonances hum, ν rises, the wall being fought loses HP. |
| Upgrade mode | Buys faders, arranges modules and cables, plans. This is where the excitement built up during practice gets released. | Frozen. Produces nothing. |
| Breather | Steps away from the screen. | Runs ×2, and breather oscillators wake. |
| Return | Starts the next flow session. | — |

A finished flow session banks one breather, and at most one is held. It pays out only if taken in full. The flow screen never asks for anything. Its job is anticipation, carried by the quiet `Ready · N` counter.

## Look: The Rack

- A synthesizer instrument, not a game HUD: precise, quiet, machined. Tokens and type live in `DESIGN.md`.
- **Hue means category**: Oscillator, Modulator, Effect, Arm. Charge is light; walls are unlit stone. No other colour carries meaning.
- **State grammar**: muted outline = unavailable, clear outline = available, firm inset = selected, engraved = acquired. Colour is never the only signal, and every hue is paired with a glyph.
- **Cables** are drawn as patch cords: thin, slightly slack curves between jacks, coloured by their source's category. They never cross.
- **Upgrades are a console**: channel faders (one per type), bus faders (one per category) and a master section (Arete). A fader's throw is its level.
- Calm by default. Glow and motion are for charge and live activity only. Reduced motion is fully static.
- Desktop first. On a phone, nothing may break (readable flow screen, no overflow) until a dedicated pass.

## Words

1. **Glossary terms or plain words only.** A new noun may not appear in copy until it is in `GLOSSARY.md`.
2. **A readout is name · number · effect**, e.g. `Sine · ×2.0 resonance · 14.2 ν/s`. Never a sentence where a readout will do.
3. **Purchases are products, not mechanics.** Terse studio-hardware names, each with one concrete effect line.
4. **No hover tooltips by default.** Inspecting is a deliberate click that opens the Hex detail.
5. **Banned in UI copy**: unlock, boost, enhance, powerful, synergy, seamless, journey, unleash, harness, empower, optimize, "level up" (as a verb), amazing, and exclamation marks.
6. **Removal test**: "Could a player who understands the concept still make a materially mistaken choice because this fact is missing?" If not, cut the fact.
7. Concept teaching lives in the **Encyclopedia**: voluntary, with one quiet unseen-dot, no forced tours and no locked entries.

## Disclosure

The first screen shows exactly nine things:

1. The board with 4 open cells
2. The surrounding walls, with Shale marked
3. Sine, unplaced
4. Triangle, unplaced
5. Flywheel, unplaced
6. 1 Patch cable
7. `ν 0`
8. The Goal: `Conquer Shale`
9. `Begin flow`

Adding a tenth is a bug.

Everything else appears when it first matters: the console when the first fader is affordable, class levels and the Almanac after the first session, Arms when Roadie opens.

Signposting comes only from **the single Goal line** and **the visible map**. Walls that open a class carry that class's mark. Rings beyond the current arc are dark. Players crave what they can see.

## Process lessons

- "Letter passes, spirit fails": wherever a brief is silent, LLM defaults (verbose, defensive, system-speak) fill the gap. Specs show the target through concrete examples (copy, numbers, screen sketches), never through lists of elements.
- Build in sequence, never in parallel streams, until the baseline exists.
- The checks are `npm run check`, `npm test` and one browser look per UI chunk. The pace runner is consulted, not used as a gate on commits. The old evidence, freeze and recording gates are retired. They were built to catch drift that a written target now prevents.
- Iterate the spec rather than hand-patching drift.
