import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../i18n'

function Checkerboard({ size = 12 }) {
  return (
    <div
      className="layer-checker"
      style={{
        backgroundImage: `
          linear-gradient(45deg, #c8c8c8 25%, transparent 25%),
          linear-gradient(-45deg, #c8c8c8 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #c8c8c8 75%),
          linear-gradient(-45deg, transparent 75%, #c8c8c8 75%)`,
        backgroundSize: `${size * 2}px ${size * 2}px`,
        backgroundPosition: `0 0, 0 ${size}px, ${size}px -${size}px, -${size}px 0`,
        backgroundColor: '#eee',
      }}
    />
  )
}

function buildOperations(baseline, currentParts) {
  const ops = []
  const baseById = Object.fromEntries((baseline || []).map((L) => [L.id, L]))
  const orderIds = currentParts
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((L) => L.id)
  const baseOrder = (baseline || [])
    .filter((L) => L.kind === 'part')
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((L) => L.id)
  if (orderIds.join('|') !== baseOrder.join('|')) {
    ops.push({ op: 'reorder_all', order: orderIds })
  }
  for (const layer of currentParts) {
    const prev = baseById[layer.id]
    if (!prev) continue
    if ((layer.name || '') !== (prev.name || '')) {
      ops.push({ op: 'rename', layer_id: layer.id, value: layer.name })
    }
    if (Boolean(layer._visible !== false) !== Boolean(prev.visible !== false)) {
      ops.push({ op: 'set_visible', layer_id: layer.id, value: layer._visible !== false })
    }
    const opCur = typeof layer.opacity === 'number' ? layer.opacity : 1
    const opPrev = typeof prev.opacity === 'number' ? prev.opacity : 1
    if (Math.abs(opCur - opPrev) > 0.001) {
      ops.push({ op: 'set_opacity', layer_id: layer.id, value: opCur })
    }
  }
  return ops
}

