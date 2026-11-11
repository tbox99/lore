import { importCdat } from './core/cdat.mjs';
import { fetchCatalog, fetchPackage, fetchReadme } from './core/lenovo.mjs';

const $ = (id) => document.getElementById(id);
const state = { snapshot: null, catalog: null, package: null, selectedPackage: null, importing: false, importSeq: 0, catalogSeq: 0, detailSeq: 0, readmeSeq: 0 };
let catalogController = null;
let detailController = null;
let readmeController = null;
let dragDepth = 0;
const number = new Intl.NumberFormat('de-DE');
const fieldLabels = [
  ['model', 'Modell'], ['mtm', 'Machine Type Model'], ['serial', 'Seriennummer'], ['bios', 'BIOS'],
  ['ec', 'Embedded Controller'], ['meFirmware', 'Intel ME Firmware'], ['os', 'Betriebssystem'],
  ['build', 'Windows-Build'], ['capturedAt', 'Erfassungszeit laut Quelle'], ['cdatVersion', 'CDAT-Version'],
];

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}
function bytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return '–';
  if (size < 1024) return `${number.format(size)} B`;
  const unit = Math.min(3, Math.floor(Math.log(size) / Math.log(1024)));
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(size / 1024 ** unit)} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
}
function fileName(path) { return String(path || '').split(/[\\/]/).pop() || 'Quelle'; }
function status(id, message, busy = false) { $(id).textContent = message; $(id).classList.toggle('busy', busy); }
function error(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
function messageOf(err) { return err instanceof Error ? err.message : String(err); }
function humanTime(value) {
  if (!value) return 'Zeitpunkt nicht angegeben';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}
function safeLink(url, label) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !['download.lenovo.com', 'pcsupport.lenovo.com', 'support.lenovo.com'].includes(parsed.hostname)) return null;
    const link = node('a', '', label);
    link.href = parsed.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  } catch { return null; }
}
function showText(title, text, detail = '', kind = 'ORIGINALQUELLE') {
  const limit = 250_000;
  const body = String(text || '');
  $('source-title').textContent = title;
  $('source-kind').textContent = kind;
  $('source-detail').textContent = `${detail}${body.length > limit ? ' · Anzeige auf 250.000 Zeichen begrenzt.' : ''}`;
  $('source-text').textContent = body.slice(0, limit);
  $('source-text').scrollTop = 0;
  if (!$('source-dialog').open) $('source-dialog').showModal();
}
function sourceButton(path, line, label = null) {
  if (!path) return node('span', 'subtle', 'Quelle nicht angegeben');
  const hasText = Object.hasOwn(state.snapshot?.texts || {}, path);
  const display = label || `${fileName(path)}${line ? ` · Z. ${line}` : ''}`;
  if (!hasText) {
    const value = node('span', 'subtle', display);
    value.title = path;
    return value;
  }
  const button = node('button', 'source-button', display);
  button.type = 'button';
  button.title = `${path}${line ? `, Zeile ${line}` : ''}`;
  button.addEventListener('click', () => showText(path, state.snapshot.texts[path], line ? `Fundstelle: Zeile ${line}. Originaltext der eingelesenen Datei.` : 'Originaltext der eingelesenen Datei.'));
  return button;
}
function activateTab(name, focus = false) {
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`panel-${tab.dataset.tab}`).hidden = !selected;
    if (selected && focus) tab.focus();
  });
}
function resetLenovo() {
  state.catalogSeq += 1; state.detailSeq += 1; state.readmeSeq += 1;
  catalogController?.abort(); detailController?.abort(); readmeController?.abort();
  state.catalog = null; state.package = null; state.selectedPackage = null;
  $('catalog-content').hidden = true;
  $('package-detail').hidden = true;
  $('catalog-search').value = '';
  $('catalog-button').disabled = state.importing;
  error('catalog-error');
  status('catalog-status', 'Noch kein Katalog abgerufen.');
  status('readme-status', '');
}

