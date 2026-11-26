// lib/exhibitionPhotoShelf.test.js
// The photo suggestion is meant to be cheap: it must stop at the name, then at
// the filename, and only then spend a vision call. These tests pin that order
// and the fact that nothing is suggested when the answer is not a shelf.
import { describe, expect, it, vi } from 'vitest'
import {
  parseVisionShelf,
  shelfFromFileName,
  suggestShelfFromPhoto,
} from './exhibitionPhotoShelf'

const url = (file) => `https://example.supabase.co/storage/v1/object/public/x/${file}`

describe('shelfFromFileName', () => {
  it('reads a shelf word out of the filename', () => {
    expect(shelfFromFileName(url('sdd-bonestraight-wig.webp'))).toEqual({
      key: 'hair',
      label: 'Hair & Wigs',
      source: 'filename',
    })
    expect(shelfFromFileName(url('ankara-fabric.jpg'))?.key).toBe('fashion')
    expect(shelfFromFileName(url('turkey-whole.png'))?.key).toBe('protein')
  })

  it('ignores upload noise and product codes', () => {
    expect(shelfFromFileName(url('draft-mwqm10hu-jcuf.webp'))).toBeNull()
    expect(shelfFromFileName(url('V0099-TUR-003.webp'))).toBeNull()
    expect(shelfFromFileName('')).toBeNull()
  })
})

describe('parseVisionShelf', () => {
  it('accepts one of the shop labels, however it is typed', () => {
    expect(parseVisionShelf('Hair & Wigs')).toEqual({ key: 'hair', label: 'Hair & Wigs' })
    expect(parseVisionShelf('hair wigs')).toEqual({ key: 'hair', label: 'Hair & Wigs' })
    expect(parseVisionShelf('Phones & Electronics.')?.key).toBe('electronics')
  })

  it('rejects anything that is not a shelf', () => {
    expect(parseVisionShelf('Unknown')).toBeNull()
    expect(parseVisionShelf('')).toBeNull()
    expect(parseVisionShelf('I think this could be several things')).toBeNull()
  })
})

describe('suggestShelfFromPhoto', () => {
  it('does not spend a call when the name already places the listing', async () => {
    const fetchImpl = vi.fn()
    const result = await suggestShelfFromPhoto({
      name: '10inches sdd (Raw closure fringe wig)',
      imageUrl: url('abc123.webp'),
      apiKey: 'k',
      fetchImpl,
    })
    expect(result).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the free filename before the model', async () => {
    const fetchImpl = vi.fn()
    const result = await suggestShelfFromPhoto({
      name: 'Item 12',
      imageUrl: url('wig-14in.webp'),
      apiKey: 'k',
      fetchImpl,
    })
    expect(result?.source).toBe('filename')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('asks the model only as the last resort', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hair & Wigs' } }] }),
    }))
    const result = await suggestShelfFromPhoto({
      name: 'Item 12',
      imageUrl: url('abc123.webp'),
      apiKey: 'k',
      fetchImpl,
    })
    expect(result).toEqual({ key: 'hair', label: 'Hair & Wigs', source: 'vision' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.messages[1].content[1].image_url.url).toContain('abc123.webp')
  })

  it('stays silent without a key or when the model fails', async () => {
    const fetchImpl = vi.fn()
    expect(
      await suggestShelfFromPhoto({ name: 'Item 12', imageUrl: url('abc123.webp'), fetchImpl })
    ).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()

    const failing = vi.fn(async () => ({ ok: false }))
    expect(
      await suggestShelfFromPhoto({
        name: 'Item 12',
        imageUrl: url('abc123.webp'),
        apiKey: 'k',
        fetchImpl: failing,
      })
    ).toBeNull()

    const badAnswer = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Unknown' } }] }),
    }))
    expect(
      await suggestShelfFromPhoto({
        name: 'Item 12',
        imageUrl: url('abc123.webp'),
        apiKey: 'k',
        fetchImpl: badAnswer,
      })
    ).toBeNull()
  })
})
