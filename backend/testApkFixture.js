'use strict';

function encodeLength(value) {
  if (value < 0x80) return Buffer.from([value]);
  return Buffer.from([0x80 | ((value >> 8) & 0x7f), value & 0xff]);
}

function buildStringPool(strings) {
  const encoded = [];
  const offsets = [];
  let total = 0;

  for (const value of strings) {
    const bytes = Buffer.from(value, 'utf8');
    offsets.push(total);
    const item = Buffer.concat([
      encodeLength([...value].length),
      encodeLength(bytes.length),
      bytes,
      Buffer.from([0]),
    ]);
    encoded.push(item);
    total += item.length;
  }

  const stringsStart = 28 + strings.length * 4;
  const raw = Buffer.concat(encoded);
  const padding = (4 - (raw.length % 4)) % 4;
  const size = stringsStart + raw.length + padding;
  const out = Buffer.alloc(size);

  out.writeUInt16LE(0x0001, 0);
  out.writeUInt16LE(28, 2);
  out.writeUInt32LE(size, 4);
  out.writeUInt32LE(strings.length, 8);
  out.writeUInt32LE(0, 12);
  out.writeUInt32LE(0x100, 16);
  out.writeUInt32LE(stringsStart, 20);
  out.writeUInt32LE(0, 24);

  offsets.forEach((value, index) => out.writeUInt32LE(value, 28 + index * 4));
  raw.copy(out, stringsStart);
  return out;
}

function buildMinimalManifest(packageName) {
  const strings = ['manifest', 'package', packageName];
  const pool = buildStringPool(strings);
  const startElement = Buffer.alloc(56);

  startElement.writeUInt16LE(0x0102, 0);
  startElement.writeUInt16LE(16, 2);
  startElement.writeUInt32LE(56, 4);
  startElement.writeUInt32LE(1, 8);
  startElement.writeUInt32LE(0xffffffff, 12);
  startElement.writeUInt32LE(0xffffffff, 16);
  startElement.writeUInt32LE(0, 20);
  startElement.writeUInt16LE(20, 24);
  startElement.writeUInt16LE(20, 26);
  startElement.writeUInt16LE(1, 28);
  startElement.writeUInt16LE(0, 30);
  startElement.writeUInt16LE(0, 32);
  startElement.writeUInt16LE(0, 34);

  const attr = 36;
  startElement.writeUInt32LE(0xffffffff, attr);
  startElement.writeUInt32LE(1, attr + 4);
  startElement.writeUInt32LE(2, attr + 8);
  startElement.writeUInt16LE(8, attr + 12);
  startElement[attr + 14] = 0;
  startElement[attr + 15] = 0x03;
  startElement.writeUInt32LE(2, attr + 16);

  const total = 8 + pool.length + startElement.length;
  const xmlHeader = Buffer.alloc(8);
  xmlHeader.writeUInt16LE(0x0003, 0);
  xmlHeader.writeUInt16LE(8, 2);
  xmlHeader.writeUInt32LE(total, 4);

  return Buffer.concat([xmlHeader, pool, startElement]);
}

function buildStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const payload = Buffer.from(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBytes, eocd]);
}

function buildTestApk(packageName = 'com.example.fixture', minSize = 0, icon = null) {
  const entries = [{ name: 'AndroidManifest.xml', data: buildMinimalManifest(packageName) }];
  if (icon) {
    entries.push({
      name: icon.path || 'res/mipmap-xxxhdpi-v4/ic_launcher.png',
      data: icon.buffer || Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
    });
  }

  let apk = buildStoredZip(entries);
  if (apk.length < minSize) {
    entries.push({ name: 'assets/test-padding.bin', data: Buffer.alloc(minSize - apk.length + 128) });
    apk = buildStoredZip(entries);
  }
  return apk;
}

module.exports = { buildTestApk };
