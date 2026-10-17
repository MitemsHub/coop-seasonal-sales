'use client'

// app/components/ItemImagePicker.jsx
// Searchable picker over the shared item-image bank (the Image Bank).
//
// Why this exists: every image lives ONCE on the `items` row and is *linked*
// to from General/Outsourced items, cycles and branches — never re-uploaded.
// The bank grows over time, so the picker is a type-to-filter search box with
// thumbnails instead of a plain <select>, plus an inline "add image" upload so
// a missing refined photo never blocks saving an item.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ImageUpload from './ImageUpload'
import { Check, Images, Plus, Search, X } from 'lucide-react'

const skuFromName = (name) => {
  const base = String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 32)
  return base || `ITEM${Date.now().toString(36).toUpperCase()}`
}

export default function ItemImagePicker({ value, onChange, name = '', sku = '', label = 'Image from bank' }) {
  const [bank, setBank] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  // Inline "new bank item" form: name + SKU + photo, saved as a real item.
  const [upName, setUpName] = useState('')
  const [upSku, setUpSku] = useState('')
  // Once the admin types their own SKU, the live name-derived one stops.
  const [upSkuTouched, setUpSkuTouched] = useState(false)
  const [upUrl, setUpUrl] = useState('')
  const [upBusy, setUpBusy] = useState(false)
  const [upErr, setUpErr] = useState(null)
  const wrapRef = useRef(null)

  const loadBank = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/items?section=images', { cache: 'no-store', credentials: 'same-origin' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load the image bank')
      setBank(json.images || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBank()
  }, [])

  // Click-away closes the dropdown (the picker lives inside dense edit rows,
  // so a backdrop would swallow neighbouring clicks).
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Retired items (is_active=false) come back from the bank endpoint so the
  // Image Bank's Deleted panel can list them, but they are NOT pickable here —
  // picking one would re-link a product the admin deliberately removed and
  // reintroduce "ghost" twins next to its active replacements. They stay
  // visible in the active list's stead only when nothing else matches, so the
  // admin still learns why a familiar name "disappeared".
  const activeBank = useMemo(() => bank.filter((r) => r.is_active !== false), [bank])
  const retiredBank = useMemo(() => bank.filter((r) => r.is_active === false), [bank])
  const matches = (r, q) => `${r.name || ''} ${r.sku || ''} ${r.category || ''}`.toLowerCase().includes(q)
  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) {
      // Default (empty search) list stays active-only: these are the rows the
      // admin should be picking from.
      return activeBank.slice(0, 40)
    }
    const active = activeBank.filter((r) => matches(r, q)).slice(0, 40)
    if (active.length) return active
    // No active match — surface retired rows under the same search so the
    // admin can see they exist (and are retired) rather than think the bank
    // lost the item.
    return retiredBank.filter((r) => matches(r, q)).slice(0, 40)
  }, [activeBank, retiredBank, search])

  const selected = bank.find((r) => String(r.image_url) === String(value || '')) || null

  const pick = (row) => {
    const url = String(row.image_url)
    // Second argument = the full bank row, so the host form can adopt the
    // bank item's name/SKU along with its image (outsourced items reuse the
    // bank identity instead of inventing a new one).
    onChange && onChange(url, row)
    setOpen(false)
    setSearch('')
    setShowUpload(false)
  }

  // Seed the inline form from the item being edited so the admin usually
  // only has to press Save.
  const openUpload = () => {
    setUpName(name || '')
    setUpSku(sku || '')
    // A SKU seeded from the item being edited is the admin's, not the
    // preview's — typing a name must not overwrite it.
    setUpSkuTouched(Boolean(sku))
    setUpUrl('')
    setUpErr(null)
    setOpen(false)
    setShowUpload(true)
  }

  // Save the name/SKU (+ photo) as a real item in the bank, so every branch
  // can use it right away — no price needed yet.
  const saveToBank = async () => {
    const n = upName.trim()
    if (n.length < 2 || upBusy) return
    setUpBusy(true)
    setUpErr(null)
    try {
      const res = await fetch('/api/admin/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ bank_only: true, name: n, sku: upSku.trim(), image_url: upUrl || value || '' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not add to the bank')
      setShowUpload(false)
      loadBank()
    } catch (e) {
      setUpErr(e.message || 'Failed to save to the bank')
    } finally {
      setUpBusy(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-sm text-muted mb-1">{label}</label>

      {/* Current selection */}
      <div className="flex items-center gap-2 rounded-lg border border-line bg-subtle/50 p-2">
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-line bg-canvas">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={selected?.name || 'Selected item'} className="h-full w-full object-contain" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[10px] text-muted">None</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-fg">{selected ? selected.name : value ? 'Custom image' : 'No image selected'}</p>
          <p className="truncate text-[11px] text-muted">
            {selected ? `Bank · ${selected.sku}` : value ? value : 'Pick from the bank below or upload a new one'}
          </p>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange && onChange('')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger-bg hover:text-danger-fg"
            aria-label="Remove image"
            title="Remove image"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-9 min-w-40 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-subtle"
        >
          <Search className="h-4 w-4" strokeWidth={2.2} />
          {open ? 'Hide bank' : 'Search image bank'}
          <span className="text-caption text-muted">({bank.length})</span>
        </button>
        <button
          type="button"
          onClick={() => (showUpload ? setShowUpload(false) : openUpload())}
          className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
            showUpload ? 'border-brand bg-brand text-on-accent' : 'border-line bg-surface text-fg hover:bg-subtle'
          }`}
          title="Add a new item (name + SKU) with its photo to the bank"
        >
          <Plus className="h-4 w-4" strokeWidth={2.2} />
          Add image
        </button>
        <Link
          href="/admin/food/image-bank"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-muted transition-colors hover:bg-subtle hover:text-fg"
          title="Open the Image Bank"
        >
          <Images className="h-4 w-4" strokeWidth={2.2} />
          Bank
        </Link>
      </div>

      {/* Searchable dropdown */}
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-lg border border-line bg-surface shadow-lg">
          <div className="border-b border-line p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtext" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to filter by item name, SKU or category…"
                className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-2 text-xs text-fg"
                aria-label="Search the image bank"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="sakani-skeleton h-10 w-full rounded-md" />
                ))}
              </div>
            ) : error ? (
              <p className="p-2 text-xs text-danger-fg">{error}</p>
            ) : results.length === 0 ? (
              <div className="p-3 text-center">
                <p className="text-xs text-muted">
                  {bank.length === 0
                    ? 'The bank is empty — upload the first image below.'
                    : results.length === 0 && search.trim()
                      ? `Nothing matches “${search}”.`
                      : 'Nothing matches — try another word.'}
                </p>
                {bank.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('')
                      openUpload()
                    }}
                    className="mt-2 text-xs font-semibold text-brand underline"
                  >
                    Add it to the bank instead
                  </button>
                )}
              </div>
            ) : (
              <ul className="space-y-1">
                {results.map((r) => {
                  const url = String(r.image_url)
                  const isSel = String(value || '') === url
                  return (
                    <li key={`${r.item_id}-${url}`}>
                      <button
                        type="button"
                        onClick={() => pick(r)}
                        className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors ${
                          isSel ? 'bg-accent-subtle' : 'hover:bg-subtle'
                        }`}
                      >
                        <span className="h-9 w-9 shrink-0 overflow-hidden rounded border border-line bg-canvas">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={r.name} loading="lazy" className="h-full w-full object-contain" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-fg">{r.name}</span>
                          <span className="block truncate text-[10px] text-muted">
                            {r.sku}
                            {r.category ? ` · ${r.category}` : ''}
                          </span>
                        </span>
                        {r.is_active === false && (
                          <span
                            className="ml-1 shrink-0 rounded-full bg-danger-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-danger-fg"
                            title="This item is retired (deleted). You should not pick it — restore it in the Image Bank if you need it back."
                          >
                            Retired
                          </span>
                        )}
                        {isSel && <Check className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2.5} />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Inline "new bank item" — name + SKU + photo, saved as a real item */}
      {showUpload && (
        <div className="mt-2 rounded-lg border border-line bg-subtle/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-fg">
              Add a new item to the bank{' '}
              <span className="font-normal text-muted">(photo uploads as SKU {upSku || skuFromName(upName)})</span>
            </p>
            <button
              type="button"
              onClick={() => setShowUpload(false)}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-subtle hover:text-fg"
              aria-label="Close upload"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          </div>
          <div className="mb-2 grid gap-2 sm:grid-cols-2">
            <input
              value={upName}
              onChange={(e) => {
                const value = e.target.value
                setUpName(value)
                // The SKU follows the name until edited by hand.
                if (!upSkuTouched) setUpSku(value.trim() ? skuFromName(value) : '')
              }}
              placeholder="Item name (required)"
              aria-label="New bank item name"
              maxLength={255}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext"
            />
            <input
              value={upSku}
              onChange={(e) => {
                setUpSkuTouched(true)
                setUpSku(e.target.value.toUpperCase())
              }}
              placeholder="SKU (auto-generated from the name as you type)"
              aria-label="New bank item SKU"
              maxLength={100}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext"
            />
          </div>
          <ImageUpload
            itemSku={upSku || skuFromName(upName)}
            currentImageUrl={upUrl || value || null}
            onImageUploaded={(url) => {
              if (url) {
                setUpUrl(url)
                onChange && onChange(url)
              }
            }}
          />
          {upErr && <p className="mt-2 text-xs text-danger-fg">{upErr}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveToBank}
              disabled={upBusy || upName.trim().length < 2}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-semibold text-on-accent transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
              {upBusy ? 'Saving…' : 'Save to bank'}
            </button>
            <span className="text-[11px] text-muted">
              Saved once for every branch — price it in Items Import to show it in shops.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
