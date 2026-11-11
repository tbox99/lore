import { message, messageError, formatMessage } from './messages.mjs';
import { extractPackageEvidence, extractReadmeEvidence } from './package-evidence.mjs';

// Lenovo transport and metadata parsing. Package metadata is not an applicability verdict.
const ORIGIN = 'https://download.lenovo.com';
const MAX_TEXT = 8 * 1024 * 1024;
const MAX_RESPONSE = 12 * 1024 * 1024;
const CATALOG_PATH = /^\/catalog\/[A-Za-z0-9]{4}_Win(?:10|11)\.xml$/;
const DOCUMENT_PATH = /^\/pccbbs\/mobiles\/[A-Za-z0-9_.-]+\.(?:xml|txt|html)$/;

export function lenovoUrl(value) {
  if (typeof value !== 'string' || /[\\%\s\x00-\x1f]/.test(value)) {
    throw messageError('lenovo.invalidUrl');
  }
  let url;
  try { url = new URL(value, ORIGIN); }
  catch { throw messageError('lenovo.invalidUrl'); }
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash ||
      (!CATALOG_PATH.test(url.pathname) && !DOCUMENT_PATH.test(url.pathname))) {
    throw messageError('lenovo.forbiddenUrl');
  }
  // Reject traversal before URL normalization rather than silently accepting its target.
  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) {
    throw messageError('lenovo.invalidPath');
  }
  return url;
}

async function boundedText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE) {
        await reader.cancel();
        throw messageError('lenovo.responseLimit');
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally { reader.releaseLock(); }
}

async function requestDocument(value, { signal } = {}) {
  const url = lenovoUrl(value);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
  try {
    const response = await fetch(`/api/lenovo?path=${encodeURIComponent(url.pathname)}`, {
      headers: { 'X-LORE-Request': '1', Accept: 'application/json' },
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    let result;
    try { result = JSON.parse(await boundedText(response)); }
    catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) throw error;
      if (error?.code === 'lenovo.responseLimit') throw error;
      throw messageError('lenovo.responseFormat', { status: response.status });
    }
    if (!response.ok) {
      const detail = typeof result?.error === 'string' ? result.error.slice(0, 300) : `HTTP ${response.status}`;
      throw messageError('lenovo.requestFailed', { detail });
    }
    if (typeof result?.text !== 'string' || result.text.length > MAX_TEXT ||
        typeof result?.retrievedAt !== 'string' || !Number.isFinite(Date.parse(result.retrievedAt))) {
      throw messageError('lenovo.incompleteMetadata');
    }
    const returnedUrl = lenovoUrl(result.url).href;
    if (returnedUrl !== url.href) throw messageError('lenovo.incompleteMetadata');
    return { sourceUrl: returnedUrl, retrievedAt: result.retrievedAt, text: result.text };
  } catch (error) {
    if (timedOut) throw messageError('lenovo.timeout');
    if (controller.signal.aborted) throw new DOMException('Request cancelled.', 'AbortError');
    if (error instanceof TypeError) throw messageError('lenovo.unreachable');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function parseXml(text, expectedRoot) {
  if (typeof DOMParser === 'undefined') throw messageError('lenovo.xmlSupport');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw messageError('lenovo.xmlDeclaration');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length ||
      doc.documentElement.localName !== expectedRoot) {
    throw messageError('lenovo.invalidXml', { root: expectedRoot });
  }
  return doc.documentElement;
}

function children(node, tag) { return Array.from(node?.children ?? []).filter(item => item.localName === tag); }
function child(node, tag) { return children(node, tag)[0] ?? null; }
function text(node) { return node?.textContent?.trim() || null; }
function localized(node, element = 'Desc') {
  const entries = children(node, element);
  const language = node?.getAttribute('default') || 'EN';
  return entries.find(item => item.getAttribute('id') === language) ||
    entries.find(item => item.getAttribute('id') === 'EN') || entries[0] || null;
}

export function parseCatalog(xml, { sourceUrl, retrievedAt }) {
  const root = parseXml(xml, 'packages');
  const entries = children(root, 'package');
  if (entries.length > 5000) throw messageError('lenovo.catalogLimit');
  const packages = entries.map(entry => {
    const url = lenovoUrl(text(child(entry, 'location')));
    if (!DOCUMENT_PATH.test(url.pathname) || !url.pathname.endsWith('.xml')) {
      throw messageError('lenovo.invalidPackage');
    }
    const checksum = child(entry, 'checksum');
    return {
      url: url.href,
      path: url.pathname,
      category: text(child(entry, 'category')) || formatMessage(message('lenovo.noCategory')),
      categoryDescriptor: text(child(entry, 'category')) ? null : message('lenovo.noCategory'),
      checksum: checksum ? { type: checksum.getAttribute('type'), value: text(checksum) } : null,
    };
  });
  return { sourceUrl, retrievedAt, packages };
}

export async function fetchCatalog(machineType, os, options = {}) {
  const type = typeof machineType === 'string' ? machineType.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{4}$/.test(type)) throw messageError('lenovo.machineType');
  if (os !== 'Win10' && os !== 'Win11') throw messageError('lenovo.os');
  const result = await requestDocument(`/catalog/${type}_${os}.xml`, options);
  return parseCatalog(result.text, result);
}

