// #541 final evidence: the earned live approach into real Shale.
// Run from the frozen candidate root:
//   node tools/run-supported.mjs docs/evidence/issue-541/earned-shale.mjs docs/evidence/issue-541/earned-shale.json
// Origin is the ordinary pushing checkpoint (seed 468, long-session schedule)
// walked by the real playthrough runner to the first living, unplayed Shale.
// Nothing is granted or injected: the routed branch makes exactly the ordinary
// moves of progression-presets.test.ts "can win Shale from the earned World
// checkpoint with the starter kit, ordinary moves and no new grant"; the bare
// branch deploys only the Sentinel so the weak outcome is kept beside the win.
// One declared sample, not a pacing distribution or calibration.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileEngineTo } from '../../../tools/dev/compile-engine.mjs';
import { devProvenance } from '../../../tools/dev/provenance.mjs';
import { recordingPayload, requireRuntimeEnvironment, writeJsonAtomic } from '../../../tools/dev/runtime.mjs';

await requireRuntimeEnvironment();
const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length) throw new Error('Usage: node tools/run-supported.mjs docs/evidence/issue-541/earned-shale.mjs <new-output.json>');
const output = resolve(file);
if (existsSync(output)) throw new Error(`Refusing to overwrite ${output}.`);
const before = devProvenance();
assert.ok(before.source?.clean, `Freeze the source first: ${JSON.stringify(before.source?.changes ?? null)}`);

await mkdir('.dev', { recursive: true });
const entry = resolve(`.dev/issue-541-earned-shale-${process.pid}.ts`);
await writeFile(entry, `
  export { PUSHING_CHECKPOINT_RECIPE, runPlaythroughCheckpoint } from '../src/engine/playthrough';
  export { placeModule, placeWorldOccupant, startSession } from '../src/engine/actions';
  export { advance } from '../src/engine/advance';
  export { hex } from '../src/engine/hex';
  export { CATEGORY_OF } from '../src/engine/constants';
  export { activeWallOf } from '../src/engine/world';
`, { flag: 'wx' });
const compiled = await mkdtemp(join(tmpdir(), 'flowsynth-541-earned-'));
try {
  const bundle = await compileEngineTo(entry, 'earned-shale', compiled);
  const engineSha256 = createHash('sha256').update(await readFile(bundle)).digest('hex');
  const engine = await import(pathToFileURL(bundle).href);
  const recipe = engine.PUSHING_CHECKPOINT_RECIPE;
  const checkpoint = engine.runPlaythroughCheckpoint(recipe, 'world-enemy-active');
  const origin = checkpoint.state;
  assert.equal(engine.activeWallOf(origin)?.key, 'shale', 'Expected a live Shale checkpoint.');

  const accept = (label, result) => assert.ok(result.ok, `${label}: ${result.reason}`);
  const walk = (variant) => {
    const state = structuredClone(origin);
    const { creatures: [sentinel], armor: [armor], weapons: [blade], spells: [spell], columns: [column] } = state.world;
    const moves = [];
    const generator = state.modules.find(m => m.type === 'focusKeyed' && m.reserve > 20);
    const reserveBefore = generator?.reserve ?? null;
    if (variant === 'routed starter kit') {
      const host = state.modules.find(m => engine.CATEGORY_OF[m.type] === 'oscillator');
      assert.ok(host && generator, 'Expected an earned oscillator and Flywheel reserve.');
      accept('Place oscillator', engine.placeModule(state, host.id, engine.hex(1, -1)));
      moves.push({ layer: 'modules', id: host.id, type: host.type, to: [1, -1] });
      accept('Place Flywheel', engine.placeModule(state, generator.id, engine.hex(1, 0)));
      moves.push({ layer: 'modules', id: generator.id, type: generator.type, to: [1, 0] });
      for (const [piece, q, r] of [[column, 1, -1], [sentinel, 0, 0], [armor, -1, 1], [blade, 1, 0], [spell, 0, -1]]) {
        accept(`Place ${piece.id}`, engine.placeWorldOccupant(state, piece.id, engine.hex(q, r)));
        moves.push({ layer: 'world', id: piece.id, to: [q, r] });
      }
    } else {
      accept('Place Sentinel', engine.placeWorldOccupant(state, sentinel.id, engine.hex(0, 0)));
      moves.push({ layer: 'world', id: sentinel.id, to: [0, 0] });
    }
    const ledger = { nous: state.nous, arete: state.arete, weapons: state.world.weapons.length, creatures: state.world.creatures.length };
    accept('Start fight', engine.startSession(state, null));
    const sample = (second) => ({ second, shaleHp: state.world.enemies.shale.hp, sentinelHp: sentinel.hp,
      recovering: sentinel.recovering, bladeStore: blade.store, spellStore: spell.store ?? null,
      basaltDiscovered: !!state.world.enemies.basalt?.discovered });
    const samples = [sample(0)];
    let second = 0;
    while (second < 40 && state.world.enemies.shale.hp > 0 && !sentinel.recovering) {
      const result = engine.advance(state, 1, () => 0.3);
      assert.equal(result.fault, undefined, result.fault);
      samples.push(sample(++second));
    }
    const end = samples.at(-1);
    const outcome = end.shaleHp === 0 ? 'cleared' : end.recovering ? 'Sentinel defeated (recovering)' : 'not cleared in 40 s';
    const after = { nous: state.nous, arete: state.arete, weapons: state.world.weapons.length, creatures: state.world.creatures.length };
    return { variant, moves, flywheelReserveBefore: reserveBefore, ledgerBeforeFight: ledger, ledgerAfterFight: after,
      outcome, worldSecondsToOutcome: second, end, samples };
  };

  const after = devProvenance();
  assert.ok(after.source?.clean && after.commit === before.commit, 'Source moved during the walk; nothing was published.');
  const report = recordingPayload({
    kind: 'earned live approach into real Shale',
    scope: 'One declared earned checkpoint (seed 468 pushing, long-session schedule) and two fight branches. Not representative acquisition, median first-clear time, or pacing calibration.',
    recordingCommit: before.commit, engineSha256,
    origin: { recipe, days: checkpoint.days, claims: checkpoint.claims, stop: checkpoint.stop,
      arete: origin.arete, ownedCells: origin.cells.length, prestiges: origin.prestiges },
    branches: [walk('routed starter kit'), walk('bare Sentinel')],
  });
  await writeJsonAtomic(output, report);
  console.log(`Earned Shale: ${before.commit} · ${engineSha256}\n${output}`);
} finally {
  await rm(compiled, { recursive: true, force: true });
  await unlink(entry).catch(() => {});
}
