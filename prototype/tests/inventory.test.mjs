import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInventory, parsePnpTable, parseInfBindings, parseDriverStore, parseWlanReport, parseBluetoothReport } from '../web/core/inventory.mjs';
import { importCdat } from '../web/core/cdat.mjs';
import { makeZip, demoEntries } from './fixtures.mjs';

const wifiId = 'PCI\\VEN_8086&DEV_1234&SUBSYS_00008086&REV_01\\DEMO';
const btId = 'USB\\VID_8087&PID_9999\\DEMO';
const wifiName = 'Demo Wi-Fi Adapter', btName = 'Demo Bluetooth Adapter';
const table = rows => ['Status'.padEnd(10) + 'FriendlyName'.padEnd(40) + 'InstanceId', '------'.padEnd(10) + '------------'.padEnd(40) + '----------', ...rows.map(([status, name, id]) => status.padEnd(10) + name.padEnd(40) + id)].join('\n');
const bindings = rows => rows.map(([id, inf]) => `Current Device ID is ${id}\nCurrent INF file is \\\\HOST\\ROOT\\cimv2:CIM_DataFile.Name="c:\\\\windows\\\\inf\\\\${inf}"\nInstallation date is: 01.01.2026`).join('\n');
const store = rows => ['Published Name | Original File Name | Inbox | Class Name | Provider Name | Date | Version', ...rows.map(([inf, original, cls, version]) => `${inf} | ${original} | No | ${cls} | Demo Provider | 01.01.2026 | ${version}`)].join('\n');
function documents() {
  return [
    { kind: 'hardware', path: 'Installed-HWD/InstalledHardwareList.log', text: table([['OK', wifiName, wifiId], ['OK', btName, btId]]) },
    { kind: 'bindings', path: 'Installed-HWD/DriversINFInstallDate.log', text: bindings([[wifiId, 'oem10.inf'], [btId, 'oem11.inf']]) },
    { kind: 'store', path: 'Installed-HWD/Driver3rdPartyOEMINF.log', text: store([['oem10.inf', 'netdemo.inf', 'net', '24.50.0.4'], ['oem11.inf', 'btdemo.inf', 'Bluetooth', '24.40.10.3'], ['oem12.inf', 'netdemo.inf', 'net', '99.99.99.99']]) },
    { kind: 'wlan', path: 'Network/WLANnetsh.log', text: `Driver : ${wifiName}\nProvider : Demo\nVersion : 24.50.0.4\nInf file : oem10.inf\n` },
    { kind: 'bluetooth', path: 'Network/BluetoothSystemReport.log', text: `Device : ${btName}\nDriver : 24.40.10.3\n\n${table([['OK', btName, btId]])}\n` },
  ];
}
const reported = [{ name: wifiName, version: '24.50.0.4', source: 'Drivers.log', line: 3 }, { name: btName, version: '24.40.10.3', source: 'Drivers.log', line: 4 }];
const radio = (data, kind = 'wlan') => data.devices.find(row => row.kind === kind);

test('exact reported device-INF-store-radio chain resolves both radios without promoting retained packages', () => {
  const docs = documents(), before = structuredClone(docs), data = buildInventory(docs, reported);
  assert.deepEqual(docs, before);
  assert.equal(data.devices.length, 2); assert.equal(data.driverStore.length, 3);
  for (const kind of ['wlan', 'bluetooth']) {
    const row = radio(data, kind);
    assert.equal(row.binding, 'device-inf'); assert.equal(row.presence, 'reported'); assert.equal(row.corroboration, 'radio-report'); assert.deepEqual(row.issues, []);
    assert.deepEqual(row.hardwareIds, []); assert.equal(row.derivedHardwareIds.length, 1);
    assert.ok(row.sources.some(s => s.path.endsWith('DriversINFInstallDate.log') && s.line > 0));
    assert.ok(row.sources.some(s => s.path.endsWith('Driver3rdPartyOEMINF.log') && s.line > 0));
  }
  assert.equal(radio(data).version, '24.50.0.4'); assert.equal(radio(data).originalInf, 'netdemo.inf');
  assert.ok(!data.devices.some(row => row.version === '99.99.99.99'));
});

