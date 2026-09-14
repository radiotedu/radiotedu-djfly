import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPreview } from './preview.mjs';

// Point to an existing Playwright installation to avoid adding browser tooling to event dependencies.
const require = createRequire(import.meta.url);
const { chromium } = process.env.DJFLY_PLAYWRIGHT_PATH ? require(process.env.DJFLY_PLAYWRIGHT_PATH) : require('playwright');
const server = await createPreview({ fixture: true, debug: true });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ headless: true });
const errors = [];
const output = resolve('generated'); await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const views = [];
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}/djfly/`);
    await page.locator('#source').filter({ hasText: 'Geliştirme örneği' }).waitFor();
    await page.locator('#development:not([hidden])').waitFor();
    assert.equal(await page.locator('#readouts dd').count(), 6);
    const before = await page.locator('#decision').textContent();
    await page.getByRole('button', { name: 'Kararı yeniden hesapla' }).click();
    await page.waitForFunction(() => !document.querySelector('#rerun button').disabled);
    assert.equal(await page.locator('#decision').textContent(), before);
    await page.locator('#seed').fill('17');
    await page.getByRole('button', { name: 'Kararı yeniden hesapla' }).click();
    await page.waitForFunction(() => !document.querySelector('#rerun button').disabled);
    await page.locator('#credits summary').click();
    assert(await page.locator('#explanation').isVisible());
    await page.locator('#development details summary').focus();
    await page.keyboard.press('Enter');
    assert(await page.locator('#debug').isVisible());
    const layout = await page.evaluate(() => ({ width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth, canvasWidth: document.querySelector('canvas').width,
      errorVisible: !document.querySelector('#error').hidden }));
    assert(layout.scrollWidth <= layout.width);
    assert(layout.canvasWidth > 0);
    assert.equal(layout.errorVisible, false);
    views.push(layout);
    await page.screenshot({ path: resolve(output, `djfly-${width}.png`), fullPage: true });
  }
  await page.evaluate(async () => {
    const { telemetry } = await (await fetch('./api/telemetry')).json();
    window.dispatchEvent(new CustomEvent('djfly:telemetry', { detail: {
      source: telemetry.source, nodes: [], edges: [], paths: [], groups: [], readouts: {}
    } }));
  });
  assert((await page.locator('#decision').textContent()).includes('Güvenli bir parça ve geçiş bulunamadı'));
  assert.equal(await page.locator('#readouts dd').count(), 0);
  await page.route('**/api/telemetry', route => route.fulfill({ status: 503, body: '{}' }));
  await page.reload();
  await page.locator('#error:not([hidden])').waitFor();
  assert((await page.locator('#source').textContent()).includes('Yerel ağ verisi alınamadı'));
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'browser-smoke.json'), JSON.stringify({ status: 'passed', dataKind: 'development-fixture', views,
    states: ['decision', 'empty', 'error'], errors }, null, 2));
  console.log(resolve(output, 'browser-smoke.json'));
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
