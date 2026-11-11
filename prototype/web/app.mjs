import { importCdat } from './core/cdat.mjs';
import { fetchCatalog, fetchPackage, fetchReadme } from './core/lenovo.mjs';
import { formatMessage } from './core/messages.mjs';
import { translate, translations } from './i18n.mjs';

const $ = (id) => document.getElementById(id);
const preferences = readPreferences();
const t = (key, params = {}) => translate(key, params, preferences.language);
const locale = () => preferences.language === 'de' ? 'de-DE' : 'en-US';
const uiMessages = new Map();
let sourceView = null;
const state = { readmeLoading: false, catalogQuery: null, snapshot: null, catalog: null, package: null, selectedPackage: null, importing: false, importSeq: 0, catalogSeq: 0, detailSeq: 0, readmeSeq: 0 };
let catalogController = null;
let detailController = null;
let readmeController = null;
let dragDepth = 0;
const number = { format: (value) => new Intl.NumberFormat(locale()).format(value) };
const fieldLabels = ['model', 'mtm', 'serial', 'bios', 'ec', 'meFirmware', 'os', 'build', 'capturedAt', 'cdatVersion'];


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
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(size / 1024 ** unit)} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
}
function fileName(path) { return String(path || '').split(/[\\/]/).pop() || t('source'); }
function renderMessage(id) {
  const message = uiMessages.get(id);
  const value = typeof message.render === 'function' ? message.render() : message.render;
  $(id).textContent = value;
  if (message.isError) $(id).hidden = !value;
  else $(id).classList.toggle('busy', message.busy);
}
function status(id, render, busy = false) { uiMessages.set(id, { render, busy }); renderMessage(id); }
function error(id, render = '') { uiMessages.set(id, { render, isError: true }); renderMessage(id); }
function messageOf(err) { return formatMessage(err, preferences.language); }
function humanTime(value) {
  if (!value) return t('timeUnknown');
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
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
function renderSource() {
  if (!sourceView) return;
  const { title, text, detail, kind } = sourceView;
  const limit = 250_000;
  $('source-title').textContent = title;
  $('source-kind').textContent = kind === 'readme' ? 'LENOVO README' : t('originalSource');
  $('source-detail').textContent = `${typeof detail === 'function' ? detail() : detail}${text.length > limit ? t('truncated', { count: number.format(limit) }) : ''}`;
  // Source content is retained verbatim and does not depend on the display language.
  if ($('source-text').textContent !== text.slice(0, limit)) $('source-text').textContent = text.slice(0, limit);
}
function showText(title, text, detail = '', kind = 'source', returnFocus = null) {
  sourceView = { title, text: String(text || ''), detail, kind, returnFocus };
  renderSource();
  $('source-text').scrollTop = 0;
  if (!$('source-dialog').open) $('source-dialog').showModal();
}
function sourceButton(path, line, label = null) {
  if (!path) return node('span', 'subtle', t('sourceUnknown'));
  const hasText = Object.hasOwn(state.snapshot?.texts || {}, path);
  const display = label || `${fileName(path)}${line ? ` · ${t('shortLine', { line })}` : ''}`;
  if (!hasText) {
    const value = node('span', 'subtle', display);
    value.title = path;
    return value;
  }
  const button = node('button', 'source-button', display);
  button.type = 'button';
  button.dataset.sourcePath = path;
  button.dataset.sourceLine = String(line ?? '');
  button.title = `${path}${line ? `, ${t('line', { line })}` : ''}`;
  button.addEventListener('click', () => {
    const containerId = button.closest('[id]')?.id;
    const returnFocus = () => {
      const container = $(containerId) || document;
      const current = Array.from(container.querySelectorAll('.source-button')).find(candidate => candidate.dataset.sourcePath === path && candidate.dataset.sourceLine === String(line ?? ''));
      (button.isConnected ? button : current)?.focus();
    };
    showText(path, state.snapshot.texts[path], () => line ? t('originalAtLine', { line }) : t('originalText'), 'source', returnFocus);
  });
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
  state.catalog = null; state.package = null; state.selectedPackage = null; state.catalogQuery = null; state.readmeLoading = false;
  $('catalog-content').hidden = true;
  $('package-detail').hidden = true;
  $('catalog-search').value = '';
  $('catalog-button').disabled = state.importing;
  error('catalog-error');
  status('catalog-status', () => t('catalogIdle'));
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
    $('capture-title').textContent = t(state.importing ? 'readingCapture' : 'noCapture');
    $('capture-meta').textContent = t('capturePrompt');
    $('capture-state').textContent = t(state.importing ? 'importing' : 'ready');
    $('capture-state').className = 'capture-state';
    return;
  }
  const warnings = data.warnings || [];
  $('capture-title').textContent = data.device.model || data.device.mtm || t('capture');
  $('capture-meta').textContent = t('captureMeta', { file: data.archive.fileName || t('archive'), count: number.format(data.archive.entryCount), size: bytes(data.archive.totalUncompressedBytes) });
  $('capture-state').textContent = warnings.length ? t('noticeCount', { count: number.format(warnings.length) }) : t('imported');
  $('capture-state').className = `capture-state ${warnings.length ? 'partial' : 'loaded'}`;
  for (const key of fieldLabels) {
    const item = node('div', 'device-item');
    const value = data.device[key];
    item.append(node('dt', '', t(key)), node('dd', value ? '' : 'unknown', value || t('notDetermined')));
    const source = data.sources?.[key];
    if (source?.path) item.append(sourceButton(source.path, source.line, `${t('source')}${source.line ? ` · ${t('shortLine', { line: source.line })}` : ''}`));
    $('device-grid').append(item);
  }
  for (const coverage of data.coverage || []) {
    const li = node('li');
    const description = node('div');
    description.append(node('div', 'coverage-name', formatMessage(coverage.labelDescriptor ?? coverage.label, preferences.language)));
    if (coverage.detail) description.append(node('p', 'coverage-detail', formatMessage(coverage.detailDescriptor ?? coverage.detail, preferences.language)));
    if (coverage.source) description.append(sourceButton(coverage.source));
    const key = String(coverage.status || '').toLowerCase();
    const cls = ['read', 'parsed', 'collected', 'available'].includes(key) ? 'good' : ['failed', 'partial', 'missing'].includes(key) ? 'caution' : '';
    li.append(description, node('span', `status-tag ${cls}`, t(Object.hasOwn(translations.en, `status_${key}`) ? `status_${key}` : 'status_unknown')));
    $('coverage-list').append(li);
  }
  if (!(data.coverage || []).length) $('coverage-list').append(node('li', 'subtle', t('coverageEmpty')));
  $('warning-count').textContent = number.format(warnings.length);
  for (const warning of warnings) {
    const li = node('li', '', formatMessage(warning.messageDescriptor ?? warning.message, preferences.language));
    if (warning.source) li.append(sourceButton(warning.source, warning.line));
    $('warning-list').append(li);
  }
  if (!warnings.length) $('warning-list').append(node('li', 'neutral', t('noticesEmpty')));
}
function renderDrivers() {
  const all = state.snapshot?.drivers || [];
  const query = $('driver-search').value.trim().toLocaleLowerCase(preferences.language);
  const rows = all.filter((item) => `${item.name} ${item.version}`.toLocaleLowerCase(preferences.language).includes(query));
  $('driver-table').replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const item of rows) {
    const row = node('tr');
    const source = node('td'); source.append(sourceButton(item.source, item.line, item.line ? t('line', { line: item.line }) : t('originalFile')));
    row.append(node('td', '', item.name), node('td', 'version', item.version), source);
    fragment.append(row);
  }
  $('driver-table').append(fragment);
  $('driver-result-count').textContent = t('entryCount', { shown: number.format(rows.length), total: number.format(all.length) });
  $('drivers-empty').hidden = !!rows.length;
  $('drivers-empty').textContent = t(!state.snapshot ? 'openFirst' : !all.length ? 'noDrivers' : 'driversFiltered');
}
function renderFiles() {
  const all = state.snapshot?.files || [];
  const query = $('file-search').value.trim().toLocaleLowerCase(preferences.language);
  const rows = all.filter((item) => item.name.toLocaleLowerCase(preferences.language).includes(query));
  $('file-table').replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const item of rows) {
    const row = node('tr');
    const name = node('td', 'file-path');
    const read = Object.hasOwn(state.snapshot.texts || {}, item.name);
    name.append(read ? sourceButton(item.name, null, item.name) : node('span', '', item.name));
    const processing = node('td'); processing.append(node('span', `status-tag ${read ? 'good' : ''}`, t(read ? 'textRead' : 'directoryOnly')));
    row.append(name, node('td', 'numeric', bytes(item.size)), processing);
    fragment.append(row);
  }
  $('file-table').append(fragment);
  $('file-result-count').textContent = t('fileCount', { shown: number.format(rows.length), total: number.format(all.length) });
  $('files-empty').hidden = !!rows.length;
  $('files-empty').textContent = t(state.snapshot ? 'filesFiltered' : 'openFirst');
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
  status('app-status', () => t('readingFile', { file: file.name || t('archive') }), true);
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
    status('app-status', () => t('importComplete', { kind: t(isDemo ? 'syntheticExample' : 'captureNoun'), count: number.format(result.archive.entryCount), size: bytes(result.archive.readBytes) }));
  } catch (err) {
    if (seq !== state.importSeq) return;
    error('app-error', () => t('importError', { error: messageOf(err) }));
    status('app-status', () => t('importFailed'));
  } finally {
    if (seq === state.importSeq) { setImportBusy(false); renderOverview(); }
  }
}
function packageName(pkg) { try { return new URL(pkg.url).pathname.split('/').pop() || pkg.path; } catch { return pkg.path || pkg.url || t('package'); } }
function renderCatalog() {
  const catalog = state.catalog;
  $('catalog-content').hidden = !catalog;
  if (!catalog) return;
  const { machineType, os } = state.catalogQuery;
  $('catalog-meta').replaceChildren(node('strong', '', t('catalogCount', { count: number.format(catalog.packages.length) })), node('span', '', t('catalogMeta', { type: machineType, os: os === 'Win11' ? 'Windows 11' : 'Windows 10', time: humanTime(catalog.retrievedAt) })));
  const link = safeLink(catalog.sourceUrl, t('originalCatalog'));
  if (link) $('catalog-meta').append(link);
  const query = $('catalog-search').value.trim().toLocaleLowerCase(preferences.language);
  const packages = catalog.packages.filter((pkg) => `${formatMessage(pkg.categoryDescriptor ?? pkg.category, preferences.language)} ${packageName(pkg)}`.toLocaleLowerCase(preferences.language).includes(query));
  $('catalog-table').replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const pkg of packages) {
    const row = node('tr');
    const action = node('td');
    const button = node('button', 'row-button', t(state.selectedPackage === pkg.url && !state.package ? 'loading' : 'loadDetails'));
    button.type = 'button';
    button.disabled = state.selectedPackage === pkg.url && !state.package;
    button.setAttribute('aria-label', t('loadDetailsFor', { package: packageName(pkg) }));
    button.addEventListener('click', () => loadPackage(pkg));
    action.append(button);
    row.append(node('td', 'package-name', packageName(pkg)), node('td', '', formatMessage(pkg.categoryDescriptor ?? pkg.category, preferences.language) || t('notSpecified')), action);
    fragment.append(row);
  }
  $('catalog-table').append(fragment);
  $('catalog-empty').hidden = packages.length > 0;
}
async function loadCatalog(event) {
  event.preventDefault();
  const machineType = $('machine-type').value.trim().toUpperCase();
  const os = $('catalog-os').value;
  if (!/^[A-Z0-9]{4}$/.test(machineType)) { error('catalog-error', () => t('machineInvalid')); return; }
  resetLenovo();
  const seq = state.catalogSeq;
  catalogController = new AbortController();
  $('catalog-button').disabled = true;
  status('catalog-status', () => t('fetchingCatalog', { type: machineType, os: os === 'Win11' ? 'Windows 11' : 'Windows 10' }), true);
  try {
    const catalog = await fetchCatalog(machineType, os, { signal: catalogController.signal });
    if (seq !== state.catalogSeq) return;
    state.catalog = catalog;
    state.catalogQuery = { machineType, os };
    renderCatalog();
    status('catalog-status', () => t('catalogLoaded'));
  } catch (err) {
    if (seq !== state.catalogSeq || err?.name === 'AbortError') return;
    error('catalog-error', () => messageOf(err));
    status('catalog-status', () => t('catalogFailed'));
  } finally {
    if (seq === state.catalogSeq) $('catalog-button').disabled = state.importing;
  }
}
function renderPackage() {
  const data = state.package;
  $('package-detail').hidden = !data;
  if (!data) return;
  $('package-title').textContent = formatMessage(data.titleDescriptor ?? data.title, preferences.language) || t('package');
  $('package-fields').replaceChildren();
  for (const [label, value] of [['packageVersion', data.version], ['packageId', data.id], ['published', data.releaseDate]]) {
    const field = node('div'); field.append(node('dt', '', t(label)), node('dd', '', value || t('notSpecified'))); $('package-fields').append(field);
  }
  $('package-description').textContent = data.description || '';
  const notes = data.noteDescriptors ?? data.notes;
  $('package-notes').textContent = Array.isArray(notes) ? notes.map(note => formatMessage(note, preferences.language)).join(' ') : formatMessage(notes || '', preferences.language);
  $('package-links').replaceChildren();
  const source = safeLink(data.sourceUrl, t('originalMetadata')); if (source) $('package-links').append(source);
  if (data.readmeUrl) {
    const readme = node('button', 'button secondary', t('openReadme')); readme.id = 'readme-button'; readme.type = 'button'; readme.disabled = state.readmeLoading;
    readme.addEventListener('click', () => loadReadme(data)); $('package-links').append(readme);
    const link = safeLink(data.readmeUrl, t('readmeLink')); if (link) $('package-links').append(link);
  } else $('package-links').append(node('span', 'subtle', t('noReadme')));
}
async function loadPackage(pkg) {
  detailController?.abort(); readmeController?.abort();
  const seq = ++state.detailSeq;
  state.readmeSeq += 1;
  detailController = new AbortController();
  state.selectedPackage = pkg.url; state.package = null; state.readmeLoading = false;
  $('package-detail').hidden = true;
  error('catalog-error');
  status('catalog-status', () => t('loadingPackage', { package: packageName(pkg) }), true);
  renderCatalog();
  try {
    const data = await fetchPackage(pkg, { signal: detailController.signal });
    if (seq !== state.detailSeq) return;
    state.package = data;
    renderPackage();
    status('readme-status', () => t('metadataRetrieved', { time: humanTime(data.retrievedAt) }));
    status('catalog-status', () => t('packageLoaded'));
    $('package-detail').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  } catch (err) {
    if (seq !== state.detailSeq || err?.name === 'AbortError') return;
    error('catalog-error', () => messageOf(err));
    status('catalog-status', () => t('packageFailed'));
    state.selectedPackage = null;
  } finally { if (seq === state.detailSeq) renderCatalog(); }
}
async function loadReadme(pkg) {
  readmeController?.abort();
  const seq = ++state.readmeSeq;
  readmeController = new AbortController();
  state.readmeLoading = true;
  if ($('readme-button')) $('readme-button').disabled = true;
  status('readme-status', () => t('readmeLoading'), true);
  try {
    const data = await fetchReadme(pkg.readmeUrl, { signal: readmeController.signal });
    if (seq !== state.readmeSeq) return;
    showText(pkg.title || 'Lenovo Readme', data.text, () => t('readmeDetail', { url: data.sourceUrl, time: humanTime(data.retrievedAt) }), 'readme', () => $('readme-button')?.focus());
    status('readme-status', () => t('readmeLoaded'));
  } catch (err) {
    if (seq !== state.readmeSeq || err?.name === 'AbortError') return;
    status('readme-status', () => t('readmeFailed', { error: messageOf(err) }));
  } finally { if (seq === state.readmeSeq) { state.readmeLoading = false; if ($('readme-button')) $('readme-button').disabled = false; } }
}

