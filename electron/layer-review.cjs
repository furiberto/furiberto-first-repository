/**
 * Phase 2: layer review payloads for jobs.
 * Frontend uses petjob:// URLs only — never raw filesystem paths.
 */
const fs = require('fs')
const path = require('path')

function jobsRoot(userData) {
  return path.join(userData, 'live2d-jobs')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function jobDir(userData, jobId) {
  const id = String(jobId || '').trim()
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error('任务 ID 无效')
  }
  return path.join(jobsRoot(userData), id)
}

function resolveJobFile(userData, jobId, relativePath) {
  const root = jobDir(userData, jobId)
  const cleaned = String(relativePath || '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
  if (!cleaned || cleaned.includes('..')) throw new Error('非法路径')
  const full = path.normalize(path.join(root, cleaned))
  if (!full.startsWith(path.normalize(root + path.sep)) && full !== path.normalize(root)) {
    throw new Error('非法路径')
  }
  return full
}

function petjobUrl(jobId, rel) {
  const cleaned = String(rel || '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
  return `petjob://${jobId}/${cleaned}`
}

function listRevisions(dir) {
  const revRoot = path.join(dir, 'revisions')
  const list = [{ id: 'original', label: 'AI 原始', pathHint: 'decomposition' }]
  if (!fs.existsSync(revRoot)) return list
  for (const name of fs.readdirSync(revRoot).sort()) {
    const sub = path.join(revRoot, name)
    if (!fs.statSync(sub).isDirectory()) continue
    if (!/^revision-\d+/i.test(name) && name !== 'working') continue
    let label = name
    const metaPath = path.join(sub, 'revision.json')
    try {
      if (fs.existsSync(metaPath)) {
        const meta = readJson(metaPath)
        if (meta.label) label = meta.label
      }
    } catch {
      /* ignore */
    }
    list.push({ id: name, label, pathHint: `revisions/${name}` })
  }
  return list
}

function loadManifestForRevision(dir, revisionId) {
  if (!revisionId || revisionId === 'original') {
    const p = path.join(dir, 'decomposition', 'layer-manifest.json')
    if (!fs.existsSync(p)) return null
    return { manifest: readJson(p), baseRel: 'decomposition' }
  }
  const base = path.join(dir, 'revisions', revisionId)
  const p = path.join(base, 'layer-manifest.json')
  if (!fs.existsSync(p)) {
    // fall back to original manifest with revision layer files if present
    const orig = path.join(dir, 'decomposition', 'layer-manifest.json')
    if (!fs.existsSync(orig)) return null
    return { manifest: readJson(orig), baseRel: `revisions/${revisionId}` }
  }
  return { manifest: readJson(p), baseRel: `revisions/${revisionId}` }
}

function findSourceRel(dir, job) {
  const candidates = [
    path.join('source', 'original.png'),
    path.join('source', 'original.jpg'),
    path.join('source', 'original.webp'),
  ]
  for (const rel of candidates) {
    if (fs.existsSync(path.join(dir, rel))) return rel.replace(/\\/g, '/')
  }
  if (job.sourceName && fs.existsSync(path.join(dir, job.sourceName))) {
    return job.sourceName.replace(/\\/g, '/')
  }
  return null
}

/**
 * Build review DTO. layer.url is petjob:// — no absolute paths.
 */
function getJobLayerReview(userData, jobId, options = {}) {
  const dir = jobDir(userData, jobId)
  const jobPath = path.join(dir, 'job.json')
  if (!fs.existsSync(jobPath)) throw new Error('任务不存在')
  const job = readJson(jobPath)
  const revisionId = options.revisionId || job.activeRevision || 'original'
  const revisions = listRevisions(dir)
  const loaded = loadManifestForRevision(dir, revisionId)
  if (!loaded) {
    return {
      jobId: job.id,
      status: job.status,
      phase: job.phase || null,
      resultKind: job.resultKind || null,
      live2d_ready: false,
      revisionId,
      revisions,
      source: null,
      frame: { width: 1024, height: 1024 },
      layers: [],
      psd: null,
      message: '尚无 layer-manifest.json。请先完成 AI 分层。',
      ready: false,
    }
  }

  const { manifest, baseRel } = loaded
  const sourceRel = findSourceRel(dir, job)

  function resolveAssetRel(fileRel) {
    const file = String(fileRel || '').replace(/\\/g, '/')
    if (!file) return null
    const candidates = [`${baseRel}/${file}`, `decomposition/${file}`]
    for (const rel of candidates) {
      if (fs.existsSync(path.join(dir, rel))) return rel
    }
    return candidates[candidates.length - 1]
  }

  const layers = (manifest.layers || []).map((layer, index) => {
    const file = String(layer.file || '').replace(/\\/g, '/')
    const rel = resolveAssetRel(file)
    const depthRel = layer.depthFile ? resolveAssetRel(String(layer.depthFile).replace(/\\/g, '/')) : null
    return {
      id: layer.id || `layer-${index}`,
      name: layer.name || layer.id || `layer-${index}`,
      order: typeof layer.order === 'number' ? layer.order : index,
      visible: layer.visible !== false,
      opacity: typeof layer.opacity === 'number' ? layer.opacity : 1,
      kind: layer.kind || 'part',
      bbox: layer.bbox || null,
      url: petjobUrl(job.id, rel),
      depthUrl: depthRel ? petjobUrl(job.id, depthRel) : null,
    }
  })

  layers.sort((a, b) => a.order - b.order)

  let psd = null
  const psdRel = manifest.psd
    ? String(manifest.psd).replace(/\\/g, '/')
    : null
  if (psdRel) {
    const abs = path.join(dir, psdRel)
    if (fs.existsSync(abs)) {
      psd = {
        relative: psdRel,
        // reveal via IPC later; do not expose absolute path to renderer
        available: true,
      }
    }
  }

  return {
    jobId: job.id,
    displayName: job.displayName || null,
    status: job.status,
    phase: job.phase || null,
    resultKind: job.resultKind || null,
    live2d_ready: false,
    revisionId,
    revisions,
    source: sourceRel
      ? { url: petjobUrl(job.id, sourceRel), relative: sourceRel }
      : null,
    frame: manifest.frame || { width: 1024, height: 1024 },
    layers,
    psd,
    notes: manifest.notes || [],
    message: job.message || null,
    ready: layers.some((L) => L.kind === 'part'),
  }
}

function markAwaitingRigging(userData, jobId) {
  const dir = jobDir(userData, jobId)
  const jobPath = path.join(dir, 'job.json')
  if (!fs.existsSync(jobPath)) throw new Error('任务不存在')
  const job = readJson(jobPath)
  if (job.live2d_ready) {
    throw new Error('状态异常：分层审阅不应标记 live2d_ready')
  }
  job.status = 'awaiting_rigging'
  job.phase = 'awaiting_rigging'
  job.message =
    '图层已审阅。请用 Cubism Editor 打开导出的 PSD 完成人工绑定，再「关联 moc」导入真实模型包。'
  job.live2d_ready = false
  job.updatedAt = new Date().toISOString()
  writeJson(jobPath, job)
  return job
}

/**
 * Seed a reviewable job from phase0 first-run (dev / phase2 bootstrap).
 */
function seedJobFromPhase0Folder(userData, phase0Dir, options = {}) {
  const src = path.resolve(phase0Dir)
  if (!fs.existsSync(src)) throw new Error(`找不到产物目录: ${src}`)

  const { randomUUID } = require('crypto')
  const id = options.id || `review-${randomUUID().slice(0, 8)}`
  const dir = path.join(jobsRoot(userData), id)
  if (fs.existsSync(dir)) throw new Error('任务目录已存在')
  fs.mkdirSync(dir, { recursive: true })

  // Prefer running Python normalizer for fidelity
  const pipelineRoot = path.join(__dirname, '..', 'services', 'image-pipeline')
  const pyCandidates = [
    process.env.IMAGE_PIPELINE_PYTHON,
    path.join(pipelineRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(pipelineRoot, '.venv', 'bin', 'python'),
  ].filter(Boolean)
  const python = pyCandidates.find((p) => fs.existsSync(p)) || 'python'
  const helper = path.join(pipelineRoot, 'adapter', 'ingest_phase0.py')

  const job = {
    id,
    status: 'needs_review',
    phase: 'needs_review',
    resultKind: 'decomposition',
    displayName: options.displayName || 'phase0-first-run',
    sourceName: 'source.png',
    sourceType: 'image',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    characterId: null,
    live2d_ready: false,
    message: '已从 phase0 产物导入，可打开图层审阅（非 Live2D）',
    error: null,
  }
  writeJson(path.join(dir, 'job.json'), job)

  const { spawnSync } = require('child_process')
  if (fs.existsSync(helper)) {
    const r = spawnSync(python, [helper, '--src', src, '--out', dir], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (r.status !== 0) {
      fs.rmSync(dir, { recursive: true, force: true })
      throw new Error(r.stderr || r.stdout || `ingest failed (${r.status})`)
    }
  } else {
    fs.rmSync(dir, { recursive: true, force: true })
    throw new Error('缺少 ingest_phase0.py')
  }

  return readJson(path.join(dir, 'job.json'))
}

function resolvePipelinePython() {
  const root = path.join(__dirname, '..', 'services', 'image-pipeline')
  const win = path.join(root, '.venv', 'Scripts', 'python.exe')
  const nix = path.join(root, '.venv', 'bin', 'python')
  if (process.env.IMAGE_PIPELINE_PYTHON && fs.existsSync(process.env.IMAGE_PIPELINE_PYTHON)) {
    return process.env.IMAGE_PIPELINE_PYTHON
  }
  if (fs.existsSync(win)) return win
  if (fs.existsSync(nix)) return nix
  return 'python'
}

function runAdapterScript(scriptName, args) {
  const { spawnSync } = require('child_process')
  const adapterDir = path.join(__dirname, '..', 'services', 'image-pipeline', 'adapter')
  const script = path.join(adapterDir, scriptName)
  if (!fs.existsSync(script)) throw new Error(`缺少脚本 ${scriptName}`)
  const python = resolvePipelinePython()
  const result = spawnSync(python, [script, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    cwd: adapterDir,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim().slice(0, 2000))
  }
  return result.stdout || ''
}

/**
 * Save a new immutable revision from UI operations. Never writes decomposition/.
 * operations: [{ op, layer_id, value|index|order }]
 */
function saveJobRevision(userData, jobId, options = {}) {
  const dir = jobDir(userData, jobId)
  const operations = Array.isArray(options.operations) ? options.operations : []
  if (!operations.length) throw new Error('没有可保存的修改')
  const parent = options.parentRevisionId || 'original'
  const label = options.label || ''
  const opsFile = path.join(dir, 'logs', `ops-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(opsFile), { recursive: true })
  writeJson(opsFile, operations)
  const out = runAdapterScript('revision_ops.py', [
    '--job',
    dir,
    '--parent',
    parent,
    '--ops-json',
    opsFile,
    ...(label ? ['--label', label] : []),
  ])
  let parsed = null
  try {
    parsed = JSON.parse(String(out).trim().split(/\r?\n/).filter(Boolean).pop())
  } catch {
    parsed = { raw: out }
  }
  return {
    ...(parsed || {}),
    live2d_ready: false,
    review: getJobLayerReview(userData, jobId, { revisionId: parsed?.revision_id || parent }),
  }
}

function exportJobPsd(userData, jobId, options = {}) {
  const dir = jobDir(userData, jobId)
  const revisionId = options.revisionId || 'original'
  const out = runAdapterScript('export_psd.py', [
    '--job',
    dir,
    '--revision',
    revisionId,
  ])
  let summary = null
  try {
    summary = JSON.parse(String(out).trim().split(/\r?\n/).filter(Boolean).pop())
  } catch {
    summary = { raw: out }
  }
  // Prefer newest export-*.psd for reveal
  const exportsDir = path.join(dir, 'exports')
  let relative = null
  if (summary?.psd) {
    relative = path.basename(String(summary.psd)).includes('/')
      ? String(summary.psd).replace(/\\/g, '/')
      : `exports/${path.basename(String(summary.psd))}`
  }
  const jobPath = path.join(dir, 'job.json')
  if (fs.existsSync(jobPath)) {
    const job = readJson(jobPath)
    job.lastExport = {
      revisionId,
      relative,
      at: new Date().toISOString(),
      verifyOk: summary?.verify_ok !== false,
    }
    job.live2d_ready = false
    job.updatedAt = new Date().toISOString()
    job.message = `已导出 PSD（修订 ${revisionId}）。请用 Cubism 打开验证；仍非 Live2D 就绪。`
    writeJson(jobPath, job)
  }
  return {
    ...summary,
    relative,
    live2d_ready: false,
    review: getJobLayerReview(userData, jobId, { revisionId }),
  }
}

function revealJobExport(userData, jobId, relativePath) {
  const jobPath = path.join(jobDir(userData, jobId), 'job.json')
  let rel = relativePath
  if (!rel && fs.existsSync(jobPath)) {
    const job = readJson(jobPath)
    rel = job.lastExport?.relative
  }
  if (!rel) throw new Error('没有可显示的导出文件')
  const file = resolveJobFile(userData, jobId, rel)
  if (!fs.existsSync(file)) throw new Error('导出文件不存在')
  const { shell } = require('electron')
  shell.showItemInFolder(file)
  return { ok: true, relative: rel }
}

module.exports = {
  getJobLayerReview,
  resolveJobFile,
  markAwaitingRigging,
  seedJobFromPhase0Folder,
  saveJobRevision,
  exportJobPsd,
  revealJobExport,
  petjobUrl,
}
