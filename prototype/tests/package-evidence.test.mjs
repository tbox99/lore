import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPackageEvidence, extractReadmeEvidence, versionRequirement } from '../web/core/package-evidence.mjs';

// Small DOM-shaped fixture adapter; browser acceptance exercises DOMParser itself.
function element(tag, body = [], attrs = {}) {
  const nodes = Array.isArray(body) ? body : [];
  return { localName: tag, children: nodes,
    textContent: Array.isArray(body) ? nodes.map(node => node.textContent).join('') : body,
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    getAttribute(name) { return attrs[name] ?? null; } };
}
const e = element;
const url = 'https://download.lenovo.com/pccbbs/mobiles/synthetic.xml';
const driver = (id, version) => e('_Driver', [e('HardwareID', id), e('Version', version)]);

test('component targets come from install detection, never prerequisite or package versions', () => {
  const tree = e('Package', [e('DetectInstall', [driver('PCI\\VEN_1234&DEV_0001', '24.70.0.3^')]),
    e('Dependencies', [e('And', [driver('PCI\\VEN_1234&DEV_9999', '20.40.12446.0^'), e('_OS', [e('OS', 'WIN11')])])])], { version: '99.0' });
  const result = extractPackageEvidence(tree, { sourceUrl: url });
  assert.equal(result.componentVersions.length, 1);
  assert.deepEqual(result.componentVersions[0].hardwareIds, ['PCI\\VEN_1234&DEV_0001']);
  assert.equal(result.componentVersions[0].version, '24.70.0.3');
  assert.equal(result.componentVersions[0].operator, 'gte');
  assert.equal(result.componentVersions[0].source.locator, '/Package/DetectInstall/_Driver[1]/Version[1]');
  assert.equal(result.componentVersions[0].source.url, url);
  assert.equal(result.dependencies.children[0].children[0].fields[1].value, '20.40.12446.0^');
});

test('unknown executable rules and nested boolean structure remain explicit data', () => {
  const root = e('Package', [e('Dependencies', [e('Or', [e('_OS', [e('OS', 'WIN11')]),
    e('And', [e('_WindowsBuildVersion', [e('Version', '22621^')]), e('Not', [e('_ExternalDetection', 'never execute.exe')])])])])]);
  const result = extractPackageEvidence(root, { sourceUrl: url });
  const unknown = result.dependencies.children[0].children[1].children[1].children[0];
  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.value, 'never execute.exe');
  assert.equal(result.unsupportedRules.length, 1);
  assert.equal(result.unsupportedRules[0].tag, '_ExternalDetection');
});

test('firmware attributes and all hardware alternatives are preserved', () => {
  const root = e('Package', [e('Dependencies', [e('_Firmware', [e('HardwareIDs', 'UEFI\\RES_A'),
    e('HardwareIDs', 'UEFI\\RES_B'), e('Version', 'F09D3^', { hex2dec: 'True' })])])]);
  const firmware = extractPackageEvidence(root, { sourceUrl: url }).dependencies.children[0];
  assert.deepEqual(firmware.fields.map(field => field.value), ['UEFI\\RES_A', 'UEFI\\RES_B', 'F09D3^']);
  assert.equal(firmware.fields[2].attributes.hex2dec, 'True');
  assert.equal(firmware.fields[1].source.locator, '/Package/Dependencies/_Firmware[1]/HardwareIDs[2]');
});

test('duplicate roots, malformed Not and excessive nesting cannot become successful conditions', () => {
  const duplicate = extractPackageEvidence(e('Package', [e('Dependencies', []), e('Dependencies', [])]));
  assert.equal(duplicate.dependencies.kind, 'unknown');
  const malformed = extractPackageEvidence(e('Package', [e('Dependencies', [e('Not', [])])]));
  assert.equal(malformed.dependencies.children[0].kind, 'unknown');
  let deep = e('_OS', [e('OS', 'WIN11')]);
  for (let i = 0; i < 40; i++) deep = e('And', [deep]);
  const bounded = extractPackageEvidence(e('Package', [e('Dependencies', [deep])]));
  assert.ok(bounded.unsupportedRules.some(item => item.reason === 'rule-limit'));
});

