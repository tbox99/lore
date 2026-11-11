// Native Chromium acceptance with its normal sandbox enabled. Synthetic data only.
// This is separate from live Lenovo transport checks and corporate Windows acceptance.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { demoEntries, makeZip } from './fixtures.mjs';

const prototype = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(prototype, 'test-results');
await mkdir(artifacts, { recursive: true });
const results = [];
const consoleErrors = [], pageErrors = [], externalRequests = [];
const pageRequests = [];
let hostOutput = '', hostErrors = '', hostSpawnError = null;
let browser = null, page = null, failure = null;

function pass(check, detail = null) {
  results.push({ check, status: 'PASS', detail });
  console.log(`PASS: ${check}${detail ? ` — ${detail}` : ''}`);
}
function observePage(target) {
  target.setDefaultTimeout(15_000);
  target.on('pageerror', error => pageErrors.push(error.message));
  target.on('console', message => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) consoleErrors.push(message.text());
  });
  target.on('request', request => {
    pageRequests.push(request.url());
    if (/^https?:/.test(request.url()) && !request.url().startsWith(`${base}/`)) externalRequests.push(request.url());
  });
}
async function preferences(target, language, fontSize) {
  assert.equal(await target.locator('html').getAttribute('lang'), language);
  assert.equal(await target.locator('#language-select').inputValue(), language);
  assert.equal(await target.locator('html').getAttribute('data-font-size'), fontSize);
  assert.equal(await target.locator('#font-size-select').inputValue(), fontSize);
}
async function fontPixels(selector) {
  return page.locator(selector).first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
}
async function noPageOverflow(label) {
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.scroll <= dimensions.width + 1, `${label}: page width ${dimensions.width}, content width ${dimensions.scroll}`);
}
async function availablePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}
const port = await availablePort();
const base = `http://127.0.0.1:${port}`;
const windows = process.platform === 'win32';
const command = windows ? 'powershell.exe' : 'python3';
const args = windows
  ? ['-NoProfile', '-File', path.join(prototype, 'Start-Lore.ps1'), '-NoBrowser', '-Port', String(port)]
  : [path.join(prototype, 'serve.py'), '--no-browser', '--port', String(port)];
