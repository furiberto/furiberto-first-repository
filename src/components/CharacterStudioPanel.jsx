import { useEffect, useState } from 'react'
import { pickLocalized, t } from '../i18n'
import LayerReviewPanel from './LayerReviewPanel'

function statusLabel(uiLocale, status) {
  const key = {
    queued: 'studioStatusQueued',
    running: 'studioStatusRunning',
    done: 'studioStatusDone',
    failed: 'studioStatusFailed',
    needs_review: 'studioStatusNeedsReview',
    awaiting_rigging: 'studioStatusAwaitingRigging',
  }[status]
  return key ? t(uiLocale, key) : status
}

export default function CharacterStudioPanel({
  uiLocale,
  characters,
  characterId,
  live2dPipelineUrl,
  onPipelineUrlChange,
  onCharacterChange,
  onCharactersChanged,
}) {
  const [jobs, setJobs] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [reviewJobId, setReviewJobId] = useState(null)

  const customChars = (characters || []).filter((item) => item.origin === 'user')
  const recentJobs = jobs.slice(0, 5)
  const hasPipelineUrl = Boolean(String(live2dPipelineUrl || '').trim())

  async function refreshJobs() {
    const list = await window.petDesktop?.listLive2dJobs?.()
    setJobs(list || [])
  }

  useEffect(() => {
    refreshJobs().catch((error) => setMessage(String(error.message || error)))
  }, [])

  useEffect(() => {
    const decomposing = jobs.some(
      (job) => job.status === 'running' && (job.phase === 'decomposing' || job.resultKind === 'decomposition'),
    )
    if (!decomposing) return undefined
    const timer = setInterval(() => {
      refreshJobs().catch(() => {})
    }, 2500)
    return () => clearInterval(timer)
  }, [jobs])

  function cleanError(error) {
    return String(error?.message || error || '')
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '')
  }

  async function run(task) {
    setBusy(true)
    setMessage('')
    try {
      await task()
      await refreshJobs()
    } catch (error) {
      setMessage(cleanError(error))
    } finally {
      setBusy(false)
    }
  }

  async function applyQuickResult(result, emptyMsg) {
    if (!result) return
    if (result.character?.id) {
      await onCharactersChanged?.(result.character.id)
      const doneKey = result.mock ? 'studioJobDoneMock' : 'studioJobDone'
      setMessage(t(uiLocale, doneKey).replace('{id}', result.character.id))
      return
    }
    if (result.pipelineError || result.soft) {
      setMessage(result.pipelineError || result.job?.error || t(uiLocale, 'studioPipelineDown'))
      return
    }
    if (result.job) {
      const name = result.job.displayName || result.job.id.slice(0, 8)
      setMessage(
        result.ran === false
          ? t(uiLocale, 'studioJobNeedPipeline')
              .replace('{id}', result.job.id.slice(0, 8))
              .replace('{name}', name)
          : emptyMsg,
      )
    }
  }

  async function handleQuickImage() {
    await run(async () => {
      const result = await window.petDesktop.quickLive2dFromImage(live2dPipelineUrl)
      await applyQuickResult(
        result,
        t(uiLocale, 'studioJobCreated').replace('{id}', result?.job?.id?.slice(0, 8) || ''),
      )
    })
  }

  async function handleQuickKk() {
    await run(async () => {
      const result = await window.petDesktop.quickLive2dFromKk(live2dPipelineUrl)
      await applyQuickResult(
        result,
        t(uiLocale, 'studioJobCreated').replace('{id}', result?.job?.id?.slice(0, 8) || ''),
      )
    })
  }

  async function handleImportPack() {
    await run(async () => {
      const imported = await window.petDesktop.importCharacterPack()
      if (!imported) return
      await onCharactersChanged?.(imported.id)
      setMessage(t(uiLocale, 'studioImportOk').replace('{id}', imported.id))
    })
  }

  async function handleRunJob(jobId) {
    await run(async () => {
      const result = await window.petDesktop.runLive2dJob(jobId, live2dPipelineUrl)
      if (result?.character?.id) {
        await onCharactersChanged?.(result.character.id)
        const doneKey = result.mock ? 'studioJobDoneMock' : 'studioJobDone'
        setMessage(t(uiLocale, doneKey).replace('{id}', result.character.id))
        return
      }
      if (result?.soft || result?.pipelineError) {
        setMessage(result.pipelineError || result.job?.error || t(uiLocale, 'studioPipelineDown'))
      }
    })
  }

  async function handleAttachPack(jobId) {
    await run(async () => {
      const result = await window.petDesktop.attachPackToJob(jobId)
      if (!result?.character?.id) return
      await onCharactersChanged?.(result.character.id)
      setMessage(t(uiLocale, 'studioJobDone').replace('{id}', result.character.id))
    })
  }

  async function handlePlaceholder(jobId) {
    await run(async () => {
      const result = await window.petDesktop.createPlaceholderFromJob(jobId)
      if (!result?.character?.id) return
      await onCharactersChanged?.(result.character.id)
      setMessage(t(uiLocale, 'studioPlaceholderOk').replace('{id}', result.character.id))
    })
  }

  async function handleDecompose(jobId, backend) {
    await run(async () => {
      const result = await window.petDesktop.startJobDecompose(jobId, { backend })
      const started = result?.started
      setMessage(
        started
          ? t(uiLocale, backend === 'see-through-quantized' ? 'studioDecomposeStarted' : 'studioDecomposeDryRun')
          : t(uiLocale, 'studioDecomposeFail'),
      )
    })
  }

  async function handleRemove(id) {
    await run(async () => {
      await window.petDesktop.removeCustomCharacter(id)
      await onCharactersChanged?.()
      setMessage(t(uiLocale, 'studioRemoved'))
    })
  }

  async function handleRemoveJob(jobId) {
    await run(async () => {
      await window.petDesktop.removeLive2dJob(jobId)
      setMessage(t(uiLocale, 'studioJobRemoved'))
    })
  }

  async function handleSeedPhase0Review() {
    await run(async () => {
      const job = await window.petDesktop.seedPhase0ReviewJob()
      setMessage(t(uiLocale, 'studioSeedReviewOk').replace('{id}', job?.id?.slice(0, 8) || ''))
      if (job?.id) setReviewJobId(job.id)
    })
  }

  if (reviewJobId) {
    return (
      <LayerReviewPanel
        uiLocale={uiLocale}
        jobId={reviewJobId}
        onClose={() => setReviewJobId(null)}
        onMarkedRigging={async () => {
          await refreshJobs()
          setMessage(t(uiLocale, 'studioMarkedRigging'))
          setReviewJobId(null)
        }}
      />
    )
  }

  return (
    <section className="char-studio">
      <p className="hint tight">{t(uiLocale, 'studioHintShort')}</p>

      <div className="action-grid">
        <button type="button" className="action-btn primary" disabled={busy} onClick={handleQuickImage}>
          {t(uiLocale, 'studioQuickImage')}
        </button>
        <button type="button" className="action-btn primary" disabled={busy} onClick={handleQuickKk}>
          {t(uiLocale, 'studioQuickKk')}
        </button>
        <button type="button" className="action-btn" disabled={busy} onClick={handleImportPack}>
          {t(uiLocale, 'studioImportPack')}
        </button>
      </div>

      {message ? <p className={`voice-msg ${busy ? 'is-busy' : ''}`}>{message}</p> : null}

      <button
        type="button"
        className="link-btn"
        onClick={() => setShowAdvanced((value) => !value)}
      >
        {showAdvanced ? t(uiLocale, 'studioHideAdvanced') : t(uiLocale, 'studioShowAdvanced')}
      </button>

      {showAdvanced ? (
        <>
          <label className="field compact">
            <span>{t(uiLocale, 'studioPipelineUrl')}</span>
            <input
              type="text"
              value={live2dPipelineUrl}
              onChange={(event) => onPipelineUrlChange(event.target.value)}
              placeholder="http://127.0.0.1:51000"
            />
          </label>
          <p className="hint tight">{t(uiLocale, 'studioPipelineMockNote')}</p>
          <button type="button" className="text-btn" disabled={busy} onClick={handleSeedPhase0Review}>
            {t(uiLocale, 'studioSeedReview')}
          </button>
        </>
      ) : null}

      {customChars.length > 0 ? (
        <>
          <h4 className="studio-sub">{t(uiLocale, 'studioCustomChars')}</h4>
          <ul className="compact-list">
            {customChars.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`list-main ${item.id === characterId ? 'is-active' : ''}`}
                  disabled={busy}
                  onClick={() => onCharacterChange(item.id)}
                >
                  <strong>
                    {pickLocalized(item.names, uiLocale) || item.id}
                    {item.placeholder || item.type === 'placeholder' ? (
                      <em className="status-pill status-placeholder">{t(uiLocale, 'modePlaceholder')}</em>
                    ) : null}
                    {item.testAdapter === 'mock-haru' ? (
                      <em className="status-pill status-mock">Mock</em>
                    ) : null}
                  </strong>
                  <small>{item.id}</small>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={busy}
                  title={t(uiLocale, 'studioDelete')}
                  onClick={() => handleRemove(item.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h4 className="studio-sub">{t(uiLocale, 'studioJobs')}</h4>
      <ul className="compact-list">
        {recentJobs.length === 0 ? <li className="studio-empty">{t(uiLocale, 'studioNoJobs')}</li> : null}
        {recentJobs.map((job) => (
          <li key={job.id} className="job-row">
            <div className="job-head">
              <div className="job-meta">
                <strong>
                  {job.displayName || job.id.slice(0, 8)}
                  <em className={`status-pill status-${job.status}`}>
                    {statusLabel(uiLocale, job.status)}
                  </em>
                </strong>
                <small>{job.message || job.error || ''}</small>
              </div>
              <button
                type="button"
                className="text-btn danger-text"
                disabled={busy}
                onClick={() => handleRemoveJob(job.id)}
              >
                {t(uiLocale, 'studioDeleteJob')}
              </button>
            </div>
            <div className="chip-row tight">
              <button
                type="button"
                className="text-btn primary-text"
                disabled={busy}
                onClick={() => handlePlaceholder(job.id)}
              >
                {t(uiLocale, 'studioMakePlaceholder')}
              </button>
              {job.status === 'needs_review' ||
              job.status === 'awaiting_rigging' ||
              job.resultKind === 'decomposition' ? (
                <button
                  type="button"
                  className="text-btn primary-text"
                  disabled={busy}
                  onClick={() => setReviewJobId(job.id)}
                >
                  {t(uiLocale, 'studioOpenReview')}
                </button>
              ) : null}
              <button
                type="button"
                className="text-btn"
                disabled={busy || job.status === 'running'}
                title={t(uiLocale, 'studioDecomposeHint')}
                onClick={() => handleDecompose(job.id, 'see-through-quantized')}
              >
                {t(uiLocale, 'studioDecompose')}
              </button>
              {showAdvanced ? (
                <button
                  type="button"
                  className="text-btn"
                  disabled={busy || job.status === 'running'}
                  onClick={() => handleDecompose(job.id, 'dry-run')}
                >
                  {t(uiLocale, 'studioDecomposeDry')}
                </button>
              ) : null}
              {job.status !== 'done' || hasPipelineUrl ? (
                <button
                  type="button"
                  className="text-btn"
                  disabled={busy || !hasPipelineUrl}
                  title={!hasPipelineUrl ? t(uiLocale, 'studioShowAdvanced') : undefined}
                  onClick={() => handleRunJob(job.id)}
                >
                  {t(uiLocale, 'studioRunPipeline')}
                </button>
              ) : null}
              {job.status !== 'done' ? (
                <button type="button" className="text-btn" disabled={busy} onClick={() => handleAttachPack(job.id)}>
                  {t(uiLocale, 'studioAttachPack')}
                </button>
              ) : null}
              {job.characterId ? (
                <button
                  type="button"
                  className="text-btn"
                  disabled={busy}
                  onClick={() => onCharacterChange(job.characterId)}
                >
                  {t(uiLocale, 'studioUseChar')}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
