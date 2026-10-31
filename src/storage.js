const KEY = 'desktop-pet-settings-v2'

const DEFAULTS = {
  uiLocale: 'zh-CN',
  voiceLocale: 'zh-CN',
  characterId: 'haru',
  expressionId: 'idle',
  autoAnimate: true,
  hideControls: false,
  petScale: 1,
  cosyvoiceUrl: 'http://127.0.0.1:50000',
  // 默认为空：阶段 A 优先走「本地占位」，不强制连假流水线
  live2dPipelineUrl: '',
}

export function clampPetScale(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  // 精确到 1%
  return Math.min(1.6, Math.max(0.5, Math.round(n * 100) / 100))
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem('desktop-pet-settings-v1')
    if (!raw) return { ...DEFAULTS }
    const old = JSON.parse(raw)
    const parsed = {
      ...DEFAULTS,
      ...old,
      uiLocale: old.uiLocale || old.locale || DEFAULTS.uiLocale,
      voiceLocale: old.voiceLocale || old.locale || DEFAULTS.voiceLocale,
      hideControls: Boolean(old.hideControls ?? old.showChrome === false),
      petScale: clampPetScale(old.petScale ?? DEFAULTS.petScale),
    }
    delete parsed.locale
    delete parsed.showChrome
    if (parsed.characterId === 'miko' || parsed.characterId === 'kuro') {
      parsed.characterId = 'haru'
      parsed.expressionId = 'idle'
    }
    return parsed
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings))
}