let zipSupported = false;
try { new DecompressionStream('deflate-raw'); zipSupported = typeof Blob.prototype.stream === 'function'; } catch { /* Human-readable capability notice below. */ }
if (!zipSupported) {
  $('browser-warning').textContent = t('browserUnsupported');
  $('browser-warning').hidden = false;
  $('archive-input').disabled = true; $('demo-button').disabled = true;
}
$('archive-input').addEventListener('change', (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) loadArchive(file); });
$('demo-button').addEventListener('click', async () => {
  const seq = state.importSeq;
  $('demo-button').disabled = true;
  error('app-error'); status('app-status', () => t('demoLoading'), true);
  try {
    const response = await fetch('./demo-cdat.zip', { cache: 'no-store' });
    if (!response.ok) throw Object.assign(new Error('The example file is not available.'), { uiKey: 'demoUnavailable' });
    const blob = await response.blob();
    if (seq !== state.importSeq) return;
    await loadArchive(new File([blob], 'LORE-Example-CDAT.zip', { type: 'application/zip' }), true);
  } catch (err) {
    if (seq === state.importSeq) { error('app-error', () => err.uiKey ? t(err.uiKey) : messageOf(err)); status('app-status', () => t('demoFailed')); }
  } finally { if (seq === state.importSeq || !state.importing) $('demo-button').disabled = !zipSupported || state.importing; }
});
$('dropzone').addEventListener('dragenter', (event) => { event.preventDefault(); dragDepth += 1; $('dropzone').classList.add('drag-over'); });
$('dropzone').addEventListener('dragover', (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
$('dropzone').addEventListener('dragleave', (event) => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropzone').classList.remove('drag-over'); });
$('dropzone').addEventListener('drop', (event) => { event.preventDefault(); dragDepth = 0; $('dropzone').classList.remove('drag-over'); const files = event.dataTransfer?.files; if (files?.length > 1) { error('app-error', () => t('oneArchive')); return; } if (files?.[0]) loadArchive(files[0]); });
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
$('source-dialog').addEventListener('close', () => sourceView?.returnFocus?.());
$('source-dialog').addEventListener('click', (event) => { if (event.target === $('source-dialog')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close(); } });
$('language-select').addEventListener('change', () => {
  preferences.language = $('language-select').value === 'de' ? 'de' : 'en';
  savePreferences();
  applyPreferences();
});
$('font-size-select').addEventListener('change', () => {
  preferences.fontSize = ['standard', 'large', 'extra-large'].includes($('font-size-select').value) ? $('font-size-select').value : 'standard';
  savePreferences();
  applyFontSize();
});
status('app-status', () => t('readyPrompt'));
status('catalog-status', () => t('catalogIdle'));
applyPreferences();

function readPreferences() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('lore.preferences') || 'null'); } catch { /* Storage may be disabled by browser policy. */ }
  return {
    language: saved?.language === 'de' ? 'de' : 'en',
    fontSize: ['standard', 'large', 'extra-large'].includes(saved?.fontSize) ? saved.fontSize : 'standard',
  };
}
function savePreferences() {
  try { localStorage.setItem('lore.preferences', JSON.stringify(preferences)); } catch { /* Preferences still work for this page session. */ }
}
function applyFontSize() {
  document.documentElement.dataset.fontSize = preferences.fontSize;
  $('font-size-select').value = preferences.fontSize;
}
function applyPreferences() {
  document.documentElement.lang = preferences.language;
  $('language-select').value = preferences.language;
  applyFontSize();
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
  for (const attribute of ['aria-label', 'placeholder', 'title']) {
    document.querySelectorAll(`[data-i18n-${attribute}]`).forEach(element => { element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`))); });
  }
  if (!zipSupported) $('browser-warning').textContent = t('browserUnsupported');
  renderSnapshot(); renderCatalog(); renderPackage(); renderSource();
  for (const id of uiMessages.keys()) renderMessage(id);
}
