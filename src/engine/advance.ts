import { CATEGORY_OF, EPS } from "./constants";
import { NumericFault, requireFinite } from "./numeric";
import { syncAchievements } from "./achievements";
import { syncChordDiscoveries } from "./library";
import { chargeDelivered, emittedStrength, maxChordFactorOf, deployed, sessionClockOf, syncRates } from "./economy";
import { lifetimeBreatherSecondsOf, nextRestBoundaryOf, nextTemporalBoundaryOf } from "./profiles";
import { summaryTermsOf } from "./allocation";
import { addForgeProgress, addMutatorForgeProgress, type Rng } from "./rolls";
import { accrueLivePractice } from "./habits";
import { accrueGoalProgress, accrueGoalFuel, secondsUntilGoalCompletion } from "./goals";
import { accrueClassDevelopment } from "./classes";
import { advanceWorldCharge, advanceWorldCombat, discoverySecondsOf, syncWorldDiscoveries, worldBoundarySeconds } from "./world";
import type { AdvanceResult, GameState, ModuleInstance, RateSnapshot } from "./types";

// Both trusted sinks bank and credit practice. Offline accounting keeps
// those promises without moving the World clock. Provisional time produces
// into the bucket and pool but does not credit practice or fight.
export type AdvanceSink = "live" | "offline" | "provisional";

// The one production-credit seam (ADR-0039): produced nous lands on the
// balance, the lifetime truth, and the era's measure together — prestige
// rebases only the era leg. Every nous-granting path reads this, never
// three parallel increments that can drift. The landing checks itself:
// an unrepresentable grant refuses before any of the three moves.
export function earnNous(state: GameState, amount: number): void {
  requireFinite(amount, "the earned ν");
  const nous = requireFinite(state.nous + amount, "the nous balance");
  const totalEarned = requireFinite(state.totalEarned + amount, "the lifetime total");
  const eraEarned = requireFinite(state.eraEarned + amount, "the era's measure");
  state.nous = nous;
  state.totalEarned = totalEarned;
  state.eraEarned = eraEarned;
}

export function sumResults(a: AdvanceResult, b: AdvanceResult): AdvanceResult {
  return {
    nousEarned: a.nousEarned + b.nousEarned,
    rollsBanked: a.rollsBanked + b.rollsBanked,
    rollsFlow: a.rollsFlow + b.rollsFlow,
    rollsForge: a.rollsForge + b.rollsForge,
    rollsMutator: a.rollsMutator + b.rollsMutator,
    goalsCompleted: a.goalsCompleted + b.goalsCompleted,
    fault: a.fault ?? b.fault,
  };
}

// Shared board boundaries; only flow adds practice-driven goal boundaries.
function boardBoundaries(state: GameState) {
  const liveGenerators: { module: ModuleInstance; strength: number }[] = [];
  let earliest = Infinity;
  for (const module of deployed(state)) {
    if (CATEGORY_OF[module.type] !== "generator") continue;
    if (module.reserve > EPS) {
      const strength = requireFinite(emittedStrength(state, module, true), "a generator's emission strength");
      liveGenerators.push({ module, strength });
      earliest = Math.min(earliest, module.reserve / strength);
    }
  }
  const clock = sessionClockOf(state);
  for (const module of deployed(state)) {
    const boundary = nextTemporalBoundaryOf(module.type, clock) - clock;
    if (boundary < earliest) earliest = boundary;
    if (state.mode === "breather") {
      const rest = lifetimeBreatherSecondsOf(state);
      earliest = Math.min(earliest, nextRestBoundaryOf(module.type, rest) - rest);
    }
  }
  return { liveGenerators, earliest };
}

function advanceForge(state: GameState, snapshot: RateSnapshot, spanSeconds: number, rng: Rng, spanResult: AdvanceResult): void {
  if (snapshot.forgeRate > 0) {
    const forgeRolls = addForgeProgress(state, snapshot.forgeRate * spanSeconds, rng);
    spanResult.rollsForge += forgeRolls;
    spanResult.rollsBanked += forgeRolls;
  }
  // The Mutator Forge branch (ADR-0043): its own meter, its own queue —
  // charge-only, so the practice leg below never feeds it.
  if (snapshot.mutatorForgeRate > 0) {
    const mutatorRolls = addMutatorForgeProgress(state, snapshot.mutatorForgeRate * spanSeconds, rng);
    spanResult.rollsMutator += mutatorRolls;
  }
}

