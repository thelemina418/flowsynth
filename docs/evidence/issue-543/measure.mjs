// Run from the frozen candidate root with a checkout of the pinned baseline.
// Each side uses its own engine and policy with the same seed/schedule.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileEngineTo } from '../../../tools/dev/compile-engine.mjs';
import { devProvenance } from '../../../tools/dev/provenance.mjs';
import { recordingEnvironment, requireRuntimeEnvironment } from '../../../tools/dev/runtime.mjs';
const baselineCommit = '7da4007dee8f2343f9526c96a4dc930c66881683';
const recipeInput = { seed: 468, policyId: 'pushing', budgetDays: 10, claimTarget: 2,
  schedule: { sessionsPerDay: 2, sessionMinutes: 600, breatherMinutes: 5 } };
const comparatorPath = 'docs/evidence/issue-543/measure.mjs';

export function verifiedCheckout(root, expectedCommit, side) {
  const worktree = realpathSync(root);
  const provenance = devProvenance(worktree);
  assert.equal(provenance.worktree, worktree, `Use the ${side} checkout root, not a subdirectory.`);
  assert.equal(provenance.commit, expectedCommit, `Unexpected ${side} checkout HEAD at ${worktree}.`);
  assert.ok(provenance.source?.clean,
    `${side} checkout has uncommitted source or unknown cleanliness: ${JSON.stringify(provenance.source?.changes ?? null)}`);
  return provenance;
}
// The proof's kit and charge are pre-staged, not earned. Only its footprint
// is rebuilt here, through the same real actions on both revisions.
function proofApproach(engine) {
  const state = engine.createWorldCombatScenario();
  state.cells = engine.createInitialState().cells;
  state.nous = 1_000;
  const now = Date.UTC(2026, 10, 21, 12);
  const accept = result => assert.ok(result.ok, result.reason);
  const purchases = [];
  for (const [q, r] of [[1,-1], [-1,1], [1,1], [2,0]]) {
    const before = state.nous;
    accept(engine.buyCell(state, {q,r}));
    purchases.push({ coordinate: [q,r], price: before - state.nous });
  }
  const { world } = state;
  // #542 stored its isolated duel under world.proof. The live promotion
  // keeps the same scenario and kit in the ordinary World ledger.
  const kit = typeof world.proof === 'object' ? world.proof : {
    creature: world.creatures[0], armor: world.armor[0], conduit: world.conduits[0], spell: world.spells[0], enemies: world.enemies,
  };
  for (const [id, q, r] of [[kit.creature.id, 0, 0], [kit.armor.id, -1, 1], [kit.conduit.id, 1, 0],
      [kit.spell.id, 0, 1], [world.columns[0].id, 1, 1], [world.weapons[0].id, 1, -1]]) {
    accept(engine.placeWorldOccupant(state, id, {q,r}));
  }
  accept(engine.startSession(state, null, now));
  let seconds = 0;
  while (kit.enemies.shale.hp > 0 && !kit.creature.recovering && seconds < 40) {
    assert.equal(engine.advance(state, 1, () => 0.3).fault, undefined);
    seconds++;
  }
  assert.equal(kit.enemies.shale.hp, 0);
  return { provenance: 'Prepared #542 kit and charge, synthetic 1000ν budget; board rebuilt from the starter triangle with buys.',
    purchases, remainingNousAfterPurchases: 1000 - purchases.reduce((sum, p) => sum + p.price, 0),
    cells: state.cells, arete: state.arete, prestiges: state.prestiges, secondsToClear: seconds, sentinelHp: kit.creature.hp };
}

