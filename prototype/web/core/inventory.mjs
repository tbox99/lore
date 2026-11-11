// CDAT evidence adapters. Driver-store rows are never active-device evidence on their own.
const norm = value => String(value || '').trim().toUpperCase();
const nameKey = value => norm(value).replace(/\s+/g, ' ');
const ref = (path, line) => ({ path, line });
const versionPattern = /^\d+(?:\.\d+){1,3}$/;
const infPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.inf$/i;
const instanceValid = value => typeof value === 'string' && value.length < 200 &&
  /^[^\\\s]+\\[^\\\s]+\\[^\s]+$/.test(value) && !/(?:\.\.\.|…)/.test(value);
function result(records, skipped, recognized) {
  return { records, skipped: [...new Set(skipped)], status: !recognized || !records.length ? 'failed' : skipped.length ? 'partial' : 'read' };
}

export function parsePnpTable(text, path) {
  const records = [], skipped = [], lines = text.split(/\r?\n/);
  let columns = null, current = null, recognized = false;
  function flush() {
    if (!current) return;
    current.instanceId = current.instanceId.trim(); current.name = current.name.trim();
    if (!instanceValid(current.instanceId)) { skipped.push(current.sources[0].line); current.issues.push('invalid-instance'); }
    records.push(current); current = null;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bStatus\s+(?:Class\s+)?FriendlyName\s+InstanceId\s*$/.test(line)) {
      flush(); columns = { name: line.indexOf('FriendlyName'), id: line.indexOf('InstanceId'), class: line.indexOf('Class') }; recognized = true; continue;
    }
    if (!columns) continue;
    if (/^\s*-{3,}/.test(line)) continue;
    if (!line.trim()) { flush(); columns = null; continue; }
    const statusEnd = columns.class >= 0 ? columns.class : columns.name;
    const status = line.slice(0, statusEnd).trim();
    const name = line.slice(columns.name, columns.id).trim();
    const instance = line.slice(columns.id).trim();
    if (/^(?:OK|Unknown|Error|Degraded)$/i.test(status)) {
      flush(); current = { name, instanceId: instance, status, className: columns.class >= 0 ? line.slice(columns.class, columns.name).trim() : null, sources: [ref(path, i + 1)], issues: [] };
    } else if (!status && current && (name || instance)) {
      if (name) current.name += ' ' + name;
      current.instanceId += instance;
      current.sources.push(ref(path, i + 1));
    } else { flush(); skipped.push(i + 1); }
  }
  flush();
  return result(records, skipped, recognized);
}

