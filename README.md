# flowsynth

Flowsynth is an incremental game played during real-life focus sessions. Modules on a single hex board resonate in patterns while the player practises.

The game is being rebuilt from [the spec](docs/spec/00-overview.md), one chunk at a time. The binding design is [`GLOSSARY.md`](GLOSSARY.md), [`docs/design/`](docs/design/), [`PRODUCT.md`](PRODUCT.md), [`DESIGN.md`](DESIGN.md) and the [decisions](docs/adr/) that [`docs/adr/README.md`](docs/adr/README.md) says still bind. Records of the game before the reset are in [`docs/archive/`](docs/archive/README.md).

```sh
# Select the supported runtime first: the checkout pins it in .node-version,
# and version managers read that file directly.
mise install            # or: fnm install; nvm users: nvm install $(cat .node-version)
npm install
npm run preflight      # runtime, timezone, and UI-storage gate — cheap, fails with the fix
npm run dev            # serve the checkout at the printed local URL
npm run check          # typecheck
npm test               # full test suite (engine and UI projects in one run)
npm run test:calendar  # calendar regressions under UTC and a DST-observing zone
npm run build          # typecheck + static bundle in dist/
npm run preview        # serve the built bundle
```

The supported Node runtime is declared once, in `.node-version` — CI installs exactly it, version managers select it from the same file, and the npm scripts select it automatically through `tools/run-supported.mjs` (ADR-0080).

Saves live in your browser's local storage. The engine in `src/engine/` is a pure library: no DOM, no clock, no unseeded randomness.
