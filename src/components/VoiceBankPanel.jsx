import { useEffect, useState } from 'react'
import { t } from '../i18n'

function playBase64Wav(base64) {
  const audio = new Audio(`data:audio/wav;base64,${base64}`)
  return audio.play()
}

export default function VoiceBankPanel({
  uiLocale,
  characterId,
  cosyvoiceUrl,
  onCosyvoiceUrlChange,
}) {
  const [bank, setBank] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [previewText, setPreviewText] = useState('你好，我是你的桌面伙伴。')
  const [showAdvanced, setShowAdvanced] = useState(false)

  async function refresh() {
    const next = await window.petDesktop?.listVoiceBank?.(characterId)
    setBank(next || null)
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error.message || error)))
  }, [characterId])

  async function run(task) {
    setBusy(true)
    setMessage('')
    try {
      await task()
      await refresh()
    } catch (error) {
      setMessage(String(error.message || error))
    } finally {
      setBusy(false)
    }
  }

  async function handlePickUpload() {
    await run(async () => {
      const picked = await window.petDesktop?.pickVoiceFiles?.()
      if (!picked?.length) return
      const result = await window.petDesktop.addVoiceSamples(characterId, picked)
      const rebuilt = result?.rebuilt
      setMessage(
        rebuilt?.ok
          ? t(uiLocale, 'voiceRebuildOk')
              .replace('{n}', String(result.bank.sampleCount))
              .replace('{sec}', String(rebuilt.promptSeconds))
          : t(uiLocale, 'voiceRebuildNeedMore'),
      )
    })
  }

  async function handleRemove(sampleId) {
    await run(async () => {
      await window.petDesktop.removeVoiceSample(characterId, sampleId)
      setMessage(t(uiLocale, 'voiceSampleRemoved'))
    })
  }

  async function handleRebuild() {
    await run(async () => {
      const rebuilt = await window.petDesktop.rebuildVoicePrompt(characterId)
      setMessage(
        rebuilt?.ok
          ? t(uiLocale, 'voiceRebuildOk')
              .replace('{n}', String(rebuilt.usedSampleCount))
              .replace('{sec}', String(rebuilt.promptSeconds))
          : t(uiLocale, 'voiceRebuildNeedMore'),
      )
    })
  }

  async function handlePreview() {
    await run(async () => {
      const base64 = await window.petDesktop.synthesizeVoice({
        characterId,
        text: previewText,
        cosyvoiceUrl,
      })
      await playBase64Wav(base64)
      setMessage(t(uiLocale, 'voicePreviewPlaying'))
    })
  }

  return (
    <section className="voice-bank bare">
      <p className="hint tight">{t(uiLocale, 'voiceBankHintShort')}</p>

      <div className="voice-stats pills">
        <span>
          {t(uiLocale, 'voiceSampleCount')} {bank?.sampleCount ?? 0}
        </span>
        <span>
          {t(uiLocale, 'voiceTotalSeconds')} {bank?.totalSeconds ?? 0}s
        </span>
        <span>
          {t(uiLocale, 'voicePromptSeconds')}{' '}
          {bank?.promptReady ? `${bank.promptSeconds}s` : '—'}
        </span>
      </div>

      <div className="action-grid">
        <button type="button" className="action-btn primary" disabled={busy} onClick={handlePickUpload}>
          {t(uiLocale, 'voiceUpload')}
        </button>
        <button type="button" className="action-btn" disabled={busy} onClick={handleRebuild}>
          {t(uiLocale, 'voiceRebuild')}
        </button>
        <button
          type="button"
          className="action-btn"
          disabled={busy || !bank?.promptReady}
          onClick={handlePreview}
        >
          {t(uiLocale, 'voicePreview')}
        </button>
      </div>

      <label className="field compact">
        <span>{t(uiLocale, 'voicePreviewText')}</span>
        <input
          type="text"
          value={previewText}
          onChange={(event) => setPreviewText(event.target.value)}
        />
      </label>

      <button type="button" className="link-btn" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? t(uiLocale, 'studioHideAdvanced') : t(uiLocale, 'studioShowAdvanced')}
      </button>

      {showAdvanced ? (
        <label className="field compact">
          <span>{t(uiLocale, 'cosyvoiceUrl')}</span>
          <input
            type="text"
            value={cosyvoiceUrl}
            onChange={(event) => onCosyvoiceUrlChange(event.target.value)}
            placeholder="http://127.0.0.1:50000"
          />
        </label>
      ) : null}

      {message ? <p className="voice-msg">{message}</p> : null}

      <ul className="compact-list">
        {(bank?.samples || []).map((sample) => (
          <li key={sample.id}>
            <div className="job-meta">
              <strong>{sample.name}</strong>
              <small>
                {sample.seconds}s · {sample.addedAt?.slice(0, 19)?.replace('T', ' ')}
              </small>
            </div>
            <button
              type="button"
              className="icon-btn"
              disabled={busy}
              title={t(uiLocale, 'voiceRemove')}
              onClick={() => handleRemove(sample.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
