'use client'

// app/components/ExhibitionFilterBar.jsx
// The shop's sticky discovery bar: search with thumbnails, intelligent shelf
// pills, and the refinements that belong to a marketplace (in stock, on offer,
// price range, sort).
//
// It is deliberately one bar rather than the old row of controls above the
// grid: on a long shelf the member can re-filter from wherever they have
// scrolled to, the way a marketplace app behaves. `filters` is the object from
// useExhibitionFilters — this component only renders it, so the shop and the
// full catalog behave identically.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Baby, Beef, BookOpen, Carrot, Check, Coffee, Cookie, Droplets, Flower2, Hammer, HeartPulse,
  Package, Percent, Search, Shirt, ShoppingBasket, SlidersHorizontal, Smartphone, Sparkles,
  SprayCan, Sprout, Tags, Wheat, X,
} from 'lucide-react'
import { EXHIBITION_SORTS } from '../hooks/useExhibitionFilters'

const PLACEHOLDER = '/images/items/placeholder.svg'
const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

// Icon names come from lib/exhibitionShelf.js as strings so that file stays
// free of JSX; this is the only place they are resolved.
const SHELF_ICON = {
  Wheat, Carrot, Beef, Droplets, Coffee, Cookie, ShoppingBasket, SprayCan, Flower2, Shirt,
  Smartphone, Baby, HeartPulse, Sprout, BookOpen, Hammer, Package, Tags,
}

function Pill({ active, onClick, icon: Icon, label, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-chips font-semibold transition-all duration-200 ease-sakani active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        active
          ? 'border-brand bg-brand text-on-accent shadow-sm'
          : 'border-line bg-surface text-muted hover:-translate-y-0.5 hover:border-line-strong hover:text-fg hover:shadow-sm',
      ].join(' ')}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.1} aria-hidden="true" /> : null}
      <span className="max-w-[9.5rem] truncate">{label}</span>
      <span className={['tabular-nums', active ? 'opacity-80' : 'opacity-60'].join(' ')}>{count}</span>
    </button>
  )
}

function Toggle({ checked, onChange, icon: Icon, children }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-chips font-semibold transition-all duration-200 ease-sakani',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        checked
          ? 'border-brand bg-brand text-on-accent shadow-sm'
          : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
      ].join(' ')}
    >
      {checked ? (
        <Check className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden="true" />
      ) : (
        <Icon className="h-3.5 w-3.5" strokeWidth={2.1} aria-hidden="true" />
      )}
      {children}
    </button>
  )
}

