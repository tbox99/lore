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
let hostOutput = '', hostErrors = '', hostSpawnError = null;
let browser = null, page = null, failure = null;

function pass(check, detail = null) {
  results.push({ check, status: 'PASS', detail });
  console.log(`PASS: ${check}${detail ? ` — ${detail}` : ''}`);
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

try {
  const hostHealth = await waitForHost();
  pass('Actual platform host starts', JSON.stringify(hostHealth));

  // No launch arguments or protection overrides: sandbox remains enabled.
  browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) consoleErrors.push(message.text());
  });
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(`${base}/`)) externalRequests.push(request.url());
  });
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#browser-warning').isVisible(), false);
  pass('Native browser starts with ZIP capability');

  const demoPath = path.join(prototype, 'web', 'demo-cdat.zip');
  await page.locator('#archive-input').setInputFiles(demoPath);
  await page.waitForFunction(() => document.querySelector('#driver-tab-count').textContent === '3' && document.querySelector('#file-tab-count').textContent === '7');
  assert.match(await page.locator('#capture-title').textContent(), /ThinkPad Demo/);
  assert.equal(await page.locator('#app-error').isVisible(), false);
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
  assert.match(await page.locator('#source-detail').textContent(), /Zeile/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#source-dialog').evaluate(dialog => dialog.open), false);
  assert.equal(await sourceButton.evaluate(button => document.activeElement === button), true);
  pass('Keyboard tabs, filtering and native source dialog', 'Escape closes; focus returns to source button');

  await page.locator('#tab-files').click();
  await page.locator('#file-search').fill('Drivers.log');
  assert.equal(await page.locator('#file-table tr').count(), 1);
  pass('Archive file filter');

  await page.locator('#archive-input').setInputFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('This is not a ZIP archive.') });
  await page.locator('#app-error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#driver-tab-count').textContent(), '0');
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
  await page.locator('#package-links button').click();
  await page.waitForFunction(() => document.querySelector('#source-dialog').open && document.querySelector('#source-kind').textContent === 'LENOVO README');
  assert.match(await page.locator('#source-text').textContent(), /Install prerequisite first\./);
  assert.doesNotMatch(await page.locator('#source-text').textContent(), /__smokePayload/);
  assert.equal(await page.locator('#source-text script, #source-text iframe').count(), 0);
  assert.equal(await page.evaluate(() => window.__smokePayload), undefined);
  await page.screenshot({ path: path.join(artifacts, 'synthetic-readme.png'), fullPage: true });
  await page.keyboard.press('Escape');
  pass('Catalog, package metadata and safe readme display', 'Controlled synthetic upstream fixture');

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