function drainReserves(liveGenerators: { module: ModuleInstance; strength: number }[], spanSeconds: number): void {
  for (const { module, strength } of liveGenerators) {
    module.reserve = Math.max(0, requireFinite(module.reserve - strength * spanSeconds, "a generator's reserve"));
  }
}

function discoverBoard(state: GameState, snapshot: RateSnapshot): void {
  syncAchievements(state, {
    chargeDelivered: chargeDelivered(snapshot),
    maxChordFactor: maxChordFactorOf(snapshot),
  });
  // The chord library rides the same tick (issue #230): every recognized
  // voice-set — active or idle — is available to discovery; only the
  // active ones populate the bonus terms (issue #258).
  syncChordDiscoveries(state, { chords: snapshot.allocation ? summaryTermsOf(snapshot.allocation) : snapshot.namedChords });
}

// The advance walk proper: the span loop the guard below wraps.
function walkFlow(
  state: GameState,
  seconds: number,
  rng: Rng,
  sink: AdvanceSink,
): AdvanceResult {
  let result: AdvanceResult = {
    nousEarned: 0,
    rollsBanked: 0,
    rollsFlow: 0,
    rollsForge: 0,
    rollsMutator: 0,
    goalsCompleted: 0,
  };
  // A depletion split can be shorter than EPS seconds while still owning
  // significant charge at high strength. Process every positive span so
  // each span drains its boundary before the next begins.
  if (state.mode !== "flow" || seconds <= 0) return result;
  const session = state.session;
  if (!session) return result;

  // Walk spans iteratively: recurring cycle boundaries must not grow the
  // call stack during multi-day away catch-up, even with empty reserves —
  // and, with the World layer (issue #425), even while weapons fire and
  // enemies fall across the whole gap.
  while (seconds > 0) {
    const spanResult: AdvanceResult = {
      nousEarned: 0, rollsBanked: 0, rollsFlow: 0,
      rollsForge: 0, rollsMutator: 0, goalsCompleted: 0,
    };
    // The board is locked during flow, so the rate is constant across the
    // step — except at reserve depletion, live goal completion, a
    // temporal profile's step boundary, or a World boundary (issue #425):
    // a generator whose remaining duration runs out mid-step splits there,
    // so the drained generator stops crediting the remainder (the rate
    // really does change mid-step, once — the loop walks every boundary).
    // The reserves are charge quantity per module (issue #371): delivery
    // consumes quantity at the generator's emission rate, so the earliest
    // emptying one — remaining quantity ÷ strength — is one split boundary.
    // Every generator drains by the same rule, and the temporal walk
    // (issue #372) splits at its authored marks beside them. The snapshot
    // leads the boundary read because the World legs need its rate: the
    // discovery crossing is measured in produced nous.
    const snapshot = syncRates(state, true);
    let { liveGenerators, earliest } = boardBoundaries(state);
    // A live goal completion banks reserve mid-span, so it is another rate
    // boundary even when every generator starts empty.
    if (sink !== "provisional") earliest = Math.min(earliest, secondsUntilGoalCompletion(state, state.activeHabitId));
    // Offline production may still activate a wall and change the rate;
    // only online trusted time has attack and recovery boundaries.
    if (sink !== "provisional") {
      earliest = Math.min(earliest, sink === "live"
        ? worldBoundarySeconds(state, snapshot.rate, snapshot)
        : discoverySecondsOf(state, snapshot.rate));
    }
    const spanSeconds = earliest !== Infinity && earliest + EPS < seconds ? earliest : seconds;

    // The board is locked during flow, so the rate is constant across the
    // step; production is exactly what the board's modules make (§2.1).
    // Board-side meters (Forge progress, received charge) run in both sinks —
    // the trust table redirects only nous and practice minutes (§1); the
    // bucket holds nous only. Practice is the practice-roll meter's whole
    // diet (ADR-0041 as pair-owned by issue #423): it joins below, live-sink
    // only, beside the credited time it keys off — it feeds no Forge
    // branch's threshold.
    // The gated production pass (issue #258): development boards earn from
    // the selected whole chords only, recomputed every step so charge,
    // upgrades, and placement reselections land. The retention hint rides
    // the state and is written back here.
    const gained = requireFinite(snapshot.rate * spanSeconds, "the produced ν/s");
    // Supply earned during this span is available at its ending attack tick.
    advanceWorldCharge(state, snapshot, spanSeconds);
    if (sink === "provisional") {
      // Provisional nous never touches the balance: it waits in the bucket
      // for the honesty report to bank or drop it in one move (§2), and the
      // span's minutes join the pool behind it.
      session.accounting.bucketNous = requireFinite(session.accounting.bucketNous + gained, "the provisional bucket");
      session.accounting.poolSeconds = requireFinite(session.accounting.poolSeconds + spanSeconds, "the provisional pool");
    } else {
      earnNous(state, gained);
    }
    spanResult.nousEarned += gained;
    advanceForge(state, snapshot, spanSeconds, rng, spanResult);
    session.elapsed = requireFinite(session.elapsed + spanSeconds, "the session clock");
    // The summary's headline and rate (§5.7) accrue with the session itself,
    // so pauses never count into either; provisional production stays out
    // until its bucket banks.
    if (sink !== "provisional") session.earned = requireFinite(session.earned + gained, "the session's earned ν");
    // Each generator's reserve is a store of charge quantity of its own
    // (issue #371): a deployed generator — any named design —
    // spends reserve at its emission rate per flow second, elapsing even
    // with no eligible neighbors (delivery reaches whoever is adjacent at
    // full strength; expenditure never depends on the neighbor count).
    // Undeployed, it produces no output and its reserve holds.
    drainReserves(liveGenerators, spanSeconds);
    if (sink !== "provisional") {
      // Practice credits only from present and trusted time — nothing ever
      // accrues from away before its reconciliation (§3), so the provisional
      // minutes above leave habit, goals, and C untouched.
      session.accounting.creditedSeconds += spanSeconds;
      accrueLivePractice(state, spanSeconds);
      // The goal-generator fuel (issue #423) accrues ahead of the
      // completion ticks in the same span, so a completion draws the
      // budget that span itself accrued.
      accrueGoalFuel(state, spanSeconds);
      spanResult.goalsCompleted += accrueGoalProgress(state, state.activeHabitId, spanSeconds);
      // The class legs (issue #423, ADR-0074): the same credited seconds
      // develop the active habit–class pair — class experience, tree
      // points at the authored thresholds, and the pair's practice-roll
      // meter, whose crossings bank module rolls into the shared queue.
      // The retired player-wide flow meter's whole diet moves here,
      // pair-owned: nothing accrues without a selected pair, so
      // unstructured sessions run production and charge forging and earn
      // nothing class-side.
      spanResult.rollsFlow += accrueClassDevelopment(state, spanSeconds, rng);
      spanResult.rollsBanked += spanResult.rollsFlow;
      // Fight at the span edge, before reevaluating the wall, so a kill
      // changes production only for the remainder. Neither reconciled
      // offline time nor provisional time resolves damage or recovery.
      if (sink === "live") advanceWorldCombat(state, spanSeconds);
      syncWorldDiscoveries(state);
    }
    // The session-tick check (ADR-0015): charge exists only live in flow, so
    // the tick that holds the snapshot reports whether any module received
    // it (Spark). Unlocks queue into the session's summary row. The feats
    // that read production factors read the factor actually earned — the
    // allocated pass's own maximum (issue #258).
    discoverBoard(state, snapshot);
    result = sumResults(result, spanResult);
    seconds -= spanSeconds;
  }
  return result;
}

