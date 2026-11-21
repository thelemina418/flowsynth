// Run from the candidate root with the verified baseline archive as argv[2].
// The baseline uses its own engine and policy with the same seed/schedule.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileEngine } from '../../../tools/dev/compile-engine.mjs';
import { recordingEnvironment, requireRuntimeEnvironment } from '../../../tools/dev/runtime.mjs';

await requireRuntimeEnvironment();
const baselineCommit = '7da4007dee8f2343f9526c96a4dc930c66881683';
const recipeInput = { seed: 468, policyId: 'pushing', budgetDays: 10, claimTarget: 2,
  schedule: { sessionsPerDay: 2, sessionMinutes: 600, breatherMinutes: 5 } };
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
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
  const { proof, columns, weapons } = state.world;
  for (const [id, q, r] of [[proof.creature.id, 0, 0], [proof.armor.id, -1, 1], [proof.conduit.id, 1, 0],
      [proof.spell.id, 0, 1], [columns[0].id, 1, 1], [weapons[0].id, 1, -1]]) {
    accept(engine.placeWorldOccupant(state, id, {q,r}));
  }
  accept(engine.startSession(state, null, now));
  let seconds = 0;
  while (proof.enemies.shale.hp > 0 && !proof.creature.recovering && seconds < 40) {
    assert.equal(engine.advance(state, 1, () => 0.3).fault, undefined);
    seconds++;
  }
  assert.equal(proof.enemies.shale.hp, 0);
  return { provenance: 'Prepared #542 kit and charge, synthetic 1000ν budget; board rebuilt from the starter triangle with buys.',
    purchases, remainingNousAfterPurchases: 1000 - purchases.reduce((sum, p) => sum + p.price, 0),
    cells: state.cells, arete: state.arete, prestiges: state.prestiges, secondsToClear: seconds, sentinelHp: proof.creature.hp };
}

async function measure(root, commit) {
  process.chdir(root);
  await mkdir('.dev', { recursive: true });
  const entry = resolve(root, `.dev/issue-543-measure-${process.pid}.ts`);
  await writeFile(entry, `
    export { composePlaythroughRecipe, runPlaythrough, runPlaythroughCheckpoint, playthroughSource } from '../src/engine/playthrough';
    export { WORLD_ENEMIES } from '../src/engine/constants';
    export { createWorldCombatScenario } from '../src/engine/world-combat-scenario';
    export { createInitialState } from '../src/engine/state';
    export { buyCell, placeWorldOccupant, startSession } from '../src/engine/actions';
    export { advance } from '../src/engine/advance';
  `, { flag: 'wx' });
  try {
    const engine = await compileEngine(entry, 'opening-543');
    const recipe = engine.composePlaythroughRecipe(recipeInput);
    const source = engine.playthroughSource();
    const proof = proofApproach(engine);
    if (process.argv.includes('--proof-only')) return { commit, source, proof };
    const openingRecipe = engine.composePlaythroughRecipe({ ...recipeInput, budgetDays: 1,
      schedule: { sessionsPerDay: 2, sessionMinutes: 25, breatherMinutes: 5 } });
    const opening = engine.runPlaythrough(openingRecipe, source);
    const cells = r => r.events.filter(e => e.ok && e.label.startsWith('Cell at ')).map(e => ({ coordinate: e.label.slice(8), creditedMinutes: e.credited / 60 }));
    const placement = opening.events.find(e => e.ok && e.kind === 'placement' && /^Placed a /.test(e.label));
    const placementAfterExpansion = opening.events.find(e => e.ok && e.kind === 'placement' && /^Placed a /.test(e.label) &&
      opening.snapshots[e.snapshot].state.cells.length > 3 &&
      !opening.snapshots[0].state.cells.some(({q,r}) => e.label.endsWith(` at ${q},${r}`)));
    const openingResult = { recipe: openingRecipe, runId: opening.runId, purchased: cells(opening),
      firstPlacement: placement ? { label: placement.label, creditedMinutes: placement.credited / 60 } : null,
      firstPlacementOnBoughtCell: placementAfterExpansion ? { label: placementAfterExpansion.label, creditedMinutes: placementAfterExpansion.credited / 60 } : null };
    if (process.argv.includes('--opening-only')) return { commit, source, proof, opening: openingResult };
    const world = engine.runPlaythroughCheckpoint(recipe, 'world-enemy-active', source);
    const eligibility = world.events.find(e => e.ok && e.label === 'First prestige eligibility reached');
    const bank = world.events.find(e => e.ok && e.kind === 'prestige');
    assert.ok(eligibility);
    assert.ok(bank);
    const bankDay = 1 + Math.floor(bank.at / 86_400);
    const firstFight = engine.WORLD_ENEMIES.find(e => world.state.world.enemies[e.key]?.discovered && world.state.world.enemies[e.key]?.hp > 0);
    return { commit, source, recipe, proof, opening: openingResult,
      eligibility: { creditedMinutes: eligibility.credited / 60 },
      bank: { day: bankDay, creditedMinutes: bank.credited / 60, claim: world.claims[0],
        purchased: cells({ events: world.events.slice(0, world.events.indexOf(bank)) }) },
      world: { runId: world.runId, day: world.days, creditedMinutes: world.creditedSeconds / 60, purchased: cells(world),
        areteSpent: world.areteSpent, enemy: firstFight?.key, footprint: world.state.cells.map(({q,r}) => [q,r]) } };
  } finally { await unlink(entry); }
}
const root = process.cwd();
const commit = head();
const output = { scope: 'One matched schedule, not a calibration or a representative distribution.',
  environment: recordingEnvironment(),
  baseline: await measure(resolve(process.argv[2]), baselineCommit), candidate: await measure(root, commit) };
await writeFile(pathToFileURL(resolve(process.argv[3])), JSON.stringify(output, null, 2) + '\n');
