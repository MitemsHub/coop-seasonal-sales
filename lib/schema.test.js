// lib/schema.test.js — guards the JSON-LD graph the homepage ships
// (is-agentic items "JSON-LD structured data" + "Organization schema
// completeness": contactPoint with email/phone/contactType and PostalAddress).

import { describe, it, expect } from 'vitest'
import { structuredData, organization, webSite, softwareApplication } from './schema.js'
import { SITE_URL } from './siteMetadata.js'

describe('structuredData', () => {
  it('serializes to valid JSON with a schema.org context', () => {
    expect(() => JSON.stringify(structuredData)).not.toThrow()
    const parsed = JSON.parse(JSON.stringify(structuredData))
    expect(parsed['@context']).toBe('https://schema.org')
    expect(Array.isArray(parsed['@graph'])).toBe(true)
    expect(parsed['@graph']).toHaveLength(3)
  })

  it('gives every entity name, description and url', () => {
    for (const entity of [organization, webSite, softwareApplication]) {
      expect(entity.name).toBeTruthy()
      expect(entity.description).toBeTruthy()
      expect(entity.url).toBe(`${SITE_URL}/`)
    }
  })
})

describe('organization', () => {
  it('is an Organization with the required identity fields', () => {
    expect(organization['@type']).toBe('Organization')
    expect(organization.name).toBe('CBN Coop')
    expect(organization.logo.url).toBe(`${SITE_URL}/logo.png`)
  })

  it('has a contactPoint with email, phone and contactType', () => {
    expect(Array.isArray(organization.contactPoint)).toBe(true)
    const [primary] = organization.contactPoint
    expect(primary['@type']).toBe('ContactPoint')
    expect(primary.email).toBe('customerservice@cbncoopng.com')
    expect(primary.telephone).toMatch(/^\+234\d{10}$/)
    expect(primary.contactType).toBeTruthy()
  })

  it('has a PostalAddress', () => {
    expect(organization.address['@type']).toBe('PostalAddress')
    expect(organization.address.addressCountry).toBe('NG')
  })
})

describe('softwareApplication', () => {
  it('declares category, platform and an offer', () => {
    expect(softwareApplication['@type']).toBe('SoftwareApplication')
    expect(softwareApplication.applicationCategory).toBeTruthy()
    expect(softwareApplication.operatingSystem).toBeTruthy()
    expect(softwareApplication.offers['@type']).toBe('Offer')
    expect(softwareApplication.offers.priceCurrency).toBe('NGN')
  })
})

describe('cross-references', () => {
  it('wires publisher/@id references to the organization', () => {
    expect(organization['@id']).toBe(`${SITE_URL}/#organization`)
    expect(webSite.publisher['@id']).toBe(organization['@id'])
    expect(softwareApplication.publisher['@id']).toBe(organization['@id'])
  })
})
