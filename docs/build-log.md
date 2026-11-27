# Build log

One short entry per spec chunk: what was built, what was improvised, and what the pace runner said (`docs/spec/00-overview.md`).

## Chunk 01: Foundation

Issues #15–#21 (parent #14), on `integration/spec-01-foundation`.

### Deleted

- The retired engine and UI, about 93 000 lines across three commits: chords and the chord layer, allocation, capacity, drafts, rarity, merges, scrap, forge, mutators, world and world combat, catalog, achievements, the old `App` and every surface it rendered (render, hex detail, inventory, library, encyclopedia, world, focus), and their tests.
- The recorders, evidence captures and balance and playthrough tooling in `tools/`.
- The docs the remaining code no longer reads, plus `CONTEXT.md`, moved to `docs/archive/`. So did the old agent process docs (review workflow, verification, recordings, visual evidence, briefs).
- The kept modules were trimmed to practice facts: `trust`, `clock`, `habits`, `goals` (now `intentions`), `notes`, `records`, `apps`, the save layer and `shared-save`. The bucket nous, the offline/suspension split, breather gap handling and the economy constants are gone.

### Built

- `num.ts` wraps `break_eternity` with `D()`, arithmetic, comparison and `fmt()`, and every `fmt` case is tested. The fault guard is a no-NaN-Decimal check at the `apply`/`advance` boundary.
- `GameState` is split into `records` (real life: habits, practice log, sessions, Notes, Intentions, class credit) and `game` (nous, mode, session, open classes, legacy line). All mutation goes through `apply`, and time goes through `advance(state, seconds, 'flow' | 'breather' | 'upgrade')`. Both are pure: they return the next state and never touch the one given. `'upgrade'` and `'breather'` are no-ops for now.
- Save v16 writes the nested state exactly, Decimals included. It keeps the stale-tab guard (ADR-0032), the explicit lost-money recovery (ADR-0082), and a newer build's save is never overwritten.
- The v15 → v16 migration keeps the real-life records. Every habit waits for its class, and the game starts fresh apart from `Legacy era · <n> modules · archived`. The original v15 text is kept under `flowsynth.save.original.pre-v16`.
- `npm run pace` is the pace runner skeleton. It runs a scripted player through `apply` and `advance` and prints milestones beside `progression-map.md`.
- The Preact shell (`src/ui/shell/`). Opening the app loads, migrates and saves. It shows the recovery choice when a load requires it, and asks each habit awaiting a class for one, offering only open classes. A choice credits the habit's live credited flow seconds through `apply`'s `chooseClass`, which refuses closed classes and repeats. A unit test (`src/ui/copy.test.ts`) scans every UI source string for the banned words and exclamation marks.

### Improvised

- **The fixture scrub.** No exported v15 save existed on this machine, so `src/engine/fixtures/saves/v15-migration.json` was generated with the retired engine at `424a224`. It covers 8 sessions over about 8 days, 3 habits (one archived), live and manual logs, honesty events, 9 Notes, 3 Intentions and 4 modules. All its text is placeholder, so no scrub was needed. The generator script is in the fixture's README.
- **The pre-v15 refusal.** v10–v14 saves are refused rather than chained. The message is now one plain sentence, and the original is kept under the same pre-v16 key as a v15 save.
- **The legacy count.** `n` counts every module in the v15 `modules` array, placed or unplaced, excluding the retired `mutatorForge`. Banked roll offers aren't counted.
- **Class credit is live time only.** The spec says a migrated habit's "credited time is credited to that class". `classCredit` is defined as live credited flow, so the choice credits the habit's `live` practice-log seconds, not `Habit.seconds`, which includes manual logs. For the fixture that's 6 301 s, 3 901 s and 3 601 s against 7 501 s, 6 601 s and 3 601 s.
- **The shell's scope.** It shows only what first load owes: the recovery choice, the class choice, and a one-line notice for an unreadable or refused save. Once nothing is owed, the page is empty until chunk 02. Archived habits are asked too, marked `· archived`, so their live time reaches a class. The recovery offers `Recover`, `Download original` and `Not now`. `Not now` leaves the save untouched and unwritten, and the next load asks again.
- **A carried-over session and the class choice.** A v15 save with a running session migrates with that session: it is the player's real session. `chooseClass` changes records only, never the board, so it is open in any mode and the first load asks for classes even mid-session. The choice credits the live seconds logged so far; flow after it accrues to the class through `advance`; ending the session credits nothing twice, because class credit never comes from the session's log entry. The running session's seconds from before the choice don't reach the class. The fixture has no running session; `save-v15-migration.test.ts` builds one.
- **Which lost v15 figures ask for recovery.** Only figures the migration keeps: a running session's accounting and its provisional bucket nous. A null `nous`, `world.frontier`, `forge.progress`, `scrap`, `arete` or module reserve is discarded with the retired game and loads ordinarily.
- **The dev JSX transform is off for builds** (`vite.config.ts`). Under vitest the build-purity test's build picked Preact's development JSX, which writes absolute source paths into `dist/`.

### Review fixes

