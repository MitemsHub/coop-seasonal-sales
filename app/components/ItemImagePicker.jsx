'use client'

// app/components/ItemImagePicker.jsx
// Searchable picker over the shared item-image bank (Items Image Mang).
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

  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return bank.slice(0, 40)
    return bank
      .filter((r) => `${r.name || ''} ${r.sku || ''} ${r.category || ''}`.toLowerCase().includes(q))
      .slice(0, 40)
  }, [bank, search])

  const selected = bank.find((r) => String(r.image_url) === String(value || '')) || null

  const pick = (url) => {
    onChange && onChange(url)
    setOpen(false)
    setSearch('')
    setShowUpload(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-xs text-muted mb-1">{label}</label>

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

      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-subtle"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={2.2} />
          {open ? 'Hide bank' : 'Search image bank'}
          <span className="text-[10px] text-muted">({bank.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setShowUpload((v) => !v)}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-subtle"
          title="Upload a new refined image into the bank"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
          Add image
        </button>
        <Link
          href="/admin/food/item-images"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-subtle hover:text-fg"
          title="Open Items Image Mang. in a new context"
        >
          <Images className="h-3.5 w-3.5" strokeWidth={2.2} />
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
                    : `Nothing matches “${search}”.`}
                </p>
                {bank.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('')
                      setShowUpload(true)
                      setOpen(false)
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
                        onClick={() => pick(url)}
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

      {/* Inline upload — feeds the bank directly */}
      {showUpload && (
        <div className="mt-2 rounded-lg border border-line bg-subtle/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-fg">
              Add to the image bank <span className="font-normal text-muted">(uploading as SKU {sku || skuFromName(name)})</span>
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
          <ImageUpload
            itemSku={sku || skuFromName(name)}
            currentImageUrl={value || null}
            onImageUploaded={(url) => {
              if (url) {
                onChange && onChange(url)
                loadBank() // the new file becomes a bank entry once some item references it
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
