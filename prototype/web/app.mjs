import { importCdat } from './core/cdat.mjs';
import { compareSnapshots } from './core/compare.mjs';
import { fetchCatalog, fetchPackage, fetchReadme } from './core/lenovo.mjs';
import { checkUpdates } from './core/updates.mjs';
import { formatMessage } from './core/messages.mjs';
import { translate, translations } from './i18n.mjs';

const $ = (id) => document.getElementById(id);
const preferences = readPreferences();
const t = (key, params = {}) => translate(key, params, preferences.language);
const locale = () => preferences.language === 'de' ? 'de-DE' : 'en-US';
const uiMessages = new Map();
let sourceView = null;
const state = { secondary: null, comparison: null, comparing: false, compareSeq: 0, secondaryFile: null, readmeLoading: false, catalogQuery: null, snapshot: null, catalog: null, package: null, selectedPackage: null, importing: false, importSeq: 0, catalogSeq: 0, detailSeq: 0, readmeSeq: 0 };
Object.assign(state, { updates: null, updateSeq: 0, updating: false });
let catalogController = null;
let detailController = null;
let readmeController = null;
let updateController = null;
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
  const element = $(id);
  element.textContent = value;
  if (message.isError) element.hidden = !value;
  else {
    element.classList.toggle('busy', message.busy);
    if (id === 'app-status' || id === 'update-status') {
      element.classList.toggle('visually-hidden', !message.busy);
    }
  }
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
  $('source-title').textContent = typeof title === 'function' ? title() : title;
  $('source-kind').textContent = kind === 'readme' ? 'LENOVO README' : t('originalSource');
  $('source-detail').textContent = `${typeof detail === 'function' ? detail() : detail}${text.length > limit ? t('truncated', { count: number.format(limit) }) : ''}`;
  // Source content is retained verbatim and does not depend on the display language.
  if ($('source-text').textContent !== text.slice(0, limit)) $('source-text').textContent = text.slice(0, limit);
}
function showText(title, text, detail = '', kind = 'source', returnFocus = null, side = null) {
  sourceView = { title, text: String(text || ''), detail, kind, returnFocus, side };
  renderSource();
  $('source-text').scrollTop = 0;
  if (!$('source-dialog').open) $('source-dialog').showModal();
}
function sourceButton(path, line, label = null, snapshot = state.snapshot, side = null) {
  if (!path) return node('span', 'subtle', t('sourceUnknown'));
  const hasText = Object.hasOwn(snapshot?.texts || {}, path);
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
  button.dataset.sourceSide = side || '';
  button.title = `${path}${line ? `, ${t('line', { line })}` : ''}`;
  button.addEventListener('click', () => {
    const containerId = button.closest('[id]')?.id;
    const returnFocus = () => {
      const container = $(containerId) || document;
      const current = Array.from(container.querySelectorAll('.source-button')).find(candidate => candidate.dataset.sourcePath === path && candidate.dataset.sourceLine === String(line ?? '') && candidate.dataset.sourceSide === (side || ''));
      (button.isConnected ? button : current)?.focus();
    };
    showText(() => side ? `${t('captureSide', { side })} · ${path}` : path, snapshot.texts[path], () => line ? t('originalAtLine', { line }) : t('originalText'), 'source', returnFocus, side);
  });
  return button;
}
function activateTab(name, focus = false) {
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`panel-${tab.dataset.tab}`).hidden = !selected;
  });
  $('capture-updates').hidden = name === 'lenovo';
  renderWorkspaceVisibility();
  if (focus) $(`tab-${name}`).focus();
}
function renderWorkspaceVisibility() {
  $('workspace-card').hidden = !state.snapshot && $('panel-lenovo').hidden;
}
function resetCatalog() {
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
  $('dropzone').classList.toggle('has-capture', !!data);
  $('analysis-tabs').hidden = !data;
  $('update-check-section').hidden = !data;
  $('open-catalog').hidden = !!data;
  $('archive-label').textContent = t(data ? 'openAnotherZip' : 'chooseZip');
  $('archive-button').classList.toggle('primary', !data);
  $('archive-button').classList.toggle('secondary', !!data);
  $('capture-actions').hidden = !data;
  $('capture-compare').disabled = state.importing || !data;
  $('overview-content').hidden = !data;
  $('capture-state').hidden = !data?.warnings?.length;
  $('driver-tab-count').textContent = number.format(data?.drivers?.length || 0);
  $('file-tab-count').textContent = number.format(data?.files?.length || 0);
  $('device-grid').replaceChildren(); $('coverage-list').replaceChildren(); $('warning-list').replaceChildren();
  renderWorkspaceVisibility();
  if (!data) {
    $('capture-title').textContent = t(state.importing ? 'readingCapture' : 'noCapture');
    $('capture-meta').textContent = state.importing ? '' : t('capturePrompt');
    return;
  }
  const warnings = data.warnings || [];
  $('capture-title').textContent = data.device.model || data.device.mtm || t('capture');
  const archive = t('captureMeta', { file: data.archive.fileName || t('archive'), count: number.format(data.archive.entryCount), size: bytes(data.archive.totalUncompressedBytes) });
  const captureTime = data.device.capturedAt ? t('captureTimestamp', { time: data.device.capturedAt }) : '';
  $('capture-meta').textContent = [archive, captureTime].filter(Boolean).join(' · ');
  $('capture-state').textContent = warnings.length ? t(warnings.length === 1 ? 'noticeCountOne' : 'noticeCount', { count: number.format(warnings.length) }) : t('imported');
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
function renderSnapshot() { renderOverview(); renderDrivers(); renderFiles(); renderComparison(); renderUpdateControls(); }
function setImportBusy(busy) {
  state.importing = busy;
  $('workspace-card').setAttribute('aria-busy', String(busy));
  $('demo-button').disabled = busy || !zipSupported;
  $('open-catalog').disabled = busy;
  $('catalog-button').disabled = busy;
  $('machine-type').disabled = busy;
  $('catalog-os').disabled = busy;
  $('compare-input').disabled = busy || !state.snapshot || !zipSupported;
  renderUpdateControls();
}
async function loadArchive(file, isDemo = false) {
  if (!zipSupported) return;
  const seq = ++state.importSeq;
  setImportBusy(true);
  if ($('source-dialog').open) $('source-dialog').close();
  state.snapshot = null;
  sourceView = null;
  resetUpdates();
  resetCatalog();
  $('manual-catalog').open = false;
  resetComparison();
  activateTab('overview');
  $('comparison-filter').value = 'all'; $('comparison-search').value = '';
  $('driver-search').value = ''; $('file-search').value = '';
  $('machine-type').value = '';
  error('app-error');
  status('app-status', () => t('readingFile', { file: file.name || t('archive') }), true);
  renderSnapshot();
  try {
    const result = await importCdat(file);
    if (seq !== state.importSeq) return;
    state.snapshot = result;
    status('compare-status', () => t('compareIdle'));
    status('update-status', () => t('updateReady'));
    const machineType = String(result.device.mtm || '').slice(0, 4).toUpperCase();
    $('machine-type').value = /^[A-Z0-9]{4}$/.test(machineType) ? machineType : '';
    if (/windows\s*10/i.test(result.device.os || '')) $('catalog-os').value = 'Win10';
    else $('catalog-os').value = 'Win11';
    renderSnapshot();
    status('app-status', () => t('importComplete', { kind: t(isDemo ? 'syntheticExample' : 'captureNoun'), count: number.format(result.archive.entryCount), size: bytes(result.archive.readBytes) }));
  } catch (err) {
    if (seq !== state.importSeq) return;
    error('app-error', () => t('importError', { error: messageOf(err) }));
    status('app-status', () => t('importFailed'));
  } finally {
    if (seq === state.importSeq) { setImportBusy(false); renderOverview(); renderComparison(); }
  }
}
function closeComparisonSource() {
  if (sourceView?.side !== 'B') return;
  sourceView = null;
  if ($('source-dialog').open) $('source-dialog').close();
}
function resetComparison() {
  state.compareSeq += 1;
  closeComparisonSource();
  state.secondary = null; state.comparison = null; state.comparing = false; state.secondaryFile = null;
  error('compare-error');
  status('compare-status', () => t(state.snapshot ? 'compareIdle' : 'compareOpenA'));
  renderComparison();
}
async function loadComparison(file) {
  if (!zipSupported || !state.snapshot || state.importing) return;
  const primary = state.snapshot;
  const primarySeq = state.importSeq;
  const seq = ++state.compareSeq;
  closeComparisonSource();
  state.secondary = null; state.comparison = null; state.comparing = true; state.secondaryFile = file.name || t('archive');
  error('compare-error');
  status('compare-status', () => t('compareReading', { file: file.name || t('archive') }), true);
  renderComparison();
  try {
    const secondary = await importCdat(file);
    if (seq !== state.compareSeq || primarySeq !== state.importSeq || primary !== state.snapshot) return;
    const comparison = compareSnapshots(primary, secondary);
    state.secondary = secondary; state.comparison = comparison;
    status('compare-status', () => t('compareLoaded'));
  } catch (err) {
    if (seq !== state.compareSeq || primarySeq !== state.importSeq) return;
    error('compare-error', () => t('compareFailed', { error: messageOf(err) }));
    status('compare-status', () => t('compareFailedStatus'));
    state.secondaryFile = null;
  } finally {
    if (seq === state.compareSeq && primarySeq === state.importSeq) { state.comparing = false; renderComparison(); }
  }
}
function renderComparisonCapture(id, snapshot, side) {
  const card = $(id);
  const noticesOpen = !!card.querySelector('details')?.open;
  card.replaceChildren(node('h4', '', t('captureSide', { side })));
  if (!snapshot) {
    card.append(node('p', 'subtle', t(side === 'B' && state.comparing ? 'compareReadingCard' : 'compareWaiting')));
    if (side === 'B' && state.secondaryFile) card.append(node('p', 'comparison-filename', state.secondaryFile));
    return;
  }
  card.append(node('p', 'comparison-model', snapshot.device.model || snapshot.device.mtm || t('capture')),
    node('p', 'comparison-filename', snapshot.archive.fileName || t('archive')));
  const fields = node('dl', 'comparison-capture-fields');
  for (const field of ['mtm', 'serial', 'capturedAt']) {
    const item = node('div');
    item.append(node('dt', '', t(field)), node('dd', '', snapshot.device[field] || t('notDetermined')));
    const ref = snapshot.sources?.[field];
    if (ref?.path) item.append(sourceButton(ref.path, ref.line, t('compareSourceSide', { side }), snapshot, side));
    fields.append(item);
  }
  card.append(fields);
  const notices = snapshot.warnings || [];
  const details = node('details', 'comparison-notices'); details.open = noticesOpen;
  details.append(node('summary', '', t(notices.length === 1 ? 'noticeCountOne' : 'noticeCount', { count: number.format(notices.length) })));
  const list = node('ul', 'warning-list');
  for (const notice of notices) {
    const item = node('li', '', formatMessage(notice.messageDescriptor ?? notice.message, preferences.language));
    if (notice.source) item.append(sourceButton(notice.source, notice.line, null, snapshot, side));
    list.append(item);
  }
  if (!notices.length) list.append(node('li', 'neutral', t('noticesEmpty')));
  details.append(list); card.append(details);
}
function comparisonRowName(row) { return row.field ? t(row.field) : row.name || t('compareDrivers'); }
function comparisonSource(ref, snapshot, side) {
  return sourceButton(ref.path, ref.line, `${t('compareSourceSide', { side })}${ref.line ? ` · ${t('shortLine', { line: ref.line })}` : ''}`, snapshot, side);
}
function comparisonCell(cell, snapshot, side, row) {
  const td = node('td', 'comparison-value'); td.dataset.side = side.toLowerCase();
  const coverageKey = Object.hasOwn(translations.en, `status_${cell.coverage}`) ? `status_${cell.coverage}` : 'status_unknown';
  if (row.summary) {
    td.append(node('span', `status-tag ${cell.coverage === 'read' ? 'good' : 'caution'}`, t(coverageKey)));
  } else if ((cell.records?.length || 0) > 1) {
    const records = node('ul', 'comparison-records');
    for (const record of cell.records) {
      const item = node('li'); item.append(node('div', '', `${record.name} · ${record.version || t('notDetermined')}`));
      if (record.source) item.append(comparisonSource({ path: record.source, line: record.line }, snapshot, side));
      records.append(item);
    }
    td.append(records);
  } else td.append(node('div', cell.value == null ? 'unknown' : '', cell.value ?? t('notDetermined')));
  if (!row.summary && cell.coverage !== 'read') td.append(node('p', 'comparison-coverage', `${t('source')}: ${t(coverageKey)}`));
  if ((cell.records?.length || 0) <= 1) {
    const refs = node('div', 'comparison-sources');
    for (const ref of cell.sources || []) if (ref.path) refs.append(comparisonSource(ref, snapshot, side));
    td.append(refs);
  }
  return td;
}
function renderComparisonRows(rows, target, emptyId, countId) {
  const filter = $('comparison-filter').value;
  const query = $('comparison-search').value.trim().toLocaleLowerCase(preferences.language);
  const filtered = rows.filter(row => {
    const matches = filter === 'all' || (filter === 'differences' ? ['different', 'onlyA', 'onlyB'].includes(row.status) : row.status === 'unresolved');
    const values = `${comparisonRowName(row)} ${row.a.value || ''} ${row.b.value || ''} ${row.a.records?.map(record => record.version).join(' ') || ''} ${row.b.records?.map(record => record.version).join(' ') || ''}`;
    return matches && values.toLocaleLowerCase(preferences.language).includes(query);
  });
  const fragment = document.createDocumentFragment();
  for (const row of filtered) {
    const tr = node('tr'); tr.dataset.status = row.status;
    if (row.field) tr.dataset.field = row.field;
    tr.dataset.name = row.name || '';
    const label = node('td'); label.append(node('strong', '', comparisonRowName(row)));
    if (row.matchBasis === 'name-only') label.append(node('p', 'comparison-match', t('compareNameOnly')));
    if (row.matchBasis === 'ambiguous') label.append(node('p', 'comparison-match', t('compareAmbiguous')));
    const outcome = node('td');
    outcome.append(node('span', `status-tag ${row.status === 'same' ? 'good' : row.status === 'unresolved' ? 'caution' : 'difference'}`, t(`compareStatus_${row.status}`)));
    const reason = `compareReason_${row.reason}`;
    outcome.append(node('p', 'comparison-reason', t(Object.hasOwn(translations.en, reason) ? reason : 'compareReason_unknown')));
    tr.append(label, comparisonCell(row.a, state.snapshot, 'A', row), comparisonCell(row.b, state.secondary, 'B', row), outcome);
    fragment.append(tr);
  }
  $(target).replaceChildren(fragment);
  $(emptyId).hidden = !!filtered.length;
  $(emptyId).textContent = t(!rows.length && target === 'driver-comparison' ? 'compareEmptyDrivers' : 'compareNoRows');
  $(countId).textContent = t('entryCount', { shown: number.format(filtered.length), total: number.format(rows.length) });
}
function renderComparison() {
  $('compare-input').disabled = !zipSupported || state.importing || !state.snapshot;
  $('compare-remove').disabled = !state.secondary && !state.comparing;
  $('panel-comparison').setAttribute('aria-busy', String(state.comparing));
  renderComparisonCapture('comparison-capture-a', state.snapshot, 'A');
  renderComparisonCapture('comparison-capture-b', state.secondary, 'B');
  const result = state.comparison;
  $('comparison-results').hidden = !result;
  if (!result) {
    $('platform-comparison').replaceChildren(); $('driver-comparison').replaceChildren(); $('comparison-summary').replaceChildren();
    $('comparison-identity').textContent = ''; $('comparison-identity').removeAttribute('data-identity');
    $('comparison-unresolved').hidden = true;
    return;
  }
  $('comparison-identity').textContent = t(`compareIdentity_${result.identity}`);
  $('comparison-identity').dataset.identity = result.identity;
  $('comparison-summary').replaceChildren();
  for (const key of ['same', 'different', 'onlyA', 'onlyB', 'unresolved']) {
    const item = node('div');
    const value = node('dd', '', number.format(result.counts[key])); value.id = `comparison-count-${key}`;
    item.append(node('dt', '', t(`compareCount_${key}`)), value); $('comparison-summary').append(item);
  }
  $('comparison-unresolved').hidden = !result.counts.unresolved;
  $('comparison-unresolved').textContent = t('compareUnresolvedNotice', { count: number.format(result.counts.unresolved) });
  renderComparisonRows(result.platformRows, 'platform-comparison', 'platform-comparison-empty', 'comparison-platform-count');
  renderComparisonRows(result.driverRows, 'driver-comparison', 'driver-comparison-empty', 'comparison-driver-count');
}
function renderUpdateControls() {
  const label = t(state.updating ? 'updateChecking' : state.updates ? 'updateRecheck' : 'updateCheck');
  for (const id of ['capture-updates', 'update-check']) {
    const button = $(id);
    button.disabled = state.importing || state.updating || !state.snapshot;
    button.textContent = label;
  }
}
function resetUpdates() {
  state.updateSeq += 1;
  updateController?.abort();
  updateController = null;
  state.updates = null; state.updating = false;
  if (sourceView?.side === 'updates') {
    if ($('source-dialog').open) $('source-dialog').close();
    sourceView = null;
  }
  error('update-error');
  status('update-status', () => t(state.snapshot ? 'updateReady' : 'openFirst'));
  renderUpdates();
}
function updateReadmeButton(row) {
  if (!row.readme?.text) return null;
  const button = node('button', 'button secondary', t('updateOriginalReadme'));
  button.type = 'button'; button.dataset.updateReadme = row.id;
  button.addEventListener('click', () => {
    const returnFocus = () => {
      const current = Array.from($('update-results').querySelectorAll('[data-update-readme]')).find(item => item.dataset.updateReadme === row.id);
      (button.isConnected ? button : current)?.focus();
    };
    showText(row.package?.title || row.name || t('updateReadme'), row.readme.text,
      () => t('updateReadmeSource', { url: row.readme.sourceUrl, time: humanTime(row.readme.retrievedAt) }), 'readme', returnFocus, 'updates');
  });
  return button;
}
function renderUpdates() {
  renderUpdateControls();
  const result = state.updates;
  const root = $('update-results');
  const expanded = new Set(Array.from(root.querySelectorAll('details[open]')).map(item => item.dataset.detailKey));
  root.hidden = !result;
  root.replaceChildren();
  if (!result) return;
  const meta = node('div', 'catalog-meta');
  meta.append(node('strong', '', t('updateResultCount', { count: number.format(result.rows?.length || 0) })),
    node('span', '', t('catalogMeta', { type: result.machineType || t('notDetermined'), os: result.os === 'Win11' ? 'Windows 11' : result.os === 'Win10' ? 'Windows 10' : result.os || t('notDetermined'), time: humanTime(result.catalog?.retrievedAt || result.retrievedAt) })));
  const catalogLink = safeLink(result.catalog?.sourceUrl, t('originalCatalog'));
  if (catalogLink) meta.append(catalogLink);
  root.append(meta);
  if (result.errors?.length) {
    const warning = node('div', 'alert warning');
    warning.append(node('p', '', t('updatePartialErrors', { count: number.format(result.errors.length) })));
    const list = node('ul');
    for (const item of result.errors) {
      const entry = node('li');
      const link = safeLink(item.url, t('updateFailedDocument'));
      if (link) entry.append(link, document.createTextNode(' · '));
      entry.append(document.createTextNode(messageOf(item.message || item.error || t('updateRequestFailed'))));
      list.append(entry);
    }
    warning.append(list); root.append(warning);
  }
  const cards = node('div', 'update-grid');
  for (const row of result.rows || []) {
    const card = node('article', 'update-card');
    card.dataset.updateId = row.id;
    card.dataset.kind = row.kind;
    card.dataset.status = row.status;
    card.dataset.versionRelation = row.versionRelation;
    card.dataset.applicability = String(row.applicability);
    const header = node('div', 'update-card-header');
    const heading = node('div');
    heading.append(node('p', 'eyebrow', t(Object.hasOwn(translations.en, `updateKind_${row.kind}`) ? `updateKind_${row.kind}` : 'component')),
      node('h3', '', row.name || row.package?.title || t('component')));
    const versionKey = Object.hasOwn(translations.en, `updateVersion_${row.versionRelation}`) ? `updateVersion_${row.versionRelation}` : 'updateVersion_unknown';
    const badge = node('span', `status-tag update-result ${row.versionRelation === 'newer' ? 'difference' : row.versionRelation === 'unknown' ? 'caution' : ''}`, t(versionKey));
    badge.dataset.updateField = 'version-result';
    header.append(heading, badge);
    card.append(header);
    const fields = node('dl', 'update-fields');
    for (const [label, value, key] of [
      ['updateInstalled', row.installedVersion, 'installed'], ['updateOffered', row.offeredVersion, 'offered'],
    ]) {
      const field = node('div'); field.dataset.updateField = key;
      field.append(node('dt', '', t(label)), node('dd', value ? '' : 'subtle', value || t('notDetermined'))); fields.append(field);
    }
    card.append(fields);
    const footer = node('div', 'update-overview-footer');
    const compatibility = node('p', 'update-compatibility');
    compatibility.dataset.updateField = 'applicability';
    compatibility.append(node('strong', '', `${t('updateApplicability')}: `), document.createTextNode(t(Object.hasOwn(translations.en, `updateApplicability_${row.applicability}`) ? `updateApplicability_${row.applicability}` : 'updateApplicability_unknown')));
    footer.append(compatibility);
    const readmeButton = updateReadmeButton(row);
    if (readmeButton) footer.append(readmeButton);
    card.append(footer);
    const evidence = node('details', 'update-details');
    evidence.dataset.detailKey = `evidence:${row.id}`;
    evidence.open = expanded.has(evidence.dataset.detailKey);
    evidence.append(node('summary', '', t('updateDetails')));
    if (row.reasons?.length) {
      const reasons = node('ul', 'update-reasons');
      for (const reason of new Set(row.reasons)) reasons.append(node('li', '', t(Object.hasOwn(translations.en, `updateReason_${reason}`) ? `updateReason_${reason}` : 'updateReason_unknown')));
      evidence.append(reasons);
    }
    if (row.sources?.length) {
      const sources = node('div', 'update-sources');
      sources.append(node('strong', '', t('updateCaptureEvidence')));
      const files = new Map();
      for (const ref of row.sources) {
        if (!ref.path) continue;
        if (!files.has(ref.path)) files.set(ref.path, new Set());
        if (Number.isSafeInteger(ref.line) && ref.line > 0) files.get(ref.path).add(ref.line);
      }
      for (const [path, sourceLines] of files) {
        const lines = [...sourceLines].sort((a, b) => a - b);
        const entry = node('div', 'update-source-file');
        entry.append(sourceButton(path, lines[0] || null, fileName(path), state.snapshot, 'A'));
        if (lines.length) entry.append(node('span', 'subtle', t('updateSourceLines', { lines: lines.join(', ') })));
        sources.append(entry);
      }
      evidence.append(sources);
    }
    if (row.package) {
      const metadata = node('div', 'update-package');
      metadata.append(node('p', '', row.package.title || row.package.id || t('package')),
        node('p', 'subtle', t('updatePackageContext', { version: row.package.version || t('notSpecified'), time: humanTime(row.package.retrievedAt) })));
      const links = node('div', 'package-links');
      const source = safeLink(row.package.sourceUrl, t('originalMetadata'));
      if (source) links.append(source);
      const readmeLink = safeLink(row.readme?.sourceUrl || row.package.readmeUrl, t('readmeLink'));
      if (readmeLink) links.append(readmeLink);
      metadata.append(links); evidence.append(metadata);
    }
    if (row.readme?.sections?.length) {
      const details = node('details', 'update-readme-sections');
      details.dataset.detailKey = `readme:${row.id}`;
      details.open = expanded.has(details.dataset.detailKey);
      details.append(node('summary', '', t('updateReadmeSections')));
      details.append(node('p', 'subtle', t('updateReadmeExtractScope')));
      if (row.readme.evidence?.truncated) details.append(node('p', 'alert warning', t('updateReadmeTruncated')));
      for (const section of row.readme.sections) {
        const sectionNode = node('section');
        const key = `updateSection_${section.kind}`;
        sectionNode.append(node('h4', '', Object.hasOwn(translations.en, key) ? t(key) : section.title || t('updateReadme')),
          node('p', 'subtle', t('updateReadmeLines', { start: section.startLine ?? '–', end: section.endLine ?? section.startLine ?? '–' })),
          node('pre', 'update-readme-text', section.text || ''));
        details.append(sectionNode);
      }
      evidence.append(details);
    }
    card.append(evidence);
    cards.append(card);
  }
  if (cards.childElementCount) root.append(cards);
  else root.append(node('p', 'alert warning', t('updateNoResults')));
}
async function loadUpdates() {
  const snapshot = state.snapshot;
  if (!snapshot || state.importing || state.updating) return;
  activateTab('lenovo');
  $('update-heading').focus();
  resetUpdates();
  const seq = state.updateSeq;
  const importSeq = state.importSeq;
  updateController = new AbortController();
  state.updating = true;
  renderUpdates();
  status('update-status', () => t('updateFetching'), true);
  const current = () => seq === state.updateSeq && importSeq === state.importSeq && snapshot === state.snapshot;
  try {
    const result = await checkUpdates(snapshot, {
      signal: updateController.signal,
      onProgress: ({ completed, total }) => {
        if (current()) status('update-status', () => t('updateProgress', { completed: number.format(completed), total: number.format(total) }), true);
      },
    });
    if (!current()) return;
    state.updates = result;
    renderUpdates();
    status('update-status', () => t(result.errors?.length ? 'updateLoadedPartial' : 'updateLoaded'));
  } catch (err) {
    if (!current() || err?.name === 'AbortError') return;
    error('update-error', () => messageOf(err));
    status('update-status', () => t('updateFailed'));
  } finally {
    if (current()) { state.updating = false; renderUpdateControls(); }
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
  resetCatalog();
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
$('capture-compare').addEventListener('click', () => { activateTab('comparison'); $('compare-input').focus(); });
$('capture-updates').addEventListener('click', loadUpdates);
$('update-check').addEventListener('click', loadUpdates);
$('open-catalog').addEventListener('click', () => {
  activateTab('lenovo');
  $('manual-catalog').open = true;
  $('machine-type').focus();
});
$('compare-input').addEventListener('change', (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) loadComparison(file); });
$('compare-remove').addEventListener('click', resetComparison);
$('comparison-filter').addEventListener('change', renderComparison);
$('comparison-search').addEventListener('input', renderComparison);
$('driver-search').addEventListener('input', renderDrivers);
$('file-search').addEventListener('input', renderFiles);
$('catalog-search').addEventListener('input', renderCatalog);
$('catalog-form').addEventListener('submit', loadCatalog);
$('machine-type').addEventListener('input', resetCatalog);
$('catalog-os').addEventListener('change', resetCatalog);
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
status('compare-status', () => t('compareOpenA'));
status('update-status', () => t('openFirst'));
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
  renderSnapshot(); renderCatalog(); renderPackage(); renderUpdates(); renderSource();
  for (const id of uiMessages.keys()) renderMessage(id);
}
