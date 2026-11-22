# #541 browser evidence (post-freeze)

## Recapture at `a498b85` (F1/F4 fix)

**Source:** `a498b85ca9676ffd25cf58da8078d9dc3f848d76`, "Hide and disarm Upgrade All while Add is armed". It was served clean from the same checkout; see [`dev-launch-a498b85.txt`](dev-launch-a498b85.txt) and the accepted preflight [`provenance-a498b85.json`](provenance-a498b85.json). Both scripts re-verify the served commit and cleanliness.

The fix acts only while Add is armed: `renderUpgradeAll` stays hidden while `ui.buyingCell` is true, and `upgradeAllAction` returns early. Only the Add surfaces were recaptured:

| Check | Area | Result |
| --- | --- | --- |
| Add inner and outer prices (30/90 ν), Short on ν, desktop keyboard purchase and Escape, phone touch from World, Cancel pill, owned on World; Upgrade All hidden while armed at both widths and back after the phone cancel | `add-a498b85/` | Pass |
| Outer 1,474,560 ν at C13 (0,9) on both widths. Phone centre tap: refused at one ν short, buys at exact funds. `elementFromPoint` reaches the offer at its centre and at both ends of the price. The polygon matches its neighbour, the price stays inside the cell, there is no overflow, and focus/Enter works on desktop. | `add-outer-a498b85/` (`*-outer-short`, `*-outer-exact`, `-gray`, `*-outer-bought`) | Pass (F1 fixed) |
| Upgrade All hidden while Add is armed (`hidden`, no focusable chips), and back after Escape (desktop) or the Cancel pill (phone) | `add-outer-a498b85/*-cancelled-upgrade-all-back` | Pass |
| F4: with Add armed, `upgradeAllAction(1, 5, 10, 'max')` leaves nous and levels unchanged; the chips cannot be reached | `add-outer-a498b85/browser.json` (`f4`) | Pass (F4 fixed) |
| Return to the same owned cell on World (C13 opens in Hex detail, World face) | `*-world-same-cell` | Pass |

The phone target is still 43×50 px with this constructed spur's fit. Its size depends on the fit, so it is recorded, not judged.

**Superseded:** the `add/` and `add-outer/` results below are superseded at `4d81a59` by the two folders above. **Still valid at `4d81a59`:** every other area (`discovery`, `proof`, `live`, `migration`, `blacksmith`, `silhouette`, `hexdetail-live`). The `a498b85` change acts only while Add is armed, and none of those walks arm Add.

## Original capture at `4d81a59`

**Source:** `4d81a5908794f426ff797f2f3632b59255b9f936` (source-identical to `5bc3e0a`), served clean from `/home/lem/.t3/worktrees/flowsynth/541-capture`. [`dev-launch.txt`](dev-launch.txt) is the launcher's output; [`provenance.json`](provenance.json) is the accepted capture preflight. The newer scripts re-verify the served worktree, commit and cleanliness before and after their walks.

**Browser:** Playwright 1.61.1 headless Chromium 149.0.7827.55. Desktop runs at 1280×800. Phone runs at 390×844 with `isMobile`, `hasTouch` and a coarse pointer. Touch is emulated in Chromium, not tested on a real device. Chromium's mobile emulation paints a teal tap highlight on the last tapped element; that highlight is not app styling.

**Reproduce** from the checkout root after the preflight: `docs/evidence/issue-541/browser/run.sh <area> <verified-url>`. `PLAYWRIGHT_MODULE` and `CHROMIUM_BIN` select an existing install. Each area writes its PNG files and its JSON record beside its script. `proof`, `live`, `add`, `blacksmith` and `silhouette` adapt the #542–#546 harnesses into new files; none of the historical captures were overwritten.

## Coverage

