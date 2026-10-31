import { useEffect, useRef, useState } from 'react'

const CROSSFADE_MS = 420

/**
 * Crossfades between expression images and plays a short reaction bob on change.
 */
export default function AnimatedSprite({ expression, characterId, alt, reacting }) {
  const [front, setFront] = useState(expression)
  const [back, setBack] = useState(null)
  const [fading, setFading] = useState(false)
  const timerRef = useRef(0)
  const frontRef = useRef(expression)

  useEffect(() => {
    frontRef.current = front
  }, [front])

  useEffect(() => {
    if (!expression) return
    if (expression.src === frontRef.current?.src) return

    window.clearTimeout(timerRef.current)
    setBack(frontRef.current)
    setFront(expression)
    setFading(true)

    timerRef.current = window.setTimeout(() => {
      setBack(null)
      setFading(false)
    }, CROSSFADE_MS)

    return () => window.clearTimeout(timerRef.current)
  }, [expression])

  useEffect(() => {
    // Hard reset layers when character changes to avoid ghost frames.
    window.clearTimeout(timerRef.current)
    setFront(expression)
    setBack(null)
    setFading(false)
  }, [characterId])

  return (
    <div className={`sprite-stack ${reacting ? 'is-reacting' : ''}`}>
      <div className="sprite-breath">
        {back ? (
          <img
            className={`pet-art pet-art-layer is-back ${fading ? 'is-leaving' : ''}`}
            src={back.src}
            alt=""
            draggable={false}
          />
        ) : null}
        <img
          className={`pet-art pet-art-layer is-front ${fading ? 'is-entering' : ''}`}
          src={front?.src}
          alt={alt}
          draggable={false}
        />
      </div>
    </div>
  )
}
