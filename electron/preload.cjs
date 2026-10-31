const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petDesktop', {
  quit: () => ipcRenderer.invoke('pet:quit'),
  resize: (size) => ipcRenderer.invoke('pet:resize', size),
  getOpenAtLogin: () => ipcRenderer.invoke('pet:get-open-at-login'),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke('pet:set-open-at-login', enabled),
  openSettingsWindow: () => ipcRenderer.invoke('pet:open-settings-window'),
  notifySettingsChanged: (patch) => ipcRenderer.invoke('pet:settings-changed', patch),
  onOpenSettings: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('pet:open-settings', listener)
    return () => ipcRenderer.removeListener('pet:open-settings', listener)
  },
  onSettingsSync: (handler) => {
    const listener = (_event, patch) => handler(patch)
    ipcRenderer.on('pet:settings-sync', listener)
    return () => ipcRenderer.removeListener('pet:settings-sync', listener)
  },
  pickVoiceFiles: () => ipcRenderer.invoke('pet:pick-voice-files'),
  listVoiceBank: (characterId) => ipcRenderer.invoke('pet:list-voice-bank', characterId),
  addVoiceSamples: (characterId, files) =>
    ipcRenderer.invoke('pet:add-voice-samples', { characterId, files }),
  removeVoiceSample: (characterId, sampleId) =>
    ipcRenderer.invoke('pet:remove-voice-sample', { characterId, sampleId }),
  rebuildVoicePrompt: (characterId) => ipcRenderer.invoke('pet:rebuild-voice-prompt', characterId),
  synthesizeVoice: (payload) => ipcRenderer.invoke('pet:synthesize-voice', payload),
  listCustomCharacters: () => ipcRenderer.invoke('pet:list-custom-characters'),
  importCharacterPack: () => ipcRenderer.invoke('pet:import-character-pack'),
  removeCustomCharacter: (characterId) =>
    ipcRenderer.invoke('pet:remove-custom-character', characterId),
  listLive2dJobs: () => ipcRenderer.invoke('pet:list-live2d-jobs'),
  removeLive2dJob: (jobId) => ipcRenderer.invoke('pet:remove-live2d-job', jobId),
  createLive2dJob: () => ipcRenderer.invoke('pet:create-live2d-job'),
  createLive2dJobFromKk: () => ipcRenderer.invoke('pet:create-live2d-job-from-kk'),
  quickLive2dFromImage: (pipelineUrl) =>
    ipcRenderer.invoke('pet:quick-live2d-from-image', { pipelineUrl }),
  quickLive2dFromKk: (pipelineUrl) =>
    ipcRenderer.invoke('pet:quick-live2d-from-kk', { pipelineUrl }),
  runLive2dJob: (jobId, pipelineUrl) =>
    ipcRenderer.invoke('pet:run-live2d-job', { jobId, pipelineUrl }),
  attachPackToJob: (jobId) => ipcRenderer.invoke('pet:attach-pack-to-job', jobId),
  createPlaceholderFromJob: (jobId) =>
    ipcRenderer.invoke('pet:create-placeholder-from-job', jobId),
  startJobDecompose: (jobId, options) =>
    ipcRenderer.invoke('pet:start-job-decompose', { jobId, ...(options || {}) }),
  getJobLayerReview: (jobId, options) =>
    ipcRenderer.invoke('pet:get-job-layer-review', { jobId, ...(options || {}) }),
  markJobAwaitingRigging: (jobId) => ipcRenderer.invoke('pet:mark-job-awaiting-rigging', jobId),
  revealJobPsd: (jobId) => ipcRenderer.invoke('pet:reveal-job-psd', jobId),
  seedPhase0ReviewJob: () => ipcRenderer.invoke('pet:seed-phase0-review-job'),
})
