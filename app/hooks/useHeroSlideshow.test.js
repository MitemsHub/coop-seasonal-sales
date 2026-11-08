import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useHeroSlideshow, { HERO_AUTOPLAY_MS } from './useHeroSlideshow'
import { HERO_IMAGES } from '../../lib/landingHeroImages'

let downloads
beforeEach(() => {
  vi.useFakeTimers()
  downloads = []
  vi.stubGlobal('Image', class {
    constructor() {
      this.naturalWidth = 1600
      this.decode = vi.fn().mockResolvedValue(undefined)
      downloads.push(this)
    }
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const setup = (props = {}) => renderHook(() => useHeroSlideshow({ reduce: false, paused: false, ...props }))
const finish = async (image) => act(async () => { await image.onload?.() })

describe('hero slideshow loading', () => {
  it('does not preload or advance before the first image loads', () => {
    const { result } = setup()
    act(() => vi.advanceTimersByTime(HERO_AUTOPLAY_MS * 3))
    expect(downloads).toHaveLength(0)
    expect(result.current.slide).toBe(0)
  })

  it('preloads only one responsive image at low priority after the first load', () => {
    const { result } = setup()
    act(() => result.current.markReady(0))
    expect(downloads).toHaveLength(1)
    expect(downloads[0].src).toBe(HERO_IMAGES[1].src)
    expect(downloads[0].srcset).toBe(HERO_IMAGES[1].srcSet)
    expect(downloads[0].sizes).toBe('100vw')
    expect(downloads[0].fetchPriority).toBe('low')
  })

  it('keeps the current slide until the next image is loaded and decoded', async () => {
    const { result } = setup()
    act(() => result.current.markReady(0))
    act(() => vi.advanceTimersByTime(HERO_AUTOPLAY_MS))
    expect(result.current.slide).toBe(0)
    let decode
    downloads.at(-1).decode = () => new Promise((resolve) => { decode = resolve })
    const loading = downloads.at(-1).onload()
    expect(result.current.slide).toBe(0)
    await act(async () => { decode(); await loading })
    expect(result.current.slide).toBe(1)
  })

  it('preserves the current slide when a requested image fails', () => {
    const { result } = setup()
    act(() => result.current.markReady(0))
    act(() => result.current.goTo(5))
    expect(downloads.at(-1).src).toBe(HERO_IMAGES[5].src)
    downloads.at(-1).naturalWidth = 0
    act(() => vi.advanceTimersByTime(HERO_AUTOPLAY_MS * 3))
    expect(result.current.slide).toBe(0)
  })

  it('ignores stale downloads when another photo is requested', async () => {
    const { result } = setup()
    act(() => result.current.markReady(0))
    act(() => result.current.goTo(4))
    const staleLoad = downloads.at(-1).onload
    act(() => result.current.goTo(6))
    await act(async () => { await staleLoad() })
    expect(result.current.slide).toBe(0)
    await finish(downloads.at(-1))
    expect(result.current.slide).toBe(6)
  })

  it.each([{ reduce: true }, { paused: true }])('does not autoplay with %o', async (props) => {
    const { result } = setup(props)
    act(() => result.current.markReady(0))
    await finish(downloads[0])
    act(() => vi.advanceTimersByTime(HERO_AUTOPLAY_MS * 3))
    expect(result.current.slide).toBe(0)
    act(() => result.current.go(-1))
    await finish(downloads.at(-1))
    expect(result.current.slide).toBe(HERO_IMAGES.length - 1)
  })

  it('recognizes an already-cached first image after hydration', () => {
    renderHook(() => {
      const state = useHeroSlideshow({ reduce: false, paused: false })
      state.imgRef.current = { complete: true, naturalWidth: 1600 }
      return state
    })
    expect(downloads).toHaveLength(1)
  })
})
