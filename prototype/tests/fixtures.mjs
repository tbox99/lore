import { deflateRawSync, crc32 } from 'node:zlib';

// Synthetic inputs only. Independent node:zlib encoding/checksum for the ZIP reader tests.
export function makeZip(entries, { compress = true } = {}) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name), data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const compressed = compress ? deflateRawSync(data) : data;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(2048, 6);
    header.writeUInt16LE(compress ? 8 : 0, 8); header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(2048, 8); directory.writeUInt16LE(compress ? 8 : 0, 10); directory.writeUInt32LE(crc32(data), 16);
    directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, filename, compressed); central.push(directory, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const body = Buffer.concat(local), index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, index, end]);
}

export function demoEntries() {
  const root = 'CDAT-Demo/';
  return [
    [root + 'FileDetails.json', JSON.stringify({ Sn: 'DEMO0001', Mtm: '21MMDEMO00', Version: '1.26', Category: 'Demo', Files: [] })],
    [root + 'CDAT1.26-QuickData-Demo.log', [
      'CDAT v1.26 Collection', 'System : ThinkPad Demo (synthetische Daten)', 'MTM : 21MMDEMO00',
      'SN : DEMO0001', 'BIOS : DEMOET10W (1.10)', 'EC : 1.02', 'ME FW : 18.0.0.1000',
      'WIN OS : Microsoft Windows 11 Enterprise', 'Build : 10.0.26100', 'Date : 11.11.2026 10:00:00',
      '', 'Windows Updates (Available)', '    + FullyQualifiedErrorId : Demo.CollectionUnavailable',
    ].join('\r\n')],
    [root + 'CDAT1.26-ComputerInfo-Demo.log', Buffer.concat([Buffer.from([255, 254]), Buffer.from('OsName : Microsoft Windows 11 Enterprise\r\nOsVersion : 10.0.26100\r\nBiosSMBIOSBIOSVersion : DEMOET10W (1.10)\r\n', 'utf16le')])],
    [root + 'Installed-HWD/Drivers.log', 'DeviceName                                              DriverVersion\r\n----------                                              -------------\r\nDemo Wi-Fi Adapter                                      24.50.0.4\r\nDemo Bluetooth Adapter                                  24.40.10.3\r\nDemo Audio Adapter                                      6.0.10007.1\r\n'],
    [root + 'Installed-HWD/Driver3rdPartyOEMINF.log', 'Driver store only: Demo Wi-Fi Adapter 23.80.0.7\r\n'],
    [root + 'CDAT1.26-Issues-Demo.log', 'This synthetic sample includes an intentionally unavailable query.\r\n'],
    [root + 'Windows-Event-Logs/Example.log', 'This raw example is deliberately not loaded by the first inventory import.\r\n'],
  ];
}
