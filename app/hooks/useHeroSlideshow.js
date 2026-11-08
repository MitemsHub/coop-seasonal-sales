'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { HERO_IMAGES } from '../../lib/landingHeroImages'

export const HERO_AUTOPLAY_MS = 3000

export default function useHeroSlideshow({ reduce, paused }) {
  const [slide, setSlide] = useState(0)
  const [target, setTarget] = useState(0)
  const [ready, setReady] = useState({})
  const imgRef = useRef(null)
  const markReady = useCallback((index) => {
    setReady((current) => current[index] ? current : { ...current, [index]: true })
  }, [])

  // A cached first image may finish loading before hydration attaches onLoad.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) markReady(slide)
  }, [slide, markReady])

  useEffect(() => {
    // The first image gets the connection to itself. After it loads, fetch only
    // the next slide (or the user's requested slide), at low priority.
    if (!ready[slide] && target === slide) return
    if (target !== slide && ready[target]) {
      setSlide(target)
      return
    }
    const next = target === slide ? (slide + 1) % HERO_IMAGES.length : target
    if (ready[next]) return
    let cancelled = false
    const image = new Image()
    image.onload = async () => {
      try {
        await image.decode()
      } catch {
        // Older browsers can load successfully without supporting decode().
      }
      if (!cancelled && image.naturalWidth > 0) markReady(next)
    }
    // A failed photo never replaces the currently displayed one.
    image.fetchPriority = 'low'
    image.sizes = HERO_IMAGES[next].sizes
    image.srcset = HERO_IMAGES[next].srcSet
    image.src = HERO_IMAGES[next].src
    return () => {
      cancelled = true
      image.onload = null
    }
  }, [slide, target, ready, markReady])

  useEffect(() => {
    if (reduce || paused || !ready[slide] || target !== slide) return
    const id = setTimeout(() => setTarget((slide + 1) % HERO_IMAGES.length), HERO_AUTOPLAY_MS)
    return () => clearTimeout(id)
  }, [slide, target, ready, reduce, paused])

  const go = (direction) => setTarget((current) => (current + direction + HERO_IMAGES.length) % HERO_IMAGES.length)
  const goTo = (index) => setTarget(index)

  return { slide, imgRef, markReady, go, goTo }
}
