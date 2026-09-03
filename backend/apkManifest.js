'use strict';

const zlib = require('zlib');

const PACKAGE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

function listZipEntries(buffer) {
  const min = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('APK ZIP central directory not found');

  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  let off = centralOffset;
  const entries = [];

  for (let i = 0; i < totalEntries; i++) {
    if (off + 46 > buffer.length || buffer.readUInt32LE(off) !== 0x02014b50) {
      throw new Error('APK ZIP central directory is malformed');
    }

    const method = buffer.readUInt16LE(off + 10);
    const compressedSize = buffer.readUInt32LE(off + 20);
    const uncompressedSize = buffer.readUInt32LE(off + 24);
    const nameLen = buffer.readUInt16LE(off + 28);
    const extraLen = buffer.readUInt16LE(off + 30);
    const commentLen = buffer.readUInt16LE(off + 32);
    const localOffset = buffer.readUInt32LE(off + 42);

    const nameStart = off + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > buffer.length) throw new Error('APK ZIP filename is truncated');

    entries.push({
      name: buffer.toString('utf8', nameStart, nameEnd),
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    off = nameEnd + extraLen + commentLen;
  }

  return entries;
}

function readZipEntryFromMeta(buffer, entry, maxUncompressedBytes = null) {
  const { method, compressedSize, uncompressedSize, localOffset } = entry;
  if (maxUncompressedBytes != null && uncompressedSize > maxUncompressedBytes) {
    throw new Error('APK ZIP entry exceeds allowed size');
  }
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error('APK ZIP local header is malformed');
  }

  const localNameLen = buffer.readUInt16LE(localOffset + 26);
  const localExtraLen = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + localNameLen + localExtraLen;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > buffer.length) throw new Error('APK ZIP entry is truncated');

  const compressed = buffer.subarray(dataStart, dataEnd);
  let output;
  if (method === 0) {
    output = Buffer.from(compressed);
  } else if (method === 8) {
    output = zlib.inflateRawSync(compressed, maxUncompressedBytes == null
      ? undefined
      : { maxOutputLength: maxUncompressedBytes });
  } else {
    throw new Error(`Unsupported APK compression method ${method}`);
  }

  if (output.length !== uncompressedSize) {
    throw new Error('APK ZIP entry size mismatch');
  }
  return output;
}

function readZipEntry(buffer, targetName) {
  const entry = listZipEntries(buffer).find(item => item.name === targetName);
  if (!entry) throw new Error(`${targetName} not found in APK`);
  return readZipEntryFromMeta(buffer, entry);
}

const ICON_MAX_BYTES = 2 * 1024 * 1024;

