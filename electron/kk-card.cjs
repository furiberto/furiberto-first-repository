const fs = require('fs')
const path = require('path')

const CHARA_MARKERS = [
  '【KoiKatuChara】',
  '【KoiKatuCharaS】',
  '【KoiKatuCharaSun】',
  'KoiKatuChara',
]
const CLOTHES_MARKERS = ['【KoiKatuClothes】', 'KoiKatuClothes']

function pngEndOffset(buf) {
  if (buf.length < 8 || buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('不是有效 PNG')
  }
  let offset = 8
  while (offset + 12 <= buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    offset += 12 + len
    if (type === 'IEND') return offset
  }
  throw new Error('PNG 缺少 IEND')
}

function includesMarker(buf, markers) {
  return markers.some((marker) => buf.includes(marker))
}

function readMsgpackStr(buf, offset) {
  if (offset >= buf.length) return null
  const b = buf[offset]
  if (b >= 0xa0 && b <= 0xbf) {
    const n = b - 0xa0
    return { value: buf.toString('utf8', offset + 1, offset + 1 + n), next: offset + 1 + n }
  }
  if (b === 0xd9) {
    const n = buf.readUInt8(offset + 1)
    return { value: buf.toString('utf8', offset + 2, offset + 2 + n), next: offset + 2 + n }
  }
  if (b === 0xda) {
    const n = buf.readUInt16BE(offset + 1)
    return { value: buf.toString('utf8', offset + 3, offset + 3 + n), next: offset + 3 + n }
  }
  return null
}

const NAME_KEYS = new Set([
  'lastname',
  'firstname',
  'nickname',
  'name',
  'fullname',
  'Parameter',
  'Custom',
  'Coordinate',
  'Status',
  'KKEx',
])

function isMsgpackKeyAt(buf, idx, key) {
  if (idx <= 0) return false
  if (buf[idx - 1] >= 0xa0 && buf[idx - 1] <= 0xbf) {
    return buf[idx - 1] - 0xa0 === key.length
  }
  if (idx > 1 && buf[idx - 2] === 0xd9) {
    return buf[idx - 1] === key.length
  }
  return false
}

function readFieldAfterKey(buf, key) {
  let from = 0
  while (from < buf.length) {
    const idx = buf.indexOf(key, from)
    if (idx < 0) return ''
    if (!isMsgpackKeyAt(buf, idx, key)) {
      from = idx + 1
      continue
    }
    const after = idx + key.length
    for (let t = 0; t < 16; t += 1) {
      const parsed = readMsgpackStr(buf, after + t)
      if (!parsed) continue
      const value = parsed.value
      if (!value || value.length >= 64) continue
      if (NAME_KEYS.has(value)) continue
      return value
    }
    from = idx + 1
  }
  return ''
}

function detectKind(tail) {
  if (includesMarker(tail, CLOTHES_MARKERS) && !includesMarker(tail, CHARA_MARKERS)) {
    return 'clothes'
  }
  if (includesMarker(tail, CHARA_MARKERS)) return 'chara'
  return 'image'
}

function parseKkCard(filePath) {
  const buf = fs.readFileSync(filePath)
  const end = pngEndOffset(buf)
  const preview = buf.subarray(0, end)
  const tail = buf.subarray(end)
  const kind = detectKind(tail)

  let productNo = null
  let header = ''
  let version = ''
  if (tail.length >= 8 && kind === 'chara') {
    try {
      let o = 0
      productNo = tail.readInt32LE(o)
      o += 4
      const headerLen = tail.readUInt8(o)
      o += 1
      header = tail.toString('utf8', o, o + headerLen)
      o += headerLen
      const verLen = tail.readUInt8(o)
      o += 1
      version = tail.toString('utf8', o, o + verLen)
    } catch {
      // ignore header parse errors
    }
  }

  const lastname = readFieldAfterKey(buf, 'lastname')
  const firstname = readFieldAfterKey(buf, 'firstname')
  const nickname = readFieldAfterKey(buf, 'nickname')
  const displayName =
    [lastname, firstname].filter(Boolean).join(' ').trim() ||
    nickname ||
    path.basename(filePath, path.extname(filePath))

  return {
    kind,
    filePath,
    fileName: path.basename(filePath),
    preview,
    productNo,
    header,
    version,
    lastname,
    firstname,
    nickname,
    displayName,
    isCharacterCard: kind === 'chara',
  }
}

module.exports = {
  parseKkCard,
  pngEndOffset,
  detectKind,
}
