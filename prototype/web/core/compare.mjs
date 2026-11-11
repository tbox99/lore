// Compare reported evidence, not package applicability or physical hardware identity.
// Driver names are provisional row labels: matching names do not establish a device match.

const PLATFORM_FIELDS = ['bios', 'ec', 'meFirmware', 'os', 'build'];
const STATUSES = ['same', 'different', 'onlyA', 'onlyB', 'unresolved'];
const COVERAGE = new Set(['read', 'partial', 'missing', 'failed']);
const PLACEHOLDERS = new Set([
  '-', '–', '—', '?', 'n/a', 'n.a.', 'na', 'none', 'null', 'unknown', 'unavailable',
  'not available', 'not applicable', 'not specified', 'not determined', 'not collected',
  'unbekannt', 'nicht verfügbar', 'nicht verfuegbar', 'nicht ermittelt', 'nicht zutreffend',
  'nicht angegeben', 'nicht erhoben', 'to be filled by o.e.m.', 'to be filled by oem',
  'default string', 'system serial number', 'invalid',
]);

// No numeric coercion, suffix removal or ordering: vendor version semantics vary.
function normalized(value) { return String(value ?? '').trim().replace(/\s+/g, ' '); }
function known(value) {
  const result = normalized(value);
  return result && !PLACEHOLDERS.has(result.toLowerCase()) ? result : null;
}
function rawValue(value) { return known(value) === null ? null : String(value); }
function coverageStatus(value) { return COVERAGE.has(value) ? value : 'unknown'; }
function sourceRefs(values) {
  const result = [], seen = new Set();
  for (const value of values) {
    const path = value?.path || value?.source;
    if (typeof path !== 'string' || !path) continue;
    const line = Number.isSafeInteger(value.line) && value.line > 0 ? value.line : null;
    const key = JSON.stringify([path, line]);
    if (!seen.has(key)) { result.push({ path, line }); seen.add(key); }
  }
  return result;
}
function fieldConflicts(snapshot, field) {
  return (snapshot?.warnings || []).filter(warning => warning.kind === 'conflict' &&
    warning.messageDescriptor?.key === 'warning.conflict' && warning.messageDescriptor.params?.field === field);
}
function fieldCell(snapshot, field) {
  const primary = snapshot?.sources?.[field];
  const conflicts = fieldConflicts(snapshot, field);
  return {
    value: rawValue(snapshot?.device?.[field]),
    sources: sourceRefs([primary, ...conflicts]),
    coverage: coverageStatus((snapshot?.coverage || []).find(item => item.source === primary?.path)?.status),
    conflict: conflicts.length > 0,
  };
}
function usable(cell) { return cell.sources.length > 0 && ['read', 'partial'].includes(cell.coverage); }
function platformRow(a, b, field) {
  const left = fieldCell(a, field), right = fieldCell(b, field);
  let status = 'unresolved', reason;
  if (left.conflict || right.conflict) reason = 'platform_conflict';
  else if (left.value === null || right.value === null) reason = 'platform_missing';
  else if (!usable(left) || !usable(right)) reason = 'platform_unreadable';
  else {
    status = normalized(left.value) === normalized(right.value) ? 'same' : 'different';
    reason = `platform_${status}`;
  }
  return { id: `platform:${field}`, kind: 'platform', field, status, reason, matchBasis: 'field', a: left, b: right };
}

function serialEvidence(snapshot) {
  const cell = fieldCell(snapshot, 'serial');
  const value = known(cell.value)?.toUpperCase();
  if (!value || cell.conflict || !usable(cell) || /^(?:0+|F+)$/.test(value)) return null;
  return value;
}
function identity(a, b) {
  const serialA = serialEvidence(a), serialB = serialEvidence(b);
  if (!serialA || !serialB) return 'unknown';
  if (serialA !== serialB) return 'different-devices';
  const mtmA = known(a?.device?.mtm)?.toUpperCase(), mtmB = known(b?.device?.mtm)?.toUpperCase();
  if (fieldConflicts(a, 'mtm').length || fieldConflicts(b, 'mtm').length ||
      (mtmA && mtmB && mtmA !== mtmB)) return 'unknown';
  return 'same-device';
}

function inventory(snapshot) {
  const items = (snapshot?.coverage || []).filter(item =>
    item.labelDescriptor?.key === 'coverage.drivers' || /(?:^|\/)Installed-HWD\/Drivers\.log$/i.test(item.source || ''));
  // More than one inventory source is not silently combined into a complete one.
  const status = items.length === 1 ? coverageStatus(items[0].status) : 'unknown';
  return { status, sources: sourceRefs(items) };
}
function groupDrivers(snapshot) {
  const groups = new Map();
  for (const item of snapshot?.drivers || []) {
    const key = normalized(item.name).toLowerCase();
    const record = { name: String(item.name ?? ''), version: item.version == null ? null : String(item.version), source: item.source, line: item.line };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
}
function driverCell(records, coverage) {
  return {
    value: records.length === 1 ? rawValue(records[0].version) : null,
    sources: records.length ? sourceRefs(records) : coverage.sources.map(source => ({ ...source })),
    records: records.map(record => ({ ...record })),
    coverage: coverage.status,
  };
}
function driverRow(key, recordsA, recordsB, inventoryA, inventoryB) {
  const a = driverCell(recordsA, inventoryA), b = driverCell(recordsB, inventoryB);
  let status = 'unresolved', reason, matchBasis = 'name-only';
  if (!key || recordsA.length > 1 || recordsB.length > 1) {
    reason = 'driver_duplicate'; matchBasis = 'ambiguous';
  } else if (recordsA.length && recordsB.length) {
    if (a.value === null || b.value === null) reason = 'driver_missing_version';
    else if (!usable(a) || !usable(b)) reason = 'driver_incomplete';
    else {
      status = normalized(a.value) === normalized(b.value) ? 'same' : 'different';
      reason = `driver_${status}`;
    }
  } else {
    const present = recordsA.length ? a : b;
    const other = recordsA.length ? inventoryB : inventoryA;
    matchBasis = 'none';
    if (present.value === null) reason = 'driver_missing_version';
    else if (!usable(present) || other.status !== 'read') reason = 'driver_incomplete';
    else {
      status = recordsA.length ? 'onlyA' : 'onlyB';
      reason = `driver_${status}`;
    }
  }
  return {
    id: `driver:${key}`, kind: 'driver', name: recordsA[0]?.name || recordsB[0]?.name || '—',
    status, reason, matchBasis, a, b,
  };
}

export function compareSnapshots(a, b) {
  const platformRows = PLATFORM_FIELDS.map(field => platformRow(a, b, field));
  const groupsA = groupDrivers(a), groupsB = groupDrivers(b);
  const inventoryA = inventory(a), inventoryB = inventory(b);
  const keys = [...new Set([...groupsA.keys(), ...groupsB.keys()])].sort();
  const driverRows = keys.map(key => driverRow(key, groupsA.get(key) || [], groupsB.get(key) || [], inventoryA, inventoryB));
  if (inventoryA.status !== 'read' || inventoryB.status !== 'read') {
    driverRows.unshift({
      id: 'inventory:drivers', kind: 'driver', field: 'driverInventory', name: null, summary: true,
      status: 'unresolved', reason: 'driver_inventory_incomplete', matchBasis: 'none',
      a: driverCell([], inventoryA), b: driverCell([], inventoryB),
    });
  }
  const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  for (const row of [...platformRows, ...driverRows]) counts[row.status] += 1;
  return { identity: identity(a, b), platformRows, driverRows, counts };
}
