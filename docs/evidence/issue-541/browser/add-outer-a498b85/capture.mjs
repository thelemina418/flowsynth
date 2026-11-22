// #541 browser evidence at a498b85 (F1/F4 fix): Add at an outer band with its exact price.
// Supersedes ../add-outer/ (4d81a59). Adds: phone centre taps on (0,9) at
// short and exact funds, Upgrade All hidden while armed and back after
// cancel/Escape, and Upgrade All unable to spend while armed (F4).
// Run after the capture preflight accepted the URL (see ../README.md):
//   docs/evidence/issue-541/browser/run.sh add-outer-a498b85 <verified-url>
// Constructed fixture (no progression claim): fresh start + World era, a
// straight owned spur (0,2)…(0,8) as in app.board.test.ts so that (0,9) is an
// outer-band destination priced 1,474,560 ν. Funds are set one short, then
// exact. Add is entered by keyboard (desktop) and by touch from World (phone);
// the bought coordinate is then reopened on World through the layer control.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const approved = JSON.parse(await readFile(here('../provenance-a498b85.json'), 'utf8'));
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
const report = { source: approved.commit, url: base.href, browser: browser.version(),
  setup: 'Constructed: fresh-start + devWorldEra, owned spur (0,2)…(0,8); nous set to price−1 then exactly the price. Not an earning record.', errors: [] };
const PRICE = 1_474_560;
const OUTER = '0,9';

