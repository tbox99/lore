import test from 'node:test';
import assert from 'node:assert/strict';
import { compareNumericVersions, identifyCapture, packageKind, matchHardware, evaluateRule, assessPackage, checkUpdates } from '../web/core/updates.mjs';

const hw = 'PCI\\VEN_1234&DEV_5678&SUBSYS_11112222';
const source = { url: 'https://download.lenovo.com/pccbbs/mobiles/synthetic.xml', locator: '/Package/Dependencies' };
function leaf(tag, values = {}, value = '') {
  return { kind: 'leaf', tag, attributes: {}, value, fields: Object.entries(values).flatMap(([name, items]) => [].concat(items).map(item => ({ tag: name, value: item, source }))), children: [], source };
}
const all = (...children) => ({ kind: 'and', tag: 'And', children });
const any = (...children) => ({ kind: 'or', tag: 'Or', children });
function capture() {
  return { device: { mtm: '21MMDEMO00', os: 'Microsoft Windows 11 Enterprise', osArchitecture: '64-Bit', build: '10.0.26100', bios: 'N99ET10W (1.10)' },
    sources: { bios: { path: 'Demo/QuickData.log', line: 5 } }, warnings: [], inventory: { devices: [{
      kind: 'wlan', name: 'Synthetic radio', instanceId: hw + '\\INSTANCE', hardwareIds: [hw], derivedHardwareIds: [], version: '24.9.0.4',
      binding: 'device-inf', presence: 'reported', corroboration: 'radio-report', issues: [], sources: [{ path: 'Demo/radio.log', line: 4 }],
    }] } };
}
function driverPackage() {
  return { id: 'synthetic', title: 'Synthetic WLAN', version: '99.88', sourceUrl: source.url, retrievedAt: '2026-11-11T12:00:00Z',
    readmeUrl: 'https://download.lenovo.com/pccbbs/mobiles/synthetic.txt', evidence: {
      dependencies: all(leaf('_OS', { OS: 'WIN11' }), leaf('_WindowsBuildVersion', { Version: '22621^' }), leaf('_PnPID', {}, hw)),
      installedDetection: all(leaf('_Driver', { HardwareID: hw, Version: '24.10.0.3^' })),
      componentVersions: [{ kind: 'driver', hardwareIds: [hw], version: '24.10.0.3', rawVersion: '24.10.0.3^', operator: 'gte', source }],
    } };
}
function readme(version = '24.10.0.3', kind = 'driver') {
  return { sourceUrl: 'https://download.lenovo.com/pccbbs/mobiles/synthetic.txt', retrievedAt: '2026-11-11T12:00:01Z', text: 'Synthetic readme', evidence: {
    machineTypes: ['21MM'], versions: [{ kind, version, source: { url: source.url, line: 8 } }], sections: [],
  } };
}

test('Numeric component ordering handles 9 versus 10, keeps differing formats unresolved', () => {
  assert.equal(compareNumericVersions('24.9.0.4', '24.10.0.3'), 'newer');
  assert.equal(compareNumericVersions('24.10.0.3', '24.9.0.4'), 'older');
  assert.equal(compareNumericVersions('01.10', '1.10'), 'same');
  for (const value of ['1.2-beta', '1.2^', '', 'N99ET10W', '99999999999.1']) assert.equal(compareNumericVersions(value, '1.2'), 'unknown');
  assert.equal(compareNumericVersions('1.2', '1.2.0'), 'unknown');
});

test('Lookup identity is capture-derived and conflicting identity cannot send a request', async () => {
  const snapshot = capture();
  assert.deepEqual(identifyCapture(snapshot), { machineType: '21MM', os: 'Win11' });
  snapshot.warnings.push({ kind: 'conflict', messageDescriptor: { params: { field: 'mtm' } } });
  let requested = false;
  await assert.rejects(checkUpdates(snapshot, { services: { fetchCatalog() { requested = true; } } }));
  assert.equal(requested, false);
});

