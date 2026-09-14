import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DJFLY_PLAYWRIGHT_PATH ?? 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('https://radiotedu.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await mkdir('generated', { recursive: true });
  await page.screenshot({ path: 'generated/phase2-site-reference.png', fullPage: false });
  const facts = await page.evaluate(() => ({ title: document.title,
    headings: [...document.querySelectorAll('h1,h2')].slice(0,6).map(e => ({ text: e.textContent, font: getComputedStyle(e).fontFamily })),
    nav: [...document.querySelectorAll('header a')].slice(0,10).map(e => ({text:e.textContent?.trim(),href:e.getAttribute('href')})) }));
  await writeFile('generated/phase2-site-reference.json', JSON.stringify(facts, null, 2));
  console.log('generated/phase2-site-reference.png');
} finally { await browser.close(); }
