// Run after capture preflight. Pass the verified dev URL as the first argument.
// PLAYWRIGHT_MODULE and CHROMIUM_BIN can select an existing installation.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const dir = fileURLToPath(new URL('.', import.meta.url));
const url = new URL('?dev=1', process.argv[2]).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
const report = { url, browser: browser.version(), errors: [], desktop: {}, phone: {} };
const shot = (page, name) => page.screenshot({ path: join(dir, `${name}.png`) });
const shard = (page, q, r) => page.locator(`[data-world-cell="${q},${r}"]`);
const ret = (page) => page.getByRole('button', { name: 'Return', exact: true });

async function open(options) {
  const page = await browser.newPage(options);
  page.setDefaultTimeout(12_000);
  page.on('pageerror', (err) => report.errors.push(err.message));
  await page.clock.install({ time: new Date('2026-11-21T12:00:00Z') });
  await page.goto(url);
  const origin = await page.evaluate(async () => {
    const app = window.__flowsynth;
    await app.devLaunchScenario('world-enemy');
    app.devScenarioAssert();
    app.setBoardLayer('world');
    return { note: app.devScenarioNote, proof: app.state.world.proof ?? false, claims: app.state.world.frontier,
      eraEarned: app.state.eraEarned, column: app.state.world.columns[0].pos, sentinelId: app.state.world.creatures[0].id,
      cells: app.state.cells, viewport: [innerWidth, innerHeight], coarse: matchMedia('(pointer: coarse)').matches };
  });
  assert.equal(origin.proof, false);
  assert.ok(origin.claims > 0);
  return { page, origin };
}
async function hideConsole(page) {
  await page.locator('#dev-panel').evaluate((panel) => { panel.style.visibility = 'hidden'; });
}
async function step(page, seconds, end = false) {
  return page.evaluate(({ seconds, end }) => {
    const app = window.__flowsynth;
    if (app.state.mode === 'upgrade') {
      const start = app.devActionStartSession(null);
      if (!start.ok) throw new Error(start.reason);
    }
    const tick = app.devActionAdvance(seconds);
    if (!tick.ok) throw new Error(tick.reason);
    if (end) {
      const finish = app.devActionEndSession();
      if (!finish.ok) throw new Error(finish.reason);
      app.closeModal();
    }
    app.setBoardLayer('world');
    const { hp, recovering, pos } = app.state.world.creatures[0];
    return { hp, recovering, pos, wall: app.state.world.enemies.shale.hp, mode: app.state.mode };
  }, { seconds, end });
}

