const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const https = require('https')
const http = require('http')
const { spawn } = require('child_process')
const { pathToFileURL } = require('url')
const { parseKkCard } = require('./kk-card.cjs')

/** @type {Map<string, import('child_process').ChildProcess>} */
const activeDecompose = new Map()

function imagePipelineRoot() {
  return path.join(__dirname, '..', 'services', 'image-pipeline')
}

function resolvePipelinePython() {
  const root = imagePipelineRoot()
  const win = path.join(root, '.venv', 'Scripts', 'python.exe')
  const nix = path.join(root, '.venv', 'bin', 'python')
  if (process.env.IMAGE_PIPELINE_PYTHON && fs.existsSync(process.env.IMAGE_PIPELINE_PYTHON)) {
    return process.env.IMAGE_PIPELINE_PYTHON
  }
  if (fs.existsSync(win)) return win
  if (fs.existsSync(nix)) return nix
  return 'python'
}

function charactersRoot(userData) {
  return path.join(userData, 'characters')
}

function jobsRoot(userData) {
  return path.join(userData, 'live2d-jobs')
}

function ensureRoots(userData) {
  fs.mkdirSync(charactersRoot(userData), { recursive: true })
  fs.mkdirSync(jobsRoot(userData), { recursive: true })
}

function safeId(raw) {
  const id = String(raw || 'char')
    .trim()
    .toLowerCase()
    .replace(/[^\w\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return id || `char-${Date.now().toString(36)}`
}

function uniqueCharacterId(userData, preferred) {
  const root = charactersRoot(userData)
  let base = safeId(preferred)
  if (!fs.existsSync(path.join(root, base))) return base
  let i = 2
  while (fs.existsSync(path.join(root, `${base}-${i}`))) i += 1
  return `${base}-${i}`
}

function findModel3(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.model3.json'))
  if (files.length) {
    files.sort((a, b) => a.name.localeCompare(b.name))
    return path.join(dir, files[0].name)
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    const nested = findModel3(path.join(dir, entry.name))
    if (nested) return nested
  }
  return null
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function buildMetaFromModel3(id, model3Path, displayName) {
  const model3 = readJson(model3Path)
  const modelFile = path.basename(model3Path)
  const motions = model3.FileReferences?.Motions || {}
  const motionGroups = Object.keys(motions)
  const expressions = []

  if (motionGroups.includes('Idle')) {
    expressions.push({
      id: 'idle',
      names: { 'zh-CN': '待机', en: 'Idle', ja: '待機' },
      motion: 'Idle',
      motionIndex: 0,
    })
  }

  for (const group of motionGroups) {
    if (group === 'Idle') continue
    const list = motions[group] || []
    list.forEach((_, index) => {
      expressions.push({
        id: `${safeId(group)}${index ? `-${index}` : ''}`,
        names: {
          'zh-CN': index ? `${group} ${index + 1}` : group,
          en: index ? `${group} ${index + 1}` : group,
          ja: index ? `${group} ${index + 1}` : group,
        },
        motion: group,
        motionIndex: index,
      })
    })
  }

  const faceList = model3.FileReferences?.Expressions || []
  faceList.slice(0, 8).forEach((item, index) => {
    const name = item.Name || `F${index + 1}`
    expressions.push({
      id: `face-${safeId(name)}`,
      names: { 'zh-CN': `表情 ${name}`, en: `Face ${name}`, ja: `表情 ${name}` },
      expression: name,
      motion: motionGroups.includes('Idle') ? 'Idle' : motionGroups[0],
      motionIndex: 0,
    })
  })

  if (!expressions.length) {
    expressions.push({
      id: 'idle',
      names: { 'zh-CN': '默认', en: 'Default', ja: 'デフォルト' },
    })
  }

  const label = displayName || id
  return {
    id,
    type: 'live2d',
    origin: 'user',
    names: { 'zh-CN': label, en: label, ja: label },
    description: {
      'zh-CN': '用户导入 / 图生 Live2D',
      en: 'Imported / AI Live2D pack',
      ja: 'インポート / 生成 Live2D',
    },
    modelFile,
    model: `petchar://${id}/${modelFile}`,
    fit: 0.92,
    defaultExpression: expressions[0].id,
    expressions,
    lines: {
      [expressions[0].id]: {
        'zh-CN': '新角色已就绪。',
        en: 'New character ready.',
        ja: '新しいキャラ準備完了。',
      },
    },
  }
}

function resolvePackDir(sourcePath) {
  const stat = fs.statSync(sourcePath)
  if (stat.isDirectory()) return sourcePath
  if (sourcePath.toLowerCase().endsWith('.model3.json')) return path.dirname(sourcePath)
  throw new Error('请选择含 .model3.json 的文件夹，或直接选 model3 文件')
}

function importCharacterPack(userData, sourcePath, options = {}) {
  ensureRoots(userData)
  const packDir = resolvePackDir(sourcePath)
  const model3Path = findModel3(packDir)
  if (!model3Path) throw new Error('未找到 .model3.json')

  const preferred = options.id || path.basename(packDir)
  const id = uniqueCharacterId(userData, preferred)
  const dest = path.join(charactersRoot(userData), id)
  fs.cpSync(packDir, dest, { recursive: true })

  const destModel3 = findModel3(dest)
  const metaPath = path.join(dest, 'meta.json')
  let meta
  if (fs.existsSync(metaPath)) {
    meta = readJson(metaPath)
    meta.id = id
    meta.type = 'live2d'
    meta.origin = 'user'
    meta.modelFile = path.basename(destModel3)
    meta.model = `petchar://${id}/${meta.modelFile}`
  } else {
    meta = buildMetaFromModel3(id, destModel3, options.name || preferred)
  }
  writeJson(metaPath, meta)
  return hydrateCharacter(meta)
}

function hydrateCharacter(meta) {
  const id = meta.id
  const isPlaceholder = Boolean(meta.placeholder || meta.type === 'placeholder')
  const isSprite = meta.type === 'sprite' || isPlaceholder

  if (isSprite) {
    const expressions = (meta.expressions || []).map((expr) => ({
      ...expr,
      src: expr.file ? `petchar://${id}/${String(expr.file).replace(/^\/+/, '')}` : undefined,
    }))
    return {
      ...meta,
      id,
      type: 'sprite',
      origin: 'user',
      placeholder: isPlaceholder,
      preview: expressions[0]?.src || null,
      expressions,
    }
  }

  const modelFile =
    meta.modelFile || path.basename(String(meta.model || '').replace(/^petchar:\/\/[^/]+\//, ''))
  return {
    ...meta,
    type: 'live2d',
    origin: 'user',
    modelFile,
    model: `petchar://${id}/${modelFile}`,
    preview: null,
    expressions: (meta.expressions || []).map((expr) => ({ ...expr })),
  }
}

/**
 * 阶段 A：用任务预览图生成「可显示」的占位桌宠角色（非 Live2D）。
 * 仅验证 选卡 → 任务 → 角色包 → 窗口显示 闭环。
 */
function createPlaceholderFromJob(userData, jobId) {
  ensureRoots(userData)
  const dir = path.join(jobsRoot(userData), jobId)
  const jobPath = path.join(dir, 'job.json')
  if (!fs.existsSync(jobPath)) throw new Error('任务不存在')
  const job = readJson(jobPath)
  const sourcePath = path.join(dir, job.sourceName || 'source.png')
  if (!fs.existsSync(sourcePath)) throw new Error('任务预览图不存在')

  const label = String(job.displayName || '预览角色').trim() || '预览角色'
  const labelSlug = String(label)
    .trim()
    .toLowerCase()
    .replace(/[^\w\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const id = uniqueCharacterId(userData, `ph-${labelSlug || jobId.slice(0, 8)}`)
  const dest = path.join(charactersRoot(userData), id)
  fs.mkdirSync(dest, { recursive: true })

  const ext = path.extname(sourcePath).toLowerCase() || '.png'
  const idleFile = `idle${ext === '.jpeg' ? '.jpg' : ext === '.jpg' || ext === '.png' || ext === '.webp' ? ext : '.png'}`
  fs.copyFileSync(sourcePath, path.join(dest, idleFile))

  const meta = {
    id,
    type: 'placeholder',
    placeholder: true,
    origin: 'user',
    names: {
      'zh-CN': label,
      en: label,
      ja: label,
    },
    description: {
      'zh-CN': '预览占位（非 Live2D，仅验证软件链路）',
      en: 'Preview placeholder (not Live2D)',
      ja: 'プレビュー用プレースホルダ（Live2Dではない）',
    },
    fit: 0.92,
    defaultExpression: 'idle',
    expressions: [
      {
        id: 'idle',
        names: { 'zh-CN': '待机', en: 'Idle', ja: '待機' },
        file: idleFile,
      },
      {
        id: 'tap',
        names: { 'zh-CN': '互动', en: 'Tap', ja: 'タップ' },
        file: idleFile,
      },
    ],
    lines: {
      idle: {
        'zh-CN': '这是预览占位角色，用来验证任务→桌宠闭环，不是完整 Live2D。',
        en: 'Preview placeholder for the pipeline — not a full Live2D rig.',
        ja: 'これはプレビュー用で、完全な Live2D ではありません。',
      },
      tap: {
        'zh-CN': '点到了占位图～',
        en: 'Placeholder tapped.',
        ja: 'プレースホルダをタップしたよ。',
      },
    },
    sourceJobId: jobId,
    createdAt: new Date().toISOString(),
  }
  writeJson(path.join(dest, 'meta.json'), meta)

  job.status = 'done'
  job.characterId = id
  job.resultKind = 'preview-placeholder'
  job.message = `已生成本地占位角色 ${id}（非 Live2D）`
  job.error = null
  updateJob(userData, job)

  return { job, character: hydrateCharacter(meta) }
}

function listCustomCharacters(userData) {
  ensureRoots(userData)
  const root = charactersRoot(userData)
  const list = []
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name)
    if (!fs.statSync(dir).isDirectory()) continue
    const metaPath = path.join(dir, 'meta.json')
    try {
      if (fs.existsSync(metaPath)) {
        list.push(hydrateCharacter(readJson(metaPath)))
        continue
      }
      const model3 = findModel3(dir)
      if (!model3) continue
      const meta = buildMetaFromModel3(name, model3, name)
      writeJson(metaPath, meta)
      list.push(hydrateCharacter(meta))
    } catch {
      // skip broken packs
    }
  }
  return list
}

function removeCustomCharacter(userData, characterId) {
  const id = safeId(characterId)
  const dir = path.join(charactersRoot(userData), id)
  if (!fs.existsSync(dir)) throw new Error('角色不存在')
  fs.rmSync(dir, { recursive: true, force: true })
  return { ok: true, id }
}

function resolveCharacterFile(userData, characterId, relativePath) {
  const id = safeId(characterId)
  const root = path.join(charactersRoot(userData), id)
  const cleaned = String(relativePath || '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
  const full = path.normalize(path.join(root, cleaned))
  if (!full.startsWith(path.normalize(root))) {
    throw new Error('非法路径')
  }
  return full
}

function listJobs(userData) {
  ensureRoots(userData)
  const root = jobsRoot(userData)
  return fs
    .readdirSync(root)
    .map((id) => {
      const file = path.join(root, id, 'job.json')
      if (!fs.existsSync(file)) return null
      try {
        return readJson(file)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
}

function removeJob(userData, jobId) {
  ensureRoots(userData)
  const id = String(jobId || '').trim()
  if (!id) throw new Error('任务 ID 无效')
  const dir = path.join(jobsRoot(userData), id)
  if (!fs.existsSync(dir)) throw new Error('任务不存在')
  fs.rmSync(dir, { recursive: true, force: true })
  return { ok: true, id }
}

function createJobFromImage(userData, imagePath, options = {}) {
  ensureRoots(userData)
  if (!fs.existsSync(imagePath)) throw new Error('图片不存在')
  const ext = path.extname(imagePath).toLowerCase() || '.png'
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    throw new Error('仅支持 PNG / JPG / WEBP')
  }
  const id = randomUUID()
  const dir = path.join(jobsRoot(userData), id)
  fs.mkdirSync(dir, { recursive: true })
  const sourceName = `source${ext}`
  fs.copyFileSync(imagePath, path.join(dir, sourceName))
  const job = {
    id,
    status: 'queued',
    sourceName,
    sourceType: options.sourceType || 'image',
    displayName: options.displayName || path.basename(imagePath, ext),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message:
      options.message ||
      '已保存立绘。可「生成本地占位」验证桌宠，或配置流水线后「生成」/「关联 moc」',
    characterId: null,
    error: null,
  }
  writeJson(path.join(dir, 'job.json'), job)
  return job
}

function createJobFromKkCard(userData, cardPath) {
  const parsed = parseKkCard(cardPath)
  if (parsed.kind === 'clothes') {
    throw new Error('这是服装卡（KoiKatuClothes），请选人物卡')
  }
  if (parsed.kind !== 'chara' && parsed.kind !== 'image') {
    throw new Error('无法识别的 PNG')
  }

  ensureRoots(userData)
  const id = randomUUID()
  const dir = path.join(jobsRoot(userData), id)
  fs.mkdirSync(dir, { recursive: true })
  const sourceName = 'source.png'
  fs.writeFileSync(path.join(dir, sourceName), parsed.preview)
  writeJson(path.join(dir, 'kk-meta.json'), {
    fileName: parsed.fileName,
    displayName: parsed.displayName,
    lastname: parsed.lastname,
    firstname: parsed.firstname,
    nickname: parsed.nickname,
    header: parsed.header,
    productNo: parsed.productNo,
    isCharacterCard: parsed.isCharacterCard,
  })

  const label = parsed.isCharacterCard ? '恋活人物卡' : '图片'
  const job = {
    id,
    status: 'queued',
    sourceName,
    sourceType: parsed.isCharacterCard ? 'kk-card' : 'image',
    displayName: parsed.displayName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message: `已从${label}提取预览：${parsed.displayName}。可「生成本地占位」验证桌宠闭环`,
    characterId: null,
    error: null,
  }
  writeJson(path.join(dir, 'job.json'), job)
  return job
}

function updateJob(userData, job) {
  const dir = path.join(jobsRoot(userData), job.id)
  job.updatedAt = new Date().toISOString()
  writeJson(path.join(dir, 'job.json'), job)
  return job
}

function postFile(urlString, filePath, fieldName, timeoutMs = 600000) {
  const boundary = `----PetL2D${Date.now()}`
  const fileBuf = fs.readFileSync(filePath)
  const filename = path.basename(filePath)
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    'utf8',
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  const body = Buffer.concat([head, fileBuf, tail])
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
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
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
            reject(new Error(`流水线失败 HTTP ${res.statusCode}: ${buf.toString('utf8').slice(0, 200)}`))
            return
          }
          resolve({
            buffer: buf,
            contentType: res.headers['content-type'] || '',
            headers: res.headers || {},
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('流水线超时'))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function extractZipTo(buffer, destDir) {
  const tmpZip = path.join(destDir, `_pack_${Date.now()}.zip`)
  fs.writeFileSync(tmpZip, buffer)
  try {
    // Prefer PowerShell Expand-Archive on Windows; unzip elsewhere.
    const { spawnSync } = require('child_process')
    if (process.platform === 'win32') {
      const ps = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
        ],
        { encoding: 'utf8' },
      )
      if (ps.status !== 0) {
        throw new Error(ps.stderr || ps.stdout || '解压失败')
      }
    } else {
      const result = spawnSync('unzip', ['-o', tmpZip, '-d', destDir], { encoding: 'utf8' })
      if (result.status !== 0) throw new Error(result.stderr || 'unzip failed')
    }
  } finally {
    try {
      fs.unlinkSync(tmpZip)
    } catch {
      // ignore
    }
  }
}

function isPipelineUnreachable(error) {
  const msg = String(error?.message || error || '')
  return /ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|超时|timeout|AggregateError/i.test(msg)
}

function friendlyPipelineError(error, pipelineUrl) {
  if (isPipelineUnreachable(error)) {
    const host = String(pipelineUrl || 'http://127.0.0.1:51000').replace(/\/$/, '')
    return `流水线未启动（${host}）。可点「生成本地占位」用预览图验证桌宠；或另开终端 npm run pipeline:mock 后再「生成」；或「关联 moc」。`
  }
  return String(error?.message || error)
}

async function runJobPipeline(userData, jobId, pipelineUrl, options = {}) {
  ensureRoots(userData)
  const dir = path.join(jobsRoot(userData), jobId)
  const jobPath = path.join(dir, 'job.json')
  if (!fs.existsSync(jobPath)) throw new Error('任务不存在')
  let job = readJson(jobPath)
  const base = String(pipelineUrl || '').replace(/\/$/, '')
  if (!base) throw new Error('请先填写图生 Live2D 流水线地址')

  job.status = 'running'
  job.message = '正在调用流水线…'
  job.error = null
  updateJob(userData, job)

  try {
    const imagePath = path.join(dir, job.sourceName)
    const endpoint = base.includes('/generate') ? base : `${base}/generate`
    const { buffer, contentType, headers } = await postFile(endpoint, imagePath, 'image')
    const isMockAdapter =
      String(headers['x-pet-adapter'] || '').toLowerCase() === 'mock-haru' ||
      String(headers['x-pet-mock'] || '') === '1'

    const unpackDir = path.join(dir, 'output')
    fs.rmSync(unpackDir, { recursive: true, force: true })
    fs.mkdirSync(unpackDir, { recursive: true })

    const looksZip =
      contentType.includes('zip') ||
      (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b)
    if (looksZip) {
      await extractZipTo(buffer, unpackDir)
    } else {
      fs.writeFileSync(path.join(unpackDir, 'response.bin'), buffer)
      throw new Error('流水线未返回 zip 角色包（需含 .model3.json）')
    }

    const model3 = findModel3(unpackDir)
    if (!model3) throw new Error('解压结果中没有 .model3.json')

    const packSource = path.dirname(model3)
    const preferredName = isMockAdapter
      ? `${job.displayName || '测试'}（Mock Haru）`
      : job.displayName || `AI ${jobId.slice(0, 8)}`
    const imported = importCharacterPack(userData, packSource, {
      id: isMockAdapter ? `mock-haru-${jobId.slice(0, 8)}` : `ai-${jobId.slice(0, 8)}`,
      name: preferredName,
    })

    if (isMockAdapter) {
      const metaPath = path.join(charactersRoot(userData), imported.id, 'meta.json')
      if (fs.existsSync(metaPath)) {
        const meta = readJson(metaPath)
        meta.testAdapter = 'mock-haru'
        meta.description = {
          'zh-CN': '【测试适配器】返回的是内置 Haru，不是你的立绘/人物卡',
          en: '[Test adapter] Bundled Haru — not your art/card',
          ja: '【テスト】内蔵 Haru。元画像ではありません',
        }
        writeJson(metaPath, meta)
        Object.assign(imported, hydrateCharacter(meta))
      }
    }

    job.status = 'done'
    job.characterId = imported.id
    job.resultKind = isMockAdapter ? 'mock-haru' : 'pipeline'
    job.message = isMockAdapter
      ? `【测试适配器】已导入内置 Haru 为 ${imported.id}（非真实角色生成）`
      : `已生成角色 ${imported.id}`
    updateJob(userData, job)
    return { job, character: imported, soft: false, mock: isMockAdapter }
  } catch (error) {
    const soft = Boolean(options.softFail) && isPipelineUnreachable(error)
    const tip = friendlyPipelineError(error, base)
    job.status = soft ? 'queued' : 'failed'
    job.error = tip
    job.message = soft
      ? `预览已保存${job.displayName ? `（${job.displayName}）` : ''}，流水线未连接 — 可「生成本地占位」`
      : '流水线失败'
    updateJob(userData, job)
    if (soft) return { job, character: null, soft: true, pipelineError: tip }
    const err = new Error(tip)
    throw err
  }
}

async function attachPackToJob(userData, jobId, sourcePath) {
  const dir = path.join(jobsRoot(userData), jobId)
  const jobPath = path.join(dir, 'job.json')
  if (!fs.existsSync(jobPath)) throw new Error('任务不存在')
  const job = readJson(jobPath)
  const imported = importCharacterPack(userData, sourcePath, {
    id: `job-${jobId.slice(0, 8)}`,
    name: `Job ${jobId.slice(0, 8)}`,
  })
  job.status = 'done'
  job.characterId = imported.id
  job.message = `已手动关联角色 ${imported.id}`
  job.error = null
  updateJob(userData, job)
  return { job, character: imported }
}

/**
 * Spawn local See-through adapter. Does NOT produce Live2D / .moc3.
 * Long GPU runs finish asynchronously; poll listJobs for needs_review.
 */
function startJobDecompose(userData, jobId, options = {}) {
  ensureRoots(userData)
  const id = String(jobId || '').trim()
  if (!id) throw new Error('任务 ID 无效')
  if (activeDecompose.has(id)) {
    throw new Error('该任务正在分层中，请稍候')
  }

  const dir = path.join(jobsRoot(userData), id)
  const jobPath = path.join(dir, 'job.json')
  if (!fs.existsSync(jobPath)) throw new Error('任务不存在')
  let job = readJson(jobPath)
  const imagePath = path.join(dir, job.sourceName || 'source.png')
  if (!fs.existsSync(imagePath)) throw new Error('任务预览图不存在')

  const backend =
    options.backend === 'see-through-quantized' ? 'see-through-quantized' : 'dry-run'
  const resolution = Number(options.resolution) > 0 ? Number(options.resolution) : 1024
  const adapter = path.join(imagePipelineRoot(), 'adapter', 'decompose_cli.py')
  if (!fs.existsSync(adapter)) {
    throw new Error(`找不到分层适配器：${adapter}`)
  }

  const python = resolvePipelinePython()
  const args = [
    adapter,
    '--image',
    imagePath,
    '--out',
    dir,
    '--backend',
    backend,
    '--resolution',
    String(resolution),
  ]

  job.status = 'running'
  job.phase = 'decomposing'
  job.resultKind = backend === 'dry-run' ? 'dry-run' : 'decomposition'
  job.live2d_ready = false
  job.error = null
  job.message =
    backend === 'dry-run'
      ? '正在准备分层目录（dry-run，无 GPU）…'
      : '正在 AI 分层（约数分钟～十余分钟，非 Live2D）…'
  updateJob(userData, job)

  const child = spawn(python, args, {
    cwd: path.join(imagePipelineRoot(), 'adapter'),
    windowsHide: true,
    env: { ...process.env },
  })
  activeDecompose.set(id, child)

  let stderrBuf = ''
  child.stderr?.on('data', (chunk) => {
    stderrBuf += String(chunk)
    if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-4000)
  })
  child.stdout?.on('data', () => {})

  child.on('error', (error) => {
    activeDecompose.delete(id)
    try {
      job = readJson(jobPath)
      job.status = 'failed'
      job.phase = 'failed'
      job.error = String(error.message || error)
      job.message = '无法启动 Python 分层进程（检查 .venv）'
      updateJob(userData, job)
    } catch {
      /* ignore */
    }
  })

  child.on('close', (code) => {
    activeDecompose.delete(id)
    try {
      job = readJson(jobPath)
      if (code === 0) {
        // Adapter merges job.json; re-read and normalize Electron fields
        job.live2d_ready = false
        if (job.phase === 'needs_review' || job.resultKind === 'decomposition') {
          job.status = 'needs_review'
          job.message =
            job.message ||
            '分层完成，请审阅 PSD/图层（尚未 Live2D）。可用 Photoshop/Photopea 打开 exports。'
        } else if (job.resultKind === 'dry-run') {
          job.status = 'queued'
          job.phase = job.phase || 'preprocessing'
          job.message =
            job.message || 'Dry-run 目录已就绪。可再点「AI 分层」跑真实 NF4（需 GPU）。'
        }
        job.error = null
      } else {
        job.status = 'failed'
        job.phase = 'failed'
        job.error = stderrBuf.trim() || `分层进程退出码 ${code}`
        job.message = 'AI 分层失败（见任务目录 logs/pipeline.log）'
        job.live2d_ready = false
      }
      updateJob(userData, job)
    } catch (error) {
      try {
        job = readJson(jobPath)
        job.status = 'failed'
        job.phase = 'failed'
        job.error = String(error.message || error)
        job.message = '分层结束后无法更新任务'
        updateJob(userData, job)
      } catch {
        /* ignore */
      }
    }
  })

  return { job, started: true, backend, python }
}

function isJobDecomposing(jobId) {
  return activeDecompose.has(String(jobId || ''))
}

module.exports = {
  charactersRoot,
  jobsRoot,
  ensureRoots,
  importCharacterPack,
  listCustomCharacters,
  removeCustomCharacter,
  resolveCharacterFile,
  listJobs,
  removeJob,
  createJobFromImage,
  createJobFromKkCard,
  createPlaceholderFromJob,
  runJobPipeline,
  attachPackToJob,
  startJobDecompose,
  isJobDecomposing,
  pathToFileURL,
}