export default function LayerReviewPanel({ uiLocale, jobId, onClose, onMarkedRigging }) {
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [soloId, setSoloId] = useState(null)
  const [compareSource, setCompareSource] = useState(false)
  const [localLayers, setLocalLayers] = useState([])
  const [baselineParts, setBaselineParts] = useState([])
  const [zoom, setZoom] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const canvasRef = useRef(null)
  const imageCache = useRef(new Map())

  const partLayers = useMemo(
    () => (localLayers || []).filter((L) => L.kind === 'part'),
    [localLayers],
  )
  const dirty = useMemo(
    () => buildOperations(baselineParts, partLayers).length > 0,
    [baselineParts, partLayers],
  )
  const selected = partLayers.find((L) => L.id === selectedId) || null

  async function load(revisionId) {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const data = await window.petDesktop.getJobLayerReview(jobId, { revisionId })
      setPayload(data)
      const mapped = (data.layers || []).map((L) => ({
        ...L,
        _visible: L.visible !== false,
      }))
      setLocalLayers(mapped)
      setBaselineParts(mapped.filter((L) => L.kind === 'part').map((L) => ({ ...L })))
      setSoloId(null)
      setSelectedId(null)
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!jobId) return undefined
    load('original')
    return undefined
  }, [jobId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !payload) return undefined
    const w = payload.frame?.width || 1024
    const h = payload.frame?.height || 1024
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    let cancelled = false

    async function loadImage(url) {
      if (!url) return null
      if (imageCache.current.has(url)) return imageCache.current.get(url)
      const img = new Image()
      img.decoding = 'async'
      const done = new Promise((resolve, reject) => {
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`load fail ${url}`))
      })
      img.src = url
      try {
        await done
        imageCache.current.set(url, img)
        return img
      } catch {
        return null
      }
    }

    async function paint() {
      ctx.clearRect(0, 0, w, h)
      const drawList = partLayers.slice().sort((a, b) => a.order - b.order)
      for (const layer of drawList) {
        const show = soloId ? layer.id === soloId : layer._visible !== false
        if (!show) continue
        const img = await loadImage(layer.url)
        if (cancelled || !img) continue
        ctx.globalAlpha = typeof layer.opacity === 'number' ? layer.opacity : 1
        ctx.drawImage(img, 0, 0, w, h)
      }
      ctx.globalAlpha = 1
      if (compareSource && payload.source?.url) {
        const src = await loadImage(payload.source.url)
        if (!cancelled && src) {
          ctx.globalAlpha = 0.45
          ctx.drawImage(src, 0, 0, w, h)
          ctx.globalAlpha = 1
        }
      }
    }

    paint()
    return () => {
      cancelled = true
    }
  }, [payload, partLayers, soloId, compareSource])

  function patchLayer(id, patch) {
    setSoloId(null)
    setLocalLayers((prev) => prev.map((L) => (L.id === id ? { ...L, ...patch } : L)))
  }

  function moveLayer(id, direction) {
    const parts = partLayers.slice().sort((a, b) => a.order - b.order)
    const idx = parts.findIndex((L) => L.id === id)
    if (idx < 0) return
    const swapWith = direction === 'up' ? idx + 1 : idx - 1
    if (swapWith < 0 || swapWith >= parts.length) return
    const a = parts[idx]
    const b = parts[swapWith]
    const orderA = a.order
    const orderB = b.order
    setLocalLayers((prev) =>
      prev.map((L) => {
        if (L.id === a.id) return { ...L, order: orderB }
        if (L.id === b.id) return { ...L, order: orderA }
        return L
      }),
    )
  }

  async function handleSaveRevision() {
    const operations = buildOperations(baselineParts, partLayers)
    if (!operations.length) {
      setInfo(t(uiLocale, 'layerReviewNoChanges'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await window.petDesktop.saveJobRevision(jobId, {
        parentRevisionId: payload?.revisionId || 'original',
        operations,
        label: t(uiLocale, 'layerReviewSavedLabel'),
      })
      const rid = result?.revision_id
      setInfo(t(uiLocale, 'layerReviewSaved').replace('{id}', rid || ''))
      await load(rid || payload?.revisionId || 'original')
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function handleExport() {
    setBusy(true)
    setError('')
    try {
      const result = await window.petDesktop.exportJobPsd(jobId, {
        revisionId: payload?.revisionId || 'original',
      })
      setInfo(
        t(uiLocale, 'layerReviewExported')
          .replace('{ok}', result?.verify_ok === false ? 'FAIL' : 'OK')
          .replace('{n}', String(result?.layers ?? '')),
      )
      if (result?.relative || result?.psd) {
        await window.petDesktop.revealJobExport(jobId, result.relative)
      }
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function handleMarkRigging() {
    setBusy(true)
    setError('')
    try {
      await window.petDesktop.markJobAwaitingRigging(jobId)
      onMarkedRigging?.()
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  if (!jobId) return null

  return (
    <section className="layer-review">
      <header className="layer-review-head">
        <div>
          <h3>{t(uiLocale, 'layerReviewTitle')}</h3>
          <p className="hint tight">
            {payload?.displayName || jobId.slice(0, 8)} · {t(uiLocale, 'layerReviewNotLive2d')}
            {dirty ? ` · ${t(uiLocale, 'layerReviewDirty')}` : ''}
          </p>
        </div>
        <button type="button" className="text-btn" disabled={busy} onClick={onClose}>
          {t(uiLocale, 'layerReviewClose')}
        </button>
      </header>

      {error ? <p className="voice-msg">{error}</p> : null}
      {info ? <p className="hint tight">{info}</p> : null}
      {!payload?.ready && !error ? (
        <p className="hint">{payload?.message || t(uiLocale, 'layerReviewEmpty')}</p>
      ) : null}

      <div className="layer-review-grid">
        <div className="layer-stage-wrap">
          <div className="layer-stage" style={{ transform: `scale(${zoom})` }}>
            <Checkerboard />
            <canvas ref={canvasRef} className="layer-canvas" />
          </div>
          <div className="chip-row tight">
            <button type="button" className="text-btn" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
              −
            </button>
            <span className="hint tight">{Math.round(zoom * 100)}%</span>
            <button type="button" className="text-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
              +
            </button>
            <button
              type="button"
              className={`text-btn ${compareSource ? 'primary-text' : ''}`}
              onClick={() => setCompareSource((v) => !v)}
            >
              {t(uiLocale, 'layerReviewCompare')}
            </button>
            <button type="button" className="text-btn" onClick={() => setSoloId(null)}>
              {t(uiLocale, 'layerReviewShowAll')}
            </button>
          </div>
        </div>

        <div className="layer-list-panel">
          <div className="field compact">
            <span>{t(uiLocale, 'layerReviewRevision')}</span>
            <select
              value={payload?.revisionId || 'original'}
              disabled={busy || dirty}
              onChange={(e) => load(e.target.value)}
            >
              {(payload?.revisions || [{ id: 'original', label: 'AI 原始' }]).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label || r.id}
                </option>
              ))}
            </select>
          </div>

          {selected ? (
            <div className="layer-edit-box">
              <label className="field compact">
                <span>{t(uiLocale, 'layerReviewRename')}</span>
                <input
                  type="text"
                  value={selected.name || ''}
                  disabled={busy}
                  onChange={(e) => patchLayer(selected.id, { name: e.target.value })}
                />
              </label>
              <label className="field compact">
                <span>{t(uiLocale, 'layerReviewOpacity')}</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={typeof selected.opacity === 'number' ? selected.opacity : 1}
                  disabled={busy}
                  onChange={(e) => patchLayer(selected.id, { opacity: Number(e.target.value) })}
                />
              </label>
              <div className="chip-row tight">
                <button type="button" className="text-btn" disabled={busy} onClick={() => moveLayer(selected.id, 'up')}>
                  {t(uiLocale, 'layerReviewMoveUp')}
                </button>
                <button type="button" className="text-btn" disabled={busy} onClick={() => moveLayer(selected.id, 'down')}>
                  {t(uiLocale, 'layerReviewMoveDown')}
                </button>
              </div>
            </div>
          ) : (
            <p className="hint tight">{t(uiLocale, 'layerReviewPickLayer')}</p>
          )}

          <ul className="layer-list">
            {partLayers
              .slice()
              .sort((a, b) => b.order - a.order)
              .map((layer) => (
                <li
                  key={layer.id}
                  className={`${soloId === layer.id ? 'is-solo' : ''} ${selectedId === layer.id ? 'is-selected' : ''}`}
                >
                  <label className="layer-vis">
                    <input
                      type="checkbox"
                      checked={layer._visible !== false}
                      onChange={() => patchLayer(layer.id, { _visible: !(layer._visible !== false) })}
                    />
                  </label>
                  <button
                    type="button"
                    className="list-main"
                    onClick={() => {
                      setSelectedId(layer.id)
                      setSoloId((id) => (id === layer.id ? null : layer.id))
                    }}
                  >
                    <strong>{layer.name}</strong>
                    <small>
                      {layer.id} · {Math.round((layer.opacity ?? 1) * 100)}%
                    </small>
                  </button>
                </li>
              ))}
          </ul>

          <div className="chip-row tight">
            <button type="button" className="text-btn primary-text" disabled={busy || !dirty} onClick={handleSaveRevision}>
              {t(uiLocale, 'layerReviewSaveRev')}
            </button>
            <button type="button" className="text-btn" disabled={busy || !payload?.ready || dirty} onClick={handleExport}>
              {t(uiLocale, 'layerReviewExportPsd')}
            </button>
            {payload?.psd?.available ? (
              <button
                type="button"
                className="text-btn"
                disabled={busy}
                onClick={() => window.petDesktop.revealJobPsd(jobId)}
              >
                {t(uiLocale, 'layerReviewOpenPsd')}
              </button>
            ) : null}
            <button
              type="button"
              className="text-btn"
              disabled={busy || !payload?.ready}
              onClick={handleMarkRigging}
            >
              {t(uiLocale, 'layerReviewMarkRigging')}
            </button>
          </div>
          <p className="hint tight">{t(uiLocale, 'layerReviewEditHint')}</p>
        </div>
      </div>
    </section>
  )
}
