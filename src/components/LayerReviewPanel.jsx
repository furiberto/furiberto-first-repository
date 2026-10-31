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

export default function LayerReviewPanel({ uiLocale, jobId, onClose, onMarkedRigging }) {
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [soloId, setSoloId] = useState(null)
  const [compareSource, setCompareSource] = useState(false)
  const [localLayers, setLocalLayers] = useState([])
  const [zoom, setZoom] = useState(1)
  const canvasRef = useRef(null)
  const imageCache = useRef(new Map())

  const partLayers = useMemo(
    () => (localLayers || []).filter((L) => L.kind === 'part'),
    [localLayers],
  )

  async function load(revisionId) {
    setBusy(true)
    setError('')
    try {
      const data = await window.petDesktop.getJobLayerReview(jobId, { revisionId })
      setPayload(data)
      setLocalLayers(
        (data.layers || []).map((L) => ({
          ...L,
          // local UI toggles only until save-revision lands
          _visible: L.visible !== false,
        })),
      )
      setSoloId(null)
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

  function toggleVisible(id) {
    setSoloId(null)
    setLocalLayers((prev) =>
      prev.map((L) => (L.id === id ? { ...L, _visible: !L._visible } : L)),
    )
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

  async function handleRevealPsd() {
    try {
      await window.petDesktop.revealJobPsd(jobId)
    } catch (err) {
      setError(String(err?.message || err))
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
          </p>
        </div>
        <button type="button" className="text-btn" disabled={busy} onClick={onClose}>
          {t(uiLocale, 'layerReviewClose')}
        </button>
      </header>

      {error ? <p className="voice-msg">{error}</p> : null}
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
              disabled={busy}
              onChange={(e) => load(e.target.value)}
            >
              {(payload?.revisions || [{ id: 'original', label: 'AI 原始' }]).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label || r.id}
                </option>
              ))}
            </select>
          </div>
          <ul className="layer-list">
            {partLayers
              .slice()
              .sort((a, b) => b.order - a.order)
              .map((layer) => (
                <li key={layer.id} className={soloId === layer.id ? 'is-solo' : ''}>
                  <label className="layer-vis">
                    <input
                      type="checkbox"
                      checked={layer._visible !== false}
                      onChange={() => toggleVisible(layer.id)}
                    />
                  </label>
                  <button
                    type="button"
                    className="list-main"
                    onClick={() => setSoloId((id) => (id === layer.id ? null : layer.id))}
                  >
                    <strong>{layer.name}</strong>
                    <small>{layer.id}</small>
                  </button>
                </li>
              ))}
          </ul>
          <div className="chip-row tight">
            {payload?.psd?.available ? (
              <button type="button" className="text-btn" disabled={busy} onClick={handleRevealPsd}>
                {t(uiLocale, 'layerReviewOpenPsd')}
              </button>
            ) : null}
            <button
              type="button"
              className="text-btn primary-text"
              disabled={busy || !payload?.ready}
              onClick={handleMarkRigging}
            >
              {t(uiLocale, 'layerReviewMarkRigging')}
            </button>
          </div>
          <p className="hint tight">{t(uiLocale, 'layerReviewEditLater')}</p>
        </div>
      </div>
    </section>
  )
}