test('wrapped PnP identifiers are reconstructed only within explicit fixed columns; truncated IDs stay unresolved', () => {
  const head = table([]);
  const result = parsePnpTable(head + '\n' + 'OK'.padEnd(10) + wifiName.padEnd(40) + 'PCI\\VEN_8086&DEV_1234&\n' + ''.padEnd(50) + 'SUBSYS_00008086&REV_01\\DEMO\n' + 'Unknown'.padEnd(10) + btName.padEnd(40) + 'USB\\VID_8087...\n', 'pnp.log');
  assert.equal(result.records[0].instanceId, wifiId); assert.deepEqual(result.records[0].sources.map(s => s.line), [3, 4]);
  assert.equal(result.status, 'partial'); assert.ok(result.records[1].issues.includes('invalid-instance'));
});

test('missing bindings or store metadata cannot establish current driver versions', () => {
  for (const kind of ['bindings', 'store']) {
    const docs = documents().filter(doc => doc.kind !== kind);
    const data = buildInventory(docs, reported);
    assert.ok(data.devices.every(row => row.binding === 'unresolved' && row.presence === 'unknown'));
    assert.equal(data.coverage.find(item => item.kind === kind).status, 'missing');
  }
  const onlyStore = buildInventory(documents().filter(doc => doc.kind === 'store'));
  assert.equal(onlyStore.devices.length, 0);
});

test('reported status is not present-only evidence; unknown status and missing radio report do not become active radios', () => {
  const docs = documents(); docs[0].text = table([['Unknown', wifiName, wifiId], ['OK', btName, btId]]);
  const data = buildInventory(docs, reported);
  assert.equal(radio(data).presence, 'unknown'); assert.equal(radio(data).binding, 'unresolved');
  assert.ok(radio(data).issues.includes('radio-status-unknown'));
  const noRadio = buildInventory(documents().filter(doc => !['wlan', 'bluetooth'].includes(doc.kind)), reported);
  assert.ok(noRadio.devices.every(row => row.presence === 'unknown' && row.corroboration === null && row.kind === null));
});

test('duplicate instances, bindings and OEM store names remain ambiguous even when versions agree', () => {
  for (const kind of ['hardware', 'bindings', 'store']) {
    const docs = documents(), doc = docs.find(d => d.kind === kind);
    if (kind === 'hardware') doc.text = table([['OK', wifiName, wifiId], ['OK', wifiName, wifiId], ['OK', btName, btId]]);
    if (kind === 'bindings') doc.text += '\n' + bindings([[wifiId, 'oem10.inf']]);
    if (kind === 'store') doc.text += '\noem10.inf | netdemo.inf | No | net | Demo | date | 24.50.0.4';
    const row = buildInventory(docs, reported).devices.find(d => d.instanceId === wifiId);
    assert.equal(row.binding, 'unresolved', kind); assert.equal(row.presence, 'unknown', kind); assert.ok(row.issues.some(s => s.startsWith('ambiguous-')), kind);
  }
});

test('version conflicts across inventory and radio sources block the radio assessment', () => {
  for (const origin of ['reported', 'radio']) {
    const docs = documents(), rows = structuredClone(reported);
    if (origin === 'reported') rows[0].version = '24.60.0.1';
    else docs.find(d => d.kind === 'wlan').text = docs.find(d => d.kind === 'wlan').text.replace('24.50.0.4', '24.60.0.1');
    const row = radio(buildInventory(docs, rows)); assert.equal(row.binding, 'unresolved'); assert.equal(row.presence, 'unknown'); assert.ok(row.issues.some(s => s.includes('conflicting')));
  }
});