// The breather's production walk (docs/breather-spec.md §1, §4, ADR-0073):
// the flow walk's board legs with every practice accrual absent and no
// provisional sink — the phase is pre-trusted, so its nous banks live
// through the one seam, and a breather claims nothing. Forge meters turn,
// received charge empowers, generator reserves drain, and the temporal
// boundaries split on the clock the breather advances (the departed
// session's, kept warm). The wall gap clamps at the remaining allowance —
// the phase cannot overshoot its mint — and the caller ends it when the
// clamp bites (trust.applyBreatherGap flags the completion).
function walkBreather(state: GameState, seconds: number, rng: Rng, offlineSeconds: number): AdvanceResult {
  let result: AdvanceResult = {
    nousEarned: 0,
    rollsBanked: 0,
    rollsFlow: 0,
    rollsForge: 0,
    rollsMutator: 0,
    goalsCompleted: 0,
  };
  const breather = state.breather;
  if (state.mode !== "breather" || !breather || seconds <= 0) return result;
  seconds = Math.min(seconds, Math.max(0, breather.allowanceSeconds - breather.elapsed));
  offlineSeconds = Math.min(seconds, offlineSeconds);
  while (seconds > 0) {
    const offline = offlineSeconds > 0;
    const spanResult: AdvanceResult = {
      nousEarned: 0, rollsBanked: 0, rollsFlow: 0,
      rollsForge: 0, rollsMutator: 0, goalsCompleted: 0,
    };
    // The same boundary walk as flow, goals aside — a breather advances no
    // goal: reserve depletion, temporal marks, and lifetime rest marks are the mid-step
    // rate changes the phase can meet. As in flow, offline banking still
    // splits at discovery but does not resolve World attacks or recovery.
    const snapshot = syncRates(state, true);
    const { liveGenerators, earliest } = boardBoundaries(state);
    const boundary = Math.min(earliest, offline
      ? discoverySecondsOf(state, snapshot.rate)
      : worldBoundarySeconds(state, snapshot.rate, snapshot));
    const available = offline ? offlineSeconds : seconds;
    const spanSeconds = boundary !== Infinity && boundary + EPS < available ? boundary : available;
    const gained = requireFinite(snapshot.rate * spanSeconds, "the breather's produced ν/s");
    // Supply earned during this span is available at its ending attack tick.
    advanceWorldCharge(state, snapshot, spanSeconds);
    // Pre-trusted time banks straight onto the balance — the counter-image
    // of the provisional sink (docs/breather-spec.md §4).
    earnNous(state, gained);
    spanResult.nousEarned += gained;
    advanceForge(state, snapshot, spanSeconds, rng, spanResult);
    breather.elapsed = requireFinite(breather.elapsed + spanSeconds, "the breather's clock");
    drainReserves(liveGenerators, spanSeconds);
    // No creditedSeconds, no habit, no goal, no flow meter: a breather
    // credits nothing (spec §6 — the honesty system governs practice
    // claims, and a breather claims nothing).
    if (offline) offlineSeconds -= spanSeconds;
    else advanceWorldCombat(state, spanSeconds);
    syncWorldDiscoveries(state);
    discoverBoard(state, snapshot);
    result = sumResults(result, spanResult);
    seconds -= spanSeconds;
  }
  return result;
}

