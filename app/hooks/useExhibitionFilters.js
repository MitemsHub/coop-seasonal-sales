'use client'

// app/hooks/useExhibitionFilters.js
// One filter model for every exhibition shopping surface.
//
// The shop and the full catalog used to carry their own search + category
// state, which drifted: one sorted, the other did not; one hid categories with
// no products, the other showed them. This hook owns the whole shelf query —
// text, shelf, stock, offers, price and sort — so the sticky filter bar and
// both grids always agree, and a new filter only has to be added once.
import { useCallback, useMemo, useState } from 'react'
import { categorizeShelf, vendorShelfLabels } from '@/lib/exhibitionShelf'
import { vendorDeclared } from '@/lib/exhibitionVendorCategories'

export const LOW_STOCK = 5

export const EXHIBITION_SORTS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'discount', label: 'Biggest discount' },
  { value: 'name', label: 'Name A–Z' },
]

const priceOf = (p) => Number(p?.price ?? p?.final_price ?? 0) || 0
const inStock = (p) => p?.qty === null || p?.qty === undefined || Number(p.qty) > 0
const clean = (s) => String(s || '').toLowerCase()

export default function useExhibitionFilters(products = [], vendors = []) {
  const [search, setSearch] = useState('')
  const [shelf, setShelf] = useState(null)
  const [stockOnly, setStockOnly] = useState(false)
  const [offerOnly, setOfferOnly] = useState(false)
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [sort, setSort] = useState('recommended')

  // Vendor declarations feed the shelves: a fashion stand's products are
  // fashion however they are named, which is what stops "Turkey gown" landing
  // in the meat shelf.
  const { keyOf, shelves } = useMemo(() => categorizeShelf(products, vendors), [products, vendors])

  // What a stand sells, in words a member would type: its name, its declared
  // category, its hall and address. One search now finds both stands and goods.
  const vendorHay = useMemo(() => {
    const map = new Map()
    for (const v of vendors) {
      map.set(
        Number(v.id),
        clean([
          v.name,
          vendorDeclared(v.name) || v.category || '',
          vendorShelfLabels(v).join(' '),
          v.hall,
          v.address,
        ].join(' '))
      )
    }
    return map
  }, [vendors])

  const priceBounds = useMemo(() => {
    if (!products.length) return { min: 0, max: 0 }
    let min = Infinity
    let max = 0
    for (const p of products) {
      const v = priceOf(p)
      if (v > 0 && v < min) min = v
      if (v > max) max = v
    }
    return { min: Number.isFinite(min) ? Math.floor(min) : 0, max: Math.ceil(max) }
  }, [products])

  const q = search.trim().toLowerCase()
  const floor = minPrice === '' ? 0 : Math.max(0, Number(minPrice) || 0)
  const ceiling = maxPrice === '' || Number(maxPrice) <= 0 ? Infinity : Number(maxPrice)

  const filtered = useMemo(() => {
    const list = products.filter((p) => {
      if (shelf && keyOf.get(p.id) !== shelf) return false
      if (stockOnly && !inStock(p)) return false
      if (offerOnly && !(Number(p.discount_pct) > 0)) return false
      const price = priceOf(p)
      if (price < floor || price > ceiling) return false
      if (q) {
        const hay = `${clean(p.name)} ${clean(p.vendor_name)} ${clean(p.category_name)} ${vendorHay.get(Number(p.vendor_id)) || ''}`
        if (!hay.includes(q)) return false
      }
      return true
    })
    if (sort === 'price-asc') return [...list].sort((a, b) => priceOf(a) - priceOf(b))
    if (sort === 'price-desc') return [...list].sort((a, b) => priceOf(b) - priceOf(a))
    if (sort === 'discount') return [...list].sort((a, b) => Number(b.discount_pct || 0) - Number(a.discount_pct || 0))
    if (sort === 'name') return [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    return list
  }, [products, keyOf, shelf, stockOnly, offerOnly, floor, ceiling, q, sort, vendorHay])

  // Searching should find a stand, not only a product: the search box suggests
  // matching stands first, so a member can type a vendor's name and go straight
  // to their stand. Product thumbnails follow, as before.
  const standSuggestions = useMemo(() => {
    if (q.length < 2) return []
    return vendors.filter((v) => (vendorHay.get(Number(v.id)) || '').includes(q)).slice(0, 3)
  }, [vendors, vendorHay, q])

  const suggestions = useMemo(() => {
    if (q.length < 2) return []
    const nameHits = []
    const otherHits = []
    for (const p of products) {
      const name = clean(p.name)
      if (name.includes(q)) nameHits.push(p)
      else if (
        clean(p.vendor_name).includes(q) ||
        (vendorHay.get(Number(p.vendor_id)) || '').includes(q)
      ) otherHits.push(p)
      if (nameHits.length >= 6) break
    }
    return [...nameHits, ...otherHits].slice(0, 6)
  }, [products, q, vendorHay])

  const priceFilters = minPrice !== '' || (maxPrice !== '' && Number(maxPrice) > 0)
  const activeCount =
    (shelf ? 1 : 0) + (stockOnly ? 1 : 0) + (offerOnly ? 1 : 0) + (priceFilters ? 1 : 0)

  const reset = useCallback(() => {
    setShelf(null)
    setStockOnly(false)
    setOfferOnly(false)
    setMinPrice('')
    setMaxPrice('')
  }, [])

  // Changing anything restarts the shelf from the top (the page resets its
  // "show more" window on this string instead of on seven separate values).
  const signature = `${search}|${shelf}|${stockOnly}|${offerOnly}|${minPrice}|${maxPrice}|${sort}`

  const activeShelf = shelves.find((s) => s.key === shelf) || null

  return {
    // text
    search,
    setSearch,
    q,
    suggestions,
    standSuggestions,
    // shelf
    shelf,
    setShelf,
    shelves,
    activeShelf,
    // refinements
    stockOnly,
    setStockOnly,
    offerOnly,
    setOfferOnly,
    minPrice,
    setMinPrice,
    maxPrice,
    setMaxPrice,
    priceBounds,
    activeCount,
    reset,
    // result
    sort,
    setSort,
    filtered,
    isFiltering: !!q || activeCount > 0,
    signature,
  }
}