test('WLAN report accepts observed English and German keys; unrelated partial radio lines do not manufacture identity', () => {
  const english = parseWlanReport(documents()[3].text, 'wlan.log');
  const german = parseWlanReport(`Treiber : ${wifiName}\nAnbieter : Demo\nVersion : 24.50.0.4\nINF-Datei : oem10.inf\n`, 'wlan.log');
  assert.deepEqual(german.records, english.records);
  const partial = parseWlanReport('Driver : Demo\nVersion : unknown\n', 'wlan.log');
  assert.equal(partial.status, 'partial'); assert.ok(partial.records[0].issues.length);
  assert.equal(parseBluetoothReport('Device : Peripheral\nDriver : 1.2.3.4\n\n' + table([['OK', 'Peripheral', 'BTHENUM\\DEV_DEMO\\DEMO']]), 'bt.log').records[0].instanceId, null);
});

test('damaged duplicate store or radio rows do not disappear and permit a false confident match', () => {
  let docs = documents(); docs[2].text += '\noem10.inf | netdemo.inf | No | net | Demo | date | broken';
  let row = radio(buildInventory(docs, reported)); assert.equal(row.binding, 'unresolved'); assert.ok(row.issues.includes('ambiguous-store'));
  docs = documents(); docs[3].text += '\nDriver : Demo Wi-Fi Adapter\nVersion : broken\nInf file : oem10.inf\n';
  row = radio(buildInventory(docs, reported)); assert.equal(row.binding, 'unresolved'); assert.equal(row.presence, 'unknown');
  assert.equal(parseInfBindings('Current INF file is C:\\Windows\\INF\\oem10.inf', 'bindings.log').status, 'failed');
  assert.equal(parseDriverStore('Unknown localized format', 'store.log').status, 'failed');
});

test('radio collection failures and conflicting Bluetooth summary versions block confidence', () => {
  let docs = documents(); docs[3].text += '\nFullyQualifiedErrorId : Demo.QueryFailed';
  let row = radio(buildInventory(docs, reported)); assert.equal(row.binding, 'unresolved'); assert.ok(row.issues.includes('source-collection-failure'));
  docs = documents(); docs[4].text = docs[4].text.replace('Driver : 24.40.10.3', 'Driver : 24.50.0.1\nDriver : 24.40.10.3');
  row = radio(buildInventory(docs, reported), 'bluetooth'); assert.equal(row.binding, 'unresolved'); assert.ok(row.issues.includes('conflicting-radio-report'));
});

test('CDAT integration reads only bounded selected inventory files, preserves source locators and architecture', async () => {
  const entries = demoEntries().filter(([path]) => !path.endsWith('Driver3rdPartyOEMINF.log'));
  for (const doc of documents()) entries.push(['CDAT-Demo/' + doc.path, doc.text]);
  entries.push(['CDAT-Demo/Installed-HWD/HKLMSYSTEMCurrentControlSetreg.log', 'never automatically load']);
  const computer = entries.find(([name]) => name.includes('-ComputerInfo-')); computer[1] = 'OsArchitecture : 64-Bit\n';
  const snapshot = await importCdat(new File([makeZip(entries)], 'synthetic.zip'));
  assert.equal(snapshot.device.osArchitecture, '64-Bit'); assert.equal(snapshot.sources.osArchitecture.line, 1);
  assert.equal(radio(snapshot.inventory).binding, 'device-inf');
  assert.ok(snapshot.texts[radio(snapshot.inventory).sources[0].path]);
  assert.ok(!Object.keys(snapshot.texts).some(path => path.endsWith('HKLMSYSTEMCurrentControlSetreg.log')));
  assert.equal(snapshot.coverage.find(c => c.labelDescriptor.key === 'coverage.bindings').status, 'read');
});

test('new inventory sources cannot mix capture roots or exceed the one-MiB source cap', async () => {
  const entries = demoEntries(); entries.push(['Other-capture/Network/WLANnetsh.log', documents()[3].text]);
  await assert.rejects(importCdat(new Blob([makeZip(entries)])), { code: 'cdat.mixedRoots' });
  const large = demoEntries(); large.push(['CDAT-Demo/Network/WLANnetsh.log', 'x'.repeat(1024 ** 2 + 1)]);
  const snapshot = await importCdat(new Blob([makeZip(large)]));
  assert.equal(snapshot.inventory.coverage.find(c => c.kind === 'wlan').status, 'failed');
  assert.ok(!Object.keys(snapshot.texts).some(path => path.endsWith('WLANnetsh.log')));
});
