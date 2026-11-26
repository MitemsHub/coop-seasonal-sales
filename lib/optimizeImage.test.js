import { describe, expect, it } from 'vitest'
import { dimensionsFor, extensionForImageMime } from './optimizeImage'

describe('optimizeProductImage helpers', () => {
  it('names the file after the format the browser actually produced', () => {
    // A phone whose canvas cannot encode WebP gets JPEG from the encoder, and
    // sending those bytes as .webp is what broke the upload.
    expect(extensionForImageMime('image/webp')).toBe('webp')
    expect(extensionForImageMime('image/jpeg')).toBe('jpg')
    expect(extensionForImageMime('image/jpg')).toBe('jpg')
    expect(extensionForImageMime('image/png')).toBe('png')
    expect(extensionForImageMime('')).toBe('webp')
  })

  it('keeps the whole photo and the aspect ratio when shrinking', () => {
    expect(dimensionsFor(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 })
    expect(dimensionsFor(3000, 4000, 1200)).toEqual({ width: 900, height: 1200 })
    expect(dimensionsFor(800, 600, 1200)).toEqual({ width: 800, height: 600 })
  })

  it('never produces a zero-pixel side', () => {
    const { width, height } = dimensionsFor(20000, 1, 1200)
    expect(width).toBe(1200)
    expect(height).toBeGreaterThanOrEqual(1)
    expect(dimensionsFor(0, 0, 1200)).toEqual({ width: 1, height: 1 })
  })
})
