// lib/siteMetadata.test.js — guards the head metadata signals the is-agentic
// audit checks (canonical resolution base, og:type, og:image, brand title).

import { describe, it, expect } from 'vitest'
import { siteMetadata, SITE_URL } from './siteMetadata.js'

describe('siteMetadata', () => {
  it('sets metadataBase to the production origin', () => {
    expect(siteMetadata.metadataBase).toBeInstanceOf(URL)
    expect(siteMetadata.metadataBase.toString()).toBe(`${SITE_URL}/`)
  })

  it('has a brand + product title and a description', () => {
    expect(siteMetadata.title).toContain('CBN Coop')
    expect(siteMetadata.title.toLowerCase()).toContain('seasonal sales')
    expect(siteMetadata.description.length).toBeGreaterThan(30)
  })

  it('declares og:type website with og:title/og:description/og:image', () => {
    expect(siteMetadata.openGraph.type).toBe('website')
    expect(siteMetadata.openGraph.title).toBeTruthy()
    expect(siteMetadata.openGraph.description).toBeTruthy()
    expect(siteMetadata.openGraph.images?.[0]?.url).toBeTruthy()
    expect(siteMetadata.openGraph.images?.[0]?.url).toContain('logo.png')
  })

  it('keeps the twitter card and icons', () => {
    expect(siteMetadata.twitter.card).toBe('summary')
    expect(siteMetadata.icons.icon).toContain('logo.png')
  })
})
