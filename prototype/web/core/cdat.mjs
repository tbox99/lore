import { openZip } from './zip.mjs';
import { message, messageError, formatMessage } from './messages.mjs';
import { buildInventory } from './inventory.mjs';

export function decodeText(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw messageError('cdat.encoding'); }
}

function keyValues(text) {
  const values = new Map();
  text.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*([\w][\w ()/-]*?)\s*:\s*(.*?)\s*$/);
    if (!match) return;
    const key = match[1].toLowerCase();
    if (!values.has(key)) values.set(key, []);
    values.get(key).push({ value: match[2], line: index + 1 });
  });
  return values;
}

export function parseDrivers(text, source) {
  const drivers = [], skipped = [];
  let inTable = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*-{3,}\s+-{3,}/.test(line)) { inTable = true; return; }
    if (!inTable || !line.trim()) return;
    const match = line.match(/^\s*(\S.*?)\s+([A-Za-z0-9][A-Za-z0-9._()+-]*)\s*$/);
    if (match && /\d/.test(match[2])) drivers.push({ name: match[1].trim(), version: match[2], source, line: index + 1 });
    else skipped.push(index + 1);
  });
  return { drivers, skipped };
}

export async function importCdat(file) {
  const zip = await openZip(file);
  const files = zip.entries.filter(entry => !entry.isDirectory);
  const warnings = [], coverage = [], texts = Object.create(null), sources = Object.create(null);
  const device = Object.fromEntries(['model', 'mtm', 'serial', 'bios', 'ec', 'meFirmware', 'os', 'build', 'osArchitecture', 'capturedAt', 'cdatVersion'].map(name => [name, null]));
  const findUnique = (pattern, label) => {
    const found = files.filter(entry => pattern.test(entry.name));
    if (found.length > 1) throw messageError('cdat.multipleSources', { label });
    return found[0]?.name || null;
  };
  const manifestPath = findUnique(/(^|\/)FileDetails\.json$/i, message('coverage.manifest'));
  const quickPath = findUnique(/(^|\/)CDAT[^/]*-QuickData-[^/]+\.log$/i, 'QuickData');
  const computerPath = findUnique(/(^|\/)CDAT[^/]*-ComputerInfo-[^/]+\.log$/i, 'ComputerInfo');
  const driverPath = findUnique(/(^|\/)Installed-HWD\/Drivers\.log$/i, message('coverage.drivers'));
  const issuesPath = findUnique(/(^|\/)CDAT[^/]*-Issues-[^/]+\.log$/i, message('coverage.issues'));
  const inventorySources = [
    ['hardware', 'Installed-HWD/InstalledHardwareList.log'],
    ['bindings', 'Installed-HWD/DriversINFInstallDate.log'],
    ['store', 'Installed-HWD/Driver3rdPartyOEMINF.log'],
    ['wlan', 'Network/WLANnetsh.log'],
    ['bluetooth', 'Network/BluetoothSystemReport.log'],
  ].map(([kind, suffix]) => ({ kind, suffix, path: findUnique(new RegExp('(^|/)' + suffix.replaceAll('.', '\\.') + '$', 'i'), message('coverage.' + kind)) }));
  if (!manifestPath && !quickPath) throw messageError('cdat.unsupported');
  const roots = new Set([manifestPath, quickPath, computerPath, issuesPath]
    .filter(Boolean).map(path => path.slice(0, path.lastIndexOf('/') + 1).toLowerCase()));
  if (driverPath) roots.add(driverPath.slice(0, -'Installed-HWD/Drivers.log'.length).toLowerCase());
  for (const item of inventorySources) if (item.path) roots.add(item.path.slice(0, -item.suffix.length).toLowerCase());
  if (roots.size > 1) throw messageError('cdat.mixedRoots');

  function coverageItem(labelDescriptor, status, source, detailDescriptor) {
    return { label: formatMessage(labelDescriptor), labelDescriptor, status, source,
      detail: formatMessage(detailDescriptor), detailDescriptor };
  }
  function addWarning(kind, messageDescriptor, source, line = null) {
    warnings.push({ kind, message: formatMessage(messageDescriptor), messageDescriptor, source, line });
  }
  function setDetail(item, descriptor) { item.detailDescriptor = descriptor; item.detail = formatMessage(descriptor); }
  async function load(path, labelDescriptor, maxBytes = 4 * 1024 ** 2) {
    if (!path) { coverage.push(coverageItem(labelDescriptor, 'missing', '', message('coverage.missing'))); return null; }
    try {
      const text = decodeText(await zip.read(path, { maxBytes }));
      if (!text.trim()) throw messageError('cdat.emptySource');
      texts[path] = text;
      coverage.push(coverageItem(labelDescriptor, 'read', path, message('coverage.read')));
      return text;
    } catch (error) {
      const detail = error.messageDescriptor || error.message;
      coverage.push(coverageItem(labelDescriptor, 'failed', path, detail));
      addWarning('import', message('warning.sourceFailure', { label: labelDescriptor, detail }), path);
      return null;
    }
  }
  const manifestText = await load(manifestPath, message('coverage.manifest'));
  if (manifestText !== null) {
    try {
      const manifest = JSON.parse(manifestText);
      if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.Files)) throw messageError('cdat.manifestStructure');
      for (const [field, key] of [['mtm', 'Mtm'], ['serial', 'Sn'], ['cdatVersion', 'Version']]) {
        const value = manifest[key];
        if (typeof value === 'string' || typeof value === 'number') { device[field] = String(value); sources[field] = { path: manifestPath, line: null }; }
      }
    } catch (error) {
      const item = coverage.find(item => item.source === manifestPath);
      item.status = 'failed'; setDetail(item, message('coverage.invalidJson'));
      addWarning('parse', message('warning.manifest'), manifestPath);
    }
  }
  const quickText = await load(quickPath, message('coverage.quick'));
  const computerText = await load(computerPath, message('coverage.computer'));
  const driverText = await load(driverPath, message('coverage.drivers'));
  const issuesText = await load(issuesPath, message('coverage.issues'));
  function conflict(field, path, line) {
    if (warnings.some(item => item.kind === 'conflict' && item.source === path && item.line === line && item.messageDescriptor?.params?.field === field)) return;
    addWarning('conflict', message('warning.conflict', { field }), path, line);
  }
  function assign(field, candidate, path) {
    if (!candidate?.value) return;
    if (device[field] && device[field] !== candidate.value) {
      conflict(field, path, candidate.line);
      return;
    }
    if (device[field]) return;
    device[field] = candidate.value; sources[field] = { path, line: candidate.line };
  }
  function assignOccurrences(field, candidates = [], path) {
    const nonempty = candidates.filter(candidate => candidate.value);
    for (const candidate of nonempty) assign(field, candidate, path);
    // Preserve every line involved in a within-source disagreement, even when
    // the displayed value came from a higher-priority source such as the manifest.
    if (new Set(nonempty.map(candidate => candidate.value)).size > 1) {
      for (const candidate of nonempty) conflict(field, path, candidate.line);
    }
  }
  if (quickText) {
    const kv = keyValues(quickText);
    for (const [field, key] of Object.entries({ model: 'system', mtm: 'mtm', serial: 'sn', bios: 'bios', ec: 'ec', meFirmware: 'me fw', os: 'win os', build: 'build', capturedAt: 'date' })) assignOccurrences(field, kv.get(key), quickPath);
    if (!device.cdatVersion) {
      const version = quickText.match(/CDAT v([\d.]+) Collection/);
      if (version) assign('cdatVersion', { value: version[1], line: quickText.slice(0, version.index).split('\n').length }, quickPath);
    }
  }
  if (computerText) {
    const kv = keyValues(computerText);
    for (const [field, key] of Object.entries({ mtm: 'csmodel', serial: 'biosseralnumber', bios: 'biossmbiosbiosversion', os: 'osname', build: 'osversion', osArchitecture: 'osarchitecture' })) assignOccurrences(field, kv.get(key), computerPath);
  }
  let drivers = [];
  if (driverText) {
    const parsed = parseDrivers(driverText, driverPath); drivers = parsed.drivers;
    if (!drivers.length || parsed.skipped.length) {
      const item = coverage.find(item => item.source === driverPath);
      item.status = drivers.length ? 'partial' : 'failed'; setDetail(item, message('coverage.driverRows', { read: drivers.length, skipped: parsed.skipped.length }));
      addWarning('parse', message('warning.driverTable'), driverPath, parsed.skipped[0] || 1);
    }
  }
  for (const [path, text] of [[quickPath, quickText], [computerPath, computerText], [issuesPath, issuesText]]) {
    if (!text) continue;
    const seen = new Set();
    text.split(/\r?\n/).forEach((line, index) => {
      const failure = line.match(/FullyQualifiedErrorId\s*:\s*(.*)/i);
      if (!failure || seen.has(failure[1])) return;
      seen.add(failure[1]);
      addWarning('collection', message('warning.collection', { error: failure[1].slice(0, 160) }), path, index + 1);
      const item = coverage.find(item => item.source === path);
      if (item?.status === 'read') { item.status = 'partial'; setDetail(item, message('coverage.collectionFailure')); }
    });
  }
  if (!Object.values(device).some(Boolean) && !drivers.length) throw messageError('cdat.noDeviceData');
  const inventoryDocuments = [];
  for (const item of inventorySources) {
    const text = await load(item.path, message('coverage.' + item.kind), 1024 ** 2);
    const loaded = coverage[coverage.length - 1];
    inventoryDocuments.push({ ...item, text, status: loaded.status });
  }
  const inventory = buildInventory(inventoryDocuments, drivers);
  for (const item of inventory.coverage) {
    const loaded = coverage.find(row => row.labelDescriptor.key === 'coverage.' + item.kind);
    if (loaded?.status === 'read') {
      loaded.status = item.status;
      setDetail(loaded, message('coverage.inventoryRows', { read: item.read, skipped: item.skipped.length }));
    }
  }
  return {
    device, sources, drivers, warnings, coverage, texts, inventory,
    archive: { fileName: file.name || 'CDAT.zip', entryCount: files.length, totalUncompressedBytes: zip.totalUncompressedBytes, readBytes: zip.readBytes },
    files: files.map(({ name, size, compressedSize }) => ({ name, size, compressedSize })),
  };
}
