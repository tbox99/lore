import { fetchCatalog, fetchPackage, fetchReadme } from './lenovo.mjs';

// Offline evidence evaluation only. No Lenovo detection code is executed.
const KINDS = ['bios', 'wlan', 'bluetooth'];
const truth = value => value ? 'true' : 'false';
const and = values => values.includes('false') ? 'false' : values.length && values.every(v => v === 'true') ? 'true' : 'unknown';
const or = values => values.includes('true') ? 'true' : values.length && values.every(v => v === 'false') ? 'false' : 'unknown';
const unique = values => [...new Set(values.filter(Boolean))];
const clean = value => String(value ?? '').trim();
const upper = value => clean(value).toUpperCase();
const PLACEHOLDERS = new Set(['-', '–', '—', '?', 'n/a', 'n.a.', 'na', 'none', 'null', 'unknown', 'unavailable',
  'not available', 'not applicable', 'not specified', 'not determined', 'not collected', 'invalid',
  'unbekannt', 'nicht verfügbar', 'nicht verfuegbar', 'nicht ermittelt', 'nicht zutreffend', 'nicht angegeben',
  'nicht erhoben', 'to be filled by o.e.m.', 'to be filled by oem', 'default string']);
const hasConflict = (snapshot, field) => snapshot.warnings?.some(item => item.kind === 'conflict' && item.messageDescriptor?.params?.field === field);
const fields = (rule, tag) => (rule.fields || []).filter(field => field.tag === tag).map(field => clean(field.value));
const usable = (snapshot, field) => {
  const value = clean(snapshot.device?.[field]);
  return !hasConflict(snapshot, field) && value && !PLACEHOLDERS.has(value.toLowerCase().replace(/\s+/g, ' ')) ? value : null;
};

export function compareNumericVersions(installed, offered) {
  const pattern = /^\d{1,10}(?:\.\d{1,10}){0,5}$/;
  if (!pattern.test(clean(installed)) || !pattern.test(clean(offered))) return 'unknown';
  const a = clean(installed).split('.').map(BigInt), b = clean(offered).split('.').map(BigInt);
  if (a.length !== b.length) return 'unknown';
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return 'newer';
    if (a[i] > b[i]) return 'older';
  }
  return 'same';
}

export function identifyCapture(snapshot) {
  const mtm = usable(snapshot, 'mtm');
  const machineType = mtm && /^[A-Z0-9]{4}(?:[A-Z0-9]{6})?$/i.test(mtm) && !/^(?:0+|f+)$/i.test(mtm) ? mtm.slice(0, 4).toUpperCase() : null;
  const osValue = usable(snapshot, 'os');
  const match = osValue && osValue.match(/\bWindows\s+(10|11)\b/i);
  return { machineType, os: match ? `Win${match[1]}` : null };
}

export function packageKind(entry, pkg = null) {
  const category = clean(entry?.category);
  if (/bios|uefi/i.test(category)) return 'bios';
  if (/wireless\s*lan|wlan|wi-?fi/i.test(category) && !/\bwan\b/i.test(category)) return 'wlan';
  if (/bluetooth/i.test(category)) return 'bluetooth';
  // Classification limits discovery; names never establish device applicability.
  const title = clean(pkg?.title);
  if (/\bBIOS\b/i.test(title)) return 'bios';
  if (/\bBluetooth\b/i.test(title)) return 'bluetooth';
  if (/wireless\s*lan|wlan|wi-?fi/i.test(title)) return 'wlan';
  return null;
}

function validRadio(device) {
  return device?.binding === 'device-inf' && device.presence === 'reported' &&
    device.corroboration === 'radio-report' && !device.issues?.length;
}

// Windows hardware IDs are opaque. Only captured IDs give an exact match.
// Instance-derived IDs can select a candidate but cannot prove applicability.
export function matchHardware(device, requestedIds) {
  const requested = requestedIds.map(upper).filter(Boolean);
  if (!requested.length) return 'none';
  if ((device.hardwareIds || []).some(id => requested.includes(upper(id)))) return 'exact';
  const derived = (device.derivedHardwareIds || []).flatMap(id => {
    const raw = upper(id);
    const pci = /^(PCI\\VEN_[0-9A-F]{4}&DEV_[0-9A-F]{4}&SUBSYS_[0-9A-F]{8})&REV_[0-9A-F]{2}$/.exec(raw);
    return pci ? [raw, pci[1]] : [raw];
  });
  if (derived.some(id => requested.includes(id))) return 'derived';
  return 'none';
}