test('Discovery includes only scoped categories, not WWAN or Ethernet', () => {
  assert.equal(packageKind({ category: 'Networking Wireless LAN' }), 'wlan');
  assert.equal(packageKind({ category: 'BIOS UEFI' }), 'bios');
  assert.equal(packageKind({ category: 'Bluetooth and Modem' }), 'bluetooth');
  assert.equal(packageKind({ category: 'Networking Wireless WAN' }), null);
  assert.equal(packageKind({ category: 'Networking LAN Ethernet' }), null);
});

test('Placeholder identity and BIOS values remain missing evidence, never inapplicable', () => {
  for (const value of ['N/A', 'Unknown', 'Not available', 'nicht verfügbar', 'Default string']) {
    const snapshot = capture(); snapshot.device.bios = value;
    assert.equal(evaluateRule(leaf('_Bios', { Level: 'N99ET' }), snapshot).result, 'unknown');
    snapshot.device.mtm = value;
    assert.equal(identifyCapture(snapshot).machineType, null);
  }
  for (const mtm of ['NONE', '0000', 'FFFFFFFFFF']) {
    const snapshot = capture(); snapshot.device.mtm = mtm;
    assert.equal(identifyCapture(snapshot).machineType, null);
  }
});

test('Exact hardware IDs and instance-derived IDs retain distinct confidence', () => {
  const radio = capture().inventory.devices[0];
  assert.equal(matchHardware(radio, [hw.toLowerCase()]), 'exact');
  radio.hardwareIds = []; radio.derivedHardwareIds = [hw];
  assert.equal(matchHardware(radio, [hw]), 'derived');
  assert.equal(matchHardware(radio, ['VEN_1234&DEV_5678']), 'none');
  assert.equal(matchHardware(radio, [hw + '&REV_01']), 'none');
  radio.derivedHardwareIds = [hw + '&REV_01'];
  assert.equal(matchHardware(radio, [hw]), 'derived');
  assert.equal(matchHardware(radio, ['PCI\\VEN_1234&DEV_5678&SUBSYS_99992222']), 'none');
});

test('Dependency evaluation is tri-state and never promotes missing hardware to absent', () => {
  const snapshot = capture();
  const unknown = { kind: 'unknown', tag: '_ExternalDetection', source };
  assert.equal(evaluateRule(all(leaf('_OS', { OS: 'WIN11' }), unknown), snapshot).result, 'unknown');
  assert.equal(evaluateRule(any(leaf('_OS', { OS: 'WIN11' }), unknown), snapshot).result, 'true');
  assert.equal(evaluateRule(all(leaf('_OS', { OS: 'WIN10' }), unknown), snapshot).result, 'false');
  assert.equal(evaluateRule(leaf('_PnPID', {}, 'USB\\VID_5678&PID_1234'), snapshot).result, 'unknown');
  assert.equal(evaluateRule(leaf('_OS', { OS: 'WIN11-PRO' }), snapshot).result, 'unknown');
  assert.equal(evaluateRule({ kind: 'not', children: [unknown] }, snapshot).result, 'unknown');
  assert.equal(evaluateRule(leaf('_Bios', { Level: 'N99ET10' }), snapshot).result, 'true');
});

test('CPU and driver detection do not ignore missing evidence or extra conditions', () => {
  const snapshot = capture();
  assert.equal(evaluateRule(leaf('_CPUAddressWidth', { AddressWidth: '64' }), snapshot).result, 'true');
  snapshot.device.osArchitecture = '32-bit';
  assert.equal(evaluateRule(leaf('_CPUAddressWidth', { AddressWidth: '64' }), snapshot).result, 'unknown');
  assert.equal(evaluateRule(leaf('_Driver', { HardwareID: hw, Version: '24.10.0.3^' }), snapshot).result, 'false');
  assert.equal(evaluateRule(leaf('_Driver', { HardwareID: hw, Version: '24.10.0.3^', Date: '2026-01-01' }), snapshot).result, 'unknown');
  snapshot.inventory.devices[0].presence = 'unknown';
  assert.equal(evaluateRule(leaf('_Driver', { HardwareID: hw, Version: '24.10.0.3^' }), snapshot).result, 'unknown');
});