test('negated installation rules and ambiguous versions do not create target components', () => {
  const root = e('Package', [e('DetectInstall', [e('Not', [driver('USB\\VID_1234', '1.2.3.4^')]),
    e('_Driver', [e('HardwareID', 'USB\\VID_5678'), e('Version', '1.2.3.4^'), e('Version', '5.6.7.8^')])])]);
  assert.deepEqual(extractPackageEvidence(root).componentVersions, []);
});

test('only simple decimal exact/minimum version expressions are normalized', () => {
  assert.deepEqual(versionRequirement('24.70.0.3^'), { version: '24.70.0.3', rawVersion: '24.70.0.3^', operator: 'gte' });
  assert.equal(versionRequirement('22621^').version, '22621');
  assert.equal(versionRequirement('1.18').operator, 'eq');
  for (const raw of ['^1.2', '1.2^3.4', 'F09D3^', '1.2-beta', '1.2.3.4.5', '']) assert.equal(versionRequirement(raw).operator, 'unknown');
});

const readme = [
  'ReadMe', 'Support Models', 'ThinkPad Synthetic (Type 21MM, 21ML)', '',
  'Operating Systems', 'Windows 11', 'Version', '1.18 (UEFI BIOS)', '1.16 (ECP)',
  'Changes in This Release', 'Fixed a synthetic issue.', 'Dependency', 'Update ME firmware first.',
  'Important Notice', 'Rollback is restricted.', 'Version Information',
  'Version 1.00 removed Synthetic (Type 99ZZ).', 'Support Models', 'Historical (Type 88XX)',
].join('\n');

test('current readme sections retain exact lines and exclude historical model mentions', () => {
  const result = extractReadmeEvidence(readme, { sourceUrl: url });
  assert.deepEqual(result.machineTypes, ['21MM', '21ML']);
  assert.deepEqual(result.versions.map(({ kind, version }) => [kind, version]), [['bios', '1.18'], ['ec', '1.16']]);
  assert.equal(result.versions[0].source.line, 8);
  const prerequisite = result.sections.find(section => section.key === 'dependency');
  assert.equal(prerequisite.text, 'Update ME firmware first.');
  assert.equal(prerequisite.startLine, 13);
  assert.equal(prerequisite.endLine, 13);
  assert.equal(result.sections.filter(section => section.key === 'models').length, 1);
  assert.equal(result.truncated, false);
});

test('readme driver version is separated from revision and prose numbers', () => {
  const text = 'Support Models\nSynthetic (Machine Types: 21MM, 21ML)\nVersion\n24.70.0.3\nRevision\n99\nChanges in This Release\nRequires driver 20.40.12446.0.';
  const result = extractReadmeEvidence(text);
  assert.deepEqual(result.versions.map(({ kind, version }) => [kind, version]), [['driver', '24.70.0.3']]);
  assert.deepEqual(result.machineTypes, ['21MM', '21ML']);
});

test('a BIOS Version heading inside current changes does not replace header component versions', () => {
  const result = extractReadmeEvidence('Version\n1.18 (UEFI BIOS)\n1.16 (ECP)\nWhat This Package Does\nUpdates BIOS.\nChanges in This Release\nVersion:\n1.18 (UEFI BIOS)\n1.16 (ECP)\n[Problem fixes]\nSynthetic fix.\nDependency\nME firmware first.');
  assert.deepEqual(result.versions.map(({ kind, version }) => [kind, version]), [['bios', '1.18'], ['ec', '1.16']]);
  assert.deepEqual(result.ambiguousSections, []);
  assert.match(result.sections.find(section => section.key === 'changes').text, /Version:\n1\.18 \(UEFI BIOS\)/);
});

test('ambiguous current sections do not produce confident model/version evidence', () => {
  const result = extractReadmeEvidence('Support Models\nSynthetic (Type 21MM)\nSupport Models\nOther (Type 88XX)\nVersion\n1.18 (UEFI BIOS)\nVersion\n1.19 (UEFI BIOS)');
  assert.deepEqual(result.machineTypes, []);
  assert.deepEqual(result.versions, []);
  assert.deepEqual(result.ambiguousSections, ['models', 'versions']);
});

test('unknown prose is not interpreted as support and large sections are explicitly truncated', () => {
  assert.deepEqual(extractReadmeEvidence('Install this on 21MM and update to 1.2.3.4.').machineTypes, []);
  const result = extractReadmeEvidence('Important Notice\n' + 'x'.repeat(17000));
  assert.equal(result.truncated, true);
  assert.equal(result.sections[0].text.length, 16000);
});