function simplePattern(value, patterns) {
  if (!value || !patterns.length) return 'unknown';
  let unsupported = false;
  for (const raw of patterns) {
    const pattern = upper(raw);
    if (pattern === '*') return 'true';
    if (/^[A-Z0-9._-]+\*?$/.test(pattern)) {
      // Lenovo BIOS levels are prefixes, including levels without a literal '*'.
      if (upper(value).startsWith(pattern.replace(/\*$/, ''))) return 'true';
    } else unsupported = true;
  }
  return unsupported ? 'unknown' : 'false';
}

function versionRule(value, expression) {
  const raw = clean(expression);
  const match = raw.match(/^(\d+(?:\.\d+)*)(\^)?$/);
  if (!match) return 'unknown';
  const relation = compareNumericVersions(value, match[1]);
  if (relation === 'unknown') return relation;
  // Caret is Lenovo's greater-than-or-equal version comparison suffix.
  return truth(match[2] ? relation !== 'newer' : relation === 'same');
}

export function evaluateRule(rule, snapshot) {
  const checks = [];
  function evaluate(node) {
    if (!node) return 'unknown';
    if (Object.keys(node.attributes || {}).length) {
      checks.push({ tag: node.tag || 'unknown', result: 'unknown', source: node.source || null });
      return 'unknown';
    }
    if (node.kind === 'and') return and((node.children || []).map(evaluate));
    if (node.kind === 'or') return or((node.children || []).map(evaluate));
    if (node.kind === 'not') {
      if (node.children?.length !== 1) return 'unknown';
      const result = evaluate(node.children[0]);
      return result === 'unknown' ? result : result === 'true' ? 'false' : 'true';
    }
    let result = 'unknown';
    if (node.kind === 'leaf') {
      const allowed = {
        _Bios: ['Level'], _OS: ['OS'], _CPUAddressWidth: ['AddressWidth'],
        _WindowsBuildVersion: ['Version'], _PnPID: ['HardwareID'], _Driver: ['HardwareID', 'Version'],
      }[node.tag];
      if (!allowed || (node.fields || []).some(field => !allowed.includes(field.tag) || field.nested || Object.keys(field.attributes || {}).length)) {
        checks.push({ tag: node.tag || 'unknown', result: 'unknown', source: node.source || null });
        return 'unknown';
      }
      if (node.tag === '_Bios') {
        const bios = usable(snapshot, 'bios');
        result = simplePattern(bios && bios.split(/\s/)[0], fields(node, 'Level'));
      } else if (node.tag === '_OS') {
        const { os } = identifyCapture(snapshot);
        const codes = fields(node, 'OS').map(upper);
        if (os && codes.length) {
          if (codes.includes(upper(os))) result = 'true';
          else if (codes.every(code => /^WIN(?:10|11)(?:[-.].*)?$/.test(code)) && !codes.some(code => code.startsWith(upper(os)))) result = 'false';
          // Edition, language and wildcard OS rules need evidence beyond a major version.
        }
      } else if (node.tag === '_CPUAddressWidth') {
        const architecture = usable(snapshot, 'osArchitecture');
        const width = architecture && /^(32|64)(?:[- ]?(?:bit|bits))?$/i.exec(architecture)?.[1];
        // A 32-bit OS can run on a 64-bit CPU; it does not establish CPU width.
        if (width === '64') result = truth(fields(node, 'AddressWidth').includes(width));
      } else if (node.tag === '_WindowsBuildVersion') {
        const build = usable(snapshot, 'build');
        const number = build && /^(?:\d+\.\d+\.)?(\d+)(?:\.\d+)?$/.exec(build)?.[1];
        const expressions = fields(node, 'Version');
        if (number && expressions.length === 1) result = versionRule(number, expressions[0]);
      } else if (node.tag === '_PnPID') {
        const ids = [node.value, ...fields(node, 'HardwareID')].filter(Boolean);
        const matches = (snapshot.inventory?.devices || []).filter(validRadio).map(device => matchHardware(device, ids));
        // Lack of a match is not evidence that a device is absent from a partial CDAT.
        if (matches.includes('exact')) result = 'true';
      } else if (node.tag === '_Driver') {
        const ids = fields(node, 'HardwareID');
        const candidates = (snapshot.inventory?.devices || []).filter(device => validRadio(device) && matchHardware(device, ids) === 'exact');
        const expressions = fields(node, 'Version');
        const supportedFields = (node.fields || []).every(field => ['HardwareID', 'Version'].includes(field.tag));
        if (candidates.length === 1 && expressions.length === 1 && supportedFields) result = versionRule(candidates[0].version, expressions[0]);
      }
    }
    checks.push({ tag: node.tag || 'unknown', result, source: node.source || null });
    return result;
  }
  return { result: evaluate(rule), checks };
}

