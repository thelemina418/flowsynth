// #541 browser evidence: pre-discovery pressure in the Ledger, then discovery.
// Run after the capture preflight accepted the URL (see ../README.md):
//   docs/evidence/issue-541/browser/run.sh discovery <verified-url>
// From the recipe checkpoint `approaching-prestige`, real flow crosses Shale's
// threshold before World exists; the Ledger must explain the one bounded
// penalty without revealing the map. The ambient reset door then banks Arete
// and World is discovered with HP and pressure on the plate.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const approved = JSON.parse(await readFile(here('../provenance-a498b85-full.json'), 'utf8'));
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
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, timezoneId: 'America/Chicago' });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', e => report.errors.push(`${name}: ${e.message}`));
  const shot = file => page.screenshot({ path: here(`${name}-${file}.png`) });
  const r = {};
  try {
    await page.clock.install({ time: new Date('2026-11-21T12:00:00Z') });
    await page.goto(new URL('?dev=1', base).href);
    r.origin = await page.evaluate(async () => {
      const app = window.__flowsynth;
      await app.devLaunchScenario('approaching-prestige');
      app.devScenarioAssert();
      return { note: app.devScenarioNote, eraEarned: app.state.eraEarned, unlocked: app.state.world.unlocked,
        viewport: [innerWidth, innerHeight], coarse: matchMedia('(pointer: coarse)').matches };
    });
    assert.deepEqual(r.origin.viewport, [viewport.width, viewport.height]);
    assert.equal(r.origin.coarse, phone);
    assert.equal(r.origin.unlocked, false);
    await page.addStyleTag({ content: '#dev-panel { display: none !important; }' });

    // Real flow past Shale's threshold, in 60 s advances, then end the session.
    r.crossing = await page.evaluate(() => {
      const app = window.__flowsynth;
      const ok = x => { if (!x.ok) throw new Error(x.reason); };
      ok(app.devActionStartSession(null));
      let seconds = 0;
      while (app.state.eraEarned < 2e7 && seconds < 36_000) { ok(app.devActionAdvance(60)); seconds += 60; }
      ok(app.devActionEndSession());
      app.closeModal();
      return { seconds, eraEarned: app.state.eraEarned, enemies: Object.fromEntries(Object.entries(app.state.world.enemies).slice(0, 2)),
        unlocked: app.state.world.unlocked, mode: app.state.mode };
    });
    assert.ok(r.crossing.eraEarned >= 2e7);
    assert.equal(r.crossing.unlocked, false);

    const overview = page.locator(phone ? '#phone-ledger-overview' : '#ledger-overview');
    if (phone) await overview.tap(); else { await overview.focus(); await page.keyboard.press('Enter'); }
    const pressure = page.locator('#ledger-pressure');
    await pressure.waitFor();
    await pressure.scrollIntoViewIfNeeded();
    r.ledgerPressure = await pressure.innerText();
    assert.match(r.ledgerPressure, /One enemy/);
    assert.match(r.ledgerPressure, /−20% ν/);
    assert.match(r.ledgerPressure, /Bank Arete at prestige to discover World/);
    assert.doesNotMatch(r.ledgerPressure, /Shale|Basalt|−35%/);
    r.mapHidden = await page.evaluate(() => document.querySelector('[data-legend-layer="world"], [data-world-cell]') === null);
    assert.equal(r.mapHidden, true);
    r.overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(r.overflow, false);
    await shot('ledger-pressure');
    const gray = await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
    await shot('ledger-pressure-gray');
    await gray.evaluate(n => n.remove());
    if (phone) await page.keyboard.press('Escape'); else await page.keyboard.press('Escape');
    await page.evaluate(() => window.__flowsynth.closeModal?.());

    // Discovery through the ambient reset door and its confirmation.
    const door = page.locator(phone ? '#phone-reset' : '#ambient-reset');
    r.yield = await page.locator('[data-live="ambient-yield"]').first().textContent();
    if (phone) await door.tap(); else { await door.focus(); await page.keyboard.press('Enter'); }
    const confirm = page.locator('#prestige-confirm');
    await confirm.waitFor();
    await shot('prestige-confirm');
    if (phone) await confirm.tap(); else await confirm.click();
    // Discovery: the grant sheet names the permanent starter kit.
    const grant = page.locator('#modal-content');
    await page.waitForFunction(() => window.__flowsynth.ui.modal === 'grant');
    r.grant = await grant.innerText();
    for (const piece of ['Sentinel', 'Guard Plate', 'Pulse', 'Charge Blade', 'Charge Column', 'Conduit']) assert.match(r.grant, new RegExp(piece));
    r.grantOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(r.grantOverflow, false);
    await shot('discovery-grant');
    const close = page.locator('#close-modal');
    if (phone) await close.tap(); else { await close.focus(); await page.keyboard.press('Enter'); }
    assert.equal(await page.evaluate(() => window.__flowsynth.ui.modal), null);
    r.discovered = await page.evaluate(() => {
      const app = window.__flowsynth;
      return { unlocked: app.state.world.unlocked, arete: app.state.arete, prestiges: app.state.prestiges,
        shale: app.state.world.enemies.shale, worldLayer: !!document.querySelector('[data-legend-layer="world"]') };
    });
    assert.equal(r.discovered.unlocked, true);
    assert.ok(r.discovered.arete > 0);
    assert.equal(r.discovered.worldLayer, true);
    const legend = page.locator('#layer-legend [data-legend-layer="world"]');
    if (phone) { await legend.tap(); if (await legend.getAttribute('aria-pressed') !== 'true') await legend.tap(); }
    else { await legend.focus(); await page.keyboard.press('Enter'); }
    // Focus restored to the Ledger door may show its rate disclosure (focus
    // rule); Escape suppresses it without moving focus.
    r.disclosedAfterConfirm = await page.locator('.inst-show').count();
    await page.keyboard.press('Escape');
    r.disclosedAfterEscape = await page.locator('.inst-show').count();
    r.worldLabels = await page.locator('[data-world-cell]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    r.overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(r.overflowAfter, false);
    await shot('discovered-world');
    // A new era: every wall stays reserved until its threshold is crossed
    // again (the active Shale plate with HP and pressure is the live/ area).
    r.reservedAfterDiscovery = r.worldLabels.filter(l => /Reserved|reserved/.test(l ?? '')).length;
    assert.equal(r.discovered.shale.discovered, false);
    return r;
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
