const CHARACTER_IDS = ['haru']

function normalizeCharacter(meta, idHint) {
  const id = meta.id || idHint
  const type = meta.type === 'live2d' ? 'live2d' : 'sprite'
  return {
    ...meta,
    id,
    type,
    preview:
      type === 'sprite'
        ? `./characters/${id}/${meta.expressions?.[0]?.file || 'idle.svg'}`
        : null,
    expressions: (meta.expressions || []).map((expr) => ({
      ...expr,
      src:
        type === 'sprite' && expr.file ? `./characters/${id}/${expr.file}` : undefined,
    })),
  }
}

async function loadBundledCharacters() {
  const list = []
  for (const id of CHARACTER_IDS) {
    const res = await fetch(`./characters/${id}/meta.json`)
    if (!res.ok) continue
    const meta = await res.json()
    list.push(normalizeCharacter(meta, id))
  }
  return list
}

export async function loadCharacters() {
  const bundled = await loadBundledCharacters()
  let custom = []
  try {
    custom = (await window.petDesktop?.listCustomCharacters?.()) || []
  } catch {
    custom = []
  }
  const byId = new Map()
  for (const item of [...bundled, ...custom]) {
    byId.set(item.id, item)
  }
  return [...byId.values()]
}

export function findExpression(character, expressionId) {
  if (!character) return null
  return (
    character.expressions.find((item) => item.id === expressionId) ||
    character.expressions.find((item) => item.id === character.defaultExpression) ||
    character.expressions[0] ||
    null
  )
}

export function isLive2D(character) {
  return character?.type === 'live2d'
}
