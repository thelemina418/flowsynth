// #541 browser evidence: v14 World saves migrating on boot, and the explicit
// recovery for a v14 save with lost money.
// Run after the capture preflight accepted the URL (see ../README.md):
//   docs/evidence/issue-541/browser/run.sh migration <verified-url>
// Constructed fixture: the v14 source of app.migration.test.ts
// `priorCombat()` plus prestiges = 1 (Rack Extender era, cleared Shale over an occupied cell,
// wounded Basalt, placed Blade and Column, a historical offer), written to the
// real localStorage save slot, then a real page reload boots it.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const approved = JSON.parse(await readFile(here('../provenance.json'), 'utf8'));
const base = new URL(process.argv[2]);
assert.equal(base.href, approved.url);
const verify = async () => {
  const current = await (await fetch(new URL('/-/dev/provenance', base))).json();
  assert.equal(current.worktree, approved.worktree);
  assert.equal(current.commit, approved.commit);
  assert.equal(current.source.clean, true);
};
await verify();
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
const report = { source: approved.commit, url: base.href, browser: browser.version(), errors: [] };

async function seedV14(page, lost) {
  return page.evaluate(async (lost) => {
    const { createInitialState, createWeapon, createWorldColumn } = await import('/src/engine/state.ts');
    const { serialize, STORAGE_KEY } = await import('/src/engine/save.ts');
    const state = createInitialState();
    state.arete = 3;
    state.prestiges = 1; // a real v14 save with banked Arete has prestiged (the test fixture leaves 0, which hides the Arete read)
    state.nous = 555;
    state.eraEarned = 20_000_000;
    state.world.unlocked = state.world.starterColumnGranted = state.world.starterWeaponGranted = true;
    state.world.frontier = 2;
    state.world.hone.chargeBlade = 1;
    state.cells.push({ q: -1, r: 0 });
    state.modules[0].pos = { q: -1, r: 0 };
    const blade = createWeapon(state, 'chargeBlade');
    const column = createWorldColumn(state);
    state.world.weapons.push({ ...blade, pos: state.cells[1], store: 9, cooldown: 55 });
    state.world.columns.push({ ...column, pos: state.cells[2] });
    state.bankedRolls = [{ id: 'historical-offer', candidates: [
      { id: 'old-world', type: 'chargeBlade' }, { id: 'old-synth', type: 'additive', tier: 1 }, { id: 'old-synth-2', type: 'square', tier: 1 }] }];
    const file = JSON.parse(serialize(state, 700));
    file.version = 14;
    const { unlocked, starterColumnGranted, starterWeaponGranted, frontier, hone, weapons, columns } = file.state.world;
    file.state.world = { unlocked, starterColumnGranted, starterWeaponGranted, frontier, hone, weapons, columns,
      enemies: { w0: { discovered: true, hp: 0 }, w1: { discovered: true, hp: 4 } } };
    if (lost) file.state.arete = null;
    const source = JSON.stringify(file, null, 3);
    return { key: STORAGE_KEY, source };
  }, lost);
}