export function parseInfBindings(text, path) {
  const records = [], skipped = [];
  let current = null, recognized = false;
  function flush() {
    if (!current) return;
    if (!instanceValid(current.instanceId) || !current.publishedInf || current.issues.length) {
      skipped.push(current.sources[0].line);
      if (!instanceValid(current.instanceId)) current.issues.push('invalid-instance');
      if (!current.publishedInf) current.issues.push('missing-inf');
    }
    records.push(current); current = null;
  }
  text.split(/\r?\n/).forEach((line, i) => {
    const device = line.match(/^\s*Current Device ID is\s+(.+?)\s*$/i);
    if (device) { flush(); recognized = true; current = { instanceId: device[1], publishedInf: null, sources: [ref(path, i + 1)], issues: [] }; return; }
    if (/^\s*Current INF file is\s+/i.test(line)) {
      if (!current) { skipped.push(i + 1); return; }
      const matches = [...line.matchAll(/(?:^|[\\/])([A-Za-z0-9][A-Za-z0-9_.-]*\.inf)(?=["'\s]|$)/gi)];
      if (matches.length !== 1 || current.publishedInf) current.issues.push('ambiguous-inf');
      else current.publishedInf = matches[0][1].toLowerCase();
      current.sources.push(ref(path, i + 1)); return;
    }
    if (/^\s*Installation date is:/i.test(line)) { if (current) current.sources.push(ref(path, i + 1)); return; }
    if (line.trim()) { skipped.push(i + 1); if (current) current.issues.push('unreadable-binding'); }
  });
  flush(); return result(records, skipped, recognized);
}

export function parseDriverStore(text, path) {
  const records = [], skipped = [];
  let recognized = false;
  text.split(/\r?\n/).forEach((line, i) => {
    const parts = line.split('|').map(value => value.trim());
    if (parts.length === 7 && /^Published Name$/i.test(parts[0]) && /^Original File Name$/i.test(parts[1]) && /^Version$/i.test(parts[6])) { recognized = true; return; }
    if (!recognized || /^\s*[-| ]+$/.test(line) || !line.trim()) return;
    if (/^The operation completed successfully\.?$/i.test(line.trim())) return;
    const valid = parts.length === 7 && /^oem\d+\.inf$/i.test(parts[0]) && infPattern.test(parts[1]) && versionPattern.test(parts[6]);
    if (!valid) skipped.push(i + 1);
    // Retain identifiable damaged rows so they cannot hide a duplicate published INF.
    if (!/^oem\d+\.inf$/i.test(parts[0])) return;
    records.push({ publishedInf: parts[0].toLowerCase(), originalInf: infPattern.test(parts[1] || '') ? parts[1].toLowerCase() : null, className: parts[3] || null, provider: parts[4] || null, date: parts[5] || null, version: versionPattern.test(parts[6] || '') ? parts[6] : null, scope: 'driver-store', issues: valid ? [] : ['invalid-store-row'], sources: [ref(path, i + 1)] });
  });
  return result(records, skipped, recognized);
}

export function parseWlanReport(text, path) {
  const records = [], skipped = [];
  let current = null, recognized = false;
  function flush() {
    if (!current) return;
    if (!current.name || !versionPattern.test(current.version || '') || !infPattern.test(current.publishedInf || '') || current.issues.length) {
      skipped.push(current.sources[0].line); current.issues.push('incomplete-radio-report');
    }
    records.push(current); current = null;
  }
  text.split(/\r?\n/).forEach((line, i) => {
    const match = line.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/);
    if (!line.trim() && current) { flush(); return; }
    if (!match) return;
    const key = match[1].trim().toLowerCase();
    if (key === 'driver' || key === 'treiber') { flush(); recognized = true; current = { name: match[2], version: null, publishedInf: null, sources: [ref(path, i + 1)], issues: [] }; return; }
    if (!current) return;
    const field = { version: 'version', 'inf file': 'publishedInf', 'inf-datei': 'publishedInf', provider: 'provider', anbieter: 'provider' }[key];
    if (!field) return;
    if (current[field] && nameKey(current[field]) !== nameKey(match[2])) current.issues.push('conflicting-radio-report');
    current[field] = field === 'publishedInf' ? match[2].toLowerCase() : match[2];
    current.sources.push(ref(path, i + 1));
  });
  flush(); return result(records, skipped, recognized);
}

export function parseBluetoothReport(text, path) {
  const pnp = parsePnpTable(text, path), records = [], skipped = [...pnp.skipped];
  const summaries = []; let current = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const device = line.match(/^\s*Device\s*:\s*(.*?)\s*$/i);
    if (device) { current = { name: device[1], version: null, sources: [ref(path, i + 1)], issues: [] }; summaries.push(current); return; }
    const version = line.match(/^\s*Driver\s*:\s*(.*?)\s*$/i);
    if (version && current) { if (current.version && current.version !== version[1]) { skipped.push(i + 1); current.issues.push('conflicting-radio-report'); } current.version = version[1]; current.sources.push(ref(path, i + 1)); }
  });
  for (const summary of summaries) {
    const matches = pnp.records.filter(row => nameKey(row.name) === nameKey(summary.name) && /^(?:USB|PCI)\\/i.test(row.instanceId));
    const issues = [...summary.issues];
    if (!versionPattern.test(summary.version || '')) issues.push('incomplete-radio-report');
    if (matches.length !== 1 || matches[0]?.issues.length) issues.push('ambiguous-radio-report');
    if (issues.length) skipped.push(summary.sources[0].line);
    records.push({ ...summary, instanceId: matches.length === 1 ? matches[0].instanceId : null, status: matches.length === 1 ? matches[0].status : null, sources: [...summary.sources, ...matches.flatMap(row => row.sources)], issues });
  }
  return result(records, skipped, summaries.length > 0);
}

const adapters = { hardware: parsePnpTable, bindings: parseInfBindings, store: parseDriverStore, wlan: parseWlanReport, bluetooth: parseBluetoothReport };
const keyBy = (records, key) => {
  const map = new Map();
  for (const record of records) { const value = norm(record[key]); if (!map.has(value)) map.set(value, []); map.get(value).push(record); }
  return map;
};
const uniqueRefs = refs => [...new Map(refs.map(item => [`${item.path}:${item.line}`, item])).values()];

export function buildInventory(documents, reportedDrivers = []) {
  const parsed = {}, coverage = [];
  for (const kind of Object.keys(adapters)) {
    const doc = documents.find(item => item.kind === kind);
    const data = doc?.text != null ? adapters[kind](doc.text, doc.path) : { records: [], skipped: [], status: doc?.status || 'missing' };
    if (doc?.text && /FullyQualifiedErrorId\s*:/i.test(doc.text)) {
      data.status = data.records.length ? 'partial' : 'failed';
      for (const row of data.records) { row.issues ||= []; row.issues.push('source-collection-failure'); }
    }
    parsed[kind] = data;
    coverage.push({ kind, source: doc?.path || '', status: data.status, read: data.records.length, skipped: data.skipped });
  }
  const hardware = keyBy(parsed.hardware.records, 'instanceId');
  const bindings = keyBy(parsed.bindings.records, 'instanceId');
  const store = keyBy(parsed.store.records, 'publishedInf');
  const reported = keyBy(reportedDrivers.map(item => ({ ...item, name: nameKey(item.name) })), 'name');
  const ids = new Set([...hardware.keys(), ...bindings.keys()]);
  const devices = [];
  for (const id of ids) {
    const hw = hardware.get(id) || [], bound = bindings.get(id) || [];
    const first = hw[0] || bound[0];
    const issues = [...hw.flatMap(row => row.issues), ...bound.flatMap(row => row.issues)];
    if (hw.length > 1) issues.push('ambiguous-device');
    if (bound.length !== 1) issues.push(bound.length ? 'ambiguous-binding' : 'missing-binding');
    const publishedInf = bound.length === 1 ? bound[0].publishedInf : null;
    const packages = store.get(norm(publishedInf)) || [];
    if (packages.length !== 1) issues.push(packages.length ? 'ambiguous-store' : 'missing-store');
    const pkg = packages.length === 1 ? packages[0] : null;
    issues.push(...packages.flatMap(row => row.issues));
    const name = hw.length === 1 ? hw[0].name : null;
    const reportedRows = name ? reported.get(nameKey(name)) || [] : [];
    if (reportedRows.length > 1) issues.push('ambiguous-reported-driver');
    if (pkg && reportedRows.length === 1 && pkg.version !== reportedRows[0].version) issues.push('conflicting-version');
    const validId = instanceValid(first.instanceId);
    // Prefixes are derived for source-consistent rule comparisons only, not an observed HardwareIds list.
    const derivedHardwareIds = validId && /^(?:PCI|USB)\\/i.test(first.instanceId) ? [first.instanceId.split('\\').slice(0, 2).join('\\')] : [];
    const device = { instanceId: first.instanceId, name, status: hw.length === 1 ? hw[0].status : null,
      presence: 'unknown', kind: null, hardwareIds: [], derivedHardwareIds, publishedInf,
      originalInf: pkg?.originalInf || null, provider: pkg?.provider || null, className: pkg?.className || null,
      version: pkg?.version || null, binding: !issues.length && validId ? 'device-inf' : 'unresolved',
      corroboration: null, issues: [...new Set(issues)], sources: uniqueRefs([...hw.flatMap(row => row.sources), ...bound.flatMap(row => row.sources), ...packages.flatMap(row => row.sources), ...reportedRows.map(row => ref(row.source, row.line)).filter(row => row.path)]), radioSources: [] };
    devices.push(device);
  }
  function corroborate(kind, report, candidates) {
    if (candidates.length !== 1) return;
    const device = candidates[0];
    device.kind = kind; device.radioSources.push(...report.sources); device.sources = uniqueRefs([...device.sources, ...report.sources]);
    device.issues.push(...report.issues);
    if (device.kind && device.corroboration) device.issues.push('ambiguous-radio');
    if (report.version !== device.version) device.issues.push('conflicting-radio-version');
    if (norm(device.status) !== 'OK' || (report.status && norm(report.status) !== 'OK')) device.issues.push('radio-status-unknown');
    if (!device.issues.length && device.binding === 'device-inf') { device.presence = 'reported'; device.corroboration = 'radio-report'; }
    else { device.presence = 'unknown'; device.binding = 'unresolved'; device.corroboration = null; }
    device.issues = [...new Set(device.issues)];
  }
  for (const radio of parsed.wlan.records) {
    const candidates = devices.filter(item => norm(item.publishedInf) === norm(radio.publishedInf) && nameKey(item.name) === nameKey(radio.name));
    corroborate('wlan', radio, candidates);
  }
  for (const radio of parsed.bluetooth.records) corroborate('bluetooth', radio, devices.filter(item => norm(item.instanceId) === norm(radio.instanceId) && nameKey(item.name) === nameKey(radio.name)));
  return { devices, driverStore: parsed.store.records, coverage };
}
