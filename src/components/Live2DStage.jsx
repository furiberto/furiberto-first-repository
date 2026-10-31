import { useEffect, useRef, useState } from 'react'
import * as PIXI from 'pixi.js'
import { install } from '@pixi/unsafe-eval'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { t } from '../i18n'

install(PIXI)
window.PIXI = PIXI

const VIEW_W = 400
const VIEW_H = 600

async function playState(model, expression) {
  if (!model || !expression) return

  try {
    if (expression.expression) {
      await model.expression(expression.expression)
    }
  } catch {
    // ignore missing expression
  }

  try {
    if (expression.motion) {
      const index =
        typeof expression.motionIndex === 'number' ? expression.motionIndex : undefined
      await model.motion(expression.motion, index)
    }
  } catch {
    // ignore missing motion
  }
}

function fitModelToView(model, width, height, fit = 0.92) {
  model.scale.set(1)
  model.update?.(0)
  const bounds = model.getLocalBounds()
  const modelW = Math.max(bounds.width || model.width || 1, 1)
  const modelH = Math.max(bounds.height || model.height || 1, 1)
  const next = Math.min((width * fit) / modelW, (height * fit) / modelH)
  model.scale.set(next)
  model.anchor.set(0.5, 1)
  model.x = width / 2
  model.y = height - 4
}

export default function Live2DStage({
  character,
  expression,
  locale,
  hideStatus = false,
  onReady,
  onFail,
}) {
  const hostRef = useRef(null)
  const appRef = useRef(null)
  const modelRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const fit = character.fit ?? 0.92

  useEffect(() => {
    let disposed = false
    const host = hostRef.current
    if (!host) return undefined

    async function boot() {
      setStatus('loading')
      setError('')

      if (!window.Live2DCubismCore) {
        setStatus('error')
        setError(t(locale, 'live2dCoreMissing'))
        onFail?.(t(locale, 'live2dCoreMissing'))
        return
      }

      const app = new PIXI.Application({
        width: VIEW_W,
        height: VIEW_H,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      appRef.current = app
      host.innerHTML = ''
      host.appendChild(app.view)

      try {
        const model = await Live2DModel.from(character.model, {
          autoInteract: true,
        })
        if (disposed) {
          model.destroy()
          return
        }

        app.stage.addChild(model)
        fitModelToView(model, VIEW_W, VIEW_H, fit)
        modelRef.current = model
        await playState(model, expression)
        setStatus('ready')
        onReady?.(model)
      } catch (err) {
        const message = err?.message || String(err)
        setStatus('error')
        setError(message)
        onFail?.(message)
      }
    }

    boot()

    return () => {
      disposed = true
      modelRef.current = null
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true, baseTexture: true })
        appRef.current = null
      }
      if (host) host.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id, character.model])

  useEffect(() => {
    if (status !== 'ready') return
    playState(modelRef.current, expression)
  }, [expression, status])

  return (
    <div className="live2d-wrap" style={{ width: `${VIEW_W}px`, height: `${VIEW_H}px` }}>
      <div ref={hostRef} className="live2d-host" />
      {!hideStatus && status === 'loading' ? (
        <div className="live2d-status">{t(locale, 'live2dLoading')}</div>
      ) : null}
      {!hideStatus && status === 'error' ? (
        <div className="live2d-status is-error">
          <p>{t(locale, 'live2dFailed')}</p>
          <small>{error}</small>
        </div>
      ) : null}
    </div>
  )
}
