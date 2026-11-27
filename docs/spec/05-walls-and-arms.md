# 05: Walls and Arms

## The authored map

- Author all 91 cells in `src/engine/map.ts` as data: the opening cells, then each wall's kind, its modifier if any, and its class mark if any.
- Wall bands and stats are in `mechanics-sketch.md`. The marked Schist sits in ring 2.
- Place modifiers so they create puzzles: no more than 1 in 6 walls has one. Sketch uses exactly two, `Pressure ×2` and `Only Arm damage`.
- Show the map up to the current arc's radius, and keep the rest dark.

## Fighting

- During flow and breathers, damage reaches a wall from Arms bordering it and from cables patched into it. The wall regenerates continuously. The HP bar of the wall being fought appears on the flow screen.
- Pressure applies to the modules bordering a wall.
- **Conquest**: at 0 HP the cell becomes open and empty and is owned for life. The Goal advances, and the Encyclopedia may gain an entry.
- **Roadie** opens the first time an open cell borders Flint. Its Arms (Blade, Guard Plate) come from Roadie's allowance.

## Hex detail

```
Shale · Wall · ring 1
412 / 600 HP · regen 0.1/s
Pressure 5% on 2 modules
Taking 1.4/s
```

## Acceptance

- Pace runner: Shale falls in the first session or two (under about 1h credited), Roadie opens by about 3h, and the marked Schist falls at about 8–12h.
- No wall's HP changes in upgrade mode.
