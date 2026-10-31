/**
 * 生成 testdata/ 下的 PCM WAV 样例，供音色库上传 / 重建自测。
 * 用法：node scripts/gen-testdata.cjs
 */
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'testdata')
const SAMPLE_RATE = 16000

function pcm16MonoWav(pcm) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** 简单「人声感」合成：基频 + 谐波 + 轻颤音（非真实人声，仅测管线） */
function synthClip(seconds, { freq = 220, amplitude = 0.35, seed = 1 } = {}) {
  const frames = Math.max(1, Math.floor(seconds * SAMPLE_RATE))
  const pcm = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i += 1) {
    const t = i / SAMPLE_RATE
    const vibrato = 1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t)
    const env = Math.min(1, t * 8) * Math.min(1, (seconds - t) * 8)
    const noise = ((Math.sin(i * 12.9898 + seed) * 43758.5453) % 1) * 0.04
    const wave =
      Math.sin(2 * Math.PI * freq * vibrato * t) * 0.55 +
      Math.sin(2 * Math.PI * freq * 2 * vibrato * t) * 0.25 +
      Math.sin(2 * Math.PI * freq * 3 * vibrato * t) * 0.12 +
      noise
    const sample = Math.max(-1, Math.min(1, wave * amplitude * env))
    pcm.writeInt16LE(Math.round(sample * 32767), i * 2)
  }
  return pcm16MonoWav(pcm)
}

const clips = [
  { name: 'sample-01-1s.wav', seconds: 1.0, freq: 196, amplitude: 0.4, seed: 1 },
  { name: 'sample-02-2s.wav', seconds: 2.0, freq: 220, amplitude: 0.38, seed: 2 },
  { name: 'sample-03-3s.wav', seconds: 3.0, freq: 247, amplitude: 0.36, seed: 3 },
  { name: 'sample-04-4s.wav', seconds: 4.0, freq: 175, amplitude: 0.34, seed: 4 },
  { name: 'sample-05-quiet.wav', seconds: 2.5, freq: 210, amplitude: 0.08, seed: 5 },
  { name: 'sample-too-short.wav', seconds: 0.25, freq: 200, amplitude: 0.4, seed: 6 },
]

fs.mkdirSync(OUT, { recursive: true })

for (const clip of clips) {
  const file = path.join(OUT, clip.name)
  fs.writeFileSync(file, synthClip(clip.seconds, clip))
  console.log('wrote', path.relative(process.cwd(), file), `(${clip.seconds}s)`)
}

console.log('done →', OUT)
