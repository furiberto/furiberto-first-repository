const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const http = require('http')

const root = path.join(__dirname, '..')
const isWin = process.platform === 'win32'
const wantDev = process.argv.includes('--dev')

function log(message) {
  console.log(`[DesktopPet] ${message}`)
}

function cleanEnv() {
  const env = { ...process.env }
  // Cursor / VS Code 常带这个变量，会导致 electron.exe 当 Node 跑然后秒退
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  return env
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath))
}

function runNpm(args) {
  const result = spawnSync(isWin ? 'npm.cmd' : 'npm', args, {
    cwd: root,
    stdio: 'inherit',
    env: cleanEnv(),
    shell: isWin,
  })
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed (${result.status})`)
  }
}

function resolveElectronBinary() {
  const distDir = path.join(root, 'node_modules', 'electron', 'dist')
  const pathTxt = path.join(root, 'node_modules', 'electron', 'path.txt')
  if (fs.existsSync(pathTxt)) {
    const relative = fs.readFileSync(pathTxt, 'utf8').trim()
    const candidate = path.join(distDir, relative)
    if (fs.existsSync(candidate)) return candidate
  }
  const fallback = path.join(distDir, isWin ? 'electron.exe' : 'electron')
  if (fs.existsSync(fallback)) return fallback
  throw new Error('Electron binary missing. Run: npm install')
}

function waitForUrl(url, timeoutMs = 60000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timeout waiting for ${url}`))
          return
        }
        setTimeout(tick, 300)
      })
    }
    tick()
  })
}

function launchElectron({ dev = false, extraArgs = [] } = {}) {
  const electronBin = resolveElectronBinary()
  log(`Electron: ${electronBin}`)
  const env = cleanEnv()
  if (dev) env.DESKTOP_PET_DEV = '1'
  else delete env.DESKTOP_PET_DEV
  const child = spawn(electronBin, ['.', ...extraArgs], {
    cwd: root,
    stdio: 'inherit',
    env,
    windowsHide: false,
  })
  return child
}

function ensureDeps() {
  if (!exists('node_modules')) {
    log('Installing dependencies...')
    runNpm(['install'])
  }
  if (!exists(path.join('node_modules', 'electron', 'dist', isWin ? 'electron.exe' : 'electron'))) {
    log('Fetching Electron binary...')
    const installJs = path.join(root, 'node_modules', 'electron', 'install.js')
    const result = spawnSync(process.execPath, [installJs], {
      cwd: root,
      stdio: 'inherit',
      env: cleanEnv(),
    })
    if (result.status !== 0) {
      throw new Error('Electron install.js failed')
    }
  }
}

function newestMtime(dir) {
  let newest = 0
  if (!fs.existsSync(dir)) return 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name)
      const stat = fs.statSync(full)
      if (stat.isDirectory()) stack.push(full)
      else newest = Math.max(newest, stat.mtimeMs)
    }
  }
  return newest
}

function needsRebuild() {
  const distIndex = path.join(root, 'dist', 'index.html')
  if (!fs.existsSync(distIndex)) return true
  const distTime = fs.statSync(distIndex).mtimeMs
  const sourceTime = Math.max(
    newestMtime(path.join(root, 'src')),
    newestMtime(path.join(root, 'public')),
    fs.existsSync(path.join(root, 'index.html')) ? fs.statSync(path.join(root, 'index.html')).mtimeMs : 0,
  )
  return sourceTime > distTime
}

async function runProd() {
  if (needsRebuild()) {
    log('Building frontend (source changed)...')
    runNpm(['run', 'build'])
  } else {
    log('Using existing dist/')
  }
  log('Launching app window...')
  const electron = launchElectron({ dev: false })
  await new Promise((resolve) => {
    electron.on('exit', (code, signal) => {
      log(`Electron exited code=${code} signal=${signal || ''}`)
      resolve(code)
    })
  })
}

async function runDev() {
  log('Starting Vite...')
  const viteJs = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  const vite = spawn(process.execPath, [viteJs, '--host', '127.0.0.1', '--port', '5173'], {
    cwd: root,
    stdio: 'inherit',
    env: cleanEnv(),
  })

  vite.on('exit', (code) => {
    if (code) {
      log(`Vite exited: ${code}`)
      process.exit(code)
    }
  })

  await waitForUrl('http://127.0.0.1:5173')
  log('Launching app window...')
  const electron = launchElectron({ dev: true })

  const shutdown = () => {
    try {
      electron.kill()
    } catch {}
    try {
      vite.kill()
    } catch {}
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await new Promise((resolve) => {
    electron.on('exit', (code, signal) => {
      log(`Electron exited code=${code} signal=${signal || ''}`)
      shutdown()
      resolve(code)
    })
  })
}

async function main() {
  process.chdir(root)
  delete process.env.ELECTRON_RUN_AS_NODE
  ensureDeps()

  if (wantDev) {
    await runDev()
  } else {
    await runProd()
  }
}

main().catch((error) => {
  console.error(`[DesktopPet] ${error.stack || error.message || error}`)
  if (process.stdin.isTTY) {
    console.error('[DesktopPet] Press Enter to close...')
    process.stdin.resume()
    process.stdin.on('data', () => process.exit(1))
  } else {
    process.exit(1)
  }
})
