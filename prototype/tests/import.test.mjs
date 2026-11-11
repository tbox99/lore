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
  await assert.rejects(openZip(new Blob(['no zip'])), { code: 'zip.incompleteArchive' });
  for (const name of ['../x', '/x', 'C:/x', 'a/../x', 'a\\..\\x']) await assert.rejects(openZip(new Blob([makeZip([[name, 'x']])])), { code: 'zip.unsafePath' });
  await assert.rejects(openZip(new Blob([makeZip([['a.txt', 'a'], ['A.txt', 'b']])])), { code: 'zip.duplicatePath' });
  const encrypted = makeZip([['a', 'x']]);
  encrypted.writeUInt16LE(2049, encrypted.indexOf(Buffer.from('PK\u0001\u0002')) + 8);
  await assert.rejects(openZip(new Blob([encrypted])), { code: 'zip.encrypted' });
  const zip64 = makeZip([['a', 'x']]); zip64.writeUInt16LE(65535, zip64.length - 12);
  await assert.rejects(openZip(new Blob([zip64])), { code: 'zip.zip64' });
});
test('member size, local name and checksum are checked before returning content', async () => {
  const sizeZip = await openZip(new Blob([makeZip([['a', 'hello']])]));
  await assert.rejects(sizeZip.read('a', { maxBytes: 4 }), { code: 'zip.readLimit' });
  const corrupt = makeZip([['a', 'hello']], { compress: false }); corrupt[31] ^= 1;
  const corruptZip = await openZip(new Blob([corrupt])); await assert.rejects(corruptZip.read('a'), { code: 'zip.checksum' });
  const badName = makeZip([['a', 'hello']]); badName[30] = 98;
  const badZip = await openZip(new Blob([badName])); await assert.rejects(badZip.read('a'), { code: 'zip.nameMismatch' });
});
test('UTF-16 and UTF-8 text supported; undecodable bytes remain explicitly unresolved', () => {
  assert.equal(decodeText(new Uint8Array([255, 254, 65, 0])), 'A');
  assert.equal(decodeText(new Uint8Array([254, 255, 0, 65])), 'A');
  assert.throws(() => decodeText(new Uint8Array([128, 129])), { code: 'cdat.encoding' });
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
  assert.equal(snapshot.coverage.find(row => row.labelDescriptor.key === 'coverage.quick').status, 'partial');
  assert.ok(snapshot.sources.bios.path.endsWith('QuickData-Demo.log'));
  assert.ok(snapshot.sources.bios.line > 0);
  assert.ok(!Object.keys(snapshot.texts).some(path => path.endsWith('/Example.log')));
});
test('missing driver file means uncollected, not absent drivers', async () => {
  const data = demoEntries().filter(([name]) => !name.endsWith('/Drivers.log'));
  const snapshot = await importCdat(new Blob([makeZip(data)]));
  assert.equal(snapshot.drivers.length, 0);
  assert.equal(snapshot.coverage.find(row => row.labelDescriptor.key === 'coverage.drivers').status, 'missing');
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
test('differing repeated QuickData fields preserve the preferred value and every conflicting source line', async () => {
  for (const [field, label, first, other] of [
    ['bios', 'BIOS', 'DEMOET10W (1.10)', 'DEMOET11W (1.11)'],
    ['mtm', 'MTM', '21MMDEMO00', '9999OTHER'],
    ['serial', 'SN', 'DEMO0001', 'DEMO0002'],
    ['os', 'WIN OS', 'Microsoft Windows 11 Enterprise', 'Microsoft Windows 10 Enterprise'],
    ['build', 'Build', '10.0.26100', '10.0.22631'],
    ['ec', 'EC', '1.02', '1.03'],
    ['meFirmware', 'ME FW', '18.0.0.1000', '18.0.0.1001'],
  ]) {
    const entries = demoEntries(), source = entries.find(([name]) => name.includes('-QuickData-'));
    source[1] = `${label} : ${first}\n${label} : ${other}\n`;
    const snapshot = await importCdat(new Blob([makeZip(entries)]));
    assert.equal(snapshot.device[field], first, field);
    const conflicts = snapshot.warnings.filter(row => row.kind === 'conflict' && row.messageDescriptor.key === 'warning.conflict' && row.messageDescriptor.params.field === field && row.source === source[0]);
    assert.deepEqual(conflicts.map(row => row.line).sort(), [1, 2], field);
    assert.equal(snapshot.texts[source[0]], source[1]);
  }
});
test('differing repeated ComputerInfo fields remain conflicts even when QuickData supplies the displayed value', async () => {
  for (const [field, label, first, other] of [
    ['bios', 'BiosSMBIOSBIOSVersion', 'DEMOET10W (1.10)', 'DEMOET11W (1.11)'],
    ['mtm', 'CsModel', '21MMDEMO00', '9999OTHER'],
    ['serial', 'BiosSeralNumber', 'DEMO0001', 'DEMO0002'],
    ['os', 'OsName', 'Microsoft Windows 11 Enterprise', 'Microsoft Windows 10 Enterprise'],
    ['build', 'OsVersion', '10.0.26100', '10.0.22631'],
    ['osArchitecture', 'OsArchitecture', '64-Bit', '32-Bit'],
  ]) {
    const entries = demoEntries(), source = entries.find(([name]) => name.includes('-ComputerInfo-'));
    source[1] = `${label} : ${first}\n${label} : ${other}\n`;
    const snapshot = await importCdat(new Blob([makeZip(entries)]));
    assert.equal(snapshot.device[field], first, field);
    const conflicts = snapshot.warnings.filter(row => row.kind === 'conflict' && row.messageDescriptor.params.field === field && row.source === source[0]);
    assert.deepEqual(conflicts.map(row => row.line).sort(), [1, 2], field);
  }
});
test('empty and identical field repetitions do not manufacture conflicts or hide a later usable value', async () => {
  const entries = demoEntries(), quick = entries.find(([name]) => name.includes('-QuickData-'));
  quick[1] = 'BIOS :\nBIOS : DEMOET10W (1.10)\nBIOS : DEMOET10W (1.10)\n';
  const computer = entries.find(([name]) => name.includes('-ComputerInfo-'));
  computer[1] = 'OsArchitecture :\nOsArchitecture : 64-Bit\nOsArchitecture : 64-Bit\n';
  const snapshot = await importCdat(new Blob([makeZip(entries)]));
  assert.equal(snapshot.device.bios, 'DEMOET10W (1.10)'); assert.equal(snapshot.sources.bios.line, 2);
  assert.equal(snapshot.device.osArchitecture, '64-Bit'); assert.equal(snapshot.sources.osArchitecture.line, 2);
  assert.equal(snapshot.warnings.filter(row => row.kind === 'conflict').length, 0);
});
test('long driver names with one separator still parse; nameless continuations stay unresolved', () => {
  const result = parseDrivers('DeviceName Version\n---------- -------\nA very long component name 2613.9.7.0\n     2:10.0,2:6.3\n', 'Drivers.log');
  assert.equal(result.drivers[0].version, '2613.9.7.0');
  assert.deepEqual(result.skipped, [4]);
});
test('multiple captures and unrelated archives are rejected', async () => {
  await assert.rejects(importCdat(new Blob([makeZip([['a/FileDetails.json', '{}'], ['b/FileDetails.json', '{}']])])), { code: 'cdat.multipleSources' });
  await assert.rejects(importCdat(new Blob([makeZip([['readme.txt', 'unrelated']])])), { code: 'cdat.unsupported' });
  const mixed = demoEntries().map(([name, value]) => [name.endsWith('/Drivers.log') ? name.replace('CDAT-Demo/', 'Other-device/') : name, value]);
  await assert.rejects(importCdat(new Blob([makeZip(mixed)])), { code: 'cdat.mixedRoots' });
});
