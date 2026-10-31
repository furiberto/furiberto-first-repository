const fs = require('fs')
const path = require('path')

const outDir = path.join(process.cwd(), 'out')
if (!fs.existsSync(outDir)) process.exit(0)

function shouldKeep(name) {
  return /^DesktopPet-Setup-.*\.exe$/i.test(name) || /^DesktopPet-Portable-.*\.exe$/i.test(name)
}

for (const name of fs.readdirSync(outDir)) {
  if (shouldKeep(name)) continue
  const full = path.join(outDir, name)
  try {
    fs.rmSync(full, { recursive: true, force: true })
    console.log(`pruned ${name}`)
  } catch (error) {
    console.warn(`skip ${name}: ${error.code || error.message}`)
  }
}
