import test from 'node:test';
import assert from 'node:assert/strict';
import { lenovoUrl, fetchCatalog, fetchPackage, fetchReadme, readmePlainText } from '../web/core/lenovo.mjs';

test('Lenovo URLs accept only catalog and metadata/readme documents', () => {
  assert.equal(lenovoUrl('/catalog/21MM_Win11.xml').href, 'https://download.lenovo.com/catalog/21MM_Win11.xml');
  assert.equal(lenovoUrl('https://download.lenovo.com/pccbbs/mobiles/sample_2_.xml').pathname, '/pccbbs/mobiles/sample_2_.xml');
});

test('Lookalike hosts, credentials, executable downloads and normalized traversal are rejected', () => {
  const forbidden = [
    'https://download.lenovo.com.evil.example/pccbbs/mobiles/a.xml',
    'https://download.lenovo.com@evil.example/pccbbs/mobiles/a.xml',
    'https://user:pass@download.lenovo.com/pccbbs/mobiles/a.xml',
    'http://download.lenovo.com/pccbbs/mobiles/a.xml',
    '//evil.example/catalog/21MM_Win11.xml',
    'https://127.0.0.1/pccbbs/mobiles/a.xml',
    '/pccbbs/mobiles/a.exe',
    '/pccbbs/mobiles/../mobiles/a.xml',
    '/pccbbs/mobiles/%2e%2e/mobiles/a.xml',
    '/pccbbs/mobiles/a.xml?next=https://evil.example',
    '/pccbbs/mobiles/a.xml#fragment',
    '/catalog/../catalog/21MM_Win11.xml',
    '/catalog/21MM_Win11.xml\\evil',
    '/catalog/21MM_Win11.xml\n',
  ];
  for (const url of forbidden) assert.throws(() => lenovoUrl(url), undefined, url);
});

test('Invalid MTM, OS and document types never trigger a request', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('unexpected request'); });
  await assert.rejects(fetchCatalog('21MMFULL', 'Win11'));
  await assert.rejects(fetchCatalog('21MM', 'Linux'));
  await assert.rejects(fetchPackage({ url: '/pccbbs/mobiles/a.html' }));
  await assert.rejects(fetchReadme('/pccbbs/mobiles/a.xml'));
  assert.equal(calls, 0);
});

test('Proxy HTTP failures remain failures instead of empty current catalog', async (t) => {
  let captured;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ error: 'Upstream HTTP 403' }), { status: 502 });
  });
  await assert.rejects(fetchCatalog('21mm', 'Win11'), /Upstream HTTP 403/);
  assert.equal(captured.url, '/api/lenovo?path=%2Fcatalog%2F21MM_Win11.xml');
  assert.equal(captured.options.headers['X-LORE-Request'], '1');
  assert.equal(captured.options.cache, 'no-store');
});

test('HTML gateway errors are reported as invalid local service responses', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Proxy sign-in</html>', { status: 502 }));
  await assert.rejects(fetchCatalog('21MM', 'Win11'), /erwarteten Format \(HTTP 502\)/);
});

test('Returned upstream identity and required metadata are validated', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    url: 'https://evil.example/readme.txt', retrievedAt: new Date().toISOString(), text: 'not Lenovo',
  })));
  await assert.rejects(fetchReadme('/pccbbs/mobiles/a.txt'), /nicht freigegeben/);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    url: 'https://download.lenovo.com/pccbbs/mobiles/a.txt', text: 'missing retrieval time',
  })));
  await assert.rejects(fetchReadme('/pccbbs/mobiles/a.txt'), /unvollständige Metadaten/);
});

test('A plain-text readme retains provenance and is never treated as HTML', async (t) => {
  const retrievedAt = '2026-11-11T10:00:00Z';
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    url: 'https://download.lenovo.com/pccbbs/mobiles/a.txt', retrievedAt,
    text: '\uFEFF  <script>not executed; literal text</script>\nPrerequisite: BIOS 1.17  ',
  })));
  const result = await fetchReadme('/pccbbs/mobiles/a.txt');
  assert.equal(result.sourceUrl, 'https://download.lenovo.com/pccbbs/mobiles/a.txt');
  assert.equal(result.retrievedAt, retrievedAt);
  assert.match(result.text, /^<script>not executed; literal text<\/script>/);
  assert.equal(readmePlainText('  version 1.2  ', false), 'version 1.2');
});

test('A cancelled selection preserves AbortError for UI stale-request handling', async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, 'fetch', async (_, { signal }) => {
    assert.equal(signal.aborted, true);
    throw new DOMException('Aborted', 'AbortError');
  });
  await assert.rejects(fetchCatalog('21MM', 'Win11', { signal: controller.signal }), { name: 'AbortError' });
});
