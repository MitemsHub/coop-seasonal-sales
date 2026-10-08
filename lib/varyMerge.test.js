// lib/varyMerge.test.js — guards the Vary union patch installed by
// instrumentation.js (keeps `Vary: Accept` alive through Next's page-level
// header replay).

import { describe, it, expect, beforeAll } from 'vitest'
import { ServerResponse } from 'node:http'
import { unionVary, installVaryMerge } from './varyMerge.js'

describe('unionVary', () => {
  it('unions string values preserving order', () => {
    expect(unionVary('Accept', 'rsc, next-router-state-tree')).toBe(
      'Accept, rsc, next-router-state-tree'
    )
  })

  it('unions array values and dedupes case-insensitively', () => {
    expect(unionVary(['Accept', 'rsc'], 'rsc, Accept-Encoding')).toBe(
      'Accept, rsc, Accept-Encoding'
    )
  })

  it('tolerates empty, null and whitespace-padded segments', () => {
    expect(unionVary('', '  Accept ')).toBe('Accept')
    expect(unionVary(null, undefined)).toBe('')
    expect(unionVary('Accept,', ', ,rsc')).toBe('Accept, rsc')
  })
})

describe('installVaryMerge', () => {
  beforeAll(() => {
    installVaryMerge()
  })

  it('unions repeated setHeader calls instead of replacing (the Next replay case)', () => {
    const res = new ServerResponse({ method: 'GET' })
    // 1. middleware resHeaders apply
    res.setHeader('Vary', 'Accept')
    // 2. Next's appendHeader path
    res.setHeader('Vary', ['Accept', 'rsc, next-router-state-tree'])
    // 3. build-time header replay from the compiled page bundle
    res.setHeader('vary', 'rsc, next-router-state-tree')
    // 4. compression appends its own token
    res.setHeader('Vary', 'rsc, next-router-state-tree, Accept-Encoding')

    expect(res.getHeader('Vary')).toBe(
      'Accept, rsc, next-router-state-tree, Accept-Encoding'
    )
  })

  it('keeps non-Vary headers untouched', () => {
    const res = new ServerResponse({ method: 'GET' })
    res.setHeader('X-Test', 'one')
    res.setHeader('X-Test', 'two')
    expect(res.getHeader('X-Test')).toBe('two')
  })

  it('sets Vary normally when no previous value exists', () => {
    const res = new ServerResponse({ method: 'GET' })
    res.setHeader('vary', 'rsc, next-router-state-tree')
    expect(res.getHeader('vary')).toBe('rsc, next-router-state-tree')
  })
})