async function measure(checkout, tier) {
  const { worktree: root, commit } = checkout;
  process.chdir(root);
  await mkdir('.dev', { recursive: true });
  const entry = resolve(root, `.dev/issue-543-measure-${process.pid}.ts`);
  await writeFile(entry, `
    export { composePlaythroughRecipe, runPlaythrough, runPlaythroughCheckpoint, playthroughSource } from '../src/engine/playthrough';
    export { createWorldCombatScenario } from '../src/engine/world-combat-scenario';
    export { createInitialState } from '../src/engine/state';
    export { buyCell, placeWorldOccupant, startSession } from '../src/engine/actions';
    export { advance } from '../src/engine/advance';
  `, { flag: 'wx' });
  const compiled = await mkdtemp(join(tmpdir(), 'flowsynth-543-'));
  try {
    const bundle = await compileEngineTo(entry, 'opening-543', compiled);
    const engineSha256 = createHash('sha256').update(await readFile(bundle)).digest('hex');
    const engine = await import(pathToFileURL(bundle).href);
    const recipe = engine.composePlaythroughRecipe(recipeInput);
    const source = engine.playthroughSource();
    const provenance = { commit, worktree: root, engineSha256, source };
    const proof = proofApproach(engine);
    if (tier === '--proof-only') return { ...provenance, proof };
    const openingRecipe = engine.composePlaythroughRecipe({ ...recipeInput, budgetDays: 1,
      schedule: { sessionsPerDay: 2, sessionMinutes: 25, breatherMinutes: 5 } });
    const opening = engine.runPlaythrough(openingRecipe, source);
    // Earned events record purchase occurrences and timestamps, not ν debits.
    const cells = r => r.events.filter(e => e.ok && e.label.startsWith('Cell at ')).map(e => ({ coordinate: e.label.slice(8), creditedMinutes: e.credited / 60 }));
    const placement = opening.events.find(e => e.ok && e.kind === 'placement' && /^Placed a /.test(e.label));
    const placementAfterExpansion = opening.events.find(e => e.ok && e.kind === 'placement' && /^Placed a /.test(e.label) &&
      opening.snapshots[e.snapshot].state.cells.length > 3 &&
      !opening.snapshots[0].state.cells.some(({q,r}) => e.label.endsWith(` at ${q},${r}`)));
    const openingResult = { recipe: openingRecipe, runId: opening.runId, purchased: cells(opening),
      firstPlacement: placement ? { label: placement.label, creditedMinutes: placement.credited / 60 } : null,
      firstPlacementOnBoughtCell: placementAfterExpansion ? { label: placementAfterExpansion.label, creditedMinutes: placementAfterExpansion.credited / 60 } : null };
    if (tier === '--opening-only') return { ...provenance, proof, opening: openingResult };
    const ordinaryRecipe = engine.composePlaythroughRecipe({ seed: recipeInput.seed, budgetDays: 15 });
    const ordinary = engine.runPlaythroughCheckpoint(ordinaryRecipe, 'approaching-prestige', source);
    const world = engine.runPlaythroughCheckpoint(recipe, 'world-enemy-active', source);
    const eligibility = world.events.find(e => e.ok && e.label === 'First prestige eligibility reached');
    const bank = world.events.find(e => e.ok && e.kind === 'prestige');
    assert.ok(eligibility);
    assert.ok(bank);
    const bankDay = 1 + Math.floor(bank.at / 86_400);
    const firstFight = Object.entries(world.state.world.enemies).find(([, enemy]) => enemy.discovered && enemy.hp > 0);
    return { ...provenance, recipe, proof, opening: openingResult,
      ordinaryEligibility: { recipe: ordinaryRecipe, runId: ordinary.runId, day: ordinary.days,
        creditedMinutes: ordinary.creditedSeconds / 60, purchased: cells(ordinary) },
      eligibility: { creditedMinutes: eligibility.credited / 60 },
      bank: { day: bankDay, creditedMinutes: bank.credited / 60, claim: world.claims[0],
        purchased: cells({ events: world.events.slice(0, world.events.indexOf(bank)) }) },
      world: { runId: world.runId, day: world.days, creditedMinutes: world.creditedSeconds / 60, purchased: cells(world),
        areteSpent: world.areteSpent, enemy: firstFight?.[0], footprint: world.state.cells.map(({q,r}) => [q,r]),
        deployedColumns: world.state.world.columns.flatMap(({pos}) => pos ? [[pos.q, pos.r]] : []),
        weaponStillInTray: world.state.world.weapons.some(weapon => weapon.pos === null) } };
  } finally {
    await unlink(entry);
    await rm(compiled, { recursive: true, force: true });
  }
}

async function main() {
  const [baselineRoot, targetCommit, targetFile, tier] = process.argv.slice(2);
  assert.ok(baselineRoot && /^[a-f0-9]{40}$/.test(targetCommit ?? '') && targetFile &&
    [undefined, '--verify-only', '--proof-only', '--opening-only'].includes(tier) && process.argv.length <= 6,
  `Usage: node tools/run-supported.mjs ${comparatorPath} <from-checkout> <to-full-SHA> <new-output> [--verify-only|--proof-only|--opening-only]`);
  const targetRoot = process.cwd();
  const outputPath = resolve(targetFile);
  await requireRuntimeEnvironment(targetRoot);
  const verify = () => {
    const from = verifiedCheckout(baselineRoot, baselineCommit, 'from');
    const to = verifiedCheckout(targetRoot, targetCommit, 'to');
    assert.notEqual(from.worktree, to.worktree, 'The comparison requires two different checkouts.');
    assert.equal(fileURLToPath(import.meta.url), join(to.worktree, comparatorPath), 'Run the comparator from the to checkout.');
    // This evidence-directory file is executable input, not a capture.
    const committedComparator = execFileSync('git', ['show', `${to.commit}:${comparatorPath}`], { cwd: to.worktree });
    assert.ok(readFileSync(fileURLToPath(import.meta.url)).equals(committedComparator), 'Commit the comparator before recording.');
    execFileSync('git', ['merge-base', '--is-ancestor', from.commit, to.commit], { cwd: to.worktree });
    return { from, to };
  };
  const { from, to } = verify();
  await requireRuntimeEnvironment(from.worktree);
  if (tier === '--verify-only') return console.log(JSON.stringify({ from, to }, null, 2));
  const baseline = await measure(from, tier);
  process.chdir(targetRoot);
  verify();
  const candidate = await measure(to, tier);
  process.chdir(targetRoot);
  verify();
  const output = { scope: 'One matched schedule, not a calibration or a representative distribution.',
    cellPurchaseEvidence: 'Earned runs report counts and credited timestamps from purchase events, not ν spent. Prepared Shale measures actual ν debits from its synthetic budget.',
    recordingEnvironment: recordingEnvironment(), baseline, candidate };
  await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