| Owed item | Area and captures | Result |
| --- | --- | --- |
| Pre-discovery pressure in the Ledger | `discovery/`: `*-ledger-pressure.png` and `-gray`. Real flow from `approaching-prestige` crosses Shale (1,860 s). The Ledger says "One enemy −20% ν · Bank Arete at prestige…", names no wall and shows no World layer. | Pass at both widths |
| Discovery | `discovery/`: `*-prestige-confirm`, `*-discovery-grant` (the six-piece kit), and `*-discovered-world` (new-era walls reserved). The active Shale plate with HP and pressure is in `live/desktop-origin` and `live/desktop-flow`. | Pass |
| Isolated proof journey | `proof/`: launch with the scenario declaration, prepared kit, keyboard conduit outlet, flow, lifetime clear (Basalt −35% next), phone board, touch pressure disclosure, and Recovering in the tray | Pass |
| Combat read-only during flow, HP/pressure, recovery and placement | `live/`: `desktop-flow` (placement disabled, read-only lock on tools), `desktop-live-rig`, `desktop-live-clear`, `phone-recovery` and `-gray` (0/24 HP · Recovering, Place disabled), and `desktop-reduced-motion` | Pass |
| Migration recovery | `migration/`: a v14 save boots to v15 with the exact bytes kept under `original.pre-v15`. Its note appears once and is gone after a reload. The world renders. A v14 save with lost Arete shows the recovery offer (also in greyscale); Recover applies Arete 0 and 6 pieces and keeps the original. | Pass, with finding F3 |
| Add (**superseded at `4d81a59`**, see `add-a498b85/` and `add-outer-a498b85/`) | `add/` covers the 30/90 ν inner and outer prices and the Short-on refusal. `add-outer/` covers 1,474,560 ν one short then exact, keyboard focus and Enter on desktop, touch on phone, the refused activation, the Cancel pill and Escape, no overflow, the full price kept inside the cell, matching polygons, and reopening C13 on World in Hex detail (`*-world-same-cell`). | Desktop pass. Phone hit area fails (F1). |
| World tray, unfed vs powered | `blacksmith/*-world-inspect`: Maul reads "12 HP unfed · 24 HP for 2 charge · every 8 s · needs an adjacent Sentinel" with Place enabled. Striker and Maul are compared in `*-choice`. | Pass |
| Focus Blacksmith class, meter and choice | `blacksmith/`: class (inset marker, also in greyscale), meter disclosure by focus/Escape and by tap/tap-away, 6:00/10:00 credited, banked silently during flow, choice (square, ≥44 px, no overflow, reduced motion) | Pass |
| Common silhouette and greyscale | `silhouette/`: the same points on board, inventory, drag, Hex detail and miniatures (`browser-checks.json`), and `monochrome-comparison.png`. The four World states stay distinct. Hit tests reach the tapered edge. | Pass |
| Live Hex-detail touch: refresh, dismiss and select | `hexdetail-live/phone-*`, during real flow. The first tap pins, and a live tick replaces the trigger while the pin stays (`pin-after-live-rebuild`). Tap-away and Escape dismiss without reopening after the next tick. A pin, a rebuild, then a second tap selects World with no pin carried over. The selected miniature's tap shows its facts. | Pass, with finding F2 in the same frame |
| Keyboard focus and Escape | `hexdetail-live/desktop-*`: focus discloses and keeps focus through a live rebuild, Escape dismisses and keeps focus, Enter selects. The selected miniature's focus shows its facts (#539 owner rule). Hover discloses the inactive miniature. Also `live/desktop-keyboard-disclosure` and `proof/desktop-outlet-keyboard`. | Pass |
| State without colour | The greyscale frames listed above, plus non-colour markers (inset underline, hatching, dashed open cells, a light focus stroke on the Add offer) | Pass |
| Reduced motion | No animations under `reduce` in World grid, Hex detail, Add offers or the weapon choice (`live`, `proof`, `hexdetail-live`, `add-outer`, `blacksmith`). `silhouette` reads the fed, flowing board: the #544-retired `.world-bar-fill` breath has no emitter (its CSS is orphaned). | Pass |

**Unavailable:**
- Real-device touch, pinch, and two-finger pan were not run.
- Screen-reader output was not checked beyond accessible names and live-region text.
- The pixel size of the phone outer-Add target depends on the board fit. With the constructed spur it is 43×50 px, which is below 44 px wide. This was recorded, not judged.

## Findings (source not changed)

- **F1 — Phone: an outer Add destination sits under Upgrade All.** *Fixed in `a498b85`, verified above.*
  - Steps: Use `fresh-start`, then `devWorldEra()`. Push cells (0,2)…(0,8) and set nous to 1,474,560. On World, tap Add in the thumb bar.
  - Result: The default fit draws C13 (0,9) and (1,8) beneath `#upgrade-all`. `elementFromPoint` at the cell centre returns `DIV#upgrade-all`. A centre tap with exact funds buys nothing, and only a strip about 21 px tall above the bar buys. The `UPGRADE ALL` label also crowds the engraved price (`add-outer/phone-outer-short.png`).
- **F2 — Phone, in flow (filed as #10): the Hex-detail header collides with the ambient reset reason.**
  - Steps: Open any cell's Hex detail during flow at 390 px.
  - Result: `.hex-detail-readonly` ("FLOW LIVE · READ-ONLY", y 271–284) overlaps `#phone-reset-reason` ("Available between sessions", y 269–299). Return also overlaps the strip. See `hexdetail-live/phone-pin-after-live-rebuild.png`.
- **F3 — The migration explanations are not visible (filed as #11).**
  - The v14 note ("Old Blade-only clears do not count; new victories last through prestige.") and the v13 "Arete returned" note go only to the `sr-only` `#status` live region, so sighted players never see them.
  - This is how `say()` works for every message; whether that is acceptable for migration notices is an owner judgement.
- **F4 — Upgrade All spends nous while Add is armed.** *Fixed in `a498b85`, verified above.*
  - Steps: Arm Add, then press `+1` in `#upgrade-all` at either width.
  - Result: Nous drops by 10 while `buyingCell` stays true. Face upgrades are blocked in the same state.
- **F5 (pre-existing since #270, filed as #12) — Escape does not dismiss the desktop Ledger rate breakdown.**
  - The breakdown appears on `.board-ledger:hover`/`:focus-within` and does not respond to Escape (instrument standard: dismissible by Escape).
  - After a mouse-driven confirm, it can stay open over the board.

**Harness corrections** (these are stale expectations in the copied harnesses, not product defects):
- The occupied World cell now speaks its occupant.
- Enemy keys are now named (`shale`, `basalt`).
- On phone, the first touch on the inactive miniature pins its facts and the second touch selects.
- The fed-fill breath check was replaced, because #544 removed the charge bar it targeted.
- The migration fixture gained `prestiges = 1`. With 0 prestiges, the Arete read is the pre-Catalog dash, which no real v14 save with banked Arete would show.

**Observation:** The recipe checkpoints carry the "Place it beside your first." onboarding card on established boards.
