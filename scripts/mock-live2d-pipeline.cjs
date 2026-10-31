/**
 * 【测试适配器】本地假流水线 —— 不根据上传图生成角色。
 * 无论收到什么立绘 / 人物卡预览，一律返回内置 Haru 的 zip，仅用于打通「任务 → 导入」链路。
 *
 * 用法：npm run pipeline:mock
 * 桌宠设置 → 角色生成 → 高级选项 → 填：http://127.0.0.1:51000
 *
 * 响应头会带 X-Pet-Adapter: mock-haru，桌宠会在任务与角色描述中标明「假数据」。
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const os = require('os')

const PORT = Number(process.env.PET_L2D_PIPELINE_PORT || 51000)
const ROOT = path.join(__dirname, '..')
const HARU = path.join(ROOT, 'public', 'characters', 'haru')
const ADAPTER_ID = 'mock-haru'

function zipHaru() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-l2d-'))
  const staging = path.join(tmp, 'haru-pack')
  fs.cpSync(HARU, staging, { recursive: true })
  const zipPath = path.join(tmp, 'pack.zip')
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${staging.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: 'utf8' },
    )
    if (ps.status !== 0) throw new Error(ps.stderr || ps.stdout || 'zip failed')
  } else {
    const result = spawnSync('zip', ['-r', zipPath, '.'], { cwd: staging, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || 'zip failed')
  }
  const buf = fs.readFileSync(zipPath)
  fs.rmSync(tmp, { recursive: true, force: true })
  return buf
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        mock: true,
        adapter: ADAPTER_ID,
        note: 'TEST ADAPTER — always returns bundled Haru zip, not real generation',
      }),
    )
    return
  }

  if (req.method === 'POST' && (req.url === '/generate' || req.url?.startsWith('/generate?'))) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    console.log(
      `[mock-pipeline] TEST ADAPTER ${ADAPTER_ID}: got ${body.length} bytes — returning bundled Haru (not your art)`,
    )
    try {
      const zip = zipHaru()
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': zip.length,
        'X-Pet-Adapter': ADAPTER_ID,
        'X-Pet-Mock': '1',
      })
      res.end(zip)
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(String(error.message || error))
    }
    return
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('')
  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║  DesktopPet TEST ADAPTER (mock-haru)                 ║')
  console.log('║  Always returns bundled Haru — NOT real Live2D gen   ║')
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log(`[mock-pipeline] http://127.0.0.1:${PORT}/generate`)
  console.log('[mock-pipeline] 桌宠 → 设置 → 角色生成 → 高级选项 → 填此地址后点「生成」')
  console.log('[mock-pipeline] 阶段 A 更推荐：任务行点「生成本地占位」（不依赖本服务）')
})