try {
  // Reuse the verified walked checkpoint clone within each page. The two
  // viewports launch independently and have private in-memory save slots.
  const [desktop, phone] = await Promise.all([
    open({ viewport: { width: 1280, height: 800 } }),
    open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }),
  ]);
  report.desktop.origin = desktop.origin;
  report.phone.origin = phone.origin;
  assert.deepEqual(desktop.origin.viewport, [1280, 800]);
  assert.deepEqual(phone.origin.viewport, [390, 844]);
  assert.equal(phone.origin.coarse, true);
  const seat = (origin) => origin.cells.find(({ q, r }) =>
    Math.max(Math.abs(q + 1), Math.abs(r), Math.abs(q + 1 + r)) === 1 &&
    (origin.column?.q !== q || origin.column?.r !== r));
  const desktopSeat = seat(desktop.origin);
  const phoneSeat = seat(phone.origin);
  assert.ok(desktopSeat && phoneSeat, 'expected a free starter approach');
  const tray = (origin) => `[data-world-tray="${origin.sentinelId}"]`;
  const placement = (origin) => `[data-world-place="${origin.sentinelId}"]`;
  await shot(desktop.page, 'desktop-origin');
  await hideConsole(desktop.page);
  await hideConsole(phone.page);

  const wall = shard(desktop.page, -1, 0);
  report.desktop.wall = await wall.getAttribute('aria-label');
  assert.match(report.desktop.wall, /Shale.*48\/48 HP.*−20%/);
  await wall.focus();
  await desktop.page.keyboard.press('Enter');
  const desktopFace = desktop.page.locator('[data-detail-face="world"]');
  await desktopFace.focus();
  await desktop.page.waitForFunction(() => document.querySelector('[data-detail-face="world"]')?.getAttribute('aria-expanded') === 'true');
  await shot(desktop.page, 'desktop-keyboard-disclosure');
  await desktop.page.keyboard.press('Escape');
  assert.equal(await desktopFace.getAttribute('aria-expanded'), 'false');
  await ret(desktop.page).click();
  await desktop.page.emulateMedia({ reducedMotion: 'reduce' });
  await desktop.page.locator(`#world-tray ${tray(desktop.origin)}`).focus();
  await desktop.page.keyboard.press('Enter');
  await desktop.page.locator(`#world-tray ${placement(desktop.origin)}`).focus();
  await desktop.page.keyboard.press('Enter');
  report.desktop.reducedMotion = await desktop.page.evaluate(() => {
    const grid = document.querySelector('[data-key="world-grid"]');
    return { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      marked: grid.querySelectorAll('.world-plate.pulse').length, animations: grid.getAnimations({ subtree: true }).length };
  });
  assert.deepEqual([report.desktop.reducedMotion.reduced, report.desktop.reducedMotion.animations], [true, 0]);
  assert.ok(report.desktop.reducedMotion.marked > 0);
  await shot(desktop.page, 'desktop-reduced-motion');
  await shard(desktop.page, desktopSeat.q, desktopSeat.r).focus();
  await desktop.page.keyboard.press('Enter');
  report.desktop.flow = await step(desktop.page, 8);
  assert.equal(report.desktop.flow.hp, 12);
  assert.ok(report.desktop.flow.wall < 48);
  assert.equal(await desktop.page.locator(`${placement(desktop.origin)}:enabled`).count(), 0);
  await shot(desktop.page, 'desktop-flow');

  // Compare the bare Sentinel with a real build from the identical earned
  // checkpoint. No inventory, currency, reserve, or World state is granted.
  report.desktop.fundedRig = await desktop.page.evaluate(async () => {
    const app = window.__flowsynth;
    await app.devLaunchScenario('world-enemy');
    app.devScenarioAssert();
    app.setBoardLayer('world');
    const accept = (r) => { if (!r.ok) throw new Error(r.reason); };
    const { creatures: [sentinel], armor: [plate], weapons: [blade], spells: [pulse], columns: [column] } = app.state.world;
    const host = app.state.modules.find(({ type }) => type === 'additive');
    const generator = app.state.modules.find(({ type, reserve }) => type === 'focusKeyed' && reserve > 20);
    const arete = app.state.arete;
    const reserve = generator.reserve;
    accept(app.devActionPlace(host.id, 1, -1));
    accept(app.devActionPlace(generator.id, 1, 0));
    for (const [id, q, r] of [[column.id, 1, -1], [sentinel.id, 0, 0], [plate.id, -1, 1], [blade.id, 1, 0], [pulse.id, 0, -1]]) {
      accept(app.devActionWorldPlace(id, q, r));
    }
    return { areteBefore: arete, areteAfter: app.state.arete, heldReserve: reserve,
      setup: app.devInterventions.map(({ label }) => label) };
  });
  await hideConsole(desktop.page);
  await shot(desktop.page, 'desktop-live-rig');
  report.desktop.lifetimeClear = await step(desktop.page, 32, true);
  assert.equal(report.desktop.lifetimeClear.wall, 0);
  assert.ok(report.desktop.lifetimeClear.hp > 0);
  assert.match(await shard(desktop.page, -1, 0).getAttribute('aria-label'), /Shale cleared/);
  await shot(desktop.page, 'desktop-live-clear');

  await shot(phone.page, 'phone-board');
  await shard(phone.page, -1, 0).tap();
  const phoneFace = phone.page.locator('[data-detail-face="world"]');
  await phoneFace.tap();
  await phone.page.waitForFunction(() => document.querySelector('[data-detail-face="world"]')?.getAttribute('aria-expanded') === 'true');
  report.phone.disclosure = await phoneFace.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby'))?.textContent);
  assert.match(report.phone.disclosure, /heals/);
  await shot(phone.page, 'phone-touch-disclosure');
  await phone.page.touchscreen.tap(378, 291);
  assert.equal(await phoneFace.getAttribute('aria-expanded'), 'false');
  await ret(phone.page).tap();
  const inventory = phone.page.locator('#thumb-bar').getByRole('button', { name: /Inventory/ });
  const showInventory = async () => {
    await inventory.tap();
    if (!(await phone.page.locator('#modal-content').isVisible())) await inventory.tap();
  };
  await showInventory();
  await phone.page.locator(`#modal-content ${tray(phone.origin)}`).tap();
  await phone.page.locator(`#modal-content ${placement(phone.origin)}`).tap();
  await shard(phone.page, phoneSeat.q, phoneSeat.r).tap();
  report.phone.flow = await step(phone.page, 16, true);
  assert.equal(report.phone.flow.recovering, true);
  await showInventory();
  const recoveryRow = phone.page.locator(`#modal-content ${tray(phone.origin)}`);
  const inspection = phone.page.locator('#modal-content .inventory-inspection');
  await recoveryRow.tap();
  // If the Inventory trigger was still disclosing after closing the
  // summary, its outside tap dismisses that disclosure first.
  if (!(await inspection.isVisible()) && await recoveryRow.isVisible()) await recoveryRow.tap();
  report.phone.recovery = await inspection.innerText();
  assert.match(report.phone.recovery, /0\/24 HP · Recovering/);
  assert.equal(await phone.page.locator(`#modal-content ${placement(phone.origin)}`).isDisabled(), true);
  await shot(phone.page, 'phone-recovery');
  await phone.page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
  await shot(phone.page, 'phone-recovery-gray');
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(join(dir, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
