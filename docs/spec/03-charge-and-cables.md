# 03: Charge and cables

## Modulators

- **Facing**: a modulator has a facing, one of 6 directions, rotated in upgrade mode with click or the `R` key.
- **Reach**: each modulator type's reach shape is in `mechanics-sketch.md`. Charge goes to every module (or wall) inside the reach.
- **Output**: Flywheel's output grows with credited Producer hours, as specified. Modulators make charge only during flow and breathers.
- **Charge factor**: an oscillator's charge factor is `1 + ln(1 + charge/s received)`.

## Cables

- A cable connects a modulator output jack to a target cell within **length ≤ 3** (hex distance).
- **Patch**: sends the whole output of one modulator to that single target, *in place of* its reach.
- **No crossing**: two cables cross if their straight segments between cell centres intersect at anything other than a shared endpoint. A placement that would cross is refused, and the would-be cable is drawn in the muted state.
- **Allowance**: limited by cable allowance (Producer levels).
- **Targets**: a Patch can target a **wall**, which takes charge as damage at 1:1 (Sketch's way to fight before Roadie).
- **Drawing**: cables are slack patch-cord curves, coloured by their source's category. In flow, small light beads travel along them.

## Hex detail additions

```
Flywheel · Modulator · facing NE
1.4 charge/s · patched → Shale
```

## Acceptance

- A Flywheel facing a Triangle 2 cells away gives that Triangle a charge factor of ×1.69 at 1 charge/s.
- Patching that Flywheel to Shale removes the Triangle's charge, and Shale takes 1 damage/s in flow, less its 0.1/s regen.
- A crossing placement is refused with no side effects.
