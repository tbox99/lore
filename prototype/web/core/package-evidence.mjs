// Read-only evidence extraction. Rules are data; nothing in a package is executed.
const RULE_TAGS = new Set(['_OS', '_CPUAddressWidth', '_WindowsBuildVersion', '_Bios', '_PnPID', '_Driver', '_Firmware']);
const children = node => Array.from(node?.children || []);
const child = (node, tag) => children(node).find(item => item.localName === tag) || null;
const value = node => node?.textContent?.trim() || '';
const attributes = node => Object.fromEntries(Array.from(node?.attributes || []).map(item => [item.name, item.value]));
const source = (url, locator, line = null) => ({ url, locator, line });
function located(nodes, base) {
  const counts = new Map();
  return nodes.map(node => {
    const index = (counts.get(node.localName) || 0) + 1;
    counts.set(node.localName, index);
    return { node, locator: `${base}/${node.localName}[${index}]` };
  });
}

export function versionRequirement(raw) {
  const match = typeof raw === 'string' && raw.trim().match(/^(\d+(?:\.\d+){0,3})(\^)?$/);
  return match ? { version: match[1], rawVersion: raw, operator: match[2] ? 'gte' : 'eq' }
    : { version: null, rawVersion: raw || null, operator: 'unknown' };
}

export function extractPackageEvidence(root, { sourceUrl } = {}) {
  let count = 0;
  const unsupportedRules = [];
  function rule(node, locator, depth = 0) {
    if (!node) return null;
    const tag = node.localName;
    const ref = source(sourceUrl, locator);
    if (++count > 2048 || depth > 32) {
      const result = { kind: 'unknown', tag, attributes: {}, value: '', fields: [], children: [], source: ref, reason: 'rule-limit' };
      unsupportedRules.push({ tag, source: ref, reason: 'rule-limit' });
      return result;
    }
    const nested = children(node);
    let kind = ({ And: 'and', Or: 'or', Not: 'not', Dependencies: 'and', DetectInstall: 'and' })[tag]
      || (RULE_TAGS.has(tag) ? 'leaf' : 'unknown');
    if (kind === 'not' && nested.length !== 1) kind = 'unknown';
    if (kind === 'leaf' && nested.length > 2048) {
      unsupportedRules.push({ tag, source: ref, reason: 'rule-limit' });
      return { kind: 'unknown', tag, attributes: {}, value: '', fields: [], children: [], source: ref, reason: 'rule-limit' };
    }
    const result = { kind, tag, attributes: attributes(node), value: nested.length ? '' : value(node), fields: [], children: [], source: ref };
    if (kind === 'leaf') {
      result.fields = located(nested, locator).map(({ node: item, locator: fieldLocator }) => ({ tag: item.localName, value: value(item), attributes: attributes(item),
        nested: children(item).length > 0, source: source(sourceUrl, fieldLocator) }));
    } else if (kind !== 'unknown') {
      result.children = located(nested.slice(0, 2048), locator).map(({ node: item, locator: itemLocator }) => rule(item, itemLocator, depth + 1));
      if (nested.length > 2048) {
        result.children.push({ kind: 'unknown', tag: 'Overflow', fields: [], children: [], attributes: {}, value: '', source: ref, reason: 'rule-limit' });
        unsupportedRules.push({ tag: 'Overflow', source: ref, reason: 'rule-limit' });
      }
    }
    if (kind === 'unknown') unsupportedRules.push({ tag, source: ref, reason: 'unsupported-rule' });
    return result;
  }
  function uniqueRule(tag) {
    const found = children(root).filter(node => node.localName === tag);
    if (found.length <= 1) return rule(found[0], `/Package/${tag}`);
    const ref = source(sourceUrl, `/Package/${tag}`);
    unsupportedRules.push({ tag, source: ref, reason: 'duplicate-rule-root' });
    return { kind: 'unknown', tag, value: '', fields: [], children: [], attributes: {}, source: ref, reason: 'duplicate-rule-root' };
  }
  const dependencies = uniqueRule('Dependencies');
  const installedDetection = uniqueRule('DetectInstall');
  const detect = child(root, 'DetectVersion');
  const detectVersion = detect ? { type: detect.getAttribute('type') || null,
    pnpIds: children(detect).filter(item => item.localName === '_PnPID').map(value),
    source: source(sourceUrl, '/Package/DetectVersion') } : null;
  const componentVersions = [];
  function components(node) {
    if (!node || node.kind === 'not' || node.kind === 'unknown') return;
    if (node.kind === 'leaf' && node.tag === '_Driver') {
      const ids = node.fields.filter(item => item.tag === 'HardwareID' && !item.nested).map(item => item.value);
      const versions = node.fields.filter(item => item.tag === 'Version' && !item.nested);
      if (versions.length === 1) componentVersions.push({ kind: 'driver', hardwareIds: ids,
        ...versionRequirement(versions[0].value), biosLevels: [], source: versions[0].source });
    }
    for (const nested of node.children) components(nested);
  }
  // Only installation detection identifies a target; prerequisite versions never do.
  components(installedDetection);
  return { dependencies, installedDetection, detectVersion, componentVersions, unsupportedRules,
    rebootType: child(root, 'Reboot')?.getAttribute('type') || null };
}

