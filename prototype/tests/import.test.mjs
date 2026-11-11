import test from 'node:test';
import assert from 'node:assert/strict';
import { openZip, crc32 } from '../web/core/zip.mjs';
import { importCdat, decodeText, parseDrivers } from '../web/core/cdat.mjs';
import { makeZip, demoEntries } from './fixtures.mjs';

test('ZIP reads stored and deflated entries and validates independent CRC', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  for (const compress of [true, false]) {
    const zip = await openZip(new Blob([makeZip([['a.txt', 'Hallo äöü']], { compress })]));
    assert.equal(decodeText(await zip.read('a.txt')), 'Hallo äöü');
  }
});
test('invalid, traversal, duplicate, encrypted and ZIP64 archives fail clearly', async () => {
  await assert.rejects(openZip(new Blob(['no zip'])), /vollständiges ZIP/);
  for (const name of ['../x', '/x', 'C:/x', 'a/../x', 'a\\..\\x']) await assert.rejects(openZip(new Blob([makeZip([[name, 'x']])])), /Dateipfad/);
  await assert.rejects(openZip(new Blob([makeZip([['a.txt', 'a'], ['A.txt', 'b']])])), /doppelte/);
  const encrypted = makeZip([['a', 'x']]);
  encrypted.writeUInt16LE(2049, encrypted.indexOf(Buffer.from('PK\u0001\u0002')) + 8);
  await assert.rejects(openZip(new Blob([encrypted])), /Verschlüsselte/);
  const zip64 = makeZip([['a', 'x']]); zip64.writeUInt16LE(65535, zip64.length - 12);
  await assert.rejects(openZip(new Blob([zip64])), /ZIP64/);
});
test('member size, local name and checksum are checked before returning content', async () => {
  const sizeZip = await openZip(new Blob([makeZip([['a', 'hello']])]));
  await assert.rejects(sizeZip.read('a', { maxBytes: 4 }), /Leselimit/);
  const corrupt = makeZip([['a', 'hello']], { compress: false }); corrupt[31] ^= 1;
  const corruptZip = await openZip(new Blob([corrupt])); await assert.rejects(corruptZip.read('a'), /Prüfsumme/);
  const badName = makeZip([['a', 'hello']]); badName[30] = 98;
  const badZip = await openZip(new Blob([badName])); await assert.rejects(badZip.read('a'), /Dateinamen/);
});
test('UTF-16 and UTF-8 text supported; undecodable bytes remain explicitly unresolved', () => {
  assert.equal(decodeText(new Uint8Array([255, 254, 65, 0])), 'A');
  assert.equal(decodeText(new Uint8Array([254, 255, 0, 65])), 'A');
  assert.throws(() => decodeText(new Uint8Array([128, 129])), /Textkodierung/);
});
test('CDAT import distinguishes observed drivers, stored packages and failed collection', async () => {
  const snapshot = await importCdat(new File([makeZip(demoEntries())], 'demo.zip'));
  assert.equal(snapshot.device.mtm, '21MMDEMO00');
  assert.equal(snapshot.device.bios, 'DEMOET10W (1.10)');
  assert.equal(snapshot.device.os, 'Microsoft Windows 11 Enterprise');
  assert.equal(snapshot.drivers.length, 3);
  assert.equal(snapshot.drivers[0].version, '24.50.0.4');
  assert.ok(!snapshot.drivers.some(row => row.version === '23.80.0.7'));
  assert.equal(snapshot.warnings.filter(row => row.kind === 'collection').length, 1);
  assert.equal(snapshot.coverage.find(row => row.label === 'Geräteübersicht').status, 'partial');
  assert.ok(snapshot.sources.bios.path.endsWith('QuickData-Demo.log'));
  assert.ok(snapshot.sources.bios.line > 0);
  assert.ok(!Object.keys(snapshot.texts).some(path => path.endsWith('/Example.log')));
});
test('missing driver file means uncollected, not absent drivers', async () => {
  const data = demoEntries().filter(([name]) => !name.endsWith('/Drivers.log'));
  const snapshot = await importCdat(new Blob([makeZip(data)]));
  assert.equal(snapshot.drivers.length, 0);
  assert.equal(snapshot.coverage.find(row => row.label === 'Gemeldete Gerätetreiber').status, 'missing');
});
test('malformed manifest and conflicting identity remain visible without hiding other evidence', async () => {
  const data = demoEntries(); data[0][1] = '{invalid';
  const partial = await importCdat(new Blob([makeZip(data)]));
  assert.equal(partial.device.mtm, '21MMDEMO00');
  assert.equal(partial.coverage[0].status, 'failed');
  data[0][1] = JSON.stringify({ Mtm: '9999OTHER', Sn: 'DEMO0001', Files: [] });
  const conflict = await importCdat(new Blob([makeZip(data)]));
  assert.equal(conflict.device.mtm, '9999OTHER');
  assert.ok(conflict.warnings.some(row => row.kind === 'conflict'));
});
test('long driver names with one separator still parse; nameless continuations stay unresolved', () => {
  const result = parseDrivers('DeviceName Version\n---------- -------\nA very long component name 2613.9.7.0\n     2:10.0,2:6.3\n', 'Drivers.log');
  assert.equal(result.drivers[0].version, '2613.9.7.0');
  assert.deepEqual(result.skipped, [4]);
});
test('multiple captures and unrelated archives are rejected', async () => {
  await assert.rejects(importCdat(new Blob([makeZip([['a/FileDetails.json', '{}'], ['b/FileDetails.json', '{}']])])), /Mehrere Quellen/);
  await assert.rejects(importCdat(new Blob([makeZip([['readme.txt', 'unrelated']])])), /Keine unterstützte CDAT/);
  const mixed = demoEntries().map(([name, value]) => [name.endsWith('/Drivers.log') ? name.replace('CDAT-Demo/', 'Other-device/') : name, value]);
  await assert.rejects(importCdat(new Blob([makeZip(mixed)])), /verschiedenen Aufnahmeordnern/);
});
