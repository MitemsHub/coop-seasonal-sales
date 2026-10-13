'use client'

// app/admin/food/item-images/page.jsx
// Food Distribution · Items Management › Image Bank.
// The single image bank for every branch. Images uploaded here live on the
// `items` row (items.image_url → item-images bucket), so branches, the shop
// and the Items Import sections *link* to them instead of re-uploading the
// same photo every cycle. Moved here from the Data page.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedRoute from '../../../components/ProtectedRoute'
import ItemManagement from '../../../components/ItemManagement'
import ImageUpload from '../../../components/ImageUpload'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import Label from '../../../components/ui/Label'
import { supabase } from '@/lib/supabaseClient'
import { Images, Link2, Plus, Search, X } from 'lucide-react'

function ItemImagesPageContent() {
  const router = useRouter()
  const [cycles, setCycles] = useState([])
  const [selectedCycleId, setSelectedCycleId] = useState(null)
  const [loadingCycles, setLoadingCycles] = useState(true)

  /* ── Add-image panel (upload straight into the bank) ──────────── */
  const [showAdd, setShowAdd] = useState(false)
  const [allItems, setAllItems] = useState(null) // null = not loaded yet
  const [loadingItems, setLoadingItems] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [addTarget, setAddTarget] = useState(null)
  const [addMsg, setAddMsg] = useState(null) // { type, text }
  const [reloadToken, setReloadToken] = useState(0) // pings ItemManagement to refetch

  const loadCycles = useCallback(async () => {
    setLoadingCycles(true)
    try {
      const res = await fetch('/api/admin/cycles', { cache: 'no-store', credentials: 'same-origin' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load cycles')
      setCycles(json.cycles || [])
      setSelectedCycleId((prev) => {
        if (prev != null) return prev
        if (json.active_cycle_id != null) return json.active_cycle_id
        return (json.cycles || [])[0]?.id ?? null
      })
    } catch {
      // The bank still works without the cycle filter — ItemManagement
      // falls back to the full list when cycleId is null.
    } finally {
      setLoadingCycles(false)
    }
  }, [])

  useEffect(() => {
    loadCycles()
  }, [loadCycles])

  /* ── Add-image flow ────────────────────────────────────────────── */
  const loadItems = useCallback(async () => {
    setLoadingItems(true)
    try {
      // Every item, with or without an image — the point is to attach the
      // missing ones. Same client-side read ItemManagement uses above.
      const { data, error } = await supabase
        .from('items')
        .select('item_id, sku, name, category, image_url')
        .order('name')
      if (error) throw error
      setAllItems(data || [])
    } catch (e) {
      setAddMsg({ type: 'error', text: e.message || 'Failed to load items' })
    } finally {
      setLoadingItems(false)
    }
  }, [])

  const openAdd = () => {
    const next = !showAdd
    setShowAdd(next)
    setAddMsg(null)
    if (next && allItems == null) loadItems()
  }

  const addResults = useMemo(() => {
    if (!allItems) return []
    const q = addSearch.trim().toLowerCase()
    const list = q
      ? allItems.filter((i) => `${i.name} ${i.sku} ${i.category || ''}`.toLowerCase().includes(q))
      : allItems
    return list.slice(0, 40)
  }, [allItems, addSearch])

  // Upload finished → attach the URL to the chosen item (one PATCH, same
  // endpoint the bulk assign uses), then ping ItemManagement to refetch.
  const onAddUploaded = async (url) => {
    if (!url || !addTarget) return // the preview's × sends null — nothing to attach
    try {
      const res = await fetch('/api/admin/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ item_ids: [addTarget.item_id], image_url: url }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not attach the image to the item')
      setAddMsg({
        type: 'success',
        text: `“${addTarget.name}” now shows the new image in every branch and cycle.`,
      })
      setAllItems((prev) => (prev || []).map((i) => (i.item_id === addTarget.item_id ? { ...i, image_url: url } : i)))
      setAddTarget((t) => (t ? { ...t, image_url: url } : t))
      setReloadToken((v) => v + 1)
    } catch (e) {
      setAddMsg({ type: 'error', text: e.message || 'Upload failed' })
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-2 sm:flex sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 gap-2">
        <div className="col-span-1">
          <h1 className="text-h2 font-semibold tracking-tight text-fg">Admin · Image Bank</h1>
          <p className="mt-1 text-body text-muted">
            The shared image bank. Upload each item&apos;s refined photo once — every branch, the shop and both
            Items Import sections link to these images instead of uploading them again.
          </p>
        </div>
        <div className="col-span-1 flex items-center gap-2 justify-self-end">
          <Button onClick={openAdd} leftIcon={Plus}>
            Add image
          </Button>
          <Button variant="secondary" onClick={() => router.back()}>
            ← Back
          </Button>
        </div>
      </div>

      {/* Add-image panel — pick the item, upload once, it joins the bank */}
      {showAdd && (
        <div className="mb-4 rounded-xl border border-brand/40 bg-subtle/50 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-h3 font-semibold text-fg">➕ Add image to the bank</h2>
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)} leftIcon={X}>
              Close
            </Button>
          </div>
          <p className="mb-3 text-body text-muted">
            Search for the item this photo belongs to, then upload. The image is saved once on that item and reused
            by every branch, cycle and Items Import section.
          </p>

          {addMsg && (
            <p
              className={`mb-3 rounded-lg border px-3 py-2 text-body ${
                addMsg.type === 'success'
                  ? 'border-success-border bg-success-bg text-success-fg'
                  : 'border-danger-border bg-danger-bg text-danger-fg'
              }`}
            >
              {addMsg.text}
            </p>
          )}

          {!addTarget ? (
            <div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" />
                <Input
                  autoFocus
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  placeholder="Search items by name, SKU or category…"
                  aria-label="Search items for the new image"
                  className="pl-9"
                />
              </div>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface">
                {loadingItems ? (
                  <div className="space-y-2 p-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="sakani-skeleton h-10 w-full rounded-md" />
                    ))}
                  </div>
                ) : addResults.length === 0 ? (
                  <p className="p-4 text-center text-body text-muted">
                    {allItems?.length === 0 ? 'No items found.' : `Nothing matches “${addSearch}”.`}
                  </p>
                ) : (
                  <ul>
                    {addResults.map((it) => (
                      <li key={it.item_id}>
                        <button
                          type="button"
                          onClick={() => {
                            setAddTarget(it)
                            setAddSearch('')
                            setAddMsg(null)
                          }}
                          className="flex w-full items-center gap-3 border-b border-line-subtle px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-subtle"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-fg">{it.name}</span>
                            <span className="block truncate text-caption text-muted">
                              {it.sku}
                              {it.category ? ` · ${it.category}` : ''}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-chips font-bold uppercase tracking-wide ${
                              it.image_url ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg'
                            }`}
                          >
                            {it.image_url ? 'Has image' : 'No image'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Selected item</Label>
                <div className="rounded-lg border border-line bg-surface p-3">
                  <p className="text-sm font-semibold text-fg">{addTarget.name}</p>
                  <p className="text-caption text-muted">
                    SKU {addTarget.sku}
                    {addTarget.category ? ` · ${addTarget.category}` : ''}
                  </p>
                  <p className="mt-0.5 text-caption text-muted">
                    {addTarget.image_url
                      ? 'Has an image — uploading replaces it everywhere at once.'
                      : 'No image yet — this one is missing from the bank.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setAddTarget(null)
                      setAddMsg(null)
                    }}
                    className="mt-2 text-caption font-semibold text-brand underline"
                  >
                    Choose a different item
                  </button>
                </div>
              </div>
              <div>
                <Label>Upload photo (JPG, PNG, WebP · max 5MB)</Label>
                <ImageUpload
                  itemSku={addTarget.sku}
                  currentImageUrl={addTarget.image_url || null}
                  onImageUploaded={onAddUploaded}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-surface rounded-xl shadow-lg border border-line-subtle p-4 mb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-h3 font-semibold text-fg mb-1 flex items-center gap-2">
              <Images className="h-4 w-4" strokeWidth={2} /> Item Image Management
            </h2>
            <p className="text-body text-muted">
              Pick a cycle to see the items priced in it — the images themselves are stored once per item and
              reused across every cycle and branch.
            </p>
          </div>
          <div className="sm:w-72">
            <Label htmlFor="image-cycle">Cycle filter</Label>
            <Select
              id="image-cycle"
              value={selectedCycleId ?? ''}
              onChange={(e) => setSelectedCycleId(e.target.value ? Number(e.target.value) : null)}
              disabled={loadingCycles || cycles.length === 0}
            >
              {cycles.length === 0 ? (
                <option value="">{loadingCycles ? 'Loading cycles…' : 'No cycles found — showing all items'}</option>
              ) : (
                cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code}){c.is_active ? ' · Active' : ''}
                  </option>
                ))
              )}
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-info-border bg-info-bg px-3 py-2 text-caption text-info-fg">
          <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          Images chosen in <strong>Items Import</strong> (General / Outsourced Items) come from this bank — add a
          new one here whenever a refined photo is missing.
        </div>

        <div className="mt-4">
          <ItemManagement cycleId={selectedCycleId} cycles={cycles} reloadToken={reloadToken} />
        </div>
      </div>
    </div>
  )
}

export default function ItemImagesPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <ItemImagesPageContent />
    </ProtectedRoute>
  )
}