function biosParts(snapshot) {
  const raw = usable(snapshot, 'bios');
  const match = raw && /^([A-Z0-9]+ET)(\d{2,3})([A-Z]*)\s*\(\s*(\d+\.\d+)\s*\)$/i.exec(raw);
  return match ? { identifier: match[1] + match[2] + match[3], family: upper(match[1]), version: match[4] } : null;
}

function biosTargetLevels(rule) {
  if (!rule || ['not', 'unknown'].includes(rule.kind)) return [];
  if (rule.kind === 'leaf') return rule.tag === '_Bios' ? fields(rule, 'Level') : [];
  return (rule.children || []).flatMap(biosTargetLevels);
}

function readmeForUi(readme) {
  if (!readme) return null;
  return { ...readme, sections: (readme.evidence?.sections || []).map(section => ({ ...section, kind: section.key })) };
}

function baseRow(kind, pkg, readme) {
  return {
    id: `${kind}:${pkg?.sourceUrl || 'missing'}`, kind, name: pkg?.title || kind,
    installedVersion: null, offeredVersion: null, versionRelation: 'unknown',
    applicability: 'unknown', status: 'unresolved', reasons: ['catalog-source-only'], sources: [],
    package: pkg || null, readme: readmeForUi(readme), details: {},
  };
}

export function assessPackage(snapshot, pkg, readme, kind) {
  const row = baseRow(kind, pkg, readme);
  const identity = identifyCapture(snapshot);
  const dependencies = evaluateRule(pkg.evidence?.dependencies, snapshot);
  const detection = evaluateRule(pkg.evidence?.installedDetection, snapshot);
  row.details = { hardwareMatch: 'none', dependencies: dependencies.checks, installedDetection: detection.result,
    packageVersion: pkg.version, rebootType: pkg.evidence?.rebootType || null };
  if (!identity.machineType || !identity.os) row.reasons.push('capture-identity-incomplete');
  if (!readme) row.reasons.push('readme-unavailable');
  const prerequisites = (readme?.evidence?.sections || []).filter(section => ['dependency', 'important'].includes(section.key))
    .filter(section => !/^(?:none|nothing)\.?$/i.test(section.text.split('\n').filter(line => !/^\s*[-=]+\s*$/.test(line)).join('\n').trim()));
  const readmeIncomplete = !readme?.evidence || readme.evidence.truncated || readme.evidence.ambiguousSections?.length;
  if (readmeIncomplete) row.reasons.push('readme-evidence-incomplete');
  const listedModels = (readme?.evidence?.machineTypes || []).map(upper);
  const modelConflict = listedModels.length > 0 && !listedModels.includes(identity.machineType);
  if (modelConflict) row.reasons.push('readme-model-conflict');
  if (prerequisites.length) row.reasons.push('readme-review-required');
  if (dependencies.result === 'unknown') row.reasons.push('prerequisites-unverified');
  if (dependencies.result === 'false') row.reasons.push('prerequisites-not-met');
  if (detection.result === 'unknown') row.reasons.push('detection-unverified');

  let matched = false;
  if (kind === 'bios') {
    const installed = biosParts(snapshot);
    row.installedVersion = installed?.version || clean(snapshot.device?.bios) || null;
    if (snapshot.sources?.bios) row.sources.push(snapshot.sources.bios);
    const versions = unique((readme?.evidence?.versions || []).filter(item => item.kind === 'bios').map(item => item.version));
    if (versions.length === 1) row.offeredVersion = versions[0];
    else row.reasons.push(versions.length ? 'component-version-conflict' : 'component-version-missing');
    const levels = biosTargetLevels(pkg.evidence?.installedDetection);
    const families = unique(levels.map(level => /^([A-Z0-9]+ET)\d+\*?$/i.exec(level)?.[1]).map(upper));
    const models = (readme?.evidence?.machineTypes || []).map(upper);
    matched = Boolean(installed && families.length === 1 && families[0] === installed.family && models.includes(identity.machineType));
    if (!matched) row.reasons.push(installed ? 'bios-family-mismatch' : 'no-installed-evidence');
    row.details.hardwareMatch = matched ? 'exact' : 'none';
    if (matched && row.offeredVersion) row.versionRelation = compareNumericVersions(installed.version, row.offeredVersion);
  } else if (kind === 'wlan' || kind === 'bluetooth') {
    const components = (pkg.evidence?.componentVersions || []).filter(item => item.kind === 'driver');
    const radios = (snapshot.inventory?.devices || []).filter(device => device.kind === kind && validRadio(device));
    const matchedPairs = radios.flatMap(device => components.map(component => ({ device, component, match: matchHardware(device, component.hardwareIds || []) }))).filter(pair => pair.match !== 'none');
    const devices = [...new Set(matchedPairs.map(pair => pair.device))];
    if (devices.length === 1) {
      const device = devices[0];
      const pairs = matchedPairs.filter(pair => pair.device === device);
      row.name = device.name || pkg.title;
      row.installedVersion = device.version;
      row.sources = device.sources || [];
      row.details.hardwareMatch = pairs.some(pair => pair.match === 'exact') ? 'exact' : 'derived';
      if (row.details.hardwareMatch === 'derived') row.reasons.push('hardware-match-derived');
      const versions = unique(pairs.map(pair => pair.component.version));
      if (versions.length === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(versions[0])) {
        row.offeredVersion = versions[0];
        row.versionRelation = compareNumericVersions(device.version, row.offeredVersion);
        // A readme contradiction cannot be resolved by silently preferring XML.
        const readmeVersions = unique((readme?.evidence?.versions || []).filter(item => item.kind === 'driver').map(item => item.version));
        if (readmeVersions.length && !readmeVersions.includes(row.offeredVersion)) {
          row.versionRelation = 'unknown'; row.reasons.push('component-version-conflict');
        }
      } else row.reasons.push(versions.length > 1 ? 'component-version-conflict' : 'component-version-missing');
      matched = row.details.hardwareMatch === 'exact';
    } else row.reasons.push(devices.length > 1 ? 'ambiguous-installed-evidence' : radios.length ? 'hardware-not-matched' : 'no-installed-evidence');
  } else row.reasons.push('unsupported-package-kind');

  if (['mtm', 'bios', 'os', 'build'].some(field => hasConflict(snapshot, field))) {
    row.reasons.push('capture-conflict'); matched = false;
  }
  if (matched && identity.machineType && identity.os && readme && !prerequisites.length && !readmeIncomplete && !modelConflict) row.applicability = dependencies.result;
  else if (dependencies.result === 'false') row.applicability = 'false';
  if (row.applicability === 'false') row.status = 'not-applicable';
  else if (row.applicability === 'true' && row.versionRelation !== 'unknown') {
    row.status = row.versionRelation === 'newer' && detection.result === 'false' ? 'candidate' : 'matched';
  }
  row.reasons = unique(row.reasons);
  return row;
}