test('Matched component comparison uses target driver version, never package version', () => {
  const row = assessPackage(capture(), driverPackage(), readme(), 'wlan');
  assert.equal(row.installedVersion, '24.9.0.4');
  assert.equal(row.offeredVersion, '24.10.0.3');
  assert.equal(row.versionRelation, 'newer');
  assert.equal(row.applicability, 'true');
  assert.equal(row.status, 'candidate');
  assert.equal(row.package.version, '99.88');
  assert.deepEqual(row.sources, [{ path: 'Demo/radio.log', line: 4 }]);
});

test('Derived identity allows candidate-version comparison but leaves applicability unresolved', () => {
  const snapshot = capture(); snapshot.inventory.devices[0].hardwareIds = []; snapshot.inventory.devices[0].derivedHardwareIds = [hw];
  const row = assessPackage(snapshot, driverPackage(), readme(), 'wlan');
  assert.equal(row.versionRelation, 'newer');
  assert.equal(row.applicability, 'unknown');
  assert.equal(row.status, 'unresolved');
  assert.ok(row.reasons.includes('hardware-match-derived'));
});

test('Unknown firmware, readme prerequisites and missing readmes block applicability', () => {
  const pkg = driverPackage();
  pkg.evidence.dependencies.children.push(leaf('_Firmware', { Version: '1234^' }));
  const row = assessPackage(capture(), pkg, readme(), 'wlan');
  assert.equal(row.versionRelation, 'newer'); assert.equal(row.applicability, 'unknown');
  const document = readme(); document.evidence.sections.push({ key: 'dependency', text: 'Install prerequisite first.', startLine: 14 });
  const pending = assessPackage(capture(), driverPackage(), document, 'wlan');
  assert.equal(pending.applicability, 'unknown'); assert.ok(pending.reasons.includes('readme-review-required'));
  assert.equal(assessPackage(capture(), driverPackage(), null, 'wlan').applicability, 'unknown');
});

test('Missing, duplicated, conflicting and store-only device evidence never gives an update verdict', () => {
  for (const mutate of [
    s => { s.inventory.devices = []; },
    s => { s.inventory.devices[0].binding = 'unresolved'; },
    s => { s.inventory.devices[0].issues = ['conflicting-version']; },
    s => { s.inventory.devices.push(structuredClone(s.inventory.devices[0])); },
    s => { s.inventory.devices[0].hardwareIds = ['USB\\VID_5678&PID_1234']; },
  ]) {
    const snapshot = capture(); mutate(snapshot);
    const row = assessPackage(snapshot, driverPackage(), readme(), 'wlan');
    assert.equal(row.versionRelation, 'unknown'); assert.equal(row.status, 'unresolved');
  }
  const row = assessPackage(capture(), driverPackage(), readme('24.11.0.1'), 'wlan');
  assert.equal(row.versionRelation, 'unknown'); assert.ok(row.reasons.includes('component-version-conflict'));
});

test('BIOS uses current readme version plus model and target family proof', () => {
  const pkg = driverPackage(); pkg.version = '9.9';
  pkg.evidence.componentVersions = [];
  pkg.evidence.dependencies = leaf('_OS', { OS: 'WIN11' });
  pkg.evidence.installedDetection = all(leaf('_Bios', { Level: 'N99ET11*' }));
  const snapshot = capture(), doc = readme('1.11', 'bios');
  const row = assessPackage(snapshot, pkg, doc, 'bios');
  assert.equal(row.offeredVersion, '1.11'); assert.equal(row.versionRelation, 'newer');
  assert.equal(row.status, 'candidate');
  snapshot.device.bios = 'N99ET10W (1.10 )';
  assert.equal(assessPackage(snapshot, pkg, doc, 'bios').versionRelation, 'newer');
  pkg.evidence.installedDetection = leaf('_Bios', { Level: 'N88ET11*' });
  assert.equal(assessPackage(snapshot, pkg, doc, 'bios').versionRelation, 'unknown');
  pkg.evidence.installedDetection = leaf('_Bios', { Level: 'N99ET11*' }); doc.evidence.machineTypes = ['20ZZ'];
  assert.equal(assessPackage(snapshot, pkg, doc, 'bios').versionRelation, 'unknown');
  doc.evidence.machineTypes = ['21MM']; doc.evidence.versions = [];
  assert.equal(assessPackage(snapshot, pkg, doc, 'bios').offeredVersion, null);
});

