const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const TARGET_SECONDS = 10
const MIN_CLIP_SECONDS = 0.4
const SAMPLE_RATE = 16000

function voiceRoot(userData, characterId) {
  const safe = String(characterId || 'default').replace(/[^\w\-]+/g, '_')
  return path.join(userData, 'voices', safe)
}

function ensureDirs(root) {
  fs.mkdirSync(path.join(root, 'samples'), { recursive: true })
}

function readManifest(root) {
  const file = path.join(root, 'manifest.json')
  if (!fs.existsSync(file)) {
    return { samples: [], promptSeconds: 0, updatedAt: null }
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { samples: [], promptSeconds: 0, updatedAt: null }
  }
}

function writeManifest(root, manifest) {
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

function pcm16MonoWavHeader(dataBytes, sampleRate = SAMPLE_RATE) {
  const buffer = Buffer.alloc(44)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  return buffer
}

function decodeWavToMono16(filePath) {
  const buf = fs.readFileSync(filePath)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('仅支持 WAV 文件')
  }
  let offset = 12
  let audioFormat = 1
  let channels = 1
  let sampleRate = SAMPLE_RATE
  let bitsPerSample = 16
  let dataOffset = -1
  let dataSize = 0

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === 'fmt ') {
      audioFormat = buf.readUInt16LE(start)
      channels = buf.readUInt16LE(start + 2)
      sampleRate = buf.readUInt32LE(start + 4)
      bitsPerSample = buf.readUInt16LE(start + 14)
    } else if (id === 'data') {
      dataOffset = start
      dataSize = size
      break
    }
    offset = start + size + (size % 2)
  }

  if (dataOffset < 0) throw new Error('WAV 缺少 data 块')
  if (audioFormat !== 1) throw new Error('仅支持 PCM WAV')
  if (![8, 16].includes(bitsPerSample)) throw new Error('仅支持 8/16 bit PCM')

  let pcm = buf.subarray(dataOffset, dataOffset + dataSize)
  if (bitsPerSample === 8) {
    const out = Buffer.alloc(pcm.length * 2)
    for (let i = 0; i < pcm.length; i += 1) {
      const sample = (pcm[i] - 128) << 8
      out.writeInt16LE(sample, i * 2)
    }
    pcm = out
  }

  if (channels > 1) {
    const frames = Math.floor(pcm.length / (2 * channels))
    const mono = Buffer.alloc(frames * 2)
    for (let i = 0; i < frames; i += 1) {
      let sum = 0
      for (let c = 0; c < channels; c += 1) {
        sum += pcm.readInt16LE((i * channels + c) * 2)
      }
      mono.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sum / channels))), i * 2)
    }
    pcm = mono
  }

  // naive resample to 16k if needed
  if (sampleRate !== SAMPLE_RATE) {
    const srcFrames = Math.floor(pcm.length / 2)
    const dstFrames = Math.max(1, Math.round((srcFrames * SAMPLE_RATE) / sampleRate))
    const out = Buffer.alloc(dstFrames * 2)
    for (let i = 0; i < dstFrames; i += 1) {
      const srcIndex = Math.min(srcFrames - 1, Math.floor((i * sampleRate) / SAMPLE_RATE))
      out.writeInt16LE(pcm.readInt16LE(srcIndex * 2), i * 2)
    }
    pcm = out
    sampleRate = SAMPLE_RATE
  }

  const seconds = pcm.length / (2 * sampleRate)
  return { pcm, sampleRate, seconds }
}

function scoreClip(seconds, pcm) {
  // Prefer 1–8s clips; penalize very quiet audio.
  let peak = 1
  for (let i = 0; i < pcm.length; i += 2) {
    peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)))
  }
  const loud = Math.min(1, peak / 8000)
  const lengthScore = seconds < 1 ? seconds : seconds <= 8 ? 1 : Math.max(0.2, 8 / seconds)
  return loud * 0.45 + lengthScore * 0.55
}

function listVoiceBank(userData, characterId) {
  const root = voiceRoot(userData, characterId)
  ensureDirs(root)
  const manifest = readManifest(root)
  const promptPath = path.join(root, 'prompt.wav')
  return {
    characterId,
    sampleCount: manifest.samples.length,
    totalSeconds: Number(
      manifest.samples.reduce((sum, item) => sum + (item.seconds || 0), 0).toFixed(2),
    ),
    promptReady: fs.existsSync(promptPath),
    promptSeconds: manifest.promptSeconds || 0,
    updatedAt: manifest.updatedAt,
    samples: manifest.samples.map((item) => ({
      id: item.id,
      name: item.name,
      seconds: item.seconds,
      addedAt: item.addedAt,
    })),
  }
}

