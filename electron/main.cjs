const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  screen,
  Tray,
  Menu,
  nativeImage,
} = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const voiceBank = require('./voice-bank.cjs')
const characterBank = require('./character-bank.cjs')
const layerReview = require('./layer-review.cjs')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'petchar',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
  {
    scheme: 'petjob',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
])

// 本地 `electron .` 时 isPackaged=false，不能据此当开发态；仅 DESKTOP_PET_DEV=1 才连 Vite
const isDev = process.env.DESKTOP_PET_DEV === '1'
const PET_WIDTH = 420
const PET_HEIGHT = 640
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json')

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {BrowserWindow | null} */
let settingsWindow = null
/** @type {Tray | null} */
let tray = null
let isQuitting = false

function appPageUrl(query = '') {
  const q = query ? (query.startsWith('?') ? query : `?${query}`) : ''
  if (isDev) return `http://127.0.0.1:5173/${q}`
  return pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href + q
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }

  const { workArea } = screen.getPrimaryDisplay()
  const width = 420
  const height = 640
  settingsWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    frame: true,
    transparent: false,
    alwaysOnTop: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    show: false,
    autoHideMenuBar: true,
    title: 'DesktopPet 设置',
    backgroundColor: '#fff8f1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  })

  settingsWindow.loadURL(appPageUrl('?mode=settings'))
  settingsWindow.once('ready-to-show', () => settingsWindow?.show())
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  return settingsWindow
}

function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'))
  } catch {
    return null
  }
}

function writeWindowState() {
  if (!mainWindow) return
  const bounds = mainWindow.getBounds()
  const payload = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify(payload, null, 2), 'utf8')
  } catch {
    // ignore persistence errors
  }
}

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: Math.round(workArea.x + workArea.width - PET_WIDTH - 24),
    y: Math.round(workArea.y + workArea.height - PET_HEIGHT - 24),
  }
}

