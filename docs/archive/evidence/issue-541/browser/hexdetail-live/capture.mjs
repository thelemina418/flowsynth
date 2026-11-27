// #541 browser evidence: the live Hex-detail miniature disclosure.
// Run after the capture preflight accepted the URL (see ../README.md):
//   docs/evidence/issue-541/browser/run.sh hexdetail-live <verified-url>
// From the recipe checkpoint `world-enemy`, the Sentinel takes the free starter
// approach beside Shale and a real flow session runs on the page's own clock,
// so live ticks rebuild Hex detail between gestures. Phone: first tap pins the
// inactive World miniature, a live rebuild keeps the pin, tap-away and Escape
// dismiss, a second tap selects. Desktop: keyboard focus discloses, Escape
// dismisses, Enter selects; the selected miniature keeps its facts tooltip
// (owner decision 2026-11-22, #539 rule).
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

async function journey(phone) {
  const name = phone ? 'phone' : 'desktop';
  const viewport = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', e => report.errors.push(`${name}: ${e.message}`));
  const shot = file => page.screenshot({ path: here(`${name}-${file}.png`) });
  const mini = face => page.locator(`#hex-detail [data-legend-layer="${face}"]`);
  // Read atomically in one task: a live tick can replace the trigger between
  // a locator's resolve and its evaluate.
  const state = face => page.evaluate(f => document.querySelector(`#hex-detail [data-legend-layer="${f}"]`), face).then(() => page.evaluate(f => (el => ({
    expanded: el.getAttribute('aria-expanded'), selected: el.getAttribute('aria-pressed'),
    tip: document.getElementById(el.getAttribute('aria-describedby'))?.textContent ?? null,
    tipShown: document.getElementById(el.getAttribute('aria-describedby'))?.classList.contains('inst-show') ?? false,
    focused: document.activeElement === el, box: el.getBoundingClientRect().toJSON(),
    face: document.querySelector('.hex-detail-scene')?.getAttribute('data-face'),
  }))(document.querySelector(`#hex-detail [data-legend-layer="${f}"]`)), face));
  // Tag the current trigger, then wait for a live tick to replace it.
  const rebuilt = async face => {
    await mini(face).evaluate(el => { el.dataset.evidenceTag = 'before'; });
    await page.waitForFunction(f => {
      const el = document.querySelector(`#hex-detail [data-legend-layer="${f}"]`);
      return el && el.dataset.evidenceTag !== 'before';
    }, face, { timeout: 10_000 });
    return page.evaluate(() => window.__flowsynth.state.world.elapsed);
  };
  const r = {};
  try {
    await page.goto(new URL('?dev=1', base).href);
    r.origin = await page.evaluate(async () => {
      const app = window.__flowsynth;
      await app.devLaunchScenario('world-enemy');
      app.devScenarioAssert();
      const sentinel = app.state.world.creatures[0];
      const column = app.state.world.columns[0]?.pos;
      const seat = app.state.cells.find(({ q, r }) => Math.max(Math.abs(q + 1), Math.abs(r), Math.abs(q + 1 + r)) === 1
        && (column?.q !== q || column?.r !== r) && app.state.modules.some(m => m.pos?.q === q && m.pos?.r === r));
      if (!seat) throw new Error('No module-occupied starter approach beside Shale.');
      const placed = app.devActionWorldPlace(sentinel.id, seat.q, seat.r);
      if (!placed.ok) throw new Error(placed.reason);
      const start = app.devActionStartSession(null);
      if (!start.ok) throw new Error(start.reason);
      app.setBoardLayer('modules');
      return { note: app.devScenarioNote, seat, mode: app.state.mode, coarse: matchMedia('(pointer: coarse)').matches };
    });
    assert.equal(r.origin.mode, 'flow');
    assert.equal(r.origin.coarse, phone);
    await page.addStyleTag({ content: '#dev-panel { display: none !important; }' });
    const { q, r: rr } = r.origin.seat;
    const cell = page.locator(`#grid [data-cell="${q},${rr}"]`).first();
    if (phone) await cell.tap(); else { await cell.focus(); await page.keyboard.press('Enter'); }
    await mini('world').waitFor();
    r.opened = await state('world');
    assert.equal(r.opened.face, 'modules');
    assert.ok(r.opened.box.width >= 44 && r.opened.box.height >= 44, 'miniature touch target');

    if (phone) {
      await mini('world').tap();
      r.firstTap = await state('world');
      assert.deepEqual([r.firstTap.face, r.firstTap.expanded, r.firstTap.tipShown], ['modules', 'true', true]);
      r.firstTap.elapsedAfterRebuild = await rebuilt('world');
      r.afterRebuild = await state('world');
      assert.deepEqual([r.afterRebuild.face, r.afterRebuild.expanded, r.afterRebuild.tipShown], ['modules', 'true', true]);
      await shot('pin-after-live-rebuild');
      // Tap-away on the detail's blank corner dismisses without reopening.
      const corner = await page.locator('#hex-detail .hex-detail-corner').boundingBox();
      await page.touchscreen.tap(corner.x + corner.width / 2, corner.y + corner.height / 2);
      r.tapAway = await state('world');
      assert.equal(r.tapAway.expanded === 'true' || r.tapAway.tipShown, false);
      await rebuilt('world');
      r.tapAwayAfterRebuild = await state('world');
      assert.equal(r.tapAwayAfterRebuild.tipShown, false);
      await shot('tap-away-dismissed');
      // Pin again, Escape dismisses.
      await mini('world').tap();
      assert.equal((await state('world')).tipShown, true);
      await page.keyboard.press('Escape');
      r.escape = await state('world');
      assert.equal(r.escape.tipShown, false);
      assert.equal(r.escape.face, 'modules');
      await rebuilt('world');
      assert.equal((await state('world')).tipShown, false);
      // First tap pins, a live rebuild, then the second tap selects.
      await mini('world').tap();
      await rebuilt('world');
      await mini('world').tap();
      r.selected = await state('world');
      r.layer = await page.evaluate(() => window.__flowsynth.ui.boardLayer);
      assert.equal(r.selected.face, 'world');
      assert.equal(r.layer, 'world');
      assert.equal(r.selected.expanded, 'false', 'a switch never carries the pin');
      await shot('second-tap-selected');
      // The selected miniature keeps its facts tooltip (#539 rule).
      await mini('world').tap();
      r.selectedTap = await state('world');
      assert.equal(r.selectedTap.tipShown, true);
      assert.ok(r.selectedTap.tip && r.selectedTap.tip.length > 0);
      await shot('selected-mini-facts');
    } else {
      // Keyboard: focus the inactive miniature from Return.
      await page.locator('#hex-detail-return').focus();
      for (let i = 0; i < 6 && !(await state('world')).focused; i++) await page.keyboard.press('Tab');
      r.focus = await state('world');
      assert.equal(r.focus.focused, true);
      assert.equal(r.focus.tipShown, true);
      r.focus.elapsedAfterRebuild = await rebuilt('world');
      r.focusAfterRebuild = await state('world');
      assert.equal(r.focusAfterRebuild.focused, true, 'live rebuild restores keyboard focus');
      await shot('focus-disclosure');
      await page.keyboard.press('Escape');
      r.escape = await state('world');
      assert.equal(r.escape.tipShown, false);
      assert.equal(r.escape.focused, true, 'Escape keeps focus');
      assert.equal(r.escape.face, 'modules');
      await shot('escape-dismissed');
      await page.keyboard.press('Enter');
      r.selected = await state('world');
      assert.equal(r.selected.face, 'world');
      await page.locator('#hex-detail-return').focus();
      await mini('world').focus();
      r.selectedFocus = await state('world');
      assert.equal(r.selectedFocus.tipShown, true, 'selected miniature carries its facts');
      await shot('selected-mini-facts');
      await page.keyboard.press('Escape');
      assert.equal((await state('world')).tipShown, false);
      // Hover the inactive Modules miniature.
      await mini('modules').hover();
      r.hoverModules = await state('modules');
      assert.equal(r.hoverModules.tipShown, true);
      await shot('hover-modules-mini');
    }
    // Reduced motion over the live flow detail.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    r.reducedMotion = await page.evaluate(() => ({
      animations: document.querySelector('#hex-detail')?.getAnimations({ subtree: true }).map(a => a.animationName) ?? [],
      grid: document.querySelector('#grid')?.getAnimations({ subtree: true }).map(a => a.animationName) ?? [] }));
    assert.deepEqual(r.reducedMotion.animations, []);
    await shot('reduced-motion');
    r.overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(r.overflow, false);
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
  for (const [name, phone] of [['desktop', false], ['phone', true]]) {
    try { report[name] = await journey(phone); }
    catch (error) { report.errors.push(`${name}: ${error.stack ?? error}`); }
  }
  await verify();
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(here('browser.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
