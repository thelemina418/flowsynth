// The engine's constants: trust accounting, the summary reflection, and
// the save version.

export const EPS = 1e-9;

// The dual-clock drift noise floor (focus-tool spec §1): Date.now() reads
// whole milliseconds while performance.now() reads finer, so the measured
// drift jitters by a millisecond or two across every boundary even when
// both clocks run true, while real sleeps and rollbacks move the drift by
// seconds. A step inside the floor is measurement noise, not drift.
export const DRIFT_NOISE_SECONDS = 0.05;

// The reconciliation floor (focus-tool spec §1, ADR-0019): absences below
// it auto-credit silently on both modes — time credits, no report, never
// joins the pool.
export const RECONCILIATION_FLOOR_SECONDS = 180;

// The summary reflection's slider (focus-tool spec §8): a continuous
// rough ↔ great read on the 1–5 scale; decimals store raw.
export const REFLECTION_SLIDER_MIN = 1;
export const REFLECTION_SLIDER_POSITIONS = 5;
export const REFLECTION_SLIDER_NEUTRAL = 3;

// Save v16 (issue #18): the nested GameState. A v15 save is read once and
// migrated (issue #19); older versions are refused; newer ones are never
// overwritten.
export const SAVE_VERSION = 16;
