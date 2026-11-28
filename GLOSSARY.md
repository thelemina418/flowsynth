# Flowsynth

An incremental game played during real-life focus sessions. Modules on a single hex board resonate in patterns while the player works. The board grows only by conquering the walls that occupy it.

This glossary replaces `CONTEXT.md` as part of the design reset. Terms not listed here are not yet decided.

## Language

### The board

**Board**:
The single-layer hex grid where all production and all conflict happen.
_Avoid_: Rack (as the grid), Modules layer, World layer, lattice

**Cell**:
One hex of the board. Cells are scarce and gained only by conquest, never bought.
_Avoid_: Slot, tile, hex

**Module**:
Anything placed in a cell. It belongs to exactly one category.
_Avoid_: Unit, piece, card

**Category**:
A module's family. Each category has one distinct spatial niche.
_Avoid_: Type (a type is a specific module within a category), class (a class belongs to a habit)

**Oscillator**:
A category of sound-source modules that make nous. Each oscillator type has a resonance pattern.
_Avoid_: Synthesizer, voice, generator

**Modulator**:
A category of modules that make charge from the player's practice and push it out with a fixed direction and reach.
_Avoid_: Generator, LFO (as the category name), source

**Effect**:
A category of modules that act at a distance or across an area, e.g. Delay, Reverb, Filter.
_Avoid_: Booster, infusor, buff

**Arm**:
A category of combat modules that work only from cells bordering a wall.
_Avoid_: Weapon (as the category name), creature, gear

**Cable**:
A link from one module's output jack to another module within a maximum length. A cable occupies no cell and may not cross another cable. Cable types are Patch, Mult, Inverter and Sync. Cables belong to the Producer class.
_Avoid_: Wire, spacer, conduit, connector, link

**Patch**:
A cable that carries a modulator's charge to one module, in place of that output's fixed reach.

**Mult**:
A cable that splits one output to two targets at reduced strength.

**Inverter**:
A cable that turns a modulator's output against a wall.

**Sync**:
A rare cable that makes two oscillators count as adjacent for one resonance pattern.

**Resonance**:
The effect an oscillator gains while its resonance pattern is satisfied. One module can take part in several resonances at once.
_Avoid_: Chord, synergy, combo, harmony

**Resonance pattern**:
An oscillator type's required shape of neighbouring partner modules.
_Avoid_: Formation, voicing, recipe

**Wall**:
A hostile presence that occupies a cell on the board. It has HP and regen, and applies pressure. Conquering it gains that cell for the player's lifetime. Walls come in nine named kinds, from Shale to Corundum, in an authored outward order.
_Avoid_: Enemy (in copy), boss, blocker, creature

**Modifier**:
A wall's authored rule that changes how it is fought, e.g. `Pressure ×2`, `Only Arm damage`. Copy names the rule, never the word itself.
_Avoid_: Affix, trait, mutator, (in copy) modifier

**Pressure**:
A wall's reduction of nous from the modules bordering it.
_Avoid_: Penalty, debuff, drain

**Facing**:
The one of six directions a modulator or Arm points, rotated in upgrade mode.
_Avoid_: Orientation, rotation (as a noun)

**Reach**:
The cells a modulator's charge goes to when it isn't patched.
_Avoid_: Range, aura, area

### Resources

**Nous (ν)**:
The main currency, made by oscillators and spent on console faders.
_Avoid_: Money, points, score

**Charge**:
The single resource modulators make from practice and deliver to other modules.
_Avoid_: Energy, mana, power

### Progression

**Habit class**:
The kind of development a habit is attuned to. Each class grants allowance of its craft: Engineer → Oscillators, Producer → Modulators and Cables, Mixer → Effects, Roadie → Arms.
_Avoid_: Role, job, skill tree

**Class level**:
A habit class's standing, earned from credited flow time. It grants allowance and new module types. Nous cannot buy it.
_Avoid_: XP (in copy), rank

**Allowance**:
How many modules of a category the player may have placed at once. Allowance is granted by class level, never drafted, rolled or merged.
_Avoid_: Inventory, draft, roll, hand

**Console**:
The always-visible strip of faders, and the only way nous (or Arete) buys strength. It holds channel faders (one per type), bus faders (one per category) and the master section (Arete).
_Avoid_: Global row, shop, upgrade tree, module level, upgrade all

**Fader**:
One console upgrade. Its throw shows its level.
_Avoid_: Upgrade button, perk, node

**Arete**:
The prestige currency. It is earned when an era ends and spent on the master section.
_Avoid_: Prestige points

**Master section**:
The console's Arete faders, shown from the first prestige on. Their levels survive every prestige. It holds Channel Taper, Bus Taper and Drive.
_Avoid_: Arete row, prestige shop, perks

**Taper**:
A master fader that makes one section's fader costs grow more slowly: **Channel Taper** for the channel faders, **Bus Taper** for the bus faders.
_Avoid_: Discount, cost reduction

**Drive**:
The master fader that multiplies all oscillator ν.
_Avoid_: Global multiplier

**Era**:
The span between prestiges. Prestige resets only nous and fader levels; the board, cables, class levels and allowance stay.
_Avoid_: Run, loop, cycle

**Arc**:
One of the four macro stages of the game, Sketch, Demo, Record and Master, followed by Encore. Each arc adds new play and automates old play.
_Avoid_: Act, chapter, tier, era

**Master**:
The final multi-era build project. Finishing it ends the designed game.
_Avoid_: Endgame, win

**Encore**:
The endless post-game after the Master.
_Avoid_: Infinity, NG+

**Goal**:
The single line on the board that always names the next visible thing worth reaching.
_Avoid_: Quest, objective (Intentions are the player's own targets)

### Play cadence

**Flow session**:
A timed period of real-world practice on one habit, during which the board produces without player input.
_Avoid_: Focus session, run

**Breather**:
A timed step away from the screen. It is banked at the end of a flow session (at most one held) and taken before the next one, and pays out only if completed. The board runs stronger during it and has breather-only effects.
_Avoid_: Break, rest

**Habit**:
A real-world practice. It is a name plus its attuned habit class.
_Avoid_: Task, activity

**Upgrade mode**:
The interactive time between flow sessions, when the board is frozen and the player buys faders and arranges modules and cables.
_Avoid_: Tending (that is mindhive's term), edit mode, shop

### Planning

**Almanac**:
The planning view: habit stats, Intentions, Notes, the calendar and history. Nothing in it affects the board.
_Avoid_: Habit app, planner, dashboard

**Intention**:
A player-set target for a habit, tracked in the Almanac. It has no effect on the board.
_Avoid_: Goal (Goal is the board's signpost line), milestone

**Hex detail**:
The fixed panel that shows the full readout of a clicked cell.
_Avoid_: Tooltip, inspector, popover

**Encyclopedia**:
The voluntary reference where concepts are explained.
_Avoid_: Help, tutorial, codex
