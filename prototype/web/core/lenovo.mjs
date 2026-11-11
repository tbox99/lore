// Lenovo transport and metadata parsing. Package metadata is not an applicability verdict.
const ORIGIN = 'https://download.lenovo.com';
const MAX_TEXT = 8 * 1024 * 1024;
const MAX_RESPONSE = 12 * 1024 * 1024;
const CATALOG_PATH = /^\/catalog\/[A-Za-z0-9]{4}_Win(?:10|11)\.xml$/;
const DOCUMENT_PATH = /^\/pccbbs\/mobiles\/[A-Za-z0-9_.-]+\.(?:xml|txt|html)$/;

export function lenovoUrl(value) {
  if (typeof value !== 'string' || /[\\%\s\x00-\x1f]/.test(value)) {
    throw new Error('Ungültige Lenovo-Quelladresse.');
  }
  let url;
  try { url = new URL(value, ORIGIN); }
  catch { throw new Error('Ungültige Lenovo-Quelladresse.'); }
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash ||
      (!CATALOG_PATH.test(url.pathname) && !DOCUMENT_PATH.test(url.pathname))) {
    throw new Error('Diese Quelle ist für den Lenovo-Abruf nicht freigegeben.');
  }
  // Reject traversal before URL normalization rather than silently accepting its target.
  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) {
    throw new Error('Ungültiger Pfad in der Lenovo-Quelladresse.');
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
        throw new Error('Die Lenovo-Antwort überschreitet das Größenlimit.');
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
      if (error?.message?.includes('Größenlimit')) throw error;
      throw new Error(`Der lokale Lenovo-Dienst antwortet nicht im erwarteten Format (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const detail = typeof result?.error === 'string' ? result.error.slice(0, 300) : `HTTP ${response.status}`;
      throw new Error(`Lenovo-Abruf fehlgeschlagen: ${detail}`);
    }
    if (typeof result?.text !== 'string' || result.text.length > MAX_TEXT ||
        typeof result?.retrievedAt !== 'string' || !Number.isFinite(Date.parse(result.retrievedAt))) {
      throw new Error('Der lokale Lenovo-Dienst hat unvollständige Metadaten geliefert.');
    }
    return { sourceUrl: lenovoUrl(result.url).href, retrievedAt: result.retrievedAt, text: result.text };
  } catch (error) {
    if (timedOut) throw new Error('Zeitüberschreitung beim Lenovo-Abruf. Bitte Netzwerk oder Proxy prüfen.');
    if (controller.signal.aborted) throw new DOMException('Abruf abgebrochen.', 'AbortError');
    if (error instanceof TypeError) throw new Error('Der lokale Lenovo-Dienst ist nicht erreichbar. Bitte den LORE-Starter prüfen.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function parseXml(text, expectedRoot) {
  if (typeof DOMParser === 'undefined') throw new Error('Dieser Browser unterstützt die XML-Auswertung nicht.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Die Lenovo-XML-Datei enthält eine nicht unterstützte Dokumentdeklaration.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length ||
      doc.documentElement.localName !== expectedRoot) {
    throw new Error(`Die Lenovo-Antwort ist keine gültige ${expectedRoot}-XML-Datei.`);
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
  if (entries.length > 5000) throw new Error('Der Lenovo-Katalog enthält zu viele Einträge.');
  const packages = entries.map(entry => {
    const url = lenovoUrl(text(child(entry, 'location')));
    if (!DOCUMENT_PATH.test(url.pathname) || !url.pathname.endsWith('.xml')) {
      throw new Error('Der Lenovo-Katalog verweist auf eine ungültige Paketdatei.');
    }
    const checksum = child(entry, 'checksum');
    return {
      url: url.href,
      path: url.pathname,
      category: text(child(entry, 'category')) || 'Ohne Kategorie',
      checksum: checksum ? { type: checksum.getAttribute('type'), value: text(checksum) } : null,
    };
  });
  return { sourceUrl, retrievedAt, packages };
}

export async function fetchCatalog(machineType, os, options = {}) {
  const type = typeof machineType === 'string' ? machineType.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{4}$/.test(type)) throw new Error('Bitte den vierstelligen Machine Type eingeben, zum Beispiel 21MM.');
  if (os !== 'Win10' && os !== 'Win11') throw new Error('Bitte Windows 10 oder Windows 11 wählen.');
  const result = await requestDocument(`/catalog/${type}_${os}.xml`, options);
  return parseCatalog(result.text, result);
}

export function parsePackage(xml, { sourceUrl, retrievedAt }) {
  const root = parseXml(xml, 'Package');
  const readmeNode = child(child(root, 'Files'), 'Readme');
  const readmeName = text(child(localized(readmeNode, 'File'), 'Name'));
  let readmeUrl = null;
  const notes = [];
  if (readmeName) {
    try {
      if (!/^[A-Za-z0-9_.-]+\.(?:txt|html)$/.test(readmeName)) throw new Error();
      readmeUrl = lenovoUrl(new URL(readmeName, sourceUrl).href).href;
    } catch { notes.push('Der Readme-Verweis hat ein nicht unterstütztes Format.'); }
  }
  const dependencyNode = child(root, 'Dependencies');
  if (dependencyNode) notes.push('Das Paket enthält Anwendbarkeitsregeln. Diese wurden im Prototyp nicht ausgewertet.');
  notes.push('Paketversion aus dem Lenovo-Katalog; kein Nachweis für Aktualität oder Anwendbarkeit auf dieses Gerät.');
  return {
    sourceUrl,
    retrievedAt,
    id: root.getAttribute('id') || null,
    title: text(localized(child(root, 'Title'))) || root.getAttribute('name') || 'Lenovo-Paket',
    version: root.getAttribute('version') || null,
    releaseDate: text(child(root, 'ReleaseDate')),
    readmeUrl,
    description: text(localized(child(root, 'Summary'))) || '',
    notes,
    // A package version is not an installed component's driver version.
    componentVersions: [],
  };
}

export async function fetchPackage(pkg, options = {}) {
  const url = lenovoUrl(typeof pkg === 'string' ? pkg : pkg?.url);
  if (!DOCUMENT_PATH.test(url.pathname) || !url.pathname.endsWith('.xml')) {
    throw new Error('Für Paketdetails wird eine Lenovo-Paket-XML-Datei benötigt.');
  }
  const result = await requestDocument(url.href, options);
  return parsePackage(result.text, result);
}

export function readmePlainText(value, isHtml) {
  if (!isHtml) return value.replace(/^\uFEFF/, '').trim();
  if (typeof DOMParser === 'undefined') throw new Error('Dieser Browser unterstützt die Readme-Auswertung nicht.');
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
    throw new Error('Für Readmes sind nur Lenovo-Text- und HTML-Dateien erlaubt.');
  }
  const result = await requestDocument(url.href, options);
  return { ...result, text: readmePlainText(result.text, url.pathname.endsWith('.html')) };
}
