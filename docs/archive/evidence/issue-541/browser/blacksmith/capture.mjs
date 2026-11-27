// Run after capture preflight in this directory's checkout. The browser
// walks the public controls; only the initial recipe and clock are scripted.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const asset = name => fileURLToPath(new URL(name, import.meta.url));
const approved = JSON.parse(await readFile(fileURLToPath(new URL('../provenance.json', import.meta.url)), 'utf8'));
const base = new URL(process.argv[2]);
assert.equal(base.href, approved.url);
const verify = async () => {
  const response = await fetch(new URL('/-/dev/provenance', base));
  assert.ok(response.ok);
  const current = await response.json();
  assert.equal(current.worktree, approved.worktree);
  assert.equal(current.commit, approved.commit);
  assert.equal(current.source.clean, true);
};
await verify();
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
const report = { source: approved.commit, url: base.href, browser: browser.version(), desktop: null, phone: null, errors: [] };

async function journey(phone) {
  const name = phone ? 'phone' : 'desktop';
  const viewport = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1,
    timezoneId: 'America/Chicago', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.errors.push(`${name}: ${error.message}`));
  const shot = (file) => page.screenshot({ path: asset(`${name}-${file}.png`) });
  const click = target => phone ? target.tap() : target.click();
  const press = async (target, key = 'Enter') => { await target.focus(); await page.keyboard.press(key); };
  const act = phone ? click : press;
  try {
    await page.clock.install({ time: new Date('2026-11-21T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-11-21T12:01:00Z'));
    await page.goto(new URL('?dev=1', base).href);
    const origin = await page.evaluate(async () => {
      const app = window.__flowsynth;
      await app.devLaunchScenario('world-enemy');
      app.devScenarioAssert();
      const note = app.devScenarioNote;
      const create = app.devAction('createHabit', ['Piano']);
      if (!create.ok) throw new Error(create.reason);
      const habit = app.state.habits.find(habit => habit.name === 'Piano');
      const selected = app.devAction('selectHabit', [habit.id]);
      if (!selected.ok) throw new Error(selected.reason);
      return { note, proof: app.state.world.proof ?? false, bank: app.state.world.frontier,
        viewport: [innerWidth, innerHeight], coarse: matchMedia('(pointer: coarse)').matches };
    });
    assert.equal(origin.proof, false);
    assert.ok(origin.bank > 0);
    assert.deepEqual(origin.viewport, [viewport.width, viewport.height]);
    assert.equal(origin.coarse, phone);
    await page.locator('#dev-panel').evaluate(panel => { panel.style.visibility = 'hidden'; });

    await act(page.locator('#clock-plan'));
    const sheet = page.locator('#app-popover');
    await act(sheet.locator('[data-habit-develop]'));
    const blacksmith = sheet.locator('[data-class-pick="blacksmith"]');
    await act(blacksmith);
    assert.equal(await blacksmith.getAttribute('aria-pressed'), 'true');
    if (!phone) assert.equal(await blacksmith.evaluate(el => el === document.activeElement), true);
    assert.match(await blacksmith.innerText(), /Weapon choices/);
    const mark = await blacksmith.evaluate(el => getComputedStyle(el).boxShadow);
    assert.notEqual(mark, 'none');
    await shot('class');
    const grayscale = await page.addStyleTag({ content: '#app-popover { filter: grayscale(1); }' });
    await shot('class-gray');
    await grayscale.evaluate(node => node.remove());
    await act(sheet.locator('#habit-develop-back'));
    const info = sheet.getByRole('button', { name: 'What fills the weapon meter?' });
    if (phone) await click(info);
    else await info.focus();
    await page.waitForFunction(() => document.querySelector('[aria-label="What fills the weapon meter?"]')?.getAttribute('aria-expanded') === 'true');
    await shot('disclosure');
    if (phone) await click(sheet.locator('[data-live="class-meter-line"]'));
    else await page.keyboard.press('Escape');
    assert.equal(await info.getAttribute('aria-expanded'), 'false');

    const tick = seconds => page.evaluate(seconds => {
      const app = window.__flowsynth;
      if (app.state.mode === 'upgrade') {
        const start = app.devActionStartSession(null);
        if (!start.ok) throw new Error(start.reason);
      }
      const tick = app.devActionAdvance(seconds);
      if (!tick.ok) throw new Error(tick.reason);
      return { mode: app.state.mode, modal: app.ui.modal, time: app.state.session.accounting.creditedSeconds,
        rolls: app.state.session.rolls.flow, weapons: app.state.world.weapons.map(w => w.type) };
    }, seconds);
    await tick(360);
    await page.evaluate(() => window.__flowsynth.showFocusFace('plan'));
    const meter = sheet.getByRole('progressbar', { name: 'Next weapon choice' });
    const partial = await meter.getAttribute('aria-valuetext');
    assert.match(partial, /6:00.*10:00/);
    await shot('credited');
    const fill = await tick(240);
    assert.deepEqual(fill, { mode: 'flow', modal: null, time: 600, rolls: 0, weapons: ['chargeBlade'] });
    assert.equal(await page.locator('[aria-label="Next weapon choice"]').count(), 1);
    assert.equal(await page.locator('[data-forge-weapon]').count(), 0);
    assert.match(await meter.getAttribute('aria-valuetext'), /1 banked/);
    await shot('flow-banked');
    await page.evaluate(() => {
      const app = window.__flowsynth;
      const result = app.devActionEndSession();
      if (!result.ok) throw new Error(result.reason);
      app.closeModal();
      app.showFocusFace('plan');
    });
    const choice = sheet.getByRole('group', { name: 'Banked weapon choice' });
    const maul = choice.getByRole('button', { name: 'Forge Maul' });
    assert.match(await maul.getAttribute('aria-describedby'), /maul/);
    assert.match(await choice.innerText(), /5 HP unfed · 8 HP for 1 charge · every 4 s/);
    assert.match(await choice.innerText(), /12 HP unfed · 24 HP for 2 charge · every 8 s/);
    const control = await maul.evaluate(el => ({ borderRadius: getComputedStyle(el).borderRadius,
      height: el.getBoundingClientRect().height, sheetScroll: el.closest('.inst-panel-face').scrollWidth,
      sheetWidth: el.closest('.inst-panel-face').clientWidth, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animations: el.closest('.weapon-choices').getAnimations({ subtree: true }).length }));
    assert.equal(control.borderRadius, '0px');
    assert.ok(control.height >= 44 && control.sheetScroll <= control.sheetWidth + 1);
    assert.deepEqual([control.reducedMotion, control.animations], [true, 0]);
    // Show the whole comparison and its return actions within the clipped
    // sheet, including the lower edge of the keyboard focus ring.
    await maul.scrollIntoViewIfNeeded();
    await choice.evaluate(el => { const face = el.closest('.inst-panel-face'); face.scrollTop = face.scrollHeight; });
    if (!phone) await maul.focus();
    await shot('choice');
    await act(maul);
    assert.equal(await choice.count(), 0);
    const id = await page.evaluate((phone) => {
      const app = window.__flowsynth;
      app.closeApp();
      app.setBoardLayer('world');
      app.ui.inventory.collapsed = false;
      app.render();
      if (phone) app.openModal('inventory');
      const owned = app.state.world.weapons.filter(w => w.type === 'maul');
      if (owned.length !== 1 || owned[0].pos !== null) throw new Error('Choice did not mint exactly one unplaced Maul.');
      return owned[0].id;
    }, phone);
    const tray = phone ? page.locator('#modal-content') : page.locator('#world-tray');
    await act(tray.locator(`[data-world-tray="${id}"]`));
    const worldFacts = await tray.locator('.inventory-inspection').innerText();
    assert.match(worldFacts, /Maul.*12 HP unfed · 24 HP for 2 charge · every 8 s · needs an adjacent Sentinel/s);
    assert.equal(await tray.locator(`[data-world-place="${id}"]`).isEnabled(), true);
    assert.equal(await page.locator('[aria-label="Next weapon choice"]').count(), 0);
    await shot('world-inspect');
    return { origin, partial, fill, control, worldFacts, choiceConsumed: true, disclosureOpenedAndDismissed: true, selectedInset: mark };
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
  await writeFile(asset('browser.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
