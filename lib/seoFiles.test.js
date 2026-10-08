// lib/seoFiles.test.js — validates the machine-readable files in /public that
// the is-agentic audit checks: sitemap.xml (item 6), llms.txt with when-to-use
// guidance (item 5) and robots.txt (supporting file).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SITE_URL } from './siteMetadata.js'

// Vitest runs from the project root (vitest.config.mjs lives there).
const readPublic = (name) => readFileSync(join(process.cwd(), 'public', name), 'utf8')

describe('public/sitemap.xml', () => {
  const xml = readPublic('sitemap.xml')

  it('is well-formed XML using the sitemap protocol namespace', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.documentElement.tagName).toBe('urlset')
    expect(doc.documentElement.namespaceURI).toBe('http://www.sitemaps.org/schemas/sitemap/0.9')
  })

  it('lists the public indexable URLs with lastmod dates', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const urls = [...doc.querySelectorAll('url')]
    expect(urls.length).toBeGreaterThanOrEqual(5)

    const locs = urls.map((u) => u.querySelector('loc').textContent)
    for (const loc of locs) {
      expect(loc.startsWith(`${SITE_URL}/`)).toBe(true)
    }
    // Trust pages must be discoverable.
    expect(locs).toContain(`${SITE_URL}/about`)
    expect(locs).toContain(`${SITE_URL}/contact`)
    expect(locs).toContain(`${SITE_URL}/privacy`)

    for (const u of urls) {
      const lastmod = u.querySelector('lastmod')?.textContent
      expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('stays far below the 50MB limit', () => {
    expect(Buffer.byteLength(xml, 'utf8')).toBeLessThan(50 * 1024 * 1024)
  })
})

describe('public/llms.txt', () => {
  const txt = readPublic('llms.txt')

  it("follows the llmstxt.org shape: one H1 and a blockquote summary", () => {
    expect(txt).toMatch(/^# .+/)
    expect(txt).toMatch(/^> .+/m)
    expect((txt.match(/^# /gm) || []).length).toBe(1)
  })

  it('has a when-to-use section with concrete best-fit jobs', () => {
    expect(txt.toLowerCase()).toContain('when to use')
    // Best-fit use cases named as guidance, not generic marketing copy.
    expect(txt).toContain('Member portal')
    expect(txt).toContain('Food cycle survey')
    expect(txt.toLowerCase()).toContain('do not use')
  })

  it('links the discovery files and contact channels', () => {
    expect(txt).toContain('](https://sales.cbncoopng.com/sitemap.xml)')
    expect(txt).toContain('](https://sales.cbncoopng.com/about)')
    expect(txt).toContain('customerservice@cbncoopng.com')
  })
})

describe('public/robots.txt', () => {
  const txt = readPublic('robots.txt')

  it('points at the sitemap and shields private surfaces', () => {
    expect(txt).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`)
    expect(txt).toContain('User-agent: *')
    expect(txt).toContain('Disallow: /admin/')
    expect(txt).toContain('Disallow: /api/')
  })
})
