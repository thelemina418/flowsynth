# Flowsynth reset: build prompt

You are rebuilding **Flowsynth**, an incremental game played during real-life focus sessions. Modules on a single hex board resonate in patterns while the player practises. Modulators turn practice into charge and patch it across the board through cables. Walls occupy almost every cell, and conquering them is the only way the board grows.

This is a **rebuild that keeps three layers**: trust and session accounting, save integrity, and The Rack look. Everything else (chords, the lattice, drafts, rarity, merges, per-module levels, the World layer, the Forge, mutators) is gone.

## Read these first. They are binding.

| Doc | What it decides |
|---|---|
| `GLOSSARY.md` | Every term. Never use an *Avoid* word, and never put a noun in copy that isn't here. `CONTEXT.md` is archived. |
| `docs/design/philosophy.md` | Cadence, look, words, disclosure, process. Where this spec is silent, philosophy decides, not your defaults. |
| `PRODUCT.md`, `DESIGN.md` | The Rack: brand, voice, tokens. |
| `docs/design/progression-map.md` | Arcs, classes, the authored map, prestige, horizon. These are the pace runner's targets. |
| `docs/design/mechanics-sketch.md` | Exact rules and numbers for the first arc. |
| `docs/adr/0090`–`0095` | The reset's decisions. Do not reverse them. `docs/adr/README.md` says which older ADRs still hold. |

## The shape of a day of play

```
[Upgrade mode] ──Begin flow──▶ [Flow session] ──end──▶ honesty report (if owed) ──▶ [Upgrade mode]
     ▲                         board produces,          banks 1 breather              board frozen
     │                         walls take damage                                     faders, layout, cables
     │                                                                                     │
     └──── return; breather result shown ◀── [Breather] ◀──Take breather────────────────────┘
                                           step away; board ×2,
                                           breather oscillators wake
```

## Stack

- Vite, TypeScript (strict), Vitest, happy-dom, on Node pinned in `.node-version`. **Add Preact + `@preact/signals`** for the UI, and `break_eternity.js` for numbers (ADR-0094), behind `src/engine/num.ts`.
- `src/engine/` is pure: no DOM, no clock, no unseeded randomness.
- UI files stay under 400 lines; split by surface. Never recreate a `render.ts` or an `app.ts` monolith.
- The board is SVG.

## What to port, and what to rebuild

| Keep: port and adapt | Rebuild from this spec | Delete |
|---|---|---|
| `src/engine/trust.ts`, `clock.ts`, `session` logic, honesty report; `apps.ts` and `notes.ts` (focus apps); `calendar.ts`; save integrity (stale-tab guard ADR-0032, explicit recovery ADR-0082); `DESIGN.md` tokens and the Rack's CSS primitives | Economy, rates, board, modules, walls, console, prestige, habits and classes, every UI surface, the pace runner | Chords, lattice, drafts, rarity, merges, scrap, Forge, mutators, World layer, per-module levels, capacity ladder, Arete Catalog, recorders and evidence tooling, century and later-era tools |

## Build order

Build **sequentially**: one chunk at a time, each leaving the game playable end-to-end up to that point, with `npm run check` and `npm test` green. Never run chunks in parallel.

1. `01-foundation.md`: clear out the old systems, num, state, save v16 and migration, ported trust, the pace runner skeleton
2. `02-board.md`: hex map, opening cells, oscillators, resonance, rates, rendering, Hex detail
3. `03-charge-and-cables.md`: modulators, facing and reach, cables, the charge factor
4. `04-cadence.md`: habits and classes, levels and allowance, flow, breather, upgrade mode, Goal, Almanac, Encyclopedia
5. `05-walls-and-arms.md`: the authored map, walls, pressure, conquest, Roadie, Arms
6. `06-console-and-prestige.md`: faders, prestige, the master section
7. `07-demo.md`: framework
8. `08-record.md`: framework
9. `09-master-and-encore.md`: framework

Chunks 1–6 are exact. Chunks 7–9 are frameworks: fixed structure and guardrails, with room to improvise types, patterns and numbers. Record what you improvise in `docs/design/` and add any new term to `GLOSSARY.md` first.

## Rules you will be tempted to break

- **No tooltips.** Clicking opens the Hex detail.
- **No explanatory paragraphs on screen.** A readout is `name · number · effect`. Concepts go in the Encyclopedia.
- **The first screen has exactly nine things** (philosophy.md). A tenth is a bug.
- **Hue is category only.**
- **The board never produces, and walls never change, during upgrade mode.**
- **Nous never buys cells, allowance or class levels.**
- **Real-life records never reset.** Prestige never touches the board (ADR-0093).
- **The pacing law**: cost grows faster than production. If the pace runner shows a stretch longer than about 2 credited hours with nothing new reachable, add an unlock rather than flattening costs.

## Done, per chunk

- `npm run check` and `npm test` pass.
- A unit test greps the UI strings for the banned-word list in philosophy.md.
- For UI chunks, one browser look on desktop, plus a phone width check that nothing overflows.
- A short entry in `docs/build-log.md`: what was built, what was improvised, and what the pace runner said.