function renderOverview() {
  const data = state.snapshot;
  $('overview-empty').hidden = !!data;
  $('overview-content').hidden = !data;
  $('driver-tab-count').textContent = number.format(data?.drivers?.length || 0);
  $('file-tab-count').textContent = number.format(data?.files?.length || 0);
  $('device-grid').replaceChildren(); $('coverage-list').replaceChildren(); $('warning-list').replaceChildren();
  if (!data) {
    $('capture-title').textContent = state.importing ? 'Aufnahme wird gelesen …' : 'Noch keine Aufnahme geöffnet';
    $('capture-meta').textContent = 'Ein ZIP genügt für den ersten Überblick.';
    $('capture-state').textContent = state.importing ? 'Import läuft' : 'Bereit';
    $('capture-state').className = 'capture-state';
    return;
  }
  const warnings = data.warnings || [];
  $('capture-title').textContent = data.device.model || data.device.mtm || 'CDAT-Aufnahme';
  $('capture-meta').textContent = `${data.archive.fileName || 'CDAT-Archiv'} · ${number.format(data.archive.entryCount)} Dateien · ${bytes(data.archive.totalUncompressedBytes)} entpackt`;
  $('capture-state').textContent = warnings.length ? `${number.format(warnings.length)} Hinweise` : 'Aufnahme eingelesen';
  $('capture-state').className = `capture-state ${warnings.length ? 'partial' : 'loaded'}`;
  for (const [key, label] of fieldLabels) {
    const item = node('div', 'device-item');
    const value = data.device[key];
    item.append(node('dt', '', label), node('dd', value ? '' : 'unknown', value || 'Nicht ermittelt'));
    const source = data.sources?.[key];
    if (source?.path) item.append(sourceButton(source.path, source.line, `Quelle${source.line ? ` · Z. ${source.line}` : ''}`));
    $('device-grid').append(item);
  }
  for (const coverage of data.coverage || []) {
    const li = node('li');
    const description = node('div');
    description.append(node('div', 'coverage-name', coverage.label));
    if (coverage.detail) description.append(node('p', 'coverage-detail', coverage.detail));
    if (coverage.source) description.append(sourceButton(coverage.source));
    const key = String(coverage.status || '').toLowerCase();
    const labels = { read: 'Gelesen', parsed: 'Eingelesen', collected: 'Erfasst', available: 'Vorhanden', missing: 'Fehlt in Aufnahme', failed: 'Nicht auswertbar', partial: 'Teilweise', unsupported: 'Nicht unterstützt', unknown: 'Unklar', 'not-collected': 'Nicht erhoben' };
    const cls = ['read', 'parsed', 'collected', 'available'].includes(key) ? 'good' : ['failed', 'partial', 'missing'].includes(key) ? 'caution' : '';
    li.append(description, node('span', `status-tag ${cls}`, labels[key] || coverage.status || 'Unklar'));
    $('coverage-list').append(li);
  }
  if (!(data.coverage || []).length) $('coverage-list').append(node('li', 'subtle', 'Keine Angaben zur Datenabdeckung verfügbar.'));
  $('warning-count').textContent = number.format(warnings.length);
  for (const warning of warnings) {
    const li = node('li', '', warning.message);
    if (warning.source) li.append(sourceButton(warning.source, warning.line));
    $('warning-list').append(li);
  }
  if (!warnings.length) $('warning-list').append(node('li', 'neutral', 'In den ausgewerteten Quellen wurden keine Erfassungshinweise erkannt. Das ist keine vollständige Geräte- oder Fehlerprüfung.'));
}
function renderDrivers() {
  const all = state.snapshot?.drivers || [];
  const query = $('driver-search').value.trim().toLocaleLowerCase('de');
  const rows = all.filter((item) => `${item.name} ${item.version}`.toLocaleLowerCase('de').includes(query));
  $('driver-table').replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const item of rows) {
    const row = node('tr');
    const source = node('td'); source.append(sourceButton(item.source, item.line, item.line ? `Zeile ${item.line}` : 'Originaldatei'));
    row.append(node('td', '', item.name), node('td', 'version', item.version), source);
    fragment.append(row);
  }
  $('driver-table').append(fragment);
  $('driver-result-count').textContent = `${number.format(rows.length)} von ${number.format(all.length)} Einträgen`;
  $('drivers-empty').hidden = !!rows.length;
  $('drivers-empty').textContent = !state.snapshot ? 'Zuerst eine CDAT-Aufnahme öffnen.' : !all.length ? 'Keine Treiberversionen aus der unterstützten Quelle ermittelt.' : 'Keine Treiber passen zum Filter.';
}
function renderFiles() {
  const all = state.snapshot?.files || [];
  const query = $('file-search').value.trim().toLocaleLowerCase('de');
  const rows = all.filter((item) => item.name.toLocaleLowerCase('de').includes(query));
  $('file-table').replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const item of rows) {
    const row = node('tr');
    const name = node('td', 'file-path');
    const read = Object.hasOwn(state.snapshot.texts || {}, item.name);
    name.append(read ? sourceButton(item.name, null, item.name) : node('span', '', item.name));
    const processing = node('td'); processing.append(node('span', `status-tag ${read ? 'good' : ''}`, read ? 'Text eingelesen' : 'Nur Verzeichnis'));
    row.append(name, node('td', 'numeric', bytes(item.size)), processing);
    fragment.append(row);
  }
  $('file-table').append(fragment);
  $('file-result-count').textContent = `${number.format(rows.length)} von ${number.format(all.length)} Dateien`;
  $('files-empty').hidden = !!rows.length;
  $('files-empty').textContent = state.snapshot ? 'Keine Dateien passen zum Filter.' : 'Zuerst eine CDAT-Aufnahme öffnen.';
}
function renderSnapshot() { renderOverview(); renderDrivers(); renderFiles(); }
function setImportBusy(busy) {
  state.importing = busy;
  $('workspace-card').setAttribute('aria-busy', String(busy));
  $('demo-button').disabled = busy || !zipSupported;
  $('catalog-button').disabled = busy;
  $('machine-type').disabled = busy;
  $('catalog-os').disabled = busy;
}
async function loadArchive(file, isDemo = false) {
  if (!zipSupported) return;
  const seq = ++state.importSeq;
  setImportBusy(true); resetLenovo();
  if ($('source-dialog').open) $('source-dialog').close();
  state.snapshot = null;
  $('driver-search').value = ''; $('file-search').value = '';
  $('machine-type').value = '';
  error('app-error');
  status('app-status', `${file.name || 'CDAT-Archiv'} wird eingelesen …`, true);
  renderSnapshot();
  try {
    const result = await importCdat(file);
    if (seq !== state.importSeq) return;
    state.snapshot = result;
    const machineType = String(result.device.mtm || '').slice(0, 4).toUpperCase();
    $('machine-type').value = /^[A-Z0-9]{4}$/.test(machineType) ? machineType : '';
    if (/windows\s*10/i.test(result.device.os || '')) $('catalog-os').value = 'Win10';
    else $('catalog-os').value = 'Win11';
    renderSnapshot();
    activateTab('overview');
    status('app-status', `${isDemo ? 'Synthetisches Beispiel' : 'Aufnahme'} eingelesen · ${number.format(result.archive.entryCount)} Dateien im Archiv · ${bytes(result.archive.readBytes)} Archivdaten gelesen. Die vollständige Aufnahme bleibt lokal.`);
  } catch (err) {
    if (seq !== state.importSeq) return;
    error('app-error', `Die Aufnahme konnte nicht eingelesen werden: ${messageOf(err)}`);
    status('app-status', 'Import fehlgeschlagen. Eine andere Datei kann ausgewählt werden.');
  } finally {
    if (seq === state.importSeq) { setImportBusy(false); renderOverview(); }
  }
}
function packageName(pkg) { try { return new URL(pkg.url).pathname.split('/').pop() || pkg.path; } catch { return pkg.path || pkg.url || 'Paket'; } }
function renderCatalog() {
  const catalog = state.catalog;
  $('catalog-content').hidden = !catalog;
  if (!catalog) return;
  const query = $('catalog-search').value.trim().toLocaleLowerCase('de');
  const packages = catalog.packages.filter((pkg) => `${pkg.category} ${packageName(pkg)}`.toLocaleLowerCase('de').includes(query));
  $('catalog-table').replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const pkg of packages) {
    const row = node('tr');
    const action = node('td');
    const button = node('button', 'row-button', state.selectedPackage === pkg.url && !state.package ? 'Wird geladen …' : 'Details laden');
    button.type = 'button';
    button.disabled = state.selectedPackage === pkg.url && !state.package;
    button.setAttribute('aria-label', `Details für ${packageName(pkg)} laden`);
    button.addEventListener('click', () => loadPackage(pkg));
    action.append(button);
    row.append(node('td', 'package-name', packageName(pkg)), node('td', '', pkg.category || 'Nicht angegeben'), action);
    fragment.append(row);
  }
  $('catalog-table').append(fragment);
  $('catalog-empty').hidden = packages.length > 0;
}
async function loadCatalog(event) {
  event.preventDefault();
  const machineType = $('machine-type').value.trim().toUpperCase();
  const os = $('catalog-os').value;
  if (!/^[A-Z0-9]{4}$/.test(machineType)) { error('catalog-error', 'Bitte den vierstelligen Maschinen-Typ eingeben, zum Beispiel 21MM.'); return; }
  resetLenovo();
  const seq = state.catalogSeq;
  catalogController = new AbortController();
  $('catalog-button').disabled = true;
  status('catalog-status', `Lenovo-Katalog für ${machineType} / ${os === 'Win11' ? 'Windows 11' : 'Windows 10'} wird abgerufen …`, true);
  try {
    const catalog = await fetchCatalog(machineType, os, { signal: catalogController.signal });
    if (seq !== state.catalogSeq) return;
    state.catalog = catalog;
    $('catalog-meta').replaceChildren(node('strong', '', `${number.format(catalog.packages.length)} Katalogpakete`), node('span', '', `${machineType} · ${os === 'Win11' ? 'Windows 11' : 'Windows 10'} · Abgerufen ${humanTime(catalog.retrievedAt)}`));
    const link = safeLink(catalog.sourceUrl, 'Originalkatalog ↗');
    if (link) $('catalog-meta').append(link);
    renderCatalog();
    status('catalog-status', 'Lenovo-Katalog geladen. Paketdetails werden einzeln auf Anfrage abgerufen.');
  } catch (err) {
    if (seq !== state.catalogSeq || err?.name === 'AbortError') return;
    error('catalog-error', messageOf(err));
    status('catalog-status', 'Lenovo-Abruf nicht erfolgreich. Die lokale CDAT-Auswertung bleibt verfügbar.');
  } finally {
    if (seq === state.catalogSeq) $('catalog-button').disabled = state.importing;
  }
}
async function loadPackage(pkg) {
  detailController?.abort(); readmeController?.abort();
  const seq = ++state.detailSeq;
  state.readmeSeq += 1;
  detailController = new AbortController();
  state.selectedPackage = pkg.url; state.package = null;
  $('package-detail').hidden = true;
  error('catalog-error');
  status('catalog-status', `Paketdetails für ${packageName(pkg)} werden geladen …`, true);
  renderCatalog();
  try {
    const data = await fetchPackage(pkg, { signal: detailController.signal });
    if (seq !== state.detailSeq) return;
    state.package = data;
    $('package-title').textContent = data.title || packageName(pkg);
    $('package-fields').replaceChildren();
    for (const [label, value] of [['Paketversion', data.version], ['Paketkennung', data.id], ['Veröffentlicht laut Quelle', data.releaseDate]]) {
      const field = node('div'); field.append(node('dt', '', label), node('dd', '', value || 'Nicht angegeben')); $('package-fields').append(field);
    }
    $('package-description').textContent = data.description || '';
    $('package-notes').textContent = Array.isArray(data.notes) ? data.notes.join(' ') : (data.notes || '');
    $('package-links').replaceChildren();
    const source = safeLink(data.sourceUrl, 'Originalmetadaten ↗'); if (source) $('package-links').append(source);
    if (data.readmeUrl) {
      const readme = node('button', 'button secondary', 'Readme als Text öffnen'); readme.type = 'button'; readme.addEventListener('click', () => loadReadme(data, readme)); $('package-links').append(readme);
      const link = safeLink(data.readmeUrl, 'Readme bei Lenovo ↗'); if (link) $('package-links').append(link);
    } else $('package-links').append(node('span', 'subtle', 'Keine Readme-URL in den Paketmetadaten gefunden.'));
    status('readme-status', `Metadaten abgerufen ${humanTime(data.retrievedAt)}. Paketversion ist nicht automatisch die Version jeder enthaltenen Komponente.`);
    $('package-detail').hidden = false;
    status('catalog-status', 'Paketdetails geladen. Die Anwendbarkeit auf dieses Gerät wurde noch nicht bewertet.');
    $('package-detail').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  } catch (err) {
    if (seq !== state.detailSeq || err?.name === 'AbortError') return;
    error('catalog-error', messageOf(err));
    status('catalog-status', 'Paketdetails konnten nicht geladen werden.');
    state.selectedPackage = null;
  } finally { if (seq === state.detailSeq) renderCatalog(); }
}
async function loadReadme(pkg, button) {
  readmeController?.abort();
  const seq = ++state.readmeSeq;
  readmeController = new AbortController();
  button.disabled = true;
  status('readme-status', 'Readme wird abgerufen …', true);
  try {
    const data = await fetchReadme(pkg.readmeUrl, { signal: readmeController.signal });
    if (seq !== state.readmeSeq) return;
    showText(pkg.title || 'Lenovo Readme', data.text, `${data.sourceUrl} · Abgerufen ${humanTime(data.retrievedAt)}. Als Text dargestellt; noch keine automatische Änderungsanalyse.`, 'LENOVO README');
    status('readme-status', 'Readme geladen. Voraussetzungen und Update-Reihenfolge bitte im Originaltext beachten.');
  } catch (err) {
    if (seq !== state.readmeSeq || err?.name === 'AbortError') return;
    status('readme-status', `Readme konnte nicht geladen werden: ${messageOf(err)}`);
  } finally { if (seq === state.readmeSeq) button.disabled = false; }
}

