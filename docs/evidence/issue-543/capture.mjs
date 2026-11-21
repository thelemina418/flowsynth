// Run after evidence-preflight passes against the candidate URL, from its root.
// CHROMIUM_BIN=/usr/bin/chromium PLAYWRIGHT_MODULE=playwright node tools/run-supported.mjs docs/evidence/issue-543/capture.mjs http://localhost:PORT/
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const output = fileURLToPath(new URL('.', import.meta.url));
const url = new URL('?dev=1', process.argv[2]).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN, headless: true });
const results = { url, browser: browser.version(), setup: 'Fresh starter footprint. The test harness sets 32ν for a controlled mixed-affordability read; it is not an earning record.', errors: [] };
const inner = '[data-cell="1,-1"]';
const outer = '[data-cell="2,0"]';
const screenshot = (page, name) => page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' });
const addOffer = (page, selector) => page.locator(`#grid ${selector}.cell-offer`);
const available = node => node.getAttribute('aria-disabled');
async function seed(page) {
  page.on('pageerror', error => results.errors.push(error.message));
  page.setDefaultTimeout(7_000);
  await page.goto(url);
  await page.evaluate(() => {
    const app = window.__flowsynth;
    app.state.nous = 32;
    document.getElementById('dev-panel').style.visibility = 'hidden';
    app.render();
  });
}
async function inspect(page) {
  const near = addOffer(page, inner);
  const far = addOffer(page, outer);
  await near.waitFor();
  const info = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const exit = box('#cell-arm-pill');
    const prices = [...document.querySelectorAll('.cell-price')];
    return { viewport: [innerWidth, innerHeight], coarse: matchMedia('(pointer:coarse)').matches,
      overflowing: document.documentElement.scrollWidth > innerWidth,
      priceOcclusions: prices.filter(node => {
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return hit?.closest('.cell-offer') !== node.closest('.cell-offer');
      }).length,
      exitHeight: exit.height, exitObscuresLedger: overlaps(exit, box('#game-info-strip')),
      exitObscuresZoom: overlaps(exit, box('#zoom-cluster')),
      priceAnimations: document.getAnimations().filter(a => a.effect?.target?.closest('.cell-offer')).length };
  });
  const target = await near.locator('polygon').boundingBox();
  const prices = { near: await near.getAttribute('aria-label'), far: await far.getAttribute('aria-label'),
    nearVisual: await near.locator('.cell-price').textContent(), farVisual: await far.locator('.cell-price').textContent(),
    farState: await far.locator('.cell-price-state').textContent() };
  assert.equal(await available(near), 'false');
  assert.equal(await available(far), 'true');
  assert.equal(prices.nearVisual, '30 ν');
  assert.equal(prices.farVisual, '90 ν');
  assert.equal(prices.farState, 'Short on ν');
  assert.match(prices.far, /Not enough whole nous/);
  assert.ok(target && target.width >= 44 && target.height >= 44);
  assert.equal(info.overflowing, false);
  assert.equal(info.exitObscuresZoom, false);
  assert.equal(info.priceOcclusions, 0);
  assert.ok(info.exitHeight >= 44);
  if (info.coarse) assert.equal(info.exitObscuresLedger, false);
  return { ...info, prices, target };
}
async function readPurchase(page) {
  const purchased = await page.evaluate(() => {
    const { state, ui } = window.__flowsynth;
    return { layer: ui.boardLayer, addStillOpen: ui.buyingCell, nous: state.nous, arete: state.arete,
      cells: state.cells, cellsBought: state.cellsBought };
  });
  assert.equal(purchased.nous, 2);
  assert.equal(purchased.cellsBought, 1);
  assert.equal(purchased.addStillOpen, true);
  assert.ok(purchased.cells.some(({q,r}) => q === 1 && r === -1));
  return purchased;
}
try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await seed(desktop);
  const dock = desktop.locator('#board-tools [data-op="cell"]');
  await dock.focus();
  await desktop.keyboard.press('Enter');
  results.desktop = await inspect(desktop);
  assert.equal(results.desktop.priceAnimations, 0);
  await addOffer(desktop, inner).focus();
  assert.equal(await addOffer(desktop, inner).evaluate(node => document.activeElement === node), true);
  await screenshot(desktop, 'desktop-add-keyboard');
  await desktop.keyboard.press('Enter');
  results.desktop.purchase = await readPurchase(desktop);
  await desktop.keyboard.press('Escape');
  await desktop.locator('#cell-arm-pill').waitFor({ state: 'hidden' });
  results.desktop.escapeCancels = true;

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await seed(phone);
  await phone.evaluate(() => {
    const app = window.__flowsynth;
    app.devWorldEra();
    app.state.nous = 32;
    app.render();
    if (app.ui.boardLayer !== 'world') throw new Error('Expected the World layer before Add');
  });
  const thumbAdd = phone.locator('#thumb-bar [data-op="cell"]');
  await screenshot(phone, 'phone-world-add-entry');
  await thumbAdd.tap();
  if (await thumbAdd.getAttribute('aria-expanded') === 'true') await thumbAdd.tap();
  results.phone = await inspect(phone);
  assert.equal(results.phone.coarse, true);
  assert.equal(await phone.evaluate(() => window.__flowsynth.ui.boardLayer), 'modules');
  results.phone.fromWorld = true;
  await screenshot(phone, 'phone-add-price-states');
  await addOffer(phone, inner).locator('polygon').tap();
  results.phone.purchase = await readPurchase(phone);
  await phone.locator('#cell-arm-pill').tap();
  await phone.locator('#cell-arm-pill').waitFor({ state: 'hidden' });
  results.phone.cancel = true;
  await phone.evaluate(() => window.__flowsynth.setBoardLayer('world'));
  await phone.locator('#grid [data-world-cell="1,-1"]').waitFor();
  results.phone.ownedInWorld = true;
  assert.deepEqual(results.errors, []);
  await writeFile(join(output, 'browser-checks.json'), `${JSON.stringify(results, null, 2)}\n`);
} finally {
  await browser.close();
}