const HEADINGS = new Map([
  ['support models', 'models'], ['supported models', 'models'], ['supported systems', 'models'],
  ['operating systems', 'os'], ['supported operating systems', 'os'],
  ['version', 'versions'], ['versions', 'versions'], ['support device', 'devices'], ['supported devices', 'devices'],
  ['revision', 'revision'], ['compliant standard information', 'standards'],
  ['what this package does', 'description'], ['changes in this release', 'changes'],
  ['dependency', 'dependency'], ['dependencies', 'dependency'], ['prerequisites', 'dependency'],
  ['important notice', 'important'], ['important information', 'important'],
  ['determining which version is installed', 'installedHelp'], ['determining operating system version', 'osHelp'],
  ['installation instructions / how to use this software', 'install'], ['installation instructions', 'install'],
  ['uninstallation instructions', 'uninstall'], ['version information', 'history'], ['summary of changes', 'history'],
  ['trademarks', 'legal'], ['limitations', 'limitations'], ['known limitations', 'limitations'],
]);
const headingKey = line => HEADINGS.get(line.replace(/\u00a0/g, ' ').trim().replace(/:$/, '').replace(/\s+/g, ' ').toLowerCase());

export function extractReadmeEvidence(text, { sourceUrl } = {}) {
  // Line references are into the retained plain-text view, not the source HTML.
  const lines = String(text || '').split(/\r?\n/);
  const sections = [];
  let active = null;
  let history = false;
  let bodyStarted = false;
  let truncated = false;
  for (let i = 0; i < lines.length; i++) {
    const key = headingKey(lines[i]);
    if (!key) continue;
    // BIOS change notes can begin with "Version:". Only the document header
    // defines current component versions; keep that later line in the changes.
    if (key === 'versions' && bodyStarted) continue;
    if (key === 'description' || key === 'changes') bodyStarted = true;
    if (active) { active.end = i; sections.push(active); }
    if (key === 'history') history = true;
    active = { key, title: lines[i].trim(), start: i + 1, end: lines.length, current: !history };
  }
  if (active) sections.push(active);
  const exposed = sections.filter(section => section.current && !['installedHelp', 'osHelp', 'legal', 'revision', 'standards', 'install', 'uninstall'].includes(section.key));
  const summaries = exposed.slice(0, 30).map(section => {
    let start = section.start, end = section.end;
    while (start < end && !lines[start].trim()) start++;
    while (end > start && !lines[end - 1].trim()) end--;
    const body = lines.slice(start, end).join('\n');
    if (body.length > 16000) truncated = true;
    return { key: section.key, title: section.title, text: body.slice(0, 16000), startLine: start + 1, endLine: end,
      source: source(sourceUrl, `plain-text:line(${start + 1})`, start + 1) };
  });
  if (exposed.length > 30) truncated = true;
  const modelSections = summaries.filter(section => section.key === 'models');
  const machineTypes = [];
  if (modelSections.length === 1) {
    // Restrict to explicit Type/Machine Type lists; prose/product names are not IDs.
    for (const match of modelSections[0].text.matchAll(/\b(?:Machine\s+Types?|Types?)\s*:?\s*([A-Z0-9]{4}(?:\s*[,/]\s*[A-Z0-9]{4})*)\b/gi)) {
      for (const mtm of match[1].match(/[A-Z0-9]{4}/gi) || []) if (!machineTypes.includes(mtm.toUpperCase())) machineTypes.push(mtm.toUpperCase());
    }
  }
  const versions = [];
  const versionSections = summaries.filter(section => section.key === 'versions');
  if (versionSections.length === 1) {
    const section = versionSections[0];
    section.text.split('\n').forEach((line, index) => {
      const normalized = line.replace(/\u00a0/g, ' ').trim();
      const match = normalized.match(/^(\d+(?:\.\d+){1,3})\s*(?:\((UEFI BIOS|BIOS|ECP|Embedded Controller(?: Program)?)\))?$/i);
      if (!match) return;
      const label = match[2] || '';
      const kind = /BIOS/i.test(label) ? 'bios' : /ECP|Embedded/i.test(label) ? 'ec' : /^\d+\.\d+\.\d+\.\d+$/.test(match[1]) ? 'driver' : 'unknown';
      versions.push({ kind, version: match[1], source: source(sourceUrl, 'readme:versions', section.startLine + index) });
    });
  }
  return { sections: summaries, machineTypes, versions, truncated,
    ambiguousSections: [...new Set(summaries.map(section => section.key))].filter(key => summaries.filter(section => section.key === key).length > 1) };
}