function createWindow() {
  const saved = readWindowState()
  const bounds = {
    ...defaultBounds(),
    ...(saved || {}),
  }

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  })

  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  mainWindow.loadURL(appPageUrl())

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('move', () => writeWindowState())
  mainWindow.on('resize', () => writeWindowState())

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    } else {
      writeWindowState()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function trayIcon() {
  const iconPath = path.join(__dirname, 'tray.png')
  const image = nativeImage.createFromPath(iconPath)
  return image.isEmpty() ? nativeImage.createEmpty() : image
}

function rebuildTrayMenu() {
  if (!tray) return
  const openAtLogin = app.getLoginItemSettings().openAtLogin
  const template = [
    {
      label: '显示桌宠',
      click: () => {
        if (!mainWindow) createWindow()
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    {
      label: '隐藏桌宠',
      click: () => mainWindow?.hide(),
    },
    {
      label: '打开设置',
      click: () => openSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          openAsHidden: true,
        })
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function createTray() {
  tray = new Tray(trayIcon())
  tray.setToolTip('DesktopPet 桌宠')
  tray.on('double-click', () => {
    if (!mainWindow) createWindow()
    else if (mainWindow.isVisible()) mainWindow.hide()
    else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
  rebuildTrayMenu()
}

ipcMain.handle('pet:quit', () => {
  isQuitting = true
  app.quit()
})

ipcMain.handle('pet:resize', (_event, { width, height, animate = true }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const w = Math.max(240, Math.round(width || PET_WIDTH))
  const h = Math.max(280, Math.round(height || PET_HEIGHT))
  const bounds = mainWindow.getBounds()
  // Windows 上 setBounds 第二参 animate 基本无效；保持中心不跳，配合渲染层过渡
  const x = Math.round(bounds.x + (bounds.width - w) / 2)
  const y = Math.round(bounds.y + (bounds.height - h))
  mainWindow.setBounds({ x, y, width: w, height: h }, Boolean(animate))
  writeWindowState()
})

ipcMain.handle('pet:open-settings-window', () => {
  openSettingsWindow()
  return true
})

ipcMain.handle('pet:settings-changed', (event, patch) => {
  for (const win of [mainWindow, settingsWindow]) {
    if (win && !win.isDestroyed() && win.webContents.id !== event.sender.id) {
      win.webContents.send('pet:settings-sync', patch || null)
    }
  }
  return true
})

ipcMain.handle('pet:get-open-at-login', () => app.getLoginItemSettings().openAtLogin)

ipcMain.handle('pet:set-open-at-login', (_event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    openAsHidden: true,
  })
  rebuildTrayMenu()
  return app.getLoginItemSettings().openAtLogin
})

ipcMain.handle('pet:pick-voice-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '选择语音样本（WAV）',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
  })
  if (result.canceled || !result.filePaths?.length) return []
  return result.filePaths.map((filePath) => ({
    path: filePath,
    name: path.basename(filePath),
  }))
})

ipcMain.handle('pet:list-voice-bank', (_event, characterId) =>
  voiceBank.listVoiceBank(app.getPath('userData'), characterId),
)

ipcMain.handle('pet:add-voice-samples', (_event, { characterId, files }) =>
  voiceBank.addVoiceSamples(app.getPath('userData'), characterId, files),
)

ipcMain.handle('pet:remove-voice-sample', (_event, { characterId, sampleId }) =>
  voiceBank.removeVoiceSample(app.getPath('userData'), characterId, sampleId),
)

ipcMain.handle('pet:rebuild-voice-prompt', (_event, characterId) =>
  voiceBank.rebuildPrompt(app.getPath('userData'), characterId),
)

ipcMain.handle('pet:synthesize-voice', async (_event, payload) => {
  const { characterId, text, cosyvoiceUrl } = payload || {}
  return voiceBank.synthesizeWithPrompt(
    app.getPath('userData'),
    characterId,
    text,
    cosyvoiceUrl,
  )
})

ipcMain.handle('pet:list-custom-characters', () =>
  characterBank.listCustomCharacters(app.getPath('userData')),
)

ipcMain.handle('pet:import-character-pack', async () => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '导入 Live2D：选择 .model3.json',
    properties: ['openFile'],
    filters: [{ name: 'Live2D model3', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths?.[0]) return null
  const picked = result.filePaths[0]
  if (!picked.toLowerCase().endsWith('.model3.json')) {
    throw new Error('请选择 .model3.json 文件')
  }
  return characterBank.importCharacterPack(app.getPath('userData'), picked)
})

ipcMain.handle('pet:remove-custom-character', (_event, characterId) =>
  characterBank.removeCustomCharacter(app.getPath('userData'), characterId),
)

ipcMain.handle('pet:list-live2d-jobs', () => characterBank.listJobs(app.getPath('userData')))

ipcMain.handle('pet:remove-live2d-job', (_event, jobId) =>
  characterBank.removeJob(app.getPath('userData'), jobId),
)

const DEFAULT_KK_CHARA_DIR = 'F:\\restore\\kk\\kk_files\\UserData\\chara\\female'

ipcMain.handle('pet:create-live2d-job', async () => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '选择人物立绘',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  if (result.canceled || !result.filePaths?.[0]) return null
  return characterBank.createJobFromImage(app.getPath('userData'), result.filePaths[0])
})

ipcMain.handle('pet:create-live2d-job-from-kk', async () => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '选择恋活人物卡 PNG',
    defaultPath: fs.existsSync(DEFAULT_KK_CHARA_DIR) ? DEFAULT_KK_CHARA_DIR : undefined,
    properties: ['openFile'],
    filters: [{ name: 'KK Card / PNG', extensions: ['png'] }],
  })
  if (result.canceled || !result.filePaths?.[0]) return null
  return characterBank.createJobFromKkCard(app.getPath('userData'), result.filePaths[0])
})

ipcMain.handle('pet:quick-live2d-from-image', async (_event, { pipelineUrl } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '选择立绘并一键生成',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  if (result.canceled || !result.filePaths?.[0]) return null
  const userData = app.getPath('userData')
  const job = characterBank.createJobFromImage(userData, result.filePaths[0])
  if (!String(pipelineUrl || '').trim()) return { job, character: null, ran: false }
  const out = await characterBank.runJobPipeline(userData, job.id, pipelineUrl, { softFail: true })
  return { ...out, ran: !out.soft }
})