function iconScore(name, size) {
  const lower = name.toLowerCase();
  if (!/^res\//.test(lower)) return -1;
  if (!/\.(png|webp|jpe?g)$/.test(lower) || /\.9\.png$/.test(lower)) return -1;

  const base = lower.split('/').pop().replace(/\.(png|webp|jpe?g)$/, '');
  let score = 0;
  if (/^res\/mipmap/.test(lower)) score += 100;
  if (/^res\/drawable/.test(lower)) score += 25;
  if (/^(ic_launcher|ic_launcher_round|launcher|app_icon|icon)$/.test(base)) score += 220;
  else if (/launcher/.test(base)) score += 160;
  else if (/(^|_)app(_|$).*icon|(^|_)icon(_|$)/.test(base)) score += 120;
  else if (/logo/.test(base)) score += 55;

  if (/xxxhdpi/.test(lower)) score += 60;
  else if (/xxhdpi/.test(lower)) score += 50;
  else if (/xhdpi/.test(lower)) score += 40;
  else if (/hdpi/.test(lower)) score += 30;
  else if (/mdpi/.test(lower)) score += 20;

  // Prefer a substantial raster over tiny notification/status icons.
  score += Math.min(40, Math.floor(Math.log2(Math.max(1, size))));
  return score;
}

function extractAppIcon(apkBuffer) {
  const candidates = listZipEntries(apkBuffer)
    .filter(entry => entry.uncompressedSize > 0 && entry.uncompressedSize <= ICON_MAX_BYTES)
    .map(entry => ({ entry, score: iconScore(entry.name, entry.uncompressedSize) }))
    .filter(item => item.score >= 100)
    .sort((a, b) => b.score - a.score || b.entry.uncompressedSize - a.entry.uncompressedSize);

  for (const { entry } of candidates) {
    try {
      const buffer = readZipEntryFromMeta(apkBuffer, entry, ICON_MAX_BYTES);
      const lower = entry.name.toLowerCase();
      const extension = lower.endsWith('.webp') ? 'webp'
        : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'jpg'
        : 'png';
      const contentType = extension === 'webp' ? 'image/webp'
        : extension === 'jpg' ? 'image/jpeg'
        : 'image/png';
      return { buffer, contentType, extension, path: entry.name };
    } catch {
      // Try the next plausible launcher icon rather than failing the APK upload.
    }
  }
  return null;
}

function readUtf8Length(buffer, offset) {
  const first = buffer[offset];
  if (first === undefined) throw new Error('Truncated UTF-8 string pool');
  if ((first & 0x80) === 0) return { value: first, bytes: 1 };

  const second = buffer[offset + 1];
  if (second === undefined) throw new Error('Truncated UTF-8 string pool');
  return { value: ((first & 0x7f) << 8) | second, bytes: 2 };
}

function readUtf16Length(buffer, offset) {
  if (offset + 2 > buffer.length) throw new Error('Truncated UTF-16 string pool');
  const first = buffer.readUInt16LE(offset);
  if ((first & 0x8000) === 0) return { value: first, bytes: 2 };

  if (offset + 4 > buffer.length) throw new Error('Truncated UTF-16 string pool');
  const second = buffer.readUInt16LE(offset + 2);
  return { value: ((first & 0x7fff) << 16) | second, bytes: 4 };
}

function parseStringPool(buffer, offset) {
  const headerSize = buffer.readUInt16LE(offset + 2);
  const chunkSize = buffer.readUInt32LE(offset + 4);
  if (headerSize < 28 || offset + chunkSize > buffer.length) {
    throw new Error('Malformed APK string pool');
  }

  const stringCount = buffer.readUInt32LE(offset + 8);
  const flags = buffer.readUInt32LE(offset + 16);
  const stringsStart = buffer.readUInt32LE(offset + 20);
  const utf8 = (flags & 0x100) !== 0;
  const offsetsStart = offset + headerSize;

  if (offsetsStart + stringCount * 4 > offset + chunkSize) {
    throw new Error('Malformed APK string offsets');
  }

  const strings = [];
  for (let i = 0; i < stringCount; i++) {
    const relativeOffset = buffer.readUInt32LE(offsetsStart + i * 4);
    let pos = offset + stringsStart + relativeOffset;

    if (pos < offset || pos >= offset + chunkSize) {
      throw new Error('Invalid APK string offset');
    }

    if (utf8) {
      const chars = readUtf8Length(buffer, pos);
      pos += chars.bytes;
      const bytes = readUtf8Length(buffer, pos);
      pos += bytes.bytes;
      const end = pos + bytes.value;
      if (end > offset + chunkSize) throw new Error('Truncated APK UTF-8 string');
      strings.push(buffer.toString('utf8', pos, end));
    } else {
      const length = readUtf16Length(buffer, pos);
      pos += length.bytes;
      const end = pos + length.value * 2;
      if (end > offset + chunkSize) throw new Error('Truncated APK UTF-16 string');
      strings.push(buffer.toString('utf16le', pos, end));
    }
  }

  return strings;
}

function extractPackageName(apkBuffer) {
  const xml = readZipEntry(apkBuffer, 'AndroidManifest.xml');
  if (xml.length < 8 || xml.readUInt16LE(0) !== 0x0003) {
    throw new Error('AndroidManifest.xml is not binary Android XML');
  }

  const xmlSize = xml.readUInt32LE(4);
  if (xmlSize > xml.length || xmlSize < 8) {
    throw new Error('Malformed AndroidManifest.xml');
  }

  let strings = null;
  let offset = xml.readUInt16LE(2);

  while (offset + 8 <= xmlSize) {
    const type = xml.readUInt16LE(offset);
    const headerSize = xml.readUInt16LE(offset + 2);
    const chunkSize = xml.readUInt32LE(offset + 4);

    if (headerSize < 8 || chunkSize < headerSize || offset + chunkSize > xmlSize) {
      throw new Error('Malformed AndroidManifest.xml chunk');
    }

    if (type === 0x0001) {
      strings = parseStringPool(xml, offset);
    } else if (type === 0x0102 && strings) {
      if (headerSize < 16 || chunkSize < 36) {
        throw new Error('Malformed manifest start element');
      }

      const nameIndex = xml.readUInt32LE(offset + 20);
      if (strings[nameIndex] === 'manifest') {
        const attributeStart = xml.readUInt16LE(offset + 24);
        const attributeSize = xml.readUInt16LE(offset + 26);
        const attributeCount = xml.readUInt16LE(offset + 28);

        if (attributeSize < 20) throw new Error('Malformed manifest attributes');

        const attributesBase = offset + 16 + attributeStart;
        if (attributesBase < offset ||
            attributesBase + attributeCount * attributeSize > offset + chunkSize) {
          throw new Error('Manifest attributes exceed chunk bounds');
        }

        for (let i = 0; i < attributeCount; i++) {
          const attributeOffset = attributesBase + i * attributeSize;
          const attributeNameIndex = xml.readUInt32LE(attributeOffset + 4);
          const rawValueIndex = xml.readUInt32LE(attributeOffset + 8);
          const valueType = xml[attributeOffset + 15];
          const valueData = xml.readUInt32LE(attributeOffset + 16);

          if (strings[attributeNameIndex] !== 'package') continue;

          let value = null;
          if (rawValueIndex !== 0xffffffff) {
            value = strings[rawValueIndex];
          } else if (valueType === 0x03) {
            value = strings[valueData];
          }

          if (!value || !PACKAGE_NAME_REGEX.test(value)) {
            throw new Error('APK manifest package name is invalid');
          }
          return value;
        }

        throw new Error('APK manifest does not contain a package name');
      }
    }

    offset += chunkSize;
  }

  throw new Error('APK manifest element not found');
}

module.exports = { extractPackageName, extractAppIcon };