- `apply` and `advance` became pure through one shared `transact` step (clone, run, refuse or NaN-check). Tests that walk one held state use the fixtures' `applyIn`/`advanceIn`, which write the returned state back in place.
- `serialize` takes `savedAt` from its caller; the engine reads no clock.
- `numeric.ts` is gone: `requireFinite` lives in `num.ts` and throws its one `NumFault`.
- Version 15 reads only as the real pre-reset save. The readers for the two interim shapes that never left the branch (#15's flat one, #17's nested one under v15) are gone.
- Goal became Intention inside the engine (`intentions.ts`, `Intention`, `createIntention`…). GLOSSARY.md keeps Goal for the board's signpost line. Saved field names (`goalId`, `goal`, `goalsAdvanced`, `goalSeconds`) keep their spelling so v15 and v16 read the same keys.
- The banned-word test scans the engine's strings too; nothing needed changing.
- The class choice lost its explanatory line. The recovery shows only what ADR-0082 asks, as readouts: `Unreadable · <paths> · start at 0` and `Kept · your habits, sessions, Notes and Intentions, and the original save`.
- Removed the banking experiment, the old-UI `.impeccable` critiques and reviews, and pointed ADR-0074, 0081, 0082, 0088 and 0089 at `docs/archive/`.

### Pace runner

The first output, unchanged at the end of the chunk:

```
Pace run: 300 sessions, 250.0h credited

Milestone                         Reached       Target
--------------------------------  ------------  -------------------------------------------
Engineer opens                    0.0h          at the start (0h)
Producer opens                    0.0h          at the start (0h)
Roadie opens                      not reached   first contact with Flint (Sketch, 0–15h)
Mixer opens                       not reached   conquering the marked Schist (Demo, 15–60h)
First Shale conquered             not reached*  Sketch, 0–15h (ring 1)
...
Master finished (Encore opens)    not reached*  250h

* the engine has no such fact yet

DRY 0.0h–250.0h: 250.0h with no new milestone
```

As expected: there is no board yet, so nothing past the two starting classes can be reached. The whole 250 h stretch is flagged dry.

## Chunk 02: Board

Issues #24–#28 (parent #23), on `integration/spec-02-board`.

### Built

- `hex.ts`: pure axial geometry (distance, rings, neighbours in one fixed direction order, rotation and mirroring of offsets, the 91-cell lifetime board, flat-top pixel layout). `board.ts` derives each cell's kind (open, wall, dark) from the owned cells and the arc, and `map.ts` is the placeholder authored map: Shale at (−1,1), Flint at (2,−1) opening Roadie.
- `game.board` holds the owned cells, the arc (Sketch, radius 2) and the placements. `game.allowance` (2 oscillators) and `game.arrived` (Sine, Triangle) are plain facts chunk 04 will grant. Save v16 reads them additively; an older v16 save loads the opening board.
- `apply` gains `placeModule`, `moveModule` and `removeModule` (`placement.ts`), refused outside upgrade mode, onto walls, dark or occupied cells, beyond allowance, or for a type that hasn't arrived.
- Patterns as data in `modules.ts`, tested in all six rotations and their mirrors (`resonance.ts`). `rates.ts` computes `BoardRates` once per layout change and on load, with identity legs for charge, faders and pressure. Flow credits `rates.total` per second through the trust layer.
- The board in SVG (`src/ui/board/`): flat-top plates, walls as unlit stone with Shale's initial and Flint's Roadie mark, dark cells as broken outlines, modules with hue and glyph, the tray, drag and click-to-pick with keyboard, and engraved resonance outlines that pulse in flow.
- The Hex detail panel (#27): a fixed panel under the board, empty until a cell is clicked, at most five lines read from the cached `BoardRates`, opened by click, keyboard or touch and dismissed by Escape or a tap away.
- The pace runner's placement hook (#28): `placeAllowanceGreedily` fills the allowance through `apply`, and the report prints the board's layout, ν/s and the era's ν.

### Improvised

- **The tray (#25).** Until chunk 04's allowance chips, the tray beside the board shows one entry per arrived type (`Sine`, `Triangle`). Any arrived type can be placed while oscillator allowance remains. Once allowance is spent the entries stay, muted, rather than disappearing.
- **Move onto an occupied cell swaps (#25).** Moving a placed module onto another occupied open cell swaps the two in one action.
- **Removing (#25).** A placed module returns to unplaced by picking it and clicking (or dropping on) the tray.
- **Invalid saved placements (#25).** A placement whose type is unknown, whose cell isn't an owned open cell, or whose cell already holds a module returns to unplaced instead of failing the load. A save without allowance or arrived types loads the opening's (2 oscillators; Sine and Triangle).
- **Refusal copy (#25).** A refused placement keeps the pick and shows its reason in one quiet line under the board (`That cell is a wall.`, `Oscillator allowance is full.`, `The board is locked while a session runs.`).
- **Patterns as direction paths (#26).** Each partner cell in a pattern is a path of steps through the six directions, relative to the oscillator, and every step asks one adjacency function (`adjacent` in `engine/resonance.ts`). Chunk 08's Sync cables extend that function. Square's threshold is the same data: all six sides, with `atLeast: 4`, and its partners are the occupied sides.
- **Rates are not persisted (#26).** `game.rates` is left out of the save text. The reader recomputes it once from the loaded layout, and the v15 migration computes it once from the opening board. A fresh state carries empty rates, since the opening board holds no module.
- **The acceptance hour (#26).** The ticket gives one trusted hour on the acceptance layout as 3.5 × 3600 ν. That figure is the two Triangles' share. The Sine makes its base 1 ν/s too, so the board totals 4.5 ν/s and the hour yields 4.5 × 3600. The test asserts both.
- **One outline per set of cells (#26).** Instances that cover the same cells, such as the acceptance layout's two Triangles, draw one outline, since two would coincide. The outline is the union's boundary, drawn in the gutter between plates with a dark undercut for the engraving. It pulses by stroke opacity over 3.2 s in flow, and holds still under `prefers-reduced-motion`.
- **No flow clock in the shell yet (#26).** Nothing in this chunk starts a session from the page, so the shell has no flow ticker. The ν readout and the outlines read the state signal, so they rise and pulse as soon as flow time passes through `advance`. Chunk 04's flow screen adds the clock.
- **Hex detail placement and clicks (#27).** The Hex detail sits under the board, full stage width, with its five-line lane reserved, so it never moves the board and draws nothing until the first click. Every cell click (and Enter or Space on a focused cell) reads that cell. In upgrade mode the same click still picks or places, and after a placement the panel reads the cell the module landed on. In flow, pause and breathers it only reads. Escape and a tap away empty it and cancel any pick together. A tap inside the panel keeps both.
- **Keyboard reach (#27).** The board is one tab stop (roving focus), starting at (0,0) and then wherever focus last sat. The arrow keys move between cells, dark ones included, so every cell reads from the keyboard without 91 tab stops. Up and down step along a column. Flat-top hexes have no straight left or right neighbour, so left and right zig-zag along a drawn row (from an even column east steps down-right, from an odd column up-right), and a step left undoes a step right. Focus stops at the lifetime board's edge.
- **Dark cells as targets (#25).** During a pick, dark cells carry the muted invalid-target outline like walls.
- **The board keeps the touch floor (#24).** The board scales with its width only, so on a desktop width every cell stays at least 44px across its flats and a short window scrolls. Below 680px the tray drops under the board; at phone width the board only has to fit.
- **Hex detail copy (#27).** Each oscillator type says what closes its resonance (Sine `between`, Triangle `closes`, Square `held by`, Saw `ends`) and what it needs when it isn't resonating. A placeholder wall reads `Wall`, a dark cell `Dark cell · beyond this arc`, and a Release `No resonance pattern`. Rates and factors show two decimals with at least one (`1.0`, `1.75`), truncated like every shown figure. The inspected cell keeps a thin ink outline.
- **Placeholder walls carry no initial (#24).** Only Shale and Flint are named in this chunk, so only they carry an initial (and Flint the Roadie mark). Every other wall inside Sketch's radius is nameless unlit stone until chunk 05 authors the map.
- **The pace runner's greedy placement (#28).** In upgrade mode before the first session, and again after each session, the scripted player fills its remaining allowance one oscillator at a time. Each candidate (every arrived type on every owned cell) is tried through `apply`, which is pure, and the one that most raises `rates.total` is applied. Ties keep the first candidate in arrived-type, then owned-cell order, so on the opening's allowance of 2, where nothing can resonate, it places two Sines at (0,0) and (1,0). It never moves a placed oscillator. With allowance 3 the third oscillator closes a resonance (`pace.test.ts`). `runPace` takes an optional `start` state so tests can grant what chunk 04 will. ν/s prints as the Hex detail shows it (`fmtRate` in `num.ts`: two decimals with at least one, truncated like every shown figure).

### Pace runner

At the end of the chunk, `npm run pace` (250 credited hours):

```
Pace run: 300 sessions, 250.0h credited
Board: 2 oscillators, 2.0 ν/s — Sine (0,0), Sine (1,0)
Era ν: 1.8e6

Milestone                         Reached       Target
--------------------------------  ------------  -------------------------------------------
Engineer opens                    0.0h          at the start (0h)
Producer opens                    0.0h          at the start (0h)
Roadie opens                      not reached   first contact with Flint (Sketch, 0–15h)
Mixer opens                       not reached   conquering the marked Schist (Demo, 15–60h)
First Shale conquered             not reached*  Sketch, 0–15h (ring 1)
...
Master finished (Encore opens)    not reached*  250h

* the engine has no such fact yet

DRY 0.0h–250.0h: 250.0h with no new milestone
```

The board makes nous now: the player lays out the two Sines before the first session, so 2 ν/s over every credited second, 2 × 250 h × 3600 = 1.8e6 ν. The allowance never grows (chunk 04 grants it), so the opening layout can't resonate and the rate stays flat. Nothing spends nous and no wall can be conquered yet, so no further milestone is reachable and the whole run is still flagged dry.