function addVoiceSamples(userData, characterId, files) {
  const root = voiceRoot(userData, characterId)
  ensureDirs(root)
  const manifest = readManifest(root)
  const added = []

  for (const file of files || []) {
    const sourcePath = file.path ? String(file.path) : ''
    const originalName = String(
      file.name || (sourcePath ? path.basename(sourcePath) : `sample-${Date.now()}.wav`),
    )
    const ext = path.extname(originalName).toLowerCase() || '.wav'
    if (ext !== '.wav') {
      throw new Error(`暂仅支持 WAV：${originalName}`)
    }
    const id = randomUUID()
    const savedName = `${id}.wav`
    const dest = path.join(root, 'samples', savedName)
    const bytes = sourcePath
      ? fs.readFileSync(sourcePath)
      : Buffer.from(String(file.dataBase64 || ''), 'base64')
    if (!bytes.length) throw new Error(`空文件：${originalName}`)
    fs.writeFileSync(dest, bytes)

    let meta
    try {
      meta = decodeWavToMono16(dest)
    } catch (error) {
      fs.unlinkSync(dest)
      throw error
    }
    if (meta.seconds < MIN_CLIP_SECONDS) {
      fs.unlinkSync(dest)
      throw new Error(`太短（${meta.seconds.toFixed(2)}s）：${originalName}`)
    }

    const entry = {
      id,
      name: originalName,
      file: savedName,
      seconds: Number(meta.seconds.toFixed(2)),
      score: Number(scoreClip(meta.seconds, meta.pcm).toFixed(4)),
      addedAt: new Date().toISOString(),
    }
    manifest.samples.push(entry)
    added.push(entry)
  }

  writeManifest(root, manifest)
  const rebuilt = rebuildPrompt(userData, characterId)
  return { added, bank: listVoiceBank(userData, characterId), rebuilt }
}

function removeVoiceSample(userData, characterId, sampleId) {
  const root = voiceRoot(userData, characterId)
  const manifest = readManifest(root)
  const target = manifest.samples.find((item) => item.id === sampleId)
  if (!target) throw new Error('样本不存在')
  const file = path.join(root, 'samples', target.file)
  if (fs.existsSync(file)) fs.unlinkSync(file)
  manifest.samples = manifest.samples.filter((item) => item.id !== sampleId)
  writeManifest(root, manifest)
  const rebuilt = rebuildPrompt(userData, characterId)
  return { bank: listVoiceBank(userData, characterId), rebuilt }
}

function rebuildPrompt(userData, characterId) {
  const root = voiceRoot(userData, characterId)
  ensureDirs(root)
  const manifest = readManifest(root)
  if (!manifest.samples.length) {
    const promptPath = path.join(root, 'prompt.wav')
    if (fs.existsSync(promptPath)) fs.unlinkSync(promptPath)
    manifest.promptSeconds = 0
    manifest.updatedAt = new Date().toISOString()
    writeManifest(root, manifest)
    return { ok: false, reason: 'no-samples', promptSeconds: 0 }
  }

  const ranked = [...manifest.samples].sort((a, b) => (b.score || 0) - (a.score || 0))
  const chunks = []
  let total = 0
  const used = []

  for (const item of ranked) {
    const file = path.join(root, 'samples', item.file)
    if (!fs.existsSync(file)) continue
    try {
      const decoded = decodeWavToMono16(file)
      if (decoded.seconds < MIN_CLIP_SECONDS) continue
      chunks.push(decoded.pcm)
      used.push(item.id)
      total += decoded.seconds
      if (total >= TARGET_SECONDS) break
    } catch {
      // skip bad clip
    }
  }

  if (total < 1.0 || !chunks.length) {
    return { ok: false, reason: 'too-short', promptSeconds: Number(total.toFixed(2)) }
  }

  const needBytes = Math.floor(TARGET_SECONDS * SAMPLE_RATE) * 2
  const merged = Buffer.concat(chunks).subarray(0, Math.min(needBytes, Buffer.concat(chunks).length))
  const wav = Buffer.concat([pcm16MonoWavHeader(merged.length, SAMPLE_RATE), merged])
  fs.writeFileSync(path.join(root, 'prompt.wav'), wav)
  manifest.promptSeconds = Number((merged.length / (2 * SAMPLE_RATE)).toFixed(2))
  manifest.updatedAt = new Date().toISOString()
  manifest.lastUsedSampleIds = used
  writeManifest(root, manifest)
  return {
    ok: true,
    promptSeconds: manifest.promptSeconds,
    usedSampleCount: used.length,
    totalSampleCount: manifest.samples.length,
  }
}

function buildMultipart(fields, file) {
  const boundary = `----DesktopPet${Date.now()}`
  const chunks = []
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    )
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: audio/wav\r\n\r\n`,
      'utf8',
    ),
  )
  chunks.push(file.buffer)
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'))
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function postMultipart(urlString, fields, file, timeoutMs = 90000) {
  const https = require('https')
  const http = require('http')
  const { body, contentType } = buildMultipart(fields, file)
  const url = new URL(urlString)
  const transport = url.protocol === 'https:' ? https : http

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': body.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const parts = []
        res.on('data', (chunk) => parts.push(chunk))
        res.on('end', () => {
          const buf = Buffer.concat(parts)
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`语音服务失败 HTTP ${res.statusCode}`))
            return
          }
          resolve(buf)
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('语音服务超时'))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function synthesizeWithPrompt(userData, characterId, text, cosyvoiceUrl) {
  const root = voiceRoot(userData, characterId)
  const promptPath = path.join(root, 'prompt.wav')
  if (!fs.existsSync(promptPath)) {
    throw new Error('还没有可用音色，请先上传语音并重建')
  }
  const line = String(text || '').trim()
  if (!line) throw new Error('没有可朗读的文本')

  const base = String(cosyvoiceUrl || 'http://127.0.0.1:50000').replace(/\/$/, '')
  const bytes = await postMultipart(
    `${base}/inference_cross_lingual`,
    { tts_text: line.slice(0, 280), speed: '1.00' },
    { field: 'prompt_wav', filename: 'voice.wav', buffer: fs.readFileSync(promptPath) },
  )
  if (!bytes.length) throw new Error('语音服务返回空音频')
  return bytes.toString('base64')
}

module.exports = {
  listVoiceBank,
  addVoiceSamples,
  removeVoiceSample,
  rebuildPrompt,
  synthesizeWithPrompt,
  voiceRoot,
}
