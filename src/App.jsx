import { useEffect, useMemo, useRef, useState } from 'react'
import { loadCharacters, findExpression, isLive2D } from './characters'
import { clampPetScale, loadSettings, saveSettings } from './storage'
import { pickLocalized, t } from './i18n'
import PetStage from './components/PetStage'

const AUTO_CYCLE_MS = 4500
const REACT_MS = 520
const BUBBLE_VISIBLE_MS = 3800

export default function App() {
  const [characters, setCharacters] = useState([])
  const [loading, setLoading] = useState(true)
  const [bubble, setBubble] = useState('')
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [reacting, setReacting] = useState(false)
  const [settings, setSettings] = useState(loadSettings)
  const reactTimerRef = useRef(0)
  const bubbleTimerRef = useRef(0)
  const pauseAutoUntilRef = useRef(0)
  const resizeTimerRef = useRef(0)
  const syncingRef = useRef(false)

  async function reloadCharacters(selectId) {
    const list = await loadCharacters()
    setCharacters(list)
    setSettings((prev) => {
      const preferredId = selectId || prev.characterId
      const nextChar = list.find((item) => item.id === preferredId) || list[0]
      if (!nextChar) return prev
      const expression = findExpression(nextChar, prev.expressionId)
      return {
        ...prev,
        characterId: nextChar.id,
        expressionId: expression?.id || nextChar.defaultExpression,
      }
    })
    return list
  }

  useEffect(() => {
    let alive = true
    reloadCharacters()
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    saveSettings(settings)
    if (syncingRef.current) {
      syncingRef.current = false
      return
    }
    window.petDesktop?.notifySettingsChanged?.(settings)
  }, [settings])

  useEffect(() => {
    const unsubOpen = window.petDesktop?.onOpenSettings?.(() => {
      window.petDesktop?.openSettingsWindow?.()
    })
    const unsubSync = window.petDesktop?.onSettingsSync?.((patch) => {
      syncingRef.current = true
      if (!patch || typeof patch !== 'object') {
        setSettings(loadSettings())
        return
      }
      setSettings((prev) => ({
        ...prev,
        ...patch,
        petScale: clampPetScale(patch.petScale ?? prev.petScale),
      }))
    })
    function onStorage(event) {
      if (event.key && event.key.includes('desktop-pet-settings')) {
        syncingRef.current = true
        setSettings(loadSettings())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      unsubOpen?.()
      unsubSync?.()
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const character = useMemo(
    () => characters.find((item) => item.id === settings.characterId) || characters[0] || null,
    [characters, settings.characterId],
  )

  const expression = useMemo(
    () => findExpression(character, settings.expressionId),
    [character, settings.expressionId],
  )

  const petScale = clampPetScale(settings.petScale ?? 1)

  useEffect(() => {
    if (!character) return undefined
    const baseW = isLive2D(character) ? 420 : 320
    const baseH = isLive2D(character) ? 640 : 420
    const bubblePad = 72
    // 等 CSS 缩放过渡接近完成后再改窗口，避免缩放过程中反复重排导致闪烁
    window.clearTimeout(resizeTimerRef.current)
    resizeTimerRef.current = window.setTimeout(() => {
      window.petDesktop?.resize?.({
        width: Math.max(260, Math.round(baseW * petScale)),
        height: Math.max(320, Math.round(baseH * petScale + bubblePad)),
        animate: true,
      })
    }, 220)
    return () => window.clearTimeout(resizeTimerRef.current)
  }, [character, petScale])

  useEffect(() => {
    if (!character || !expression) return
    const line = pickLocalized(character.lines?.[expression.id], settings.voiceLocale)
    window.clearTimeout(bubbleTimerRef.current)
    if (!line) {
      setBubble('')
      setBubbleVisible(false)
      return undefined
    }
    setBubble(line)
    setBubbleVisible(true)
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubbleVisible(false)
    }, BUBBLE_VISIBLE_MS)
    return () => window.clearTimeout(bubbleTimerRef.current)
  }, [character, expression, settings.voiceLocale])

  useEffect(() => {
    return () => {
      window.clearTimeout(reactTimerRef.current)
      window.clearTimeout(bubbleTimerRef.current)
      window.clearTimeout(resizeTimerRef.current)
    }
  }, [])

  function updateSettings(patch) {
    setSettings((prev) => ({ ...prev, ...patch }))
  }

  function triggerReact() {
    setReacting(true)
    window.clearTimeout(reactTimerRef.current)
    reactTimerRef.current = window.setTimeout(() => setReacting(false), REACT_MS)
  }

  function setExpression(expressionId, { fromUser = false } = {}) {
    if (!expressionId || expressionId === settings.expressionId) return
    if (fromUser) {
      pauseAutoUntilRef.current = Date.now() + AUTO_CYCLE_MS
    }
    updateSettings({ expressionId })
    triggerReact()
  }

  function handlePetClick() {
    if (!character || !expression) return
    const ids = character.expressions.map((item) => item.id)
    const index = ids.indexOf(expression.id)
    const nextId = ids[(index + 1) % ids.length]
    setExpression(nextId, { fromUser: true })
  }

  useEffect(() => {
    if (!settings.autoAnimate || !character || character.expressions.length < 2) {
      return undefined
    }

    const timer = window.setInterval(() => {
      if (Date.now() < pauseAutoUntilRef.current) return
      setSettings((prev) => {
        const current = characters.find((item) => item.id === prev.characterId)
        if (!current || current.expressions.length < 2) return prev
        const ids = current.expressions.map((item) => item.id)
        const index = ids.indexOf(prev.expressionId)
        const nextId = ids[(index + 1) % ids.length]
        return { ...prev, expressionId: nextId }
      })
      triggerReact()
    }, AUTO_CYCLE_MS)

    return () => window.clearInterval(timer)
  }, [settings.autoAnimate, character, characters])

  const uiLocale = settings.uiLocale || 'zh-CN'

  if (loading) {
    return <div className="boot">{t(uiLocale, 'loading')}</div>
  }

  if (!character || !expression) {
    return <div className="boot">{t(uiLocale, 'empty')}</div>
  }

  return (
    <div className="app-shell">
      <PetStage
        character={character}
        expression={expression}
        uiLocale={uiLocale}
        bubble={bubble}
        bubbleVisible={bubbleVisible}
        reacting={reacting}
        petScale={petScale}
        onPetClick={handlePetClick}
        onOpenSettings={() => window.petDesktop?.openSettingsWindow?.()}
        onPetScaleChange={(next) => updateSettings({ petScale: clampPetScale(next) })}
      />
    </div>
  )
}