async function journey(phone, lost) {
  const name = `${phone ? 'phone' : 'desktop'}-${lost ? 'recovery' : 'migration'}`;
  const viewport = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', e => report.errors.push(`${name}: ${e.message}`));
  const shot = file => page.screenshot({ path: here(`${name}-${file}.png`) });
  const act = async loc => { if (phone) await loc.tap(); else { await loc.focus(); await page.keyboard.press('Enter'); } };
  const r = {};
  try {
    // Build the v14 bytes with the served engine in a scratch tab, then seed
    // the real slot before boot in a fresh tab (an app's pagehide save would
    // otherwise overwrite a slot written under it).
    const scratch = await context.newPage();
    await scratch.goto(new URL('?dev=1', base).href);
    await scratch.waitForFunction(() => Boolean(window.__flowsynth));
    const { key, source } = await seedV14(scratch, lost);
    await scratch.close();
    await context.addInitScript(({ key, source }) => {
      if (sessionStorage.getItem('evidence-seeded')) return;
      localStorage.clear();
      localStorage.setItem(key, source);
      sessionStorage.setItem('evidence-seeded', '1');
    }, { key, source });
    r.seed = { key, bytes: source.length, version: JSON.parse(source).version };
    await page.goto(new URL('?dev=1', base).href);
    await page.waitForFunction(() => Boolean(window.__flowsynth));
    r.exactSourceRetained = await page.evaluate(src => Object.keys(localStorage).filter(k => localStorage.getItem(k) === src), source);
    await page.addStyleTag({ content: '#dev-panel { display: none !important; }' });
    r.boot = await page.evaluate(() => {
      const app = window.__flowsynth;
      return { arete: app.state.arete, nous: app.state.nous, eraEarned: app.state.eraEarned, frontier: app.state.world.frontier,
        shale: app.state.world.enemies.shale, status: document.getElementById('status')?.textContent ?? null,
        areteReadout: document.querySelector('#board-ledger')?.innerText.match(/ARETE\s*\n?\s*(\S+)/i)?.[1] ?? null,
        stored: JSON.parse(localStorage.getItem('flowsynth.save.v1')).version,
        modal: app.ui.modal, recovery: app.ui.recovery ? { lost: app.ui.recovery.lost } : null,
        text: document.getElementById('modal-content')?.innerText ?? null,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(r.boot.overflow, false);
    if (lost) {
      assert.ok(r.boot.recovery?.lost.some(path => /arete/.test(path)));
      assert.match(r.boot.text, /SAVE RECOVERY/);
      await shot('offer');
      const gray = await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
      await shot('offer-gray');
      await gray.evaluate(n => n.remove());
      // Keyboard/touch reach the primary action; the stored slot is untouched until it applies.
      r.storedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('flowsynth.save.v1')).version);
      assert.equal(r.storedBefore, 14);
      await act(page.locator('#recovery-apply'));
      r.after = await page.evaluate(() => {
        const app = window.__flowsynth;
        return { modal: app.ui.modal, arete: app.state.arete, pieces: [...app.state.world.weapons, ...app.state.world.columns, ...app.state.world.creatures, ...app.state.world.armor, ...app.state.world.spells, ...app.state.world.conduits].length,
          retained: localStorage.getItem('flowsynth.save.original.pre-v15') !== null,
          version: JSON.parse(localStorage.getItem('flowsynth.save.v1')).version, text: document.getElementById('modal-content')?.innerText ?? null };
      });
      assert.equal(r.after.arete, 0);
      assert.equal(r.after.pieces, 6);
      assert.equal(r.after.retained, true);
      await shot('recovered');
    } else {
      // v14 → v15 explains itself in the status line once (no modal).
      assert.equal(r.boot.stored, 15);
      assert.match(r.boot.status ?? '', /Old Blade-only clears do not count/);
      assert.deepEqual(r.exactSourceRetained, ['flowsynth.save.original.pre-v15', 'flowsynth.save.original.v1'].filter(k => r.exactSourceRetained.includes(k)));
      assert.ok(r.exactSourceRetained.includes('flowsynth.save.original.pre-v15'));
      await shot('notice');
      await page.evaluate(() => { window.__flowsynth.setBoardLayer('world'); });
      r.world = await page.evaluate(() => [...document.querySelectorAll('#grid [data-world-cell]')].map(e => e.getAttribute('aria-label')));
      await shot('world');
      // Explains once: a reload shows no second notice.
      await page.reload();
      await page.waitForFunction(() => Boolean(window.__flowsynth));
      r.reload = await page.evaluate(() => ({ modal: window.__flowsynth.ui.modal, status: document.getElementById('status')?.textContent ?? null, arete: window.__flowsynth.state.arete }));
      assert.equal(r.reload.modal, null);
      assert.doesNotMatch(r.reload.status ?? '', /Old Blade-only/);
    }
    return r;
  } catch (error) {
    report[`${name}Partial`] = r;
    await shot('failure').catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

try {
  for (const phone of [false, true]) for (const lost of [false, true]) {
    const name = `${phone ? 'phone' : 'desktop'}-${lost ? 'recovery' : 'migration'}`;
    try { report[name] = await journey(phone, lost); }
    catch (error) { report.errors.push(`${name}: ${error.stack ?? error}`); }
  }
  await verify();
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(here('browser.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