export default function ExhibitionFilterBar({ filters, className = '' }) {
  const {
    search, setSearch, q, suggestions,
    shelf, setShelf, shelves,
    stockOnly, setStockOnly, offerOnly, setOfferOnly,
    minPrice, setMinPrice, maxPrice, setMaxPrice, priceBounds,
    activeCount, reset,
    sort, setSort,
  } = filters

  const [open, setOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrapRef = useRef(null)

  const showSuggestions = listOpen && q.length >= 2 && suggestions.length > 0

  // Close the suggestion list on any click outside the search box.
  useEffect(() => {
    if (!listOpen) return undefined
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setListOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [listOpen])

  const pick = (p) => {
    setSearch(p.name)
    setListOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e) => {
    if (!showSuggestions) {
      if (e.key === 'Escape' && search) setSearch('')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(suggestions[active])
    } else if (e.key === 'Escape') {
      setListOpen(false)
      setActive(-1)
    }
  }

  const total = shelves.reduce((s, x) => s + x.count, 0)

  return (
    <div
      className={[
        'sticky top-12 z-20 border-b border-line/70 bg-canvas/95 pb-2 pt-2 backdrop-blur-md lg:top-14',
        className,
      ].join(' ')}
      // Full-bleed the bar out of the page gutter so nothing scrolls past its
      // edges while it is pinned.
      style={{
        marginLeft: 'calc(var(--sp-fluid) * -1)',
        marginRight: 'calc(var(--sp-fluid) * -1)',
        paddingLeft: 'var(--sp-fluid)',
        paddingRight: 'var(--sp-fluid)',
      }}
    >
      {/* Search · sort · filters */}
      <div className="flex items-center gap-1.5">
        <div ref={wrapRef} className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setListOpen(true)
              setActive(-1)
            }}
            onFocus={() => setListOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search this market…"
            aria-label="Search this market"
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls="shop-suggestions"
            aria-autocomplete="list"
            autoComplete="off"
            className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-8 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
          />
          {!!search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition-colors hover:bg-subtle hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          <AnimatePresence>
            {showSuggestions && (
              <motion.div
                id="shop-suggestions"
                role="listbox"
                aria-label="Product suggestions"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
              >
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Suggestions
                </p>
                <ul className="max-h-72 overflow-y-auto overscroll-contain pb-1">
                  {suggestions.map((s, i) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => pick(s)}
                        className={[
                          'flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors',
                          i === active ? 'bg-subtle' : 'hover:bg-subtle/70',
                        ].join(' ')}
                      >
                        <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-line-subtle bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={s.image_url || PLACEHOLDER}
                            alt=""
                            className="h-full w-full object-contain"
                            onError={(e) => { e.currentTarget.src = PLACEHOLDER }}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-fg">{s.name}</span>
                          {!!s.vendor_name && (
                            <span className="block truncate text-[11px] text-muted">{s.vendor_name}</span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs font-bold tabular-nums text-brand">{naira(s.price)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setListOpen(false)}
                  className="w-full border-t border-line-subtle bg-subtle/40 px-3 py-2 text-left text-[11px] font-semibold text-brand transition-colors hover:bg-subtle"
                >
                  See all results for “{search.trim()}”
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <label htmlFor="shop-sort" className="sr-only">Sort products</label>
        <select
          id="shop-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="h-10 w-[6.75rem] shrink-0 rounded-xl border border-line bg-surface px-1.5 text-[11px] font-semibold text-fg focus:border-brand focus:outline-none sm:w-auto sm:px-2 sm:text-xs"
        >
          {EXHIBITION_SORTS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="shop-filter-panel"
          className={[
            'relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-chips font-semibold transition-colors duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
            open || activeCount > 0
              ? 'border-brand bg-brand-subtle text-brand-fg'
              : 'border-line bg-surface text-fg hover:bg-subtle',
          ].join(' ')}
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-accent">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {/* Intelligent shelf pills — every product belongs to exactly one. */}
      {shelves.length > 0 && (
        <div className="scrollbar-hide -mx-1 mt-2 flex snap-x gap-1.5 overflow-x-auto overscroll-x-contain px-1 pb-0.5">
          <Pill active={!shelf} onClick={() => setShelf(null)} label="All" count={total} />
          {shelves.map((s) => {
            const Icon = SHELF_ICON[s.icon]
            return (
              <Pill
                key={s.key}
                active={shelf === s.key}
                onClick={() => setShelf(shelf === s.key ? null : s.key)}
                icon={Icon}
                label={s.label}
                count={s.count}
              />
            )
          })}
        </div>
      )}

      {/* Refinements */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="shop-filter-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2.5 rounded-xl border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Toggle checked={stockOnly} onChange={setStockOnly} icon={Package}>In stock only</Toggle>
                <Toggle checked={offerOnly} onChange={setOfferOnly} icon={Percent}>On offer only</Toggle>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Price</span>
                <input
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  placeholder={`${naira(priceBounds.min)}`}
                  aria-label="Minimum price"
                  className="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-xs tabular-nums text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
                />
                <span className="text-muted">–</span>
                <input
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  placeholder={`${naira(priceBounds.max)}`}
                  aria-label="Maximum price"
                  className="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-xs tabular-nums text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
                />
                {activeCount > 0 && (
                  <button
                    type="button"
                    onClick={reset}
                    className="ml-auto text-[11px] font-semibold text-brand transition-colors hover:text-brand-hover"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
