import { messageError } from './messages.mjs';

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
    throw messageError('zip.legacyNames');
  }
  const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\\', '/');
  const parts = name.replace(/\/$/, '').split('/');
  if (!name || name.length > 4096 || /^[\/]|^[A-Za-z]:/.test(name) || /[\u0000-\u001f]/.test(name)
      || parts.some(part => !part || part === '.' || part === '..')) {
    throw messageError('zip.unsafePath');
  }
  return name;
}

export async function openZip(blob) {
  if (!blob || typeof blob.slice !== 'function' || !Number.isSafeInteger(blob.size)) throw messageError('zip.unreadable');
  if (blob.size > MAX_ARCHIVE) throw messageError('zip.archiveLimit');
  if (blob.size < 22) throw messageError('zip.incompleteArchive');
  const tailStart = Math.max(0, blob.size - 65557);
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
  const end = new DataView(tail.buffer);
  let offset = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (end.getUint32(i, true) === 0x06054b50 && i + 22 + end.getUint16(i + 20, true) === tail.length) { offset = i; break; }
  }
  if (offset < 0) throw messageError('zip.noDirectory');
  const count = end.getUint16(offset + 10, true);
  const directorySize = end.getUint32(offset + 12, true);
  const directoryStart = end.getUint32(offset + 16, true);
  if (count === 65535 || directorySize === 0xffffffff || directoryStart === 0xffffffff) throw messageError('zip.zip64');
  if (end.getUint16(offset + 4, true) || end.getUint16(offset + 6, true) || end.getUint16(offset + 8, true) !== count) throw messageError('zip.multipart');
  if (!count || count > 5000 || directorySize > MAX_DIRECTORY || directoryStart + directorySize > tailStart + offset) throw messageError('zip.directoryLimit');
  const directory = new Uint8Array(await blob.slice(directoryStart, directoryStart + directorySize).arrayBuffer());
  const view = new DataView(directory.buffer);
  const entries = [], names = new Set();
  let position = 0, totalUncompressedBytes = 0, readBytes = directory.length + tail.length;
  for (let i = 0; i < count; i++) {
    if (position + 46 > directory.length || view.getUint32(position, true) !== 0x02014b50) throw messageError('zip.corruptDirectory');
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true);
    const compressedSize = view.getUint32(position + 20, true), size = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true), extraLength = view.getUint16(position + 30, true), commentLength = view.getUint16(position + 32, true);
    const next = position + 46 + nameLength + extraLength + commentLength;
    const localOffset = view.getUint32(position + 42, true);
    if (next > directory.length || localOffset + 30 > directoryStart || compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw messageError('zip.invalidEntry');
    if (flags & 1 || flags & 64) throw messageError('zip.encrypted');
    const name = safeName(directory.subarray(position + 46, position + 46 + nameLength), !!(flags & 2048));
    if (names.has(name.toLowerCase())) throw messageError('zip.duplicatePath');
    names.add(name.toLowerCase());
    totalUncompressedBytes += size;
    if (totalUncompressedBytes > MAX_EXPANDED) throw messageError('zip.expandedLimit');
    entries.push({ name, size, compressedSize, method, flags, localOffset, crc: view.getUint32(position + 16, true), isDirectory: name.endsWith('/') });
    position = next;
  }
  if (position !== directory.length) throw messageError('zip.unexpectedDirectory');
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  return {
    entries, totalUncompressedBytes,
    get readBytes() { return readBytes; },
    async read(name, { maxBytes = 4 * 1024 ** 2 } = {}) {
      const entry = byName.get(name);
      if (!entry || entry.isDirectory) throw messageError('zip.missingEntry');
      if (entry.size > maxBytes || entry.compressedSize > maxBytes + 65536) throw messageError('zip.readLimit');
      if (![0, 8].includes(entry.method)) throw messageError('zip.compression');
      const local = new DataView(await blob.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
      if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(6, true) !== entry.flags || local.getUint16(8, true) !== entry.method) throw messageError('zip.headerMismatch');
      const nameLength = local.getUint16(26, true), extraLength = local.getUint16(28, true);
      const start = entry.localOffset + 30 + nameLength + extraLength;
      if (start + entry.compressedSize > directoryStart) throw messageError('zip.dataRange');
      const localName = new Uint8Array(await blob.slice(entry.localOffset + 30, entry.localOffset + 30 + nameLength).arrayBuffer());
      if (safeName(localName, !!(entry.flags & 2048)) !== name) throw messageError('zip.nameMismatch');
      let stream = blob.slice(start, start + entry.compressedSize).stream();
      readBytes += 30 + nameLength + entry.compressedSize;
      if (entry.method === 8) {
        try { stream = stream.pipeThrough(new DecompressionStream('deflate-raw')); }
        catch { throw messageError('zip.browserSupport'); }
      }
      const reader = stream.getReader(), chunks = [];
      let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > maxBytes || length > entry.size) { await reader.cancel(); throw messageError('zip.sizeMismatch'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (length !== entry.size) throw messageError('zip.incompleteEntry');
      const result = new Uint8Array(length);
      let cursor = 0;
      for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.length; }
      if (crc32(result) !== entry.crc) throw messageError('zip.checksum');
      return result;
    },
  };
}