const host = spawn(command, args, { cwd: prototype, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
host.on('error', error => { hostSpawnError = error; });
host.stdout.on('data', chunk => { hostOutput = (hostOutput + chunk).slice(-128_000); });
host.stderr.on('data', chunk => { hostErrors = (hostErrors + chunk).slice(-128_000); });
async function health() {
  const response = await fetch(`${base}/api/health`, { headers: { 'X-LORE-Request': '1' }, signal: AbortSignal.timeout(1000) });
  assert.equal(response.status, 200);
  return response.json();
}
async function waitForHost() {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    if (hostSpawnError) throw hostSpawnError;
    if (host.exitCode !== null) throw new Error(`Host exited with ${host.exitCode}: ${hostErrors}`);
    try { return await health(); } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Host did not become ready: ${last?.message}; ${hostErrors}`);
}

const syntheticCatalog = `<?xml version="1.0"?><packages count="1"><package><location>https://download.lenovo.com/pccbbs/mobiles/lore_smoke.xml</location><category>Synthetic BIOS</category></package></packages>`;
const syntheticPackage = `<?xml version="1.0"?><Package id="lore-smoke" name="Synthetic BIOS" version="9.8.7"><Title default="EN"><Desc id="EN">Synthetic BIOS package</Desc></Title><ReleaseDate>2026-01-01</ReleaseDate><Summary default="EN"><Desc id="EN">Synthetic browser acceptance metadata.</Desc></Summary><Files><Readme default="EN"><File id="EN"><Name>lore_smoke.html</Name></File></Readme></Files></Package>`;
const syntheticReadme = '<!doctype html><html><body><h1>Synthetic readme</h1><p>Install prerequisite first.</p><script>window.__smokePayload = true;</script><iframe src="https://example.invalid/never-load"></iframe></body></html>';

// Change both BIOS sources together unless a conflict is the subject of a test.
// The archive-relative paths deliberately remain identical across A and B.
function comparisonFixture({ bios, wifi, serial, optional = false, missingDrivers = false, failedDrivers = false, partialDrivers = false, duplicate = false, date } = {}) {
  return makeZip(demoEntries().filter(([name]) => !(missingDrivers && name.endsWith('/Installed-HWD/Drivers.log'))).map(([name, original]) => {
    const utf16 = Buffer.isBuffer(original) && original[0] === 255 && original[1] === 254;
    let content = utf16 ? original.subarray(2).toString('utf16le') : String(original);
    if (bios) content = content.replaceAll('DEMOET10W (1.10)', bios);
    if (serial) content = content.replaceAll('DEMO0001', serial);
    if (date) content = content.replace('11.11.2026 10:00:00', date);
    if (name.endsWith('/Installed-HWD/Drivers.log')) {
      if (wifi) content = content.replace('24.50.0.4', wifi);
      if (optional) content += 'Demo USB Adapter                                        3.2.1\r\n';
      if (partialDrivers) content = content.replace(/^Demo Bluetooth Adapter[^\r\n]*\r?\n/m, '') + 'Unreadable table continuation\r\n';
      if (duplicate) content += 'Demo Wi-Fi Adapter                                      24.60.1.2\r\n';
      if (failedDrivers) content = '';
    }
    return [name, utf16 ? Buffer.concat([Buffer.from([255, 254]), Buffer.from(content, 'utf16le')]) : content];
  }));
}
async function loadComparison(buffer, name) {
  await page.locator('#compare-input').setInputFiles({ name, mimeType: 'application/zip', buffer });
  await page.locator('#comparison-results').waitFor({ state: 'visible' });
  await page.waitForFunction(expected => document.querySelector('#comparison-capture-b').textContent.includes(expected)
    && !document.querySelector('#compare-status').classList.contains('busy'), name);
  assert.equal(await page.locator('#compare-error').isVisible(), false);
}
async function comparisonCounts(expected) {
  for (const [status, value] of Object.entries(expected)) {
    assert.equal((await page.locator(`#comparison-count-${status}`).textContent()).trim(), String(value), `Comparison count: ${status}`);
  }
}

try {
  const hostHealth = await waitForHost();
  pass('Actual platform host starts', JSON.stringify(hostHealth));

  // No launch arguments or protection overrides: sandbox remains enabled.
  browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  // A German browser must still get English until the user chooses otherwise.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  page = await context.newPage();
  observePage(page);
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#browser-warning').isVisible(), false);
  pass('Native browser starts with ZIP capability');
  await preferences(page, 'en', 'standard');
  assert.equal(await fontPixels('html'), 18);
  assert.match(await page.locator('#tab-drivers').textContent(), /Drivers/);
  const skipLink = page.locator('.skip-link');
  assert.equal(await skipLink.evaluate(link => getComputedStyle(link).opacity), '0');
  await page.keyboard.press('Tab');
  assert.equal(await skipLink.evaluate(link => document.activeElement === link), true);
  assert.equal(await skipLink.evaluate(link => getComputedStyle(link).opacity), '1');
  assert.ok((await skipLink.boundingBox()).y >= 0);
  await page.keyboard.press('Tab');
  assert.equal(await skipLink.evaluate(link => getComputedStyle(link).opacity), '0');
  pass('English is the default in a German browser', '18 px default root font');

  const demoPath = path.join(prototype, 'web', 'demo-cdat.zip');
  await page.locator('#archive-input').setInputFiles(demoPath);
  await page.waitForFunction(() => document.querySelector('#driver-tab-count').textContent === '3' && document.querySelector('#file-tab-count').textContent === '7');
  assert.match(await page.locator('#capture-title').textContent(), /ThinkPad Demo/);
  assert.equal(await page.locator('#app-error').isVisible(), false);
  const englishOverview = await page.locator('#device-grid').textContent();
  const englishCoverage = await page.locator('#coverage-list').textContent();
  const englishWarnings = await page.locator('#warning-list').textContent();
  assert.match(englishWarnings, /Demo\.CollectionUnavailable/);
  for (const selector of ['.device-item dt', '.device-item dd', '.source-button', '.coverage-detail', '.status-tag']) {
    assert.ok(await fontPixels(selector) >= 14, `${selector} must remain readable at the default size`);
  }
  await noPageOverflow('Desktop overview');
  await page.screenshot({ path: path.join(artifacts, 'synthetic-overview.png'), fullPage: true });
  pass('Native file picker import', '3 drivers, 7 archive files');

  await page.locator('#tab-overview').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-drivers').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#panel-drivers').isVisible(), true);
  await page.locator('#driver-search').fill('Wi-Fi');
  assert.equal(await page.locator('#driver-table tr').count(), 1);
  assert.match(await page.locator('#driver-table').textContent(), /24\.50\.0\.4/);
  const sourceButton = page.locator('#driver-table button');
  await sourceButton.click();
  assert.equal(await page.locator('#source-dialog').evaluate(dialog => dialog.open), true);
  assert.match(await page.locator('#source-text').textContent(), /DeviceName/);
  assert.match(await page.locator('#source-detail').textContent(), /line/i);
  const originalSource = await page.locator('#source-text').textContent();
  const defaultSourceFont = await fontPixels('#source-text');
  const defaultTableFont = await fontPixels('#driver-table td');
  assert.ok(defaultSourceFont >= 15, 'Source text must be readable at the default size');
  assert.ok(defaultTableFont >= 16, 'Driver table must be readable at the default size');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#source-dialog').evaluate(dialog => dialog.open), false);
  assert.equal(await sourceButton.evaluate(button => document.activeElement === button), true);
  pass('Keyboard tabs, filtering and native source dialog', 'Escape closes; focus returns to source button');

  const beforePreferenceRequests = pageRequests.length;
  await page.locator('#language-select').selectOption('de');
  await preferences(page, 'de', 'standard');
  assert.match(await page.locator('#tab-drivers').textContent(), /Treiber/);
  assert.equal(await page.locator('#tab-drivers').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#driver-search').inputValue(), 'Wi-Fi');
  assert.equal(await page.locator('#driver-table tr').count(), 1);
  assert.notEqual(await page.locator('#device-grid').textContent(), englishOverview);
  assert.notEqual(await page.locator('#coverage-list').textContent(), englishCoverage);
  assert.notEqual(await page.locator('#warning-list').textContent(), englishWarnings);
  assert.match(await page.locator('#warning-list').textContent(), /Demo\.CollectionUnavailable/);
  await page.locator('#font-size-select').selectOption('large');
  assert.equal(await fontPixels('html'), 20);
  await page.locator('#font-size-select').selectOption('extra-large');
  await preferences(page, 'de', 'extra-large');
  assert.equal(await fontPixels('html'), 22);
  assert.ok(Math.abs((await fontPixels('#driver-table td')) / defaultTableFont - 22 / 18) < 0.02);
  await sourceButton.click();
  assert.equal(await page.locator('#source-text').textContent(), originalSource);
  assert.match(await page.locator('#source-detail').textContent(), /Zeile/);
  assert.ok(Math.abs((await fontPixels('#source-text')) / defaultSourceFont - 22 / 18) < 0.02);
  await page.keyboard.press('Escape');
  await page.locator('#tab-overview').click();
  await noPageOverflow('Desktop German extra-large overview');
  await page.screenshot({ path: path.join(artifacts, 'synthetic-overview-de-extra-large.png'), fullPage: true });
  await page.locator('#language-select').selectOption('en');
  assert.equal(await page.locator('#device-grid').textContent(), englishOverview);
  assert.equal(await page.locator('#coverage-list').textContent(), englishCoverage);
  assert.equal(await page.locator('#warning-list').textContent(), englishWarnings);
  assert.equal(pageRequests.length, beforePreferenceRequests, 'Preference changes must not refetch data');
  await page.locator('#font-size-select').selectOption('standard');
  pass('Live language and text-size changes preserve evidence', 'Filtered rows retained; original source unchanged; tables and dialogs scale without requests');

  await page.locator('#tab-files').click();
  await page.locator('#file-search').fill('Drivers.log');
  assert.equal(await page.locator('#file-table tr').count(), 1);
  pass('Archive file filter');

  await page.locator('#archive-input').setInputFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('This is not a ZIP archive.') });
  await page.locator('#app-error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#driver-tab-count').textContent(), '0');
  const englishImportError = await page.locator('#app-error').textContent();
  assert.match(englishImportError, /ZIP/);
  await page.locator('#language-select').selectOption('de');
  assert.notEqual(await page.locator('#app-error').textContent(), englishImportError);
  await page.locator('#language-select').selectOption('en');
  assert.equal(await page.locator('#app-error').textContent(), englishImportError);
  await page.locator('#archive-input').setInputFiles(demoPath);
  await page.waitForFunction(() => document.querySelector('#driver-tab-count').textContent === '3');
  assert.equal(await page.locator('#app-error').isVisible(), false);
  pass('Invalid archive reports error and subsequent import recovers');

  // Hold an older demo response until a newer upload has finished. The late
  // completion must not replace the new device snapshot.
  let releaseDemo, signalDemoRequest;
  const demoRequested = new Promise(resolve => { signalDemoRequest = resolve; });
  const releasePromise = new Promise(resolve => { releaseDemo = resolve; });
  const demoBytes = await readFile(demoPath);
  await page.route('**/demo-cdat.zip', async route => {
    signalDemoRequest();
    await releasePromise;
    await route.fulfill({ status: 200, contentType: 'application/zip', body: demoBytes });
  });
  await page.locator('#demo-button').click();
  await demoRequested;
  const englishBusyStatus = await page.locator('#app-status').textContent();
  await page.locator('#language-select').selectOption('de');
  assert.notEqual(await page.locator('#app-status').textContent(), englishBusyStatus);
  assert.equal(await page.locator('#app-status').evaluate(element => element.classList.contains('busy')), true);
  await page.locator('#language-select').selectOption('en');
  assert.equal(await page.locator('#app-status').textContent(), englishBusyStatus);
  const secondEntries = demoEntries().map(([name, content]) => [name, typeof content === 'string' ? content.replace('ThinkPad Demo (synthetische Daten)', 'Second synthetic device') : content]);
  await page.locator('#archive-input').setInputFiles({ name: 'second-synthetic.zip', mimeType: 'application/zip', buffer: makeZip(secondEntries) });
  await page.waitForFunction(() => document.querySelector('#capture-title').textContent === 'Second synthetic device');
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/demo-cdat.zip'));
  releaseDemo();
  await (await oldResponse).finished();
  // Allow the delivered fetch/blob promise to finish in the actual browser.
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#capture-title').textContent(), 'Second synthetic device');
  await page.unroute('**/demo-cdat.zip');
  pass('Late demo response cannot replace a newer uploaded snapshot');

  // Mock only the upstream HTTP envelope. The real UI, fetch adapter, XML
  // parser and readme conversion execute unchanged in the native browser.
  await page.route('**/api/lenovo?*', async route => {
    const query = new URL(route.request().url()).searchParams.get('path');
    assert.equal(route.request().headers()['x-lore-request'], '1');
    const document = query === '/catalog/21MM_Win11.xml' ? syntheticCatalog
      : query === '/pccbbs/mobiles/lore_smoke.xml' ? syntheticPackage
      : query === '/pccbbs/mobiles/lore_smoke.html' ? syntheticReadme : null;
    if (document === null) throw new Error(`Unexpected mock path: ${query}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: `https://download.lenovo.com${query}`, retrievedAt: '2026-01-01T12:00:00Z', text: document }) });
  });
  await page.locator('#tab-lenovo').click();
  await page.locator('#machine-type').fill('21MM');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-content').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#catalog-table tr').count(), 1);
  await page.locator('#catalog-table button').click();
  await page.locator('#package-detail').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#package-title').textContent(), 'Synthetic BIOS package');
  assert.match(await page.locator('#package-fields').textContent(), /9\.8\.7/);
  const englishPackageFields = await page.locator('#package-fields').textContent();
  const englishPackageNotes = await page.locator('#package-notes').textContent();
  const englishCatalogStatus = await page.locator('#catalog-status').textContent();
  await page.locator('#catalog-search').fill('Synthetic BIOS');
  const beforeCatalogPreferenceRequests = pageRequests.length;
  await page.locator('#language-select').selectOption('de');
  assert.equal(await page.locator('#tab-lenovo').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#catalog-search').inputValue(), 'Synthetic BIOS');
  assert.equal(await page.locator('#catalog-table tr').count(), 1);
  assert.equal(await page.locator('#package-title').textContent(), 'Synthetic BIOS package');
  assert.match(await page.locator('#package-fields').textContent(), /9\.8\.7/);
  assert.notEqual(await page.locator('#package-fields').textContent(), englishPackageFields);
  assert.notEqual(await page.locator('#package-notes').textContent(), englishPackageNotes);
  assert.notEqual(await page.locator('#catalog-status').textContent(), englishCatalogStatus);
  await page.locator('#language-select').selectOption('en');
  assert.equal(await page.locator('#package-fields').textContent(), englishPackageFields);
  assert.equal(await page.locator('#package-notes').textContent(), englishPackageNotes);
  assert.equal(await page.locator('#catalog-status').textContent(), englishCatalogStatus);
  assert.equal(pageRequests.length, beforeCatalogPreferenceRequests, 'Language change must not reload catalog or package metadata');
  pass('Loaded Lenovo metadata and status translate without another request');
  await page.locator('#package-links button').click();
  await page.waitForFunction(() => document.querySelector('#source-dialog').open && document.querySelector('#source-kind').textContent === 'LENOVO README');
  assert.match(await page.locator('#source-text').textContent(), /Install prerequisite first\./);
  assert.doesNotMatch(await page.locator('#source-text').textContent(), /__smokePayload/);
  assert.equal(await page.locator('#source-text script, #source-text iframe').count(), 0);
  assert.equal(await page.evaluate(() => window.__smokePayload), undefined);
  await page.screenshot({ path: path.join(artifacts, 'synthetic-readme.png'), fullPage: true });
  await page.keyboard.press('Escape');
  pass('Catalog, package metadata and safe readme display', 'Controlled synthetic upstream fixture');

  await page.locator('#archive-input').setInputFiles(demoPath);
  await page.waitForFunction(() => document.querySelector('#capture-title').textContent.includes('ThinkPad Demo'));
  assert.equal(await page.locator('[data-tab]').count(), 5);
  await page.locator('#tab-overview').focus();
  await page.keyboard.press('End');
  assert.equal(await page.locator('[data-tab]').last().getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#tab-overview').getAttribute('aria-selected'), 'true');
  await page.locator('#tab-comparison').click();
  await loadComparison(comparisonFixture({ date: '12.11.2026 11:30:00' }), 'same-values-later-capture.zip');
  await comparisonCounts({ same: 8, different: 0, onlyA: 0, onlyB: 0, unresolved: 0 });
  assert.equal(await page.locator('#comparison-identity').getAttribute('data-identity'), 'same-device');
  await page.locator('#comparison-filter').selectOption('differences');
  assert.equal(await page.locator('#platform-comparison tr, #driver-comparison tr').count(), 0);
  pass('Identical observed values have no semantic differences', 'Capture timestamp is metadata; keyboard navigation includes all five tabs');

  const changedComparison = comparisonFixture({ bios: 'DEMOET11W (1.11)', wifi: '24.60.1.2', optional: true });
  await loadComparison(changedComparison, 'changed-capture-b.zip');
  await page.locator('#comparison-filter').selectOption('all');
  await comparisonCounts({ same: 6, different: 2, onlyA: 0, onlyB: 1, unresolved: 0 });
  const biosComparison = page.locator('#platform-comparison tr[data-field="bios"]');
  const wifiComparison = page.locator('#driver-comparison tr[data-name="Demo Wi-Fi Adapter"]');
  assert.equal(await biosComparison.getAttribute('data-status'), 'different');
  assert.equal(await wifiComparison.getAttribute('data-status'), 'different');
  assert.equal(await page.locator('#driver-comparison tr[data-name="Demo USB Adapter"]').getAttribute('data-status'), 'onlyB');
  assert.match(await biosComparison.locator('[data-side="a"]').textContent(), /DEMOET10W \(1\.10\)/);
  assert.match(await biosComparison.locator('[data-side="b"]').textContent(), /DEMOET11W \(1\.11\)/);
  assert.match(await wifiComparison.locator('[data-side="a"]').textContent(), /24\.50\.0\.4/);
  assert.match(await wifiComparison.locator('[data-side="b"]').textContent(), /24\.60\.1\.2/);
  await wifiComparison.locator('[data-side="b"] button').first().click();
  assert.match(await page.locator('#source-text').textContent(), /24\.60\.1\.2/);
  assert.doesNotMatch(await page.locator('#source-text').textContent(), /24\.50\.0\.4/);
  await page.keyboard.press('Escape');
  await wifiComparison.locator('[data-side="a"] button').first().click();
  assert.match(await page.locator('#source-text').textContent(), /24\.50\.0\.4/);
  assert.doesNotMatch(await page.locator('#source-text').textContent(), /24\.60\.1\.2/);
  await page.keyboard.press('Escape');
  assert.match(await page.locator('#driver-table').textContent(), /24\.50\.0\.4/);
  assert.doesNotMatch(await page.locator('#driver-table').textContent(), /24\.60\.1\.2/);
  pass('BIOS, reported driver differences and one-sided records retain correct evidence', 'A and B use identical source paths but open their own original text');

  await page.locator('#comparison-filter').selectOption('differences');
  assert.equal(await page.locator('#platform-comparison tr').count(), 1);
  assert.equal(await page.locator('#driver-comparison tr').count(), 2);
  await page.locator('#comparison-search').fill('Wi-Fi');
  assert.equal(await page.locator('#platform-comparison tr').count(), 0);
  assert.equal(await page.locator('#driver-comparison tr').count(), 1);
  const englishComparisonSummary = await page.locator('#comparison-summary').textContent();
  const beforeComparePreferences = pageRequests.length;
  await page.locator('#language-select').selectOption('de');
  await page.locator('#font-size-select').selectOption('extra-large');
  assert.equal(await page.locator('#tab-comparison').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#comparison-filter').inputValue(), 'differences');
  assert.equal(await page.locator('#comparison-search').inputValue(), 'Wi-Fi');
  assert.equal(await page.locator('#driver-comparison tr').count(), 1);
  assert.match(await page.locator('#comparison-capture-b').textContent(), /changed-capture-b\.zip/);
  assert.notEqual(await page.locator('#comparison-summary').textContent(), englishComparisonSummary);
  await page.locator('#language-select').selectOption('en');
  await page.locator('#font-size-select').selectOption('standard');
  assert.equal(await page.locator('#comparison-summary').textContent(), englishComparisonSummary);
  assert.equal(pageRequests.length, beforeComparePreferences);
  await page.locator('#comparison-search').fill('');
  await page.locator('#comparison-filter').selectOption('all');
  await noPageOverflow('Desktop comparison');
  await page.screenshot({ path: path.join(artifacts, 'synthetic-comparison.png'), fullPage: true });
  pass('Comparison filters and display preferences retain both captures', 'No additional network requests; differences and unresolved results are separate');

  await loadComparison(comparisonFixture({ serial: 'DEMO0002' }), 'different-device-b.zip');
  assert.equal(await page.locator('#comparison-identity').getAttribute('data-identity'), 'different-devices');
  await comparisonCounts({ same: 8, different: 0, onlyA: 0, onlyB: 0, unresolved: 0 });
  await page.locator('#compare-input').setInputFiles({ name: 'invalid-b.zip', mimeType: 'application/zip', buffer: Buffer.from('Invalid secondary archive') });
  await page.locator('#compare-error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#comparison-results').isVisible(), false);
  assert.equal(await page.locator('#driver-tab-count').textContent(), '3');
  assert.match(await page.locator('#capture-title').textContent(), /ThinkPad Demo/);
  await loadComparison(comparisonFixture(), 'recovered-capture-b.zip');
  assert.equal(await page.locator('#comparison-identity').getAttribute('data-identity'), 'same-device');
  pass('Device relationship and failed secondary import remain explicit', 'Invalid B clears stale comparison, preserves A and permits another import');

  await loadComparison(comparisonFixture({ missingDrivers: true }), 'missing-drivers-b.zip');
  await comparisonCounts({ same: 5, different: 0, onlyA: 0, onlyB: 0, unresolved: 4 });
  await page.locator('#comparison-filter').selectOption('differences');
  assert.equal(await page.locator('#platform-comparison tr, #driver-comparison tr').count(), 0);
  assert.equal(await page.locator('#comparison-count-unresolved').isVisible(), true);
  await page.locator('#comparison-filter').selectOption('unresolved');
  assert.equal(await page.locator('#driver-comparison tr').count(), 4);
  assert.equal(await page.locator('#driver-comparison tr:not([data-status="unresolved"])').count(), 0);
  await loadComparison(comparisonFixture({ failedDrivers: true }), 'failed-driver-source-b.zip');
  await comparisonCounts({ same: 5, different: 0, onlyA: 0, onlyB: 0, unresolved: 4 });
  await loadComparison(comparisonFixture({ partialDrivers: true }), 'partial-drivers-b.zip');
  await page.locator('#comparison-filter').selectOption('all');
  await comparisonCounts({ same: 7, different: 0, onlyA: 0, onlyB: 0, unresolved: 2 });
  assert.equal(await page.locator('#driver-comparison tr[data-name="Demo Bluetooth Adapter"]').getAttribute('data-status'), 'unresolved');
  await loadComparison(comparisonFixture({ duplicate: true }), 'duplicate-driver-names-b.zip');
  assert.equal(await wifiComparison.getAttribute('data-status'), 'unresolved');
  assert.match(await wifiComparison.locator('[data-side="b"]').textContent(), /24\.50\.0\.4/);
  assert.match(await wifiComparison.locator('[data-side="b"]').textContent(), /24\.60\.1\.2/);
  assert.equal(await wifiComparison.locator('[data-side="b"] button').count(), 2);
  pass('Missing, failed, partial and ambiguous driver evidence is not reported as removal', 'Unresolved rows remain accessible separately from known differences');

  // Hold the first browser ZIP read for B, then replace A. The old B task must
  // not attach itself to the new primary capture when its file read completes.
  await page.evaluate(() => {
    const original = Blob.prototype.arrayBuffer;
    let holdNext = true;
    window.__comparisonReadStarted = false;
    window.__comparisonReadFinished = false;
    Blob.prototype.arrayBuffer = async function (...arguments_) {
      if (!holdNext) return original.apply(this, arguments_);
      holdNext = false;
      window.__comparisonReadStarted = true;
      await new Promise(resolve => { window.__releaseComparisonRead = resolve; });
      const value = await original.apply(this, arguments_);
      window.__comparisonReadFinished = true;
      return value;
    };
    window.__restoreComparisonRead = () => { Blob.prototype.arrayBuffer = original; };
  });
  await page.locator('#compare-input').setInputFiles({ name: 'held-old-capture-b.zip', mimeType: 'application/zip', buffer: changedComparison });
  await page.waitForFunction(() => window.__comparisonReadStarted);
  await page.locator('#archive-input').setInputFiles(demoPath);
  await page.waitForFunction(() => document.querySelector('#driver-tab-count').textContent === '3'
    && !document.querySelector('#app-status').classList.contains('busy'));
  await page.evaluate(() => window.__releaseComparisonRead());
  await page.waitForFunction(() => window.__comparisonReadFinished);
  // Let the resumed ZIP parsing and subsequent importer promise settle.
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__restoreComparisonRead());
  assert.equal(await page.locator('#comparison-results').isVisible(), false);
  assert.doesNotMatch(await page.locator('#comparison-capture-b').textContent(), /held-old-capture-b/);
  assert.equal(await page.locator('#compare-error').evaluate(element => element.hidden), true);
  await page.locator('#tab-comparison').click();
  await loadComparison(changedComparison, 'removable-capture-b.zip');
  await page.locator('#compare-remove').click();
  assert.equal(await page.locator('#comparison-results').isVisible(), false);
  assert.equal(await page.locator('#driver-tab-count').textContent(), '3');
  await loadComparison(changedComparison, 'mobile-capture-b.zip');
  await page.locator('#comparison-filter').selectOption('all');
  pass('Replacing A invalidates an in-flight B import and B can be removed', 'Late secondary completion never changes the new primary/comparison state');

  await page.locator('#language-select').selectOption('de');
  await page.locator('#font-size-select').selectOption('extra-large');
  await page.setViewportSize({ width: 384, height: 900 });
  for (const tab of ['overview', 'drivers', 'files', 'lenovo', 'comparison']) {
    await page.locator(`#tab-${tab}`).click();
    await noPageOverflow(`384 px, extra-large text, ${tab}`);
  }
  await page.locator('#tab-comparison').click();
  await page.screenshot({ path: path.join(artifacts, 'synthetic-comparison-mobile-de-extra-large.png'), fullPage: true });
  await page.locator('#tab-overview').click();
  await page.screenshot({ path: path.join(artifacts, 'synthetic-mobile-de-extra-large.png'), fullPage: true });
  await page.locator('#tab-drivers').click();
  await page.locator('#driver-table button').first().click();
  await noPageOverflow('384 px, extra-large source dialog');
  assert.equal(await page.locator('#source-dialog').evaluate(dialog => dialog.open), true);
  assert.ok(await fontPixels('#source-text') > defaultSourceFont);
  await page.screenshot({ path: path.join(artifacts, 'synthetic-mobile-source-extra-large.png'), fullPage: true });
  await page.keyboard.press('Escape');
  pass('Responsive extra-large layout has no page overflow', '384 px viewport; all five tabs and source dialog; tables may scroll internally');

  await page.reload({ waitUntil: 'networkidle' });
  await preferences(page, 'de', 'extra-large');
  assert.equal(await page.locator('#driver-tab-count').textContent(), '0', 'Preferences persist, diagnostic data does not');
  assert.equal(await fontPixels('html'), 22);
  pass('Language and font preferences persist after reload', 'Diagnostic archive is not persisted');

  await page.evaluate(() => localStorage.setItem('lore.preferences', JSON.stringify({ language: 'invalid', fontSize: 'invalid' })));
  await page.reload({ waitUntil: 'networkidle' });
  await preferences(page, 'en', 'standard');
  await page.evaluate(() => localStorage.setItem('lore.preferences', '{invalid json'));
  await page.reload({ waitUntil: 'networkidle' });
  await preferences(page, 'en', 'standard');
  await page.locator('#archive-input').setInputFiles(demoPath);
  await page.waitForFunction(() => document.querySelector('#driver-tab-count').textContent === '3');
  pass('Invalid stored preferences recover to usable English defaults');

  // Simulate storage-denied browsers without weakening any browser protection.
  const deniedContext = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 1000 } });
  await deniedContext.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Storage denied by test fixture', 'SecurityError'); },
    });
  });
  const deniedPage = await deniedContext.newPage();
  observePage(deniedPage);
  await deniedPage.goto(`${base}/`, { waitUntil: 'networkidle' });
  await preferences(deniedPage, 'en', 'standard');
  await deniedPage.locator('#language-select').selectOption('de');
  await deniedPage.locator('#font-size-select').selectOption('large');
  await preferences(deniedPage, 'de', 'large');
  await deniedPage.locator('#archive-input').setInputFiles(demoPath);
  await deniedPage.waitForFunction(() => document.querySelector('#driver-tab-count').textContent === '3');
  assert.equal(await deniedPage.locator('#app-error').isVisible(), false);
  await deniedContext.close();
  pass('Storage denial does not prevent import or session preference changes');

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(externalRequests, []);
  pass('No page errors or unexpected external requests');
} catch (error) {
  failure = error;
  results.push({ check: 'Browser smoke', status: 'FAIL', detail: error.stack || String(error) });
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure-synthetic.png'), fullPage: true }).catch(() => {});
} finally {
  if (browser) await browser.close().catch(() => {});
  if (host.exitCode === null && !hostSpawnError) {
    const exited = once(host, 'exit');
    host.kill();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
  }
  if (host.exitCode === null && host.signalCode === null && !hostSpawnError) {
    host.kill('SIGKILL');
    failure ||= new Error('Test-owned host did not terminate normally.');
  }
  try {
    await health();
    failure ||= new Error('Test-owned host is still reachable after termination.');
  } catch { if (!failure) pass('Test-owned host closes cleanly'); }
  await writeFile(path.join(artifacts, 'host.stdout.log'), hostOutput);
  await writeFile(path.join(artifacts, 'host.stderr.log'), hostErrors);
  await writeFile(path.join(artifacts, 'browser-results.json'), JSON.stringify({ platform: process.platform, browser: 'Chromium', chromiumSandbox: true, results, pageErrors, consoleErrors, externalRequests, corporateWindows: 'NOT RUN', liveLenovoNetwork: 'NOT RUN (tested separately)' }, null, 2));
}
if (failure) throw failure;
console.log('PASS: Native browser acceptance complete. Corporate Windows remains a separate check.');
