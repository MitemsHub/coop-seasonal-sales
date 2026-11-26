import { describe, expect, it } from 'vitest'
import { thumbSrcSet, thumbUrl } from './imageUrl'

const survey = 'https://lpzyvvsuksafnpchfdqw.supabase.co/storage/v1/object/public/food-survey/survey/1791861910110_nc75ku5o.jpg?v=1791861914246'
const tallPhone = 'https://lpzyvvsuksafnpchfdqw.supabase.co/storage/v1/object/public/exhibition-images/vendors/173/V0066-IPH-007.webp?v=1795612264274'

describe('thumbUrl', () => {
  it('rewrites a public object URL into a resized render URL', () => {
    const out = thumbUrl(survey, 500)
    expect(out.startsWith('https://lpzyvvsuksafnpchfdqw.supabase.co/storage/v1/render/image/public/food-survey/survey/')).toBe(true)
    expect(out).toContain('width=500')
    expect(out).toContain('height=500')
    expect(out).toContain('resize=contain')
    expect(out).toContain('quality=70')
    expect(out).toContain('format=webp')
    // the cache-buster is preserved
    expect(out).toContain('v=1791861914246')
    expect(out).not.toContain('object/public')
  })

  it('bounds both edges, so a tall photo is not squashed into a sliver', () => {
    // width=160 alone comes back as 160x914 from the image service — the photo
    // must be given a height too, or every product thumbnail is distorted.
    const out = thumbUrl(tallPhone, 160)
    const params = new URL(out).searchParams
    expect(params.get('width')).toBe('160')
    expect(params.get('height')).toBe('160')
    expect(params.get('resize')).toBe('contain')
  })

  it('clamps width and quality to sane ranges', () => {
    expect(thumbUrl(survey, 99999)).toContain('width=2500')
    expect(thumbUrl(survey, 500, 5)).toContain('quality=20')
  })

  it('leaves images the resizer cannot handle alone', () => {
    const heic = survey.replace('.jpg', '.heic')
    const gif = survey.replace('.jpg', '.gif')
    expect(thumbUrl(heic, 200)).toBe(heic)
    expect(thumbUrl(gif, 200)).toBe(gif)
  })

  it('passes through URLs that are not public Supabase objects', () => {
    expect(thumbUrl('/uploads/food-survey/a.jpg', 200)).toBe('/uploads/food-survey/a.jpg')
    expect(thumbUrl('blob:http://localhost:3000/abc', 200)).toBe('blob:http://localhost:3000/abc')
    expect(thumbUrl('https://example.com/a.png', 200)).toBe('https://example.com/a.png')
    expect(thumbUrl('', 200)).toBe('')
    expect(thumbUrl(null, 200)).toBe('')
  })

  it('does not double-rewrite an already resized URL', () => {
    const once = thumbUrl(survey, 200)
    expect(thumbUrl(once, 800)).toBe(once)
  })
})

describe('thumbSrcSet', () => {
  it('offers half the given box as 1x and the box itself as 2x', () => {
    const set = thumbSrcSet(survey, 160)
    expect(set).toBe(`${thumbUrl(survey, 80)} 1x, ${thumbUrl(survey, 160)} 2x`)
    expect(set).toContain('width=80')
    expect(set).toContain('width=160')
    // both edges stay bounded, so neither candidate is squashed
    expect(set).toContain('height=160')
    expect(set).toContain('resize=contain')
  })

  it('never asks for less than the service accepts', () => {
    expect(thumbSrcSet(survey, 40)).toContain('width=32')
  })

  it('returns nothing when the URL cannot be resized', () => {
    expect(thumbSrcSet('/images/items/placeholder.svg', 160)).toBe('')
    expect(thumbSrcSet('', 160)).toBe('')
  })
})
