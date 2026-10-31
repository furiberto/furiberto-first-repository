import { useEffect, useMemo, useRef, useState } from 'react'
import { loadCharacters, findExpression } from './characters'
import { clampPetScale, loadSettings, saveSettings } from './storage'
import SettingsPanel from './components/SettingsPanel'

export default function SettingsApp() {
  const [characters, setCharacters] = useState([])
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(loadSettings)
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
    const unsub = window.petDesktop?.onSettingsSync?.((patch) => {
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
      unsub?.()
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  function updateSettings(patch) {
    setSettings((prev) => ({ ...prev, ...patch }))
  }

  const character = useMemo(
    () => characters.find((item) => item.id === settings.characterId) || characters[0] || null,
    [characters, settings.characterId],
  )

  if (loading || !character) {
    return <div className="settings-window boot-lite">加载设置…</div>
  }

  const uiLocale = settings.uiLocale || 'zh-CN'
  const petScale = clampPetScale(settings.petScale ?? 1)

  return (
    <div className="settings-window">
      <SettingsPanel
        standalone
        uiLocale={uiLocale}
        voiceLocale={settings.voiceLocale}
        characters={characters}
        character={character}
        expressionId={settings.expressionId}
        autoAnimate={settings.autoAnimate}
        petScale={petScale}
        cosyvoiceUrl={settings.cosyvoiceUrl || 'http://127.0.0.1:50000'}
        live2dPipelineUrl={settings.live2dPipelineUrl || 'http://127.0.0.1:51000'}
        onClose={() => window.close()}
        onUiLocaleChange={(next) => updateSettings({ uiLocale: next })}
        onVoiceLocaleChange={(next) => updateSettings({ voiceLocale: next })}
        onCharacterChange={(characterId) => {
          const next = characters.find((item) => item.id === characterId)
          if (!next) return
          updateSettings({
            characterId,
            expressionId: next.defaultExpression || next.expressions[0]?.id,
          })
        }}
        onExpressionChange={(expressionId) => updateSettings({ expressionId })}
        onAutoAnimateChange={(autoAnimate) => updateSettings({ autoAnimate })}
        onPetScaleChange={(next) => updateSettings({ petScale: clampPetScale(next) })}
        onCosyvoiceUrlChange={(cosyvoiceUrl) => updateSettings({ cosyvoiceUrl })}
        onLive2dPipelineUrlChange={(live2dPipelineUrl) => updateSettings({ live2dPipelineUrl })}
        onCharactersChanged={async (selectId) => {
          await reloadCharacters(selectId)
        }}
        onQuit={() => window.petDesktop?.quit?.()}
      />
    </div>
  )
}
