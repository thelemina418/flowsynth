# 01: Foundation

## Clear out

- Delete the retired engine and UI modules, and their tests: chords and chordlayer, allocation, capacity, drafts, rarity, merges, scrap, forge, mutators, world and world-combat, catalog, achievements tied to them, and the recorders. The playthrough tools in `tools/` go too.
- Move every doc in `docs/` that the remaining code no longer reads into `docs/archive/`. `docs/archive/README.md` already lists the remaining ones. Move `CONTEXT.md` to `docs/archive/` as well.
- Keep `docs/agents/issue-tracker.md` and `triage-labels.md`. Archive the other agent process docs (review workflow, verification, recordings, visual evidence, briefs), since `AGENTS.md` now carries the lean process.

## Build

- **`num.ts`**: wraps `Decimal`. Exports `D()`, arithmetic, comparison and `fmt()`:
  - below 1e6, plain digits with a thin space between groups (`12 480`)
  - up to e308, `1.23e45`
  - beyond that, `e1.2e308` or `ee12`

  Every `fmt` case has a unit test. `numeric.ts`'s fault guard becomes a check that no `Decimal` is NaN.
- **State**: a single serialisable `GameState`. All mutation goes through `apply(state, action)`, and time goes through `advance(state, seconds, mode)` with `mode` one of `'flow' | 'breather' | 'upgrade'`. With `'upgrade'`, `advance` is a no-op for the board.
- **Trust**: port `trust.ts`, `clock.ts` and the honesty report as they are, then adapt them to the new state. This is ADR-0019, and their tests come along.
- **Save v16**:
  - Port the stale-tab guard and explicit recovery.
  - The v15→v16 migration keeps the **real-life records**: habits, credited time per habit, session history, Notes and calendar facts.
  - It **seeds class levels**: each migrated habit asks for its class on first load, and its credited time is credited to that class.
  - Game state starts fresh, apart from one Almanac line: `Legacy era · <n> modules · archived`.
- **Pace runner** (`npm run pace`): a lean, headless script that plays a scripted reasonable player.
  - The player runs 50-minute sessions, takes each breather, and tends greedily: buy the cheapest fader, place all allowance by a simple resonance-seeking heuristic, patch charge into the nearest wall.
  - It prints milestones in credited hours (each wall, each class opening, each class level 5, first prestige…) beside the targets in `progression-map.md`, and flags any stretch over 2h with no new milestone.
  - It grows with every chunk. It is a tool you consult, not a gate.

## Acceptance

- `advance(s, 3600, 'upgrade')` leaves every resource and every wall's HP unchanged.
- A real v15 save migrates: its habits, session history and Notes are present, and the game state is fresh.
- Saving then loading round-trips state exactly, Decimals included.