ipcMain.handle('pet:quick-live2d-from-kk', async (_event, { pipelineUrl } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '选择恋活人物卡并一键生成',
    defaultPath: fs.existsSync(DEFAULT_KK_CHARA_DIR) ? DEFAULT_KK_CHARA_DIR : undefined,
    properties: ['openFile'],
    filters: [{ name: 'KK Card / PNG', extensions: ['png'] }],
  })
  if (result.canceled || !result.filePaths?.[0]) return null
  const userData = app.getPath('userData')
  const job = characterBank.createJobFromKkCard(userData, result.filePaths[0])
  if (!String(pipelineUrl || '').trim()) return { job, character: null, ran: false }
  const out = await characterBank.runJobPipeline(userData, job.id, pipelineUrl, { softFail: true })
  return { ...out, ran: !out.soft }
})

ipcMain.handle('pet:run-live2d-job', async (_event, { jobId, pipelineUrl }) =>
  characterBank.runJobPipeline(app.getPath('userData'), jobId, pipelineUrl, { softFail: true }),
)

ipcMain.handle('pet:create-placeholder-from-job', (_event, jobId) =>
  characterBank.createPlaceholderFromJob(app.getPath('userData'), jobId),
)

ipcMain.handle('pet:start-job-decompose', (_event, { jobId, backend, resolution } = {}) =>
  characterBank.startJobDecompose(app.getPath('userData'), jobId, { backend, resolution }),
)

ipcMain.handle('pet:get-job-layer-review', (_event, { jobId, revisionId } = {}) =>
  layerReview.getJobLayerReview(app.getPath('userData'), jobId, { revisionId }),
)

ipcMain.handle('pet:mark-job-awaiting-rigging', (_event, jobId) =>
  layerReview.markAwaitingRigging(app.getPath('userData'), jobId),
)

ipcMain.handle('pet:reveal-job-psd', (_event, jobId) => {
  const data = layerReview.getJobLayerReview(app.getPath('userData'), jobId)
  if (!data.psd?.relative) throw new Error('该任务没有可打开的 PSD')
  const file = layerReview.resolveJobFile(app.getPath('userData'), jobId, data.psd.relative)
  const { shell } = require('electron')
  shell.showItemInFolder(file)
  return { ok: true }
})

ipcMain.handle('pet:seed-phase0-review-job', () => {
  const phase0 = path.join(
    __dirname,
    '..',
    'services',
    'image-pipeline',
    'workspace',
    'phase0',
    'first-run',
  )
  return layerReview.seedJobFromPhase0Folder(app.getPath('userData'), phase0, {
    displayName: 'phase0-sample（审阅演示）',
  })
})

ipcMain.handle('pet:attach-pack-to-job', async (_event, jobId) => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '为该任务选择 .model3.json',
    properties: ['openFile'],
    filters: [{ name: 'Live2D model3', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths?.[0]) return null
  const picked = result.filePaths[0]
  if (!picked.toLowerCase().endsWith('.model3.json')) {
    throw new Error('请选择 .model3.json 文件')
  }
  return characterBank.attachPackToJob(app.getPath('userData'), jobId, picked)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) createWindow()
    else {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    characterBank.ensureRoots(app.getPath('userData'))
    protocol.handle('petjob', (request) => {
      try {
        const url = new URL(request.url)
        const id = decodeURIComponent(url.hostname || '')
        const rel = decodeURIComponent((url.pathname || '').replace(/^\/+/, ''))
        const file = layerReview.resolveJobFile(app.getPath('userData'), id, rel)
        if (!fs.existsSync(file)) {
          return new Response('Not Found', { status: 404 })
        }
        return net.fetch(pathToFileURL(file).href)
      } catch {
        return new Response('Bad Request', { status: 400 })
      }
    })

    protocol.handle('petchar', (request) => {
      try {
        const url = new URL(request.url)
        const id = decodeURIComponent(url.hostname)
        const rel = decodeURIComponent((url.pathname || '/').replace(/^\/+/, ''))
        const file = characterBank.resolveCharacterFile(app.getPath('userData'), id, rel)
        if (!fs.existsSync(file)) {
          return new Response('Not Found', { status: 404 })
        }
        return net.fetch(pathToFileURL(file).href)
      } catch (error) {
        return new Response(String(error.message || error), { status: 400 })
      }
    })

    createWindow()
    createTray()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else mainWindow?.show()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
    writeWindowState()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      // keep tray alive; only quit via tray/menu
    }
  })
}
