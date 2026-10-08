// lib/agentContent.test.js — unit tests for the Markdown content-negotiation
// helpers used by middleware.js (is-agentic items 1 and 2).

import { describe, it, expect } from 'vitest'
import {
  wantsMarkdown,
  isAssetPath,
  markdownResponse,
  notFoundMarkdown,
  HOMEPAGE_MARKDOWN,
} from './agentContent.js'
import { SITE_URL } from './siteMetadata.js'

describe('wantsMarkdown', () => {
  it('accepts an explicit text/markdown Accept header', () => {
    expect(wantsMarkdown('text/markdown')).toBe(true)
    expect(wantsMarkdown('text/markdown;q=0.9')).toBe(true)
    expect(wantsMarkdown('text/html, text/markdown;q=0.8')).toBe(true)
    expect(wantsMarkdown('TEXT/Markdown')).toBe(true)
  })

  it("does not treat curl's default Accept: */* as a markdown request", () => {
    expect(wantsMarkdown('*/*')).toBe(false)
    expect(wantsMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(false)
    expect(wantsMarkdown('text/html')).toBe(false)
    expect(wantsMarkdown(null)).toBe(false)
    expect(wantsMarkdown(undefined)).toBe(false)
    expect(wantsMarkdown('')).toBe(false)
  })

  it('honours q=0 (explicitly not acceptable)', () => {
    expect(wantsMarkdown('text/html, text/markdown;q=0')).toBe(false)
    expect(wantsMarkdown('text/markdown;q=0.0')).toBe(false)
  })
})

describe('isAssetPath', () => {
  it('detects build assets and public files', () => {
    expect(isAssetPath('/_next/static/chunks/main-abc.js')).toBe(true)
    expect(isAssetPath('/logo.png')).toBe(true)
    expect(isAssetPath('/llms.txt')).toBe(true)
    expect(isAssetPath('/sitemap.xml')).toBe(true)
    expect(isAssetPath('/robots.txt')).toBe(true)
    expect(isAssetPath('/landing/photos/hero-ram.jpg')).toBe(true)
  })

  it('leaves document routes alone', () => {
    expect(isAssetPath('/')).toBe(false)
    expect(isAssetPath('/about')).toBe(false)
    expect(isAssetPath('/privacy')).toBe(false)
    expect(isAssetPath('/some/unknown/page')).toBe(false)
    expect(isAssetPath('/__ora-404-probe-iyxtzc0r')).toBe(false)
  })
})

describe('HOMEPAGE_MARKDOWN', () => {
  it('is non-empty Markdown starting with an H1 and linking discovery files', () => {
    expect(HOMEPAGE_MARKDOWN.trim().length).toBeGreaterThan(20)
    expect(HOMEPAGE_MARKDOWN.startsWith('# ')).toBe(true)
    expect(HOMEPAGE_MARKDOWN).toContain('CBN Coop')
    expect(HOMEPAGE_MARKDOWN).toContain('](https://sales.cbncoopng.com/llms.txt)')
    expect(HOMEPAGE_MARKDOWN).toContain('](https://sales.cbncoopng.com/sitemap.xml)')
  })
})

describe('notFoundMarkdown', () => {
  it('is at least 20 characters and links to llms.txt/sitemap', () => {
    const body = notFoundMarkdown('/does-not-exist')
    expect(body.length).toBeGreaterThanOrEqual(20)
    expect(body).toContain('/does-not-exist')
    expect(body).toContain('404')
    expect(body).toMatch(/\]\(https:\/\/sales\.cbncoopng\.com\/(llms\.txt|sitemap\.xml)\)/)
    expect(body.startsWith('# ')).toBe(true)
  })
})

describe('markdownResponse', () => {
  it('sets Content-Type: text/markdown and Vary: Accept with the body', async () => {
    const res = markdownResponse('hello markdown', 200)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/markdown')
    expect(res.headers.get('Vary')).toBe('Accept')
    await expect(res.text()).resolves.toBe('hello markdown')
  })

  it('supports 404 responses', () => {
    const res = markdownResponse(notFoundMarkdown('/x'), 404)
    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toBe('text/markdown')
    expect(res.headers.get('Vary')).toBe('Accept')
  })

  it('omits the body for HEAD requests (null body)', async () => {
    const res = markdownResponse(null, 200)
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('')
  })
})

describe('SITE_URL', () => {
  it('defaults to the production origin without a trailing slash', () => {
    expect(SITE_URL).toBe('https://sales.cbncoopng.com')
  })
})
