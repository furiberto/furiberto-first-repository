import { useEffect, useState } from 'react'
import { isLive2D } from '../characters'
import { LOCALES, pickLocalized, t } from '../i18n'
import CharacterStudioPanel from './CharacterStudioPanel'
import VoiceBankPanel from './VoiceBankPanel'

const TABS = [
  { id: 'general', labelKey: 'tabGeneral' },
  { id: 'studio', labelKey: 'tabStudio' },
  { id: 'voice', labelKey: 'tabVoice' },
]

export default function SettingsPanel({
  standalone = false,
  uiLocale,
  voiceLocale,
  characters,
  character,
  expressionId,
  autoAnimate,
  petScale,
  cosyvoiceUrl,
  live2dPipelineUrl,
  onClose,
  onUiLocaleChange,
  onVoiceLocaleChange,
  onCharacterChange,
  onExpressionChange,
  onAutoAnimateChange,
  onPetScaleChange,
  onCosyvoiceUrlChange,
  onLive2dPipelineUrlChange,
  onCharactersChanged,
  onQuit,
}) {
  const live2d = isLive2D(character)
  const [openAtLogin, setOpenAtLogin] = useState(false)
  const [tab, setTab] = useState('general')

  useEffect(() => {
    let alive = true
    window.petDesktop?.getOpenAtLogin?.().then((value) => {
      if (alive) setOpenAtLogin(Boolean(value))
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleOpenAtLogin(next) {
    const value = await window.petDesktop?.setOpenAtLogin?.(next)
    setOpenAtLogin(Boolean(value ?? next))
  }

  const panel = (
    <section
      className={`settings-panel ${standalone ? 'is-standalone' : ''}`}
      onClick={standalone ? undefined : (event) => event.stopPropagation()}
      role="dialog"
      aria-label={t(uiLocale, 'settings')}
    >
      <header className="settings-header">
        <h2>{t(uiLocale, 'settings')}</h2>
        <button type="button" className="text-btn" onClick={onClose}>
          {t(uiLocale, 'closeSettings')}
        </button>
      </header>

      <nav className="settings-tabs" aria-label={t(uiLocale, 'settings')}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-tab ${tab === item.id ? 'is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {t(uiLocale, item.labelKey)}
          </button>
        ))}
      </nav>

      <div className="settings-body">
        {tab === 'general' ? (
          <>
            <fieldset className="field compact">
              <legend>{t(uiLocale, 'character')}</legend>
              <div className="char-chip-row">
                {characters.map((item) => {
                  const active = item.id === character.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`char-chip ${active ? 'is-active' : ''}`}
                      onClick={() => onCharacterChange(item.id)}
                    >
                      <span>{pickLocalized(item.names, uiLocale)}</span>
                      <em>{isLive2D(item) ? 'L2D' : 'IMG'}</em>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <fieldset className="field compact">
              <legend>{live2d ? t(uiLocale, 'motionExpression') : t(uiLocale, 'expression')}</legend>
              <div className="chip-row">
                {character.expressions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`chip ${item.id === expressionId ? 'is-active' : ''}`}
                    onClick={() => onExpressionChange(item.id)}
                  >
                    {pickLocalized(item.names, uiLocale)}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="lang-row">
              <label className="field compact">
                <span>{t(uiLocale, 'uiLanguage')}</span>
                <select value={uiLocale} onChange={(event) => onUiLocaleChange(event.target.value)}>
                  {LOCALES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field compact">
                <span>{t(uiLocale, 'voiceLanguage')}</span>
                <select
                  value={voiceLocale}
                  onChange={(event) => onVoiceLocaleChange(event.target.value)}
                >
                  {LOCALES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="toggle-field">
              <input
                type="checkbox"
                checked={Boolean(autoAnimate)}
                onChange={(event) => onAutoAnimateChange(event.target.checked)}
              />
              <span>
                <strong>{t(uiLocale, 'autoAnimate')}</strong>
                <small>
                  {live2d ? t(uiLocale, 'autoAnimateHintLive2d') : t(uiLocale, 'autoAnimateHint')}
                </small>
              </span>
            </label>

            <label className="toggle-field">
              <input
                type="checkbox"
                checked={openAtLogin}
                onChange={(event) => handleOpenAtLogin(event.target.checked)}
              />
              <span>
                <strong>{t(uiLocale, 'openAtLogin')}</strong>
                <small>{t(uiLocale, 'openAtLoginHint')}</small>
              </span>
            </label>

            <label className="field compact">
              <span>
                {t(uiLocale, 'petScale')} · {Math.round((petScale || 1) * 100)}%
              </span>
                <input
                  type="range"
                  min="50"
                  max="160"
                  step="1"
                  value={Math.round((petScale || 1) * 100)}
                  onChange={(event) => onPetScaleChange(Number(event.target.value) / 100)}
                />
              <small className="field-note">{t(uiLocale, 'petScaleHint')}</small>
            </label>

            <p className="hint tight">{t(uiLocale, 'clickHint')}</p>

            <button type="button" className="danger-btn" onClick={onQuit}>
              {t(uiLocale, 'quit')}
            </button>
          </>
        ) : null}

        {tab === 'studio' ? (
          <CharacterStudioPanel
            uiLocale={uiLocale}
            characters={characters}
            characterId={character.id}
            live2dPipelineUrl={live2dPipelineUrl}
            onPipelineUrlChange={onLive2dPipelineUrlChange}
            onCharacterChange={onCharacterChange}
            onCharactersChanged={onCharactersChanged}
          />
        ) : null}

        {tab === 'voice' ? (
          <VoiceBankPanel
            uiLocale={uiLocale}
            characterId={character.id}
            cosyvoiceUrl={cosyvoiceUrl}
            onCosyvoiceUrlChange={onCosyvoiceUrlChange}
          />
        ) : null}
      </div>
    </section>
  )

  if (standalone) return panel

  return (
    <div className="settings-backdrop" onClick={onClose}>
      {panel}
    </div>
  )
}
