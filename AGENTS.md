## Agent skills

### Issue tracker

Issues live as GitHub issues in `thelemina418/flowsynth`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults: role name = label string (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root (`docs/adr/README.md` says which ADRs still bind). The design target is `docs/design/` and `docs/spec/`. See `docs/agents/domain.md`.

## Design reset

The game is being rebuilt from `docs/spec/00-overview.md`, one chunk at a time, in sequence. `docs/design/philosophy.md` binds every surface. Where a spec is silent, philosophy decides, not defaults.

## Process

Implement, run `npm run check` and `npm test`, and take one browser look for UI chunks. The pace runner (`npm run pace`) is consulted, not used as a gate on commits. The old review-workflow, verification, recording and visual-evidence gates are retired; their docs are in `docs/archive/agents/`.

## Checks

Fresh worktrees carry no `node_modules` — run `npm install` before your first check. The checkout pins its supported Node runtime in `.node-version`; the npm scripts select it automatically, so run checks through them (`npm test`, not a bare `npx vitest` with a hand-built PATH). Before the first check in a fresh checkout — or whenever the runtime, timezone, or UI storage is in doubt — run `npm run preflight`: it reports the effective runtime and the host's calendar zone, probes the storage capability the UI harness needs, and fails with per-manager fix lines. Then:

- `npm run check` — the typecheck (tsc).
- `npm test` — the full suite: engine and UI projects in one run (UI files serially with isolation; engine files in parallel). An unchanged revision owes one `npm run check` and one `npm test`; a further full run needs a source change, a failure, or an unresolved concern since the last one.
- Targeted iteration: `npm test -- <file> -t '<name>'` for one case, `npm test -- --project ui` for the UI files alone. Any source change invalidates earlier runs — finish each revision with targeted reruns for the touched area, then one full pass.
- `npm run test:calendar` — the calendar-sensitive regressions (`src/engine/calendar.test.ts`, `src/engine/intentions.test.ts`) run targeted under UTC and a DST-observing zone (ADR-0080). Owed when touching intention occurrence boundaries; run in CI on every push.
- `npm run build` — typecheck plus the static bundle in `dist/`.
- The browser look: `npm run dev` picks a free port and prints the served worktree, commit, source cleanliness and URL, and tees logs to `.dev/server.log`.