// The breather's advance under the same refusal wrapper (issue #486): a
// pre-trusted phase cannot bank an unrepresentable figure either — the
// failed span restores the phase it started with, and the refusal rides
// the result.
export function advanceBreather(state: GameState, seconds: number, rng: Rng = Math.random, offlineSeconds = 0): AdvanceResult {
  return walkRefusingFault(state, structuredClone(state), () => walkBreather(state, seconds, rng, offlineSeconds));
}

// The refusal plumbing both walks share: the walk runs against the live
// state, and a commit-point numeric fault — a rate, balance, reserve,
// meter, or supply figure the doubles cannot hold — restores the snapshot
// taken at entry, so the whole update commits or nothing does. The
// refusal rides the result's fault detail: every caller (the boundary
// walk, the honesty report, the dev clock, the scheduled playthrough)
// reports it through plumbing that already exists, and the state left
// behind is the last valid economy state, ready to save.
export function emptyAdvanceResult(): AdvanceResult {
  return {
    nousEarned: 0, rollsBanked: 0, rollsFlow: 0,
    rollsForge: 0, rollsMutator: 0, goalsCompleted: 0,
  };
}

function walkRefusingFault(state: GameState, pristine: GameState, walk: () => AdvanceResult): AdvanceResult {
  try {
    return walk();
  } catch (error) {
    if (!(error instanceof NumericFault)) throw error;
    Object.assign(state, pristine);
    return { ...emptyAdvanceResult(), fault: error.detail };
  }
}

export function advance(
  state: GameState,
  seconds: number,
  rng: Rng = Math.random,
  sink: AdvanceSink = "live",
): AdvanceResult {
  return walkRefusingFault(state, structuredClone(state), () => walkFlow(state, seconds, rng, sink));
}