export async function checkUpdates(snapshot, { signal, onProgress, services = { fetchCatalog, fetchPackage, fetchReadme } } = {}) {
  const { machineType, os } = identifyCapture(snapshot);
  if (!machineType || !os) throw new Error('The capture needs an unambiguous machine type and Windows 10 or 11 identity.');
  const checkAbort = () => { if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError'); };
  checkAbort();
  const catalog = await services.fetchCatalog(machineType, os, { signal });
  checkAbort();
  const selected = catalog.packages.filter(entry => packageKind(entry));
  if (selected.length > 40) throw new Error('Too many BIOS or wireless catalog entries for a bounded prototype check.');
  const rows = [], errors = [];
  onProgress?.({ completed: 0, total: selected.length });
  // The PowerShell host serves sequentially; keep requests bounded and cancellable.
  for (const [index, entry] of selected.entries()) {
    checkAbort();
    const kind = packageKind(entry);
    try {
      const pkg = await services.fetchPackage(entry, { signal });
      checkAbort();
      let readme = null;
      if (pkg.readmeUrl) {
        try { readme = await services.fetchReadme(pkg.readmeUrl, { signal }); }
        catch (error) {
          checkAbort();
          if (error?.name === 'AbortError') throw error;
          errors.push({ url: pkg.readmeUrl, message: error?.message || 'Readme request failed.' });
        }
      }
      checkAbort();
      rows.push(assessPackage(snapshot, pkg, readme, kind));
    } catch (error) {
      checkAbort();
      if (error?.name === 'AbortError') throw error;
      errors.push({ url: entry.url, message: error?.message || 'Package request failed.' });
      const row = baseRow(kind, { sourceUrl: entry.url, title: entry.category }, null);
      row.reasons.push('package-query-failed'); rows.push(row);
    }
    onProgress?.({ completed: index + 1, total: selected.length });
  }
  for (const kind of KINDS) if (!selected.some(entry => packageKind(entry) === kind)) {
    const row = baseRow(kind, null, null); row.reasons.push('catalog-no-package'); rows.push(row);
  }
  return { rows, catalog, retrievedAt: catalog.retrievedAt, machineType, os, errors, scope: 'catalog' };
}
