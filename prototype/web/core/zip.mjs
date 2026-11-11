// Bounded, read-only ZIP reader. Members stay in the browser and are never executed.
const MAX_ARCHIVE = 512 * 1024 ** 2;
const MAX_DIRECTORY = 16 * 1024 ** 2;
const MAX_EXPANDED = 2 * 1024 ** 3;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function safeName(bytes, utf8) {
  // Non-ASCII legacy names need a future CP437 adapter; never guess their identity.
  if (!utf8 && bytes.some(byte => byte > 127)) {
    throw new Error('ZIP-Dateinamen mit älterer Zeichenkodierung werden noch nicht unterstützt.');
  }
  const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\\', '/');
  const parts = name.replace(/\/$/, '').split('/');
  if (!name || name.length > 4096 || /^[\/]|^[A-Za-z]:/.test(name) || /[\u0000-\u001f]/.test(name)
      || parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('Das ZIP enthält einen ungültigen oder unsicheren Dateipfad.');
  }
  return name;
}

export async function openZip(blob) {
  if (!blob || typeof blob.slice !== 'function' || !Number.isSafeInteger(blob.size)) throw new Error('Keine lesbare ZIP-Datei.');
  if (blob.size > MAX_ARCHIVE) throw new Error('Das ZIP ist größer als das Prototyp-Limit von 512 MiB.');
  if (blob.size < 22) throw new Error('Die Datei ist kein vollständiges ZIP.');
  const tailStart = Math.max(0, blob.size - 65557);
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
  const end = new DataView(tail.buffer);
  let offset = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (end.getUint32(i, true) === 0x06054b50 && i + 22 + end.getUint16(i + 20, true) === tail.length) { offset = i; break; }
  }
  if (offset < 0) throw new Error('ZIP-Inhaltsverzeichnis nicht gefunden.');
  const count = end.getUint16(offset + 10, true);
  const directorySize = end.getUint32(offset + 12, true);
  const directoryStart = end.getUint32(offset + 16, true);
  if (count === 65535 || directorySize === 0xffffffff || directoryStart === 0xffffffff) throw new Error('ZIP64 wird im Prototyp noch nicht unterstützt.');
  if (end.getUint16(offset + 4, true) || end.getUint16(offset + 6, true) || end.getUint16(offset + 8, true) !== count) throw new Error('Mehrteilige ZIP-Archive werden nicht unterstützt.');
  if (!count || count > 5000 || directorySize > MAX_DIRECTORY || directoryStart + directorySize > tailStart + offset) throw new Error('Ungültiges oder zu großes ZIP-Inhaltsverzeichnis.');
  const directory = new Uint8Array(await blob.slice(directoryStart, directoryStart + directorySize).arrayBuffer());
  const view = new DataView(directory.buffer);
  const entries = [], names = new Set();
  let position = 0, totalUncompressedBytes = 0, readBytes = directory.length + tail.length;
  for (let i = 0; i < count; i++) {
    if (position + 46 > directory.length || view.getUint32(position, true) !== 0x02014b50) throw new Error('Beschädigtes ZIP-Inhaltsverzeichnis.');
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true);
    const compressedSize = view.getUint32(position + 20, true), size = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true), extraLength = view.getUint16(position + 30, true), commentLength = view.getUint16(position + 32, true);
    const next = position + 46 + nameLength + extraLength + commentLength;
    const localOffset = view.getUint32(position + 42, true);
    if (next > directory.length || localOffset + 30 > directoryStart || compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error('Ungültiger ZIP-Dateieintrag oder nicht unterstütztes ZIP64.');
    if (flags & 1 || flags & 64) throw new Error('Verschlüsselte ZIP-Archive werden nicht unterstützt.');
    const name = safeName(directory.subarray(position + 46, position + 46 + nameLength), !!(flags & 2048));
    if (names.has(name.toLowerCase())) throw new Error('Mehrdeutige, doppelte Dateipfade im ZIP.');
    names.add(name.toLowerCase());
    totalUncompressedBytes += size;
    if (totalUncompressedBytes > MAX_EXPANDED) throw new Error('Entpackter Umfang überschreitet das Prototyp-Limit von 2 GiB.');
    entries.push({ name, size, compressedSize, method, flags, localOffset, crc: view.getUint32(position + 16, true), isDirectory: name.endsWith('/') });
    position = next;
  }
  if (position !== directory.length) throw new Error('Unerwartete Daten im ZIP-Inhaltsverzeichnis.');
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  return {
    entries, totalUncompressedBytes,
    get readBytes() { return readBytes; },
    async read(name, { maxBytes = 4 * 1024 ** 2 } = {}) {
      const entry = byName.get(name);
      if (!entry || entry.isDirectory) throw new Error('ZIP-Dateieintrag nicht vorhanden.');
      if (entry.size > maxBytes || entry.compressedSize > maxBytes + 65536) throw new Error('Quelldatei überschreitet das Leselimit.');
      if (![0, 8].includes(entry.method)) throw new Error('Diese ZIP-Kompression wird noch nicht unterstützt.');
      const local = new DataView(await blob.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
      if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(6, true) !== entry.flags || local.getUint16(8, true) !== entry.method) throw new Error('ZIP-Dateikopf stimmt nicht mit dem Verzeichnis überein.');
      const nameLength = local.getUint16(26, true), extraLength = local.getUint16(28, true);
      const start = entry.localOffset + 30 + nameLength + extraLength;
      if (start + entry.compressedSize > directoryStart) throw new Error('ZIP-Dateidaten außerhalb des erlaubten Bereichs.');
      const localName = new Uint8Array(await blob.slice(entry.localOffset + 30, entry.localOffset + 30 + nameLength).arrayBuffer());
      if (safeName(localName, !!(entry.flags & 2048)) !== name) throw new Error('Widersprüchliche Dateinamen im ZIP.');
      let stream = blob.slice(start, start + entry.compressedSize).stream();
      readBytes += 30 + nameLength + entry.compressedSize;
      if (entry.method === 8) {
        try { stream = stream.pipeThrough(new DecompressionStream('deflate-raw')); }
        catch { throw new Error('Dieser Browser unterstützt die benötigte ZIP-Dekompression noch nicht. Bitte einen aktuellen Edge, Chrome oder Firefox verwenden.'); }
      }
      const reader = stream.getReader(), chunks = [];
      let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > maxBytes || length > entry.size) { await reader.cancel(); throw new Error('ZIP-Datei überschreitet ihre angegebene Größe.'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (length !== entry.size) throw new Error('ZIP-Datei ist unvollständig.');
      const result = new Uint8Array(length);
      let cursor = 0;
      for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.length; }
      if (crc32(result) !== entry.crc) throw new Error('ZIP-Prüfsumme stimmt nicht: Die Quelldatei ist beschädigt.');
      return result;
    },
  };
}
