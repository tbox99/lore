import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots } from '../web/core/compare.mjs';
import { importCdat } from '../web/core/cdat.mjs';
import { demoEntries, makeZip } from './fixtures.mjs';

function editText(entries, edit) {
  return entries.map(([path, content]) => {
    const utf16 = Buffer.isBuffer(content) && content[0] === 255 && content[1] === 254;
    const text = utf16 ? content.subarray(2).toString('utf16le') : String(content);
    const changed = edit(text, path);
    return [path, utf16 ? Buffer.concat([Buffer.from([255, 254]), Buffer.from(changed, 'utf16le')]) : changed];
  });
}
async function capture(entries = demoEntries()) { return importCdat(new File([makeZip(entries)], 'synthetic.zip')); }
function field(result, key) { return result.platformRows.find(row => row.field === key); }
function driver(result, name = 'Demo Wi-Fi Adapter') { return result.driverRows.find(row => row.name?.toLowerCase() === name.toLowerCase()); }
function inventory(result) { return result.driverRows.find(row => row.summary); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('identical real imports compare reported values without mutation or chronology assumptions', async () => {
  const a = freeze(await capture()), b = freeze(await capture());
  const beforeA = JSON.stringify(a), beforeB = JSON.stringify(b);
  const result = compareSnapshots(a, b);
  assert.equal(result.identity, 'same-device');
  assert.deepEqual(result.counts, { same: 8, different: 0, onlyA: 0, onlyB: 0, unresolved: 0 });
  assert.deepEqual(result.platformRows.map(row => row.field), ['bios', 'ec', 'meFirmware', 'os', 'build']);
  assert.equal(field(result, 'bios').a.coverage, 'partial', 'An unrelated failed query does not erase a recovered BIOS value');
  for (const row of result.driverRows) assert.equal(row.matchBasis, 'name-only');
  assert.equal(driver(result).a.sources[0].line, 3);
  assert.equal(JSON.stringify(a), beforeA);
  assert.equal(JSON.stringify(b), beforeB);
});

test('known BIOS and driver version differences retain both sources and only-listed rows', async () => {
  const a = await capture();
  const changed = editText(demoEntries(), (text, path) => {
    text = text.replaceAll('DEMOET10W (1.10)', 'DEMOET11W (1.11)').replaceAll('24.50.0.4', '24.60.1.2');
    return path.endsWith('/Drivers.log') ? text + 'Demo Optional Device       1.0.0\r\n' : text;
  });
  const b = await capture(changed), result = compareSnapshots(a, b);
  assert.deepEqual(result.counts, { same: 6, different: 2, onlyA: 0, onlyB: 1, unresolved: 0 });
  assert.equal(field(result, 'bios').status, 'different');
  assert.equal(driver(result).status, 'different');
  assert.equal(driver(result).a.value, '24.50.0.4');
  assert.equal(driver(result).b.value, '24.60.1.2');
  assert.deepEqual(driver(result).b.sources, [{ path: 'CDAT-Demo/Installed-HWD/Drivers.log', line: 3 }]);
  assert.equal(driver(result, 'Demo Optional Device').status, 'onlyB');
  assert.equal(driver(result, 'Demo Optional Device').reason, 'driver_onlyB');
  assert.equal(driver(result, 'Demo Optional Device').matchBasis, 'none');
  const swapped = compareSnapshots(b, a);
  assert.equal(swapped.counts.onlyA, 1);
  assert.equal(swapped.counts.onlyB, 0);
  assert.deepEqual(result.driverRows.map(row => row.id), swapped.driverRows.map(row => row.id));
  assert.deepEqual(driver(swapped).a, driver(result).b);
  assert.deepEqual(driver(swapped).b, driver(result).a);
});

test('all platform fields compare text without vendor-specific version ordering', async () => {
  const a = await capture();
  const b = await capture(editText(demoEntries(), text => text.replaceAll('1.02', '1.03')
    .replaceAll('18.0.0.1000', '18.0.1.1000').replaceAll('Microsoft Windows 11 Enterprise', 'Microsoft Windows 11 Pro')
    .replaceAll('10.0.26100', '10.0.26200')));
  const result = compareSnapshots(a, b);
  assert.equal(result.counts.different, 4);
  for (const key of ['ec', 'meFirmware', 'os', 'build']) assert.equal(field(result, key).status, 'different');
  assert.equal(field(result, 'bios').status, 'same');
  for (const value of ['024.50.0.4', '24.50.0.4a', '24.50.0.4A']) {
    const changed = await capture(editText(demoEntries(), text => text.replaceAll('24.50.0.4', value)));
    assert.equal(driver(compareSnapshots(a, changed)).status, 'different');
  }
  const lower = await capture(editText(demoEntries(), text => text.replaceAll('24.50.0.4', '1.0a')));
  const upper = await capture(editText(demoEntries(), text => text.replaceAll('24.50.0.4', '1.0A')));
  assert.equal(driver(compareSnapshots(lower, upper)).status, 'different');
});

test('missing and failed driver sources never become removed devices or an empty clean result', async () => {
  const a = await capture();
  const missing = await capture(demoEntries().filter(([path]) => !path.endsWith('/Drivers.log')));
  const failed = await capture(demoEntries().map(([path, text]) => [path, path.endsWith('/Drivers.log') ? '' : text]));
  for (const b of [missing, failed]) {
    const result = compareSnapshots(a, b);
    assert.deepEqual(result.counts, { same: 5, different: 0, onlyA: 0, onlyB: 0, unresolved: 4 });
    assert.equal(inventory(result).reason, 'driver_inventory_incomplete');
    assert.equal(driver(result).reason, 'driver_incomplete');
    assert.equal(driver(compareSnapshots(b, a)).reason, 'driver_incomplete');
  }
  const both = compareSnapshots(missing, failed);
  assert.equal(both.driverRows.length, 1);
  assert.equal(both.driverRows[0].summary, true);
  assert.equal(both.counts.unresolved, 1);
});

test('partial driver sources compare recovered pairs but cannot establish unmatched-row absence', async () => {
  const a = await capture();
  const entries = editText(demoEntries(), (text, path) => path.endsWith('/Drivers.log')
    ? text.replace(/^Demo Audio Adapter.*\r\n/m, '') + '  2:10.0,2:6.3\r\n' : text);
  const b = await capture(entries);
  const result = compareSnapshots(a, b);
  assert.deepEqual(result.counts, { same: 7, different: 0, onlyA: 0, onlyB: 0, unresolved: 2 });
  assert.equal(driver(result).status, 'same');
  assert.equal(driver(result, 'Demo Audio Adapter').status, 'unresolved');
  assert.equal(inventory(result).b.coverage, 'partial');
  const samePartial = compareSnapshots(b, b);
  assert.equal(samePartial.counts.different + samePartial.counts.onlyA + samePartial.counts.onlyB, 0);
  assert.equal(samePartial.counts.unresolved, 1);
});

test('duplicate driver labels remain ambiguous even when versions agree and preserve every row', async () => {
  const a = await capture();
  for (const version of ['24.50.0.4', '24.60.1.2']) {
    const b = await capture(editText(demoEntries(), (text, path) => path.endsWith('/Drivers.log')
      ? text + `Demo Wi-Fi Adapter     ${version}\r\n` : text));
    for (const result of [compareSnapshots(a, b), compareSnapshots(b, a), compareSnapshots(b, b)]) {
      const row = driver(result);
      assert.equal(row.status, 'unresolved');
      assert.equal(row.reason, 'driver_duplicate');
      assert.equal(row.matchBasis, 'ambiguous');
      assert.ok(row.a.records.length === 2 || row.b.records.length === 2);
      const doubled = row.a.records.length === 2 ? row.a : row.b;
      assert.deepEqual(doubled.records.map(record => record.version), ['24.50.0.4', version]);
      assert.deepEqual(doubled.sources.map(source => source.line), [3, 6]);
    }
  }
});

test('missing or placeholder platform evidence is unresolved rather than an equality or difference', async () => {
  const a = await capture();
  for (const value of ['N/A', 'Unknown', '—', 'Nicht ermittelt']) {
    const b = await capture(editText(demoEntries(), text => text.replaceAll('DEMOET10W (1.10)', value)));
    for (const result of [compareSnapshots(a, b), compareSnapshots(b, b)]) {
      assert.equal(field(result, 'bios').status, 'unresolved');
      assert.equal(field(result, 'bios').reason, 'platform_missing');
      assert.equal(field(result, 'bios').b.value, null);
    }
  }
  const missing = await capture(editText(demoEntries(), text => text.replace(/^BIOS\s*:.*(?:\r\n|\n|$)/m, '')
    .replace(/^BiosSMBIOSBIOSVersion\s*:.*(?:\r\n|\n|$)/m, '')));
  assert.equal(field(compareSnapshots(a, missing), 'bios').status, 'unresolved');
});

test('conflicting field evidence stays unresolved with both original source locators', async () => {
  const entries = editText(demoEntries(), (text, path) => path.includes('ComputerInfo')
    ? text.replace('DEMOET10W (1.10)', 'CONFLICT (2.0)') : text);
  const conflicted = await capture(entries), clean = await capture();
  for (const result of [compareSnapshots(clean, conflicted), compareSnapshots(conflicted, conflicted)]) {
    const row = field(result, 'bios');
    assert.equal(row.status, 'unresolved');
    assert.equal(row.reason, 'platform_conflict');
    assert.equal(row.b.conflict, true);
    assert.deepEqual(row.b.sources, [
      { path: 'CDAT-Demo/CDAT1.26-QuickData-Demo.log', line: 5 },
      { path: 'CDAT-Demo/CDAT1.26-ComputerInfo-Demo.log', line: 3 },
    ]);
    assert.equal(row.b.value, 'DEMOET10W (1.10)');
  }
});

test('capture time, filenames, source line offsets and row order do not create semantic differences', async () => {
  const a = await capture();
  let entries = editText(demoEntries(), (text, path) => {
    text = text.replaceAll('11.11.2026 10:00:00', '12.11.2026 09:00:00');
    if (path.endsWith('/Drivers.log')) {
      const [heading, divider, ...rows] = text.trimEnd().split('\r\n');
      return `${heading}\r\n${divider}\r\n${rows.reverse().join('\r\n')}\r\n`;
    }
    return path.endsWith('.log') ? `\r\n${text}` : text;
  }).map(([path, text]) => [path.replace('CDAT-Demo/', 'Other-capture/'), text]);
  const b = await capture(entries), result = compareSnapshots(a, b);
  assert.deepEqual(result.counts, { same: 8, different: 0, onlyA: 0, onlyB: 0, unresolved: 0 });
  assert.notDeepEqual(field(result, 'bios').a.sources, field(result, 'bios').b.sources);
  assert.notEqual(a.device.capturedAt, b.device.capturedAt);
});

test('serial evidence distinguishes reported same device, different devices and uncertain identity', async () => {
  const a = await capture();
  const serial = async value => capture(editText(demoEntries(), text => text.replaceAll('DEMO0001', value)));
  assert.equal(compareSnapshots(a, await serial('demo0001')).identity, 'same-device');
  assert.equal(compareSnapshots(a, await serial('DEMO0002')).identity, 'different-devices');
  for (const placeholder of ['Unknown', 'N/A', '00000000', 'FFFFFFFF', 'To be filled by O.E.M.', 'System Serial Number']) {
    assert.equal(compareSnapshots(a, await serial(placeholder)).identity, 'unknown', placeholder);
  }
  const conflictedSerial = await capture(editText(demoEntries(), (text, path) => path.includes('QuickData')
    ? text.replaceAll('DEMO0001', 'DEMO0002') : text));
  assert.equal(compareSnapshots(a, conflictedSerial).identity, 'unknown');
  const otherMtm = await capture(editText(demoEntries(), text => text.replaceAll('21MMDEMO00', '9999OTHER')));
  assert.equal(compareSnapshots(a, otherMtm).identity, 'unknown');
  const conflictedMtm = await capture(editText(demoEntries(), (text, path) => path.includes('QuickData')
    ? text.replaceAll('21MMDEMO00', '9999OTHER') : text));
  assert.equal(compareSnapshots(a, conflictedMtm).identity, 'unknown');
});

test('case and spacing normalization applies only to driver labels, retaining raw labels and versions', async () => {
  const a = await capture();
  const b = await capture(editText(demoEntries(), text => text.replaceAll('Demo Wi-Fi Adapter', 'demo  wi-fi   adapter')));
  const result = compareSnapshots(a, b), row = driver(result);
  assert.equal(row.status, 'same');
  assert.equal(row.matchBasis, 'name-only');
  assert.equal(row.b.records[0].name, 'demo  wi-fi   adapter');
  assert.deepEqual(result.counts, { same: 8, different: 0, onlyA: 0, onlyB: 0, unresolved: 0 });
});

test('inventory summary and a real Inventory label have distinct stable IDs', async () => {
  const a = await capture(editText(demoEntries(), (text, path) => path.endsWith('/Drivers.log')
    ? text + 'Inventory  1.0\r\n  2:10.0,2:6.3\r\n' : text));
  const result = compareSnapshots(a, a);
  const ids = result.driverRows.map(row => row.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(inventory(result).id, 'inventory:drivers');
  assert.equal(driver(result, 'Inventory').status, 'same');
});
