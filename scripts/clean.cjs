const fs = require('fs')

const targets = ['dist', 'out', 'release']

for (const dir of targets) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    console.log(`removed ${dir}`)
  } catch (error) {
    console.warn(`skip ${dir}: ${error.code || error.message}`)
  }
}