test('A newer installed component is not downgraded by catalog evidence', () => {
  const snapshot = capture(); snapshot.inventory.devices[0].version = '24.11.0.1';
  const row = assessPackage(snapshot, driverPackage(), readme(), 'wlan');
  assert.equal(row.versionRelation, 'older'); assert.equal(row.status, 'matched');
});

test('Unknown rule modifiers and nested fields are not silently evaluated', () => {
  for (const mutate of [
    rule => { rule.attributes = { custom: 'true' }; },
    rule => { rule.fields[0].attributes = { hex2dec: 'true' }; },
    rule => { rule.fields[0].nested = true; },
    rule => { rule.fields.push({ tag: 'ExtraRequirement', value: 'x' }); },
  ]) {
    const rule = leaf('_WindowsBuildVersion', { Version: '22621^' }); mutate(rule);
    assert.equal(evaluateRule(rule, capture()).result, 'unknown');
  }
});

test('Explicit no-prerequisite text is distinguished from unreadable or contradictory readmes', () => {
  const doc = readme();
  doc.evidence.sections = [{ key: 'dependency', text: 'None.\n----------------' }, { key: 'important', text: 'Nothing.' }];
  assert.equal(assessPackage(capture(), driverPackage(), doc, 'wlan').applicability, 'true');
  for (const mutate of [
    d => { d.evidence.truncated = true; },
    d => { d.evidence.ambiguousSections = ['versions']; },
    d => { d.evidence.machineTypes = ['20ZZ']; },
  ]) {
    const changed = structuredClone(doc); mutate(changed);
    assert.equal(assessPackage(capture(), driverPackage(), changed, 'wlan').applicability, 'unknown');
  }
});

test('Bounded request workflow retains partial failures and missing category coverage', async () => {
  const calls = [], progress = [];
  const entries = [{ category: 'Networking Wireless LAN', url: source.url }, { category: 'Bluetooth and Modem', url: source.url + '.bad' }, { category: 'Networking Wireless WAN', url: source.url + '.skip' }];
  const result = await checkUpdates(capture(), { onProgress: p => progress.push(p), services: {
    async fetchCatalog(type, os) { calls.push([type, os]); return { sourceUrl: 'https://download.lenovo.com/catalog/21MM_Win11.xml', retrievedAt: '2026-11-11T12:00:00Z', packages: entries }; },
    async fetchPackage(entry) { calls.push(entry.url); if (entry.url.endsWith('.bad')) throw new Error('HTTP 503'); return driverPackage(); },
    async fetchReadme(url) { calls.push(url); return readme(); },
  } });
  assert.deepEqual(calls[0], ['21MM', 'Win11']);
  assert.equal(result.errors.length, 1); assert.equal(result.rows.length, 3);
  assert.ok(result.rows.find(row => row.kind === 'bluetooth').reasons.includes('package-query-failed'));
  assert.ok(result.rows.find(row => row.kind === 'bios').reasons.includes('catalog-no-package'));
  assert.equal(calls.some(item => typeof item === 'string' && item.endsWith('.skip')), false);
  assert.deepEqual(progress.at(-1), { completed: 2, total: 2 });
});

test('Cancellation cannot publish a late package result or request a readme', async () => {
  const controller = new AbortController(); let readmeRequested = false;
  await assert.rejects(checkUpdates(capture(), { signal: controller.signal, services: {
    async fetchCatalog() { return { packages: [{ category: 'Wireless LAN', url: source.url }] }; },
    async fetchPackage() { controller.abort(); return driverPackage(); },
    async fetchReadme() { readmeRequested = true; return readme(); },
  } }), { name: 'AbortError' });
  assert.equal(readmeRequested, false);
});
