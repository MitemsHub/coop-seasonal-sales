// lib/exhibitionShelf.test.js
// The shelf engine decides every exhibition product's shelf, so its fallback
// chain is pinned here: a stand's declaration wins, then the business name, then
// what the stand's other products already landed on. These three are what stop
// a stand with an unhelpful name from emptying into "Other goods".
import { describe, expect, it } from 'vitest'
import {
  categorizeShelf,
  shelfSummaryForVendor,
  suggestShelfKey,
  vendorShelfLabels,
} from './exhibitionShelf'

const shelfOf = (product, vendor) => {
  const { keyOf } = categorizeShelf([product], [vendor])
  return keyOf.get(product.id)
}

const product = (id, vendorId, name, extra = {}) => ({
  id,
  vendor_id: vendorId,
  name,
  category_name: '',
  description: '',
  ...extra,
})

describe('shelf engine fallbacks', () => {
  it('uses the stand declaration before the product name', () => {
    // KHASAM declares Fashion, so its "Turkey gown" stays fashion even though
    // "turkey" is a meat keyword. This is the regression that put gowns in Meat.
    const vendor = { id: 1, name: 'KHASAM EXCLUSIVE' }
    expect(shelfOf(product(1, 1, 'Agiba corporate Turkey gown'), vendor)).toBe('fashion')
    expect(vendorShelfLabels(vendor)).toContain('Fashion & Fabric')
  })

  it('reads the business name for a stand with no declaration', () => {
    // No entry in the written profiles: the sign is all there is.
    expect(shelfOf(product(1, 1, 'Item 12'), { id: 1, name: 'ZARA BOUTIQUE' })).toBe('fashion')
    expect(shelfOf(product(2, 2, 'Pack of 12'), { id: 2, name: 'PRIME SOLAR HUB' })).toBe('solar')
  })

  it('inherits a shelf from the stand’s other products', () => {
    // "OG WINNERS" declares nothing and reads as nothing. One product names a
    // phone; the silent one follows it instead of falling into Other goods.
    const vendor = { id: 7, name: 'OG WINNERS' }
    const products = [product(1, 7, 'iPhone 13 Pro 256GB'), product(2, 7, 'Item 12')]
    const { keyOf, shelves } = categorizeShelf(products, [vendor])
    expect(keyOf.get(1)).toBe(keyOf.get(2))
    expect(keyOf.get(2)).toBe('electronics')
    expect(shelves.some((s) => s.key === 'other')).toBe(false)
  })

  it('lets a category picked on the listing beat the declaration', () => {
    // The vendor/admin form writes the shelf name into the product's category.
    const vendor = { id: 1, name: 'KHASAM EXCLUSIVE' }
    const tagged = product(1, 1, 'Agiba corporate Turkey gown', { category_name: 'Hair & Wigs' })
    expect(shelfOf(tagged, vendor)).toBe('hair')
  })

  it('keeps turkey in Meat when nothing declares otherwise', () => {
    const vendor = { id: 9, name: 'BLESSED SEA FOOD AND FROZEN FOOD ENTERPRISE' }
    expect(shelfOf(product(1, 9, 'Turkey 306'), vendor)).toBe('protein')
    expect(shelfOf(product(2, 9, 'Turkey Full'), vendor)).toBe('protein')
  })
})

describe('stand shelf summary', () => {
  it('orders labels by how many products land on each', () => {
    // SPATO declares Fashion and Jewellery, but most of the stand is wigs, so
    // the card must lead with Hair & Wigs rather than the declaration.
    const vendor = { id: 3, name: "SPATO INTERNATIONAL VENTURES LIMITED/YINWA'HAIR" }
    const products = [
      product(1, 3, '10inches sdd (Raw closure fringe wig)'),
      product(2, 3, '14inches bone straight wig'),
      product(3, 3, 'Ready-to-wear gown'),
      product(4, 3, 'Beaded necklace set'),
    ]
    const summary = shelfSummaryForVendor(vendor, products)
    expect(summary[0].key).toBe('hair')
    expect(summary[0].count).toBe(2)
    expect(summary.map((s) => s.label).slice(0, 3)).toContain('Hair & Wigs')
  })

  it('falls back to the declaration for a stand with no products yet', () => {
    const summary = shelfSummaryForVendor({ id: 1, name: 'KHASAM EXCLUSIVE' }, [])
    expect(summary[0].label).toBe('Fashion & Fabric')
  })
})

describe('suggestShelfKey', () => {
  it('suggests the shelf the name points at for the picker', () => {
    expect(suggestShelfKey({ name: '10inches sdd (Raw closure fringe wig)' })).toBe('hair')
    expect(suggestShelfKey({ name: 'Turkey Full' })).toBe('protein')
    expect(suggestShelfKey({ name: 'Solar inverter 3.5kVA' })).toBe('solar')
  })
})