export function parsePackage(xml, { sourceUrl, retrievedAt }) {
  const root = parseXml(xml, 'Package');
  const evidence = extractPackageEvidence(root, { sourceUrl });
  const readmeNode = child(child(root, 'Files'), 'Readme');
  const readmeName = text(child(localized(readmeNode, 'File'), 'Name'));
  let readmeUrl = null;
  const noteDescriptors = [];
  if (readmeName) {
    try {
      if (!/^[A-Za-z0-9_.-]+\.(?:txt|html)$/.test(readmeName)) throw new Error();
      readmeUrl = lenovoUrl(new URL(readmeName, sourceUrl).href).href;
    } catch { noteDescriptors.push(message('lenovo.noteReadme')); }
  }
  const dependencyNode = child(root, 'Dependencies');
  if (dependencyNode) noteDescriptors.push(message('lenovo.noteRules'));
  noteDescriptors.push(message('lenovo.noteVersion'));
  return {
    sourceUrl,
    retrievedAt,
    id: root.getAttribute('id') || null,
    title: text(localized(child(root, 'Title'))) || root.getAttribute('name') || formatMessage(message('lenovo.packageTitle')),
    titleDescriptor: text(localized(child(root, 'Title'))) || root.getAttribute('name') ? null : message('lenovo.packageTitle'),
    version: root.getAttribute('version') || null,
    releaseDate: text(child(root, 'ReleaseDate')),
    readmeUrl,
    description: text(localized(child(root, 'Summary'))) || '',
    notes: noteDescriptors.map(descriptor => formatMessage(descriptor)),
    noteDescriptors,
    // A package version is not an installed component's driver version.
    componentVersions: evidence.componentVersions,
    evidence,
  };
}

export async function fetchPackage(pkg, options = {}) {
  const url = lenovoUrl(typeof pkg === 'string' ? pkg : pkg?.url);
  if (!DOCUMENT_PATH.test(url.pathname) || !url.pathname.endsWith('.xml')) {
    throw messageError('lenovo.packageXml');
  }
  const result = await requestDocument(url.href, options);
  return parsePackage(result.text, result);
}

export function readmePlainText(value, isHtml) {
  if (!isHtml) return value.replace(/^\uFEFF/, '').trim();
  if (typeof DOMParser === 'undefined') throw messageError('lenovo.readmeSupport');
  // This document stays detached. Only text is returned, never nodes/markup.
  const doc = new DOMParser().parseFromString(value, 'text/html');
  for (const node of doc.querySelectorAll('script,style,iframe,object,embed,link,meta,svg,canvas,template')) node.remove();
  for (const br of doc.querySelectorAll('br')) br.replaceWith('\n');
  for (const cell of doc.querySelectorAll('td,th')) cell.append('\t');
  for (const block of doc.querySelectorAll('p,div,section,article,h1,h2,h3,h4,li,tr,pre')) block.append('\n');
  return (doc.body?.textContent || '').replace(/\r\n?/g, '\n').replace(/[\t ]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

export async function fetchReadme(readmeUrl, options = {}) {
  const url = lenovoUrl(readmeUrl);
  if (!DOCUMENT_PATH.test(url.pathname) || !/\.(?:txt|html)$/.test(url.pathname)) {
    throw messageError('lenovo.readmeType');
  }
  const result = await requestDocument(url.href, options);
  const text = readmePlainText(result.text, url.pathname.endsWith('.html'));
  return { ...result, text, originalText: result.text, evidence: extractReadmeEvidence(text, result) };
}