async function journey(phone) {
  const name = phone ? 'phone' : 'desktop';
  const viewport = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', e => report.errors.push(`${name}: ${e.message}`));
  const shot = file => page.screenshot({ path: here(`${name}-${file}.png`), animations: 'disabled' });
  const offer = page.locator(`#grid [data-cell="${OUTER}"].cell-offer`);
  const r = {};
  try {
    await page.goto(new URL('?dev=1', base).href);
    r.origin = await page.evaluate(async ({ price }) => {
      const app = window.__flowsynth;
      await app.devLaunchScenario('fresh-start');
      app.devScenarioAssert();
      app.devWorldEra();
      for (let r = 2; r <= 8; r++) app.state.cells.push({ q: 0, r });
      app.state.nous = price - 1;
      app.setBoardLayer('world');
      app.render();
      return { layer: app.ui.boardLayer, viewport: [innerWidth, innerHeight], coarse: matchMedia('(pointer: coarse)').matches };
    }, { price: PRICE });
    assert.equal(r.origin.layer, 'world');
    assert.equal(r.origin.coarse, phone);
    await page.addStyleTag({ content: '#dev-panel { display: none !important; }' });
    const intro = page.locator('#arc-card-dismiss');
    if (await intro.isVisible()) phone ? await intro.tap() : await intro.click();

    const upgradeAll = () => page.evaluate(() => {
      const host = document.getElementById('upgrade-all');
      return { hidden: host.hidden, visible: host.getBoundingClientRect().height > 0 && getComputedStyle(host).display !== 'none',
        focusableChips: [...host.querySelectorAll('button')].filter(b => b.offsetParent !== null).length };
    });
    // Upgrade All only shows on Modules; read it there before arming.
    await page.evaluate(() => window.__flowsynth.setBoardLayer('modules'));
    r.upgradeAllBefore = await upgradeAll();
    assert.equal(r.upgradeAllBefore.visible, true);
    await page.evaluate(() => window.__flowsynth.setBoardLayer('world'));
    // Enter Add from World: keyboard on desktop, touch on phone.
    if (phone) {
      const add = page.locator('#thumb-bar [data-op="cell"]');
      await add.tap();
      if (await add.getAttribute('aria-expanded') === 'true') await add.tap(); // first touch names the tool
    } else {
      const add = page.locator('#board-tools [data-op="cell"]');
      await add.focus();
      await page.keyboard.press('Enter');
    }
    await offer.waitFor();
    r.entered = await page.evaluate(() => ({ layer: window.__flowsynth.ui.boardLayer, buying: window.__flowsynth.ui.buyingCell }));
    assert.deepEqual(r.entered, { layer: 'modules', buying: true });
    r.upgradeAllArmed = await upgradeAll();
    assert.deepEqual([r.upgradeAllArmed.visible, r.upgradeAllArmed.focusableChips], [false, 0]);
    // F4: even a direct invocation of the sweep cannot spend while armed.
    r.f4 = await page.evaluate(() => {
      const app = window.__flowsynth;
      const before = { nous: app.state.nous, levels: app.state.modules.map(m => m.level) };
      for (const want of [1, 5, 10, 'max']) app.upgradeAllAction(want);
      return { before, after: { nous: app.state.nous, levels: app.state.modules.map(m => m.level) }, buying: app.ui.buyingCell };
    });
    assert.deepEqual(r.f4.after, r.f4.before);
    assert.equal(r.f4.buying, true);

    const read = () => offer.evaluate((node) => {
      const price = node.querySelector('.cell-price');
      const poly = node.querySelector('polygon');
      const pr = price.getBoundingClientRect();
      const pb = poly.getBoundingClientRect();
      // Leading/trailing ink must stay inside the cell and the viewport.
      const hitAt = (x, y) => document.elementFromPoint(x, y)?.closest('.cell-offer') === node;
      const what = (x, y) => { const e = document.elementFromPoint(x, y); return e && `${e.tagName}#${e.id}.${e.className?.baseVal ?? e.className}`; };
      return {
        visual: price.textContent, label: node.getAttribute('aria-label'), disabled: node.getAttribute('aria-disabled'),
        state: node.querySelector('.cell-price-state')?.textContent ?? null,
        points: poly.getAttribute('points'), polygon: pb.toJSON(), price: pr.toJSON(),
        priceInsideCell: pr.left >= pb.left && pr.right <= pb.right,
        priceInViewport: pr.left >= 0 && pr.right <= innerWidth && pr.top >= 0 && pr.bottom <= innerHeight,
        // SVG text length vs. its rendered box: a clipped or squeezed figure would differ.
        textLength: price.getComputedTextLength?.() ?? null,
        hits: { center: hitAt(pb.x + pb.width / 2, pb.y + pb.height / 2), priceLeft: hitAt(pr.left + 1, pr.top + pr.height / 2), priceRight: hitAt(pr.right - 1, pr.top + pr.height / 2) },
        topmost: what(pb.x + pb.width / 2, pb.y + pb.height / 2),
        overflow: document.documentElement.scrollWidth > innerWidth,
        neighbourPoints: document.querySelector('#grid [data-cell="0,8"] polygon')?.getAttribute('points') ?? null,
      };
    });
    r.short = await read();
    assert.equal(r.short.visual, '1,474,560 ν');
    assert.match(r.short.label, /for 1,474,560 nous/);
    assert.match(r.short.label, /Not enough whole nous/);
    assert.equal(r.short.disabled, 'true');
    assert.equal(r.short.state, 'Short on ν');
    assert.equal(r.short.priceInsideCell, true);
    assert.equal(r.short.priceInViewport, true);
    // FAIL recorded at #541 freeze (phone): the default fit puts the outer
    // destination under #upgrade-all, which intercepts the centre tap.
    r.hitTestPass = r.short.hits.center && r.short.hits.priceLeft && r.short.hits.priceRight;
    assert.equal(r.hitTestPass, true, `outer destination occluded by ${r.short.topmost}`);
    // The target is the full cell polygon (same points as its neighbour); its
    // pixel size follows the board fit, which this long spur shrinks on phone.
    r.targetAtLeast44 = r.short.polygon.width >= 44 && r.short.polygon.height >= 44;
    assert.equal(r.short.points, r.short.neighbourPoints);
    if (!phone) assert.equal(r.targetAtLeast44, true);
    assert.equal(r.short.overflow, false);
    await shot('outer-short');
    // A refused activation changes nothing.
    const before = await page.evaluate(() => window.__flowsynth.state.cells.length);
    if (phone) { const b = r.short.polygon; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); r.shortCentreTap = 'refused'; }
    else { await offer.focus(); await page.keyboard.press('Enter'); }
    assert.equal(await page.evaluate(() => window.__flowsynth.state.cells.length), before);

    await page.evaluate(({ price }) => { window.__flowsynth.state.nous = price; window.__flowsynth.render(); }, { price: PRICE });
    r.exact = await read();
    assert.equal(r.exact.visual, '1,474,560 ν');
    assert.equal(r.exact.disabled, 'false');
    assert.ok(!r.exact.state, 'no refusal engraving at exact funds');
    assert.equal(r.exact.points, r.short.points);
    assert.equal(r.exact.priceInsideCell, true);
    if (!phone) {
      await offer.focus();
      r.focusRing = await offer.evaluate(node => ({ focused: document.activeElement === node,
        outline: getComputedStyle(node).outlineStyle, stroke: getComputedStyle(node.querySelector('polygon')).stroke }));
      assert.equal(r.focusRing.focused, true);
    }
    await shot('outer-exact');
    const grey = await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    await shot('outer-exact-gray');
    await grey.evaluate(n => n.remove());
    if (phone) {
      // Centre tap first (recorded), then the polygon's visible sliver above the strip.
      const b = r.exact.polygon;
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      r.centreTapBought = await page.evaluate(() => window.__flowsynth.state.cells.some(({ q, r }) => q === 0 && r === 9));
      assert.equal(r.centreTapBought, true, 'exact-funds centre tap buys (0,9)');
      r.boughtVia = 'centre tap';
    } else await page.keyboard.press('Enter');
    r.bought = await page.evaluate(() => {
      const { state, ui } = window.__flowsynth;
      return { nous: state.nous, owned: state.cells.some(({ q, r }) => q === 0 && r === 9), stillArmed: ui.buyingCell };
    });
    assert.deepEqual(r.bought, { nous: 0, owned: true, stillArmed: true });
    await shot('outer-bought');

    // Cancel: Escape on desktop, the Cancel Add pill on phone.
    const pill = page.locator('#cell-arm-pill');
    r.pill = await pill.evaluate(p => ({ text: p.textContent, box: p.getBoundingClientRect().toJSON() }));
    assert.ok(r.pill.box.height >= 44);
    if (phone) await pill.tap(); else await page.keyboard.press('Escape');
    await pill.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__flowsynth.ui.buyingCell), false);
    r.upgradeAllAfterCancel = await upgradeAll();
    assert.equal(r.upgradeAllAfterCancel.visible, true, 'Upgrade All returns after cancel/Escape');
    r.cancelledVia = phone ? 'Cancel Add pill' : 'Escape';
    await shot('cancelled-upgrade-all-back');

    // Back to World through the layer control, then open the same coordinate.
    const legend = page.locator('#layer-legend [data-legend-layer="world"]');
    if (phone) { await legend.tap(); if (await legend.getAttribute('aria-pressed') !== 'true') await legend.tap(); }
    else { await legend.focus(); await page.keyboard.press('Enter'); }
    const world = page.locator(`#grid [data-world-cell="${OUTER}"]`);
    await world.waitFor();
    r.worldCell = await world.getAttribute('aria-label');
    if (phone) await world.tap(); else { await world.focus(); await page.keyboard.press('Enter'); }
    await page.locator('.hex-detail-scene').waitFor();
    r.detail = await page.evaluate(() => ({ detail: window.__flowsynth.ui.detail, face: document.querySelector('.hex-detail-scene')?.getAttribute('data-face'),
      overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.deepEqual(r.detail.detail?.pos ?? r.detail.detail?.hex ?? r.detail.detail?.at ?? null, { q: 0, r: 9 });
    assert.equal(r.detail.face, 'world');
    assert.equal(r.detail.overflow, false);
    await shot('world-same-cell');
    return r;
  } catch (error) {
    report[`${name}Partial`] = r;
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
