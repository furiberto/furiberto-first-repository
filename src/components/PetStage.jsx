import { useState } from 'react'
import Live2DStage from './Live2DStage'
import AnimatedSprite from './AnimatedSprite'
import { isLive2D } from '../characters'
import { pickLocalized, t } from '../i18n'

export default function PetStage({
  character,
  expression,
  uiLocale,
  bubble,
  bubbleVisible,
  reacting,
  petScale = 1,
  onPetClick,
  onOpenSettings,
  onPetScaleChange,
}) {
  const name = pickLocalized(character.names, uiLocale)
  const live2d = isLive2D(character)
  const isPlaceholder = Boolean(character.placeholder || character.type === 'placeholder')
  const [hovered, setHovered] = useState(false)
  const modeClass = live2d ? 'live2d' : isPlaceholder ? 'placeholder' : 'sprite'
  const modeLabel = live2d
    ? t(uiLocale, 'modeLive2d')
    : isPlaceholder
      ? t(uiLocale, 'modePlaceholder')
      : t(uiLocale, 'modeSprite')

  return (
    <div
      className={`pet-stage ${live2d ? 'is-live2d' : 'is-sprite'} ${hovered ? 'is-hovered' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(event) => {
        event.preventDefault()
        onOpenSettings()
      }}
      onWheel={(event) => {
        if (!event.ctrlKey || !onPetScaleChange) return
        event.preventDefault()
        const delta = event.deltaY > 0 ? -0.01 : 0.01
        onPetScaleChange(Math.round((petScale + delta) * 100) / 100)
      }}
    >
      <div className="drag-strip" title={t(uiLocale, 'hiddenChromeHint')} />

      {bubbleVisible && bubble ? (
        <div
          className="speech-bubble is-soft"
          key={`${character.id}-${expression.id}-${bubble}`}
        >
          <p>{bubble}</p>
        </div>
      ) : null}

      <button type="button" className="pet-hitbox" onClick={onPetClick} aria-label={name}>
        <div
          className="pet-scale-layer"
          style={{
            transform: `scale(${petScale})`,
            transformOrigin: 'center bottom',
          }}
        >
          {live2d ? (
            <Live2DStage
              character={character}
              expression={expression}
              locale={uiLocale}
              hideStatus={!hovered}
            />
          ) : (
            <AnimatedSprite
              characterId={character.id}
              expression={expression}
              reacting={reacting}
              alt={`${name} / ${pickLocalized(expression.names, uiLocale)}`}
            />
          )}
        </div>
      </button>

      <div className={`pet-chrome ${hovered ? 'is-visible' : ''}`}>
        <div className={`mode-badge ${modeClass}`}>{modeLabel}</div>
        <button
          type="button"
          className="gear-btn"
          onClick={onOpenSettings}
          aria-label={t(uiLocale, 'settings')}
        >
          {t(uiLocale, 'settings')}
        </button>
      </div>
    </div>
  )
}