let zipSupported = false;
try { new DecompressionStream('deflate-raw'); zipSupported = typeof Blob.prototype.stream === 'function'; } catch { /* Human-readable capability notice below. */ }
if (!zipSupported) {
  $('browser-warning').textContent = 'Dieser Browser unterstützt die benötigte ZIP-Dekomprimierung nicht. Bitte einen aktuellen Edge-, Chrome- oder Firefox-Browser verwenden. Der Lenovo-Katalog bleibt separat nutzbar.';
  $('browser-warning').hidden = false;
  $('archive-input').disabled = true; $('demo-button').disabled = true;
}
$('archive-input').addEventListener('change', (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) loadArchive(file); });
$('demo-button').addEventListener('click', async () => {
  const seq = state.importSeq;
  $('demo-button').disabled = true;
  error('app-error'); status('app-status', 'Synthetisches Beispiel wird geöffnet …', true);
  try {
    const response = await fetch('./demo-cdat.zip', { cache: 'no-store' });
    if (!response.ok) throw new Error('Die Beispieldatei ist nicht erreichbar.');
    const blob = await response.blob();
    if (seq !== state.importSeq) return;
    await loadArchive(new File([blob], 'LORE-Beispiel-CDAT.zip', { type: 'application/zip' }), true);
  } catch (err) {
    if (seq === state.importSeq) { error('app-error', messageOf(err)); status('app-status', 'Beispiel konnte nicht geladen werden.'); }
  } finally { if (seq === state.importSeq || !state.importing) $('demo-button').disabled = !zipSupported || state.importing; }
});
$('dropzone').addEventListener('dragenter', (event) => { event.preventDefault(); dragDepth += 1; $('dropzone').classList.add('drag-over'); });
$('dropzone').addEventListener('dragover', (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
$('dropzone').addEventListener('dragleave', (event) => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropzone').classList.remove('drag-over'); });
$('dropzone').addEventListener('drop', (event) => { event.preventDefault(); dragDepth = 0; $('dropzone').classList.remove('drag-over'); const files = event.dataTransfer?.files; if (files?.length > 1) { error('app-error', 'Bitte für diesen Prototyp genau eine CDAT-ZIP-Datei auswählen.'); return; } if (files?.[0]) loadArchive(files[0]); });
document.querySelectorAll('[data-tab]').forEach((tab, index, tabs) => {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    let target;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = tabs.length - 1;
    if (target !== undefined) { event.preventDefault(); activateTab(tabs[target].dataset.tab, true); }
  });
});
$('driver-search').addEventListener('input', renderDrivers);
$('file-search').addEventListener('input', renderFiles);
$('catalog-search').addEventListener('input', renderCatalog);
$('catalog-form').addEventListener('submit', loadCatalog);
$('machine-type').addEventListener('input', resetLenovo);
$('catalog-os').addEventListener('change', resetLenovo);
$('source-close').addEventListener('click', () => $('source-dialog').close());
$('source-dialog').addEventListener('click', (event) => { if (event.target === $('source-dialog')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close(); } });
renderSnapshot();
