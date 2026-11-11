import { openZip } from './zip.mjs';

export function decodeText(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Textkodierung nicht eindeutig lesbar; keine automatische Zeichensatz-Vermutung.'); }
}

function keyValues(text) {
  const values = new Map();
  text.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*([\w][\w ()/-]*?)\s*:\s*(.*?)\s*$/);
    if (match && !values.has(match[1].toLowerCase())) values.set(match[1].toLowerCase(), { value: match[2], line: index + 1 });
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
  const device = Object.fromEntries(['model', 'mtm', 'serial', 'bios', 'ec', 'meFirmware', 'os', 'build', 'capturedAt', 'cdatVersion'].map(name => [name, null]));
  const findUnique = (pattern, label) => {
    const found = files.filter(entry => pattern.test(entry.name));
    if (found.length > 1) throw new Error(`Mehrere Quellen für ${label} im Archiv. Bitte eine einzelne CDAT-Aufnahme verwenden.`);
    return found[0]?.name || null;
  };
  const manifestPath = findUnique(/(^|\/)FileDetails\.json$/i, 'Dateiverzeichnis');
  const quickPath = findUnique(/(^|\/)CDAT[^/]*-QuickData-[^/]+\.log$/i, 'QuickData');
  const computerPath = findUnique(/(^|\/)CDAT[^/]*-ComputerInfo-[^/]+\.log$/i, 'ComputerInfo');
  const driverPath = findUnique(/(^|\/)Installed-HWD\/Drivers\.log$/i, 'Gerätetreiber');
  const issuesPath = findUnique(/(^|\/)CDAT[^/]*-Issues-[^/]+\.log$/i, 'Erfassungsprobleme');
  if (!manifestPath && !quickPath) throw new Error('Keine unterstützte CDAT-Aufnahme gefunden (FileDetails.json oder QuickData fehlt).');
  const roots = new Set([manifestPath, quickPath, computerPath, issuesPath]
    .filter(Boolean).map(path => path.slice(0, path.lastIndexOf('/') + 1).toLowerCase()));
  if (driverPath) roots.add(driverPath.slice(0, -'Installed-HWD/Drivers.log'.length).toLowerCase());
  if (roots.size > 1) throw new Error('Die Quellen liegen in verschiedenen Aufnahmeordnern. Bitte jede CDAT-Aufnahme als eigenes ZIP öffnen.');

  async function load(path, label) {
    if (!path) { coverage.push({ label, status: 'missing', source: '', detail: 'Quelldatei fehlt; Zustand nicht ermittelt.' }); return null; }
    try {
      const text = decodeText(await zip.read(path));
      if (!text.trim()) throw new Error('Quelldatei ist leer.');
      texts[path] = text;
      coverage.push({ label, status: 'read', source: path, detail: 'Quelldatei gelesen; kein Vollständigkeitsnachweis.' });
      return text;
    } catch (error) {
      coverage.push({ label, status: 'failed', source: path, detail: error.message });
      warnings.push({ kind: 'import', message: `${label}: ${error.message}`, source: path, line: null });
      return null;
    }
  }
  const manifestText = await load(manifestPath, 'CDAT-Dateiverzeichnis');
  if (manifestText !== null) {
    try {
      const manifest = JSON.parse(manifestText);
      if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.Files)) throw new Error('Unbekannte Struktur in FileDetails.json.');
      for (const [field, key] of [['mtm', 'Mtm'], ['serial', 'Sn'], ['cdatVersion', 'Version']]) {
        const value = manifest[key];
        if (typeof value === 'string' || typeof value === 'number') { device[field] = String(value); sources[field] = { path: manifestPath, line: null }; }
      }
    } catch (error) {
      const item = coverage.find(item => item.source === manifestPath);
      item.status = 'failed'; item.detail = 'JSON-Struktur nicht auswertbar.';
      warnings.push({ kind: 'parse', message: 'FileDetails.json ist nicht als CDAT-Verzeichnis auswertbar.', source: manifestPath, line: null });
    }
  }
  const quickText = await load(quickPath, 'Geräteübersicht');
  const computerText = await load(computerPath, 'Systeminformationen');
  const driverText = await load(driverPath, 'Gemeldete Gerätetreiber');
  const issuesText = await load(issuesPath, 'Erfassungshinweise');
  function assign(field, candidate, path) {
    if (!candidate?.value) return;
    if (device[field] && device[field] !== candidate.value) {
      warnings.push({ kind: 'conflict', message: `Abweichende Angaben für ${field}; die bevorzugte Quelle wird angezeigt.`, source: path, line: candidate.line });
      return;
    }
    if (device[field]) return;
    device[field] = candidate.value; sources[field] = { path, line: candidate.line };
  }
  if (quickText) {
    const kv = keyValues(quickText);
    for (const [field, key] of Object.entries({ model: 'system', mtm: 'mtm', serial: 'sn', bios: 'bios', ec: 'ec', meFirmware: 'me fw', os: 'win os', build: 'build', capturedAt: 'date' })) assign(field, kv.get(key), quickPath);
    if (!device.cdatVersion) {
      const version = quickText.match(/CDAT v([\d.]+) Collection/);
      if (version) assign('cdatVersion', { value: version[1], line: quickText.slice(0, version.index).split('\n').length }, quickPath);
    }
  }
  if (computerText) {
    const kv = keyValues(computerText);
    for (const [field, key] of Object.entries({ mtm: 'csmodel', serial: 'biosseralnumber', bios: 'biossmbiosbiosversion', os: 'osname', build: 'osversion' })) assign(field, kv.get(key), computerPath);
  }
  let drivers = [];
  if (driverText) {
    const parsed = parseDrivers(driverText, driverPath); drivers = parsed.drivers;
    if (!drivers.length || parsed.skipped.length) {
      const item = coverage.find(item => item.source === driverPath);
      item.status = drivers.length ? 'partial' : 'failed'; item.detail = `${drivers.length} Zeilen erkannt; ${parsed.skipped.length} nicht eindeutig lesbar.`;
      warnings.push({ kind: 'parse', message: 'Die Gerätetreibertabelle konnte nur teilweise oder nicht gelesen werden.', source: driverPath, line: parsed.skipped[0] || 1 });
    }
  }
  for (const [path, text] of [[quickPath, quickText], [computerPath, computerText], [issuesPath, issuesText]]) {
    if (!text) continue;
    const seen = new Set();
    text.split(/\r?\n/).forEach((line, index) => {
      const failure = line.match(/FullyQualifiedErrorId\s*:\s*(.*)/i);
      if (!failure || seen.has(failure[1])) return;
      seen.add(failure[1]);
      warnings.push({ kind: 'collection', message: `Fehlgeschlagene CDAT-Abfrage: ${failure[1].slice(0, 160)}`, source: path, line: index + 1 });
      const item = coverage.find(item => item.source === path);
      if (item?.status === 'read') { item.status = 'partial'; item.detail = 'Datei gelesen; CDAT meldet mindestens eine fehlgeschlagene Abfrage.'; }
    });
  }
  if (!Object.values(device).some(Boolean) && !drivers.length) throw new Error('Die CDAT-Quellen liefern keine auswertbaren Gerätedaten.');
  return {
    device, sources, drivers, warnings, coverage, texts,
    archive: { fileName: file.name || 'CDAT.zip', entryCount: files.length, totalUncompressedBytes: zip.totalUncompressedBytes, readBytes: zip.readBytes },
    files: files.map(({ name, size, compressedSize }) => ({ name, size, compressedSize })),
  };
}
