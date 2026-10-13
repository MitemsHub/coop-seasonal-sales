'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'
import ImageUpload from './ImageUpload'
import ItemImagePicker from './ItemImagePicker'
import Button from './ui/Button'

export default function ItemManagement({ cycleId, cycles, reloadToken }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState(null)
  const [showImageUpload, setShowImageUpload] = useState(false)
  const [message, setMessage] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  // Large screens (xl+) show 5-6 cards per row, so 10 per page fills two clean
  // rows instead of the old fixed 8; smaller screens stay at 8.
  const [itemsPerPage, setItemsPerPage] = useState(8)
  // Bulk image assignment: tick items across pages, pick one bank image,
  // apply it to the whole selection in one PATCH.
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkSelected, setBulkSelected] = useState(() => new Set())
  const [bulkImage, setBulkImage] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const apply = () => setItemsPerPage(mq.matches ? 10 : 8)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // Back to page 1 whenever the page size changes with the viewport.
  useEffect(() => {
    setCurrentPage(1)
  }, [itemsPerPage])

  const activeCycleName = cycles?.find(c => c.id === cycleId)?.name || null
  const activeCycleCode = cycles?.find(c => c.id === cycleId)?.code || null

  useEffect(() => {
    fetchItems()
  }, [cycleId])

  // The page's Add-image panel bumps this after attaching a new photo so the
  // grid shows it without a manual Refresh.
  useEffect(() => {
    if (!reloadToken) return
    fetchItems()
    setRefreshKey((p) => p + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  const fetchItems = async () => {
    try {
      let query = supabase.from('items').select('*').order('name')

      // When a cycle is selected, only show items that have prices in that cycle
      if (cycleId) {
        const { data: priceItems, error: priceErr } = await supabase
          .from('branch_item_prices')
          .select('item_id')
          .eq('cycle_id', cycleId)

        if (!priceErr && priceItems?.length) {
          const itemIds = [...new Set(priceItems.map(p => p.item_id))]
          query = query.in('item_id', itemIds)
        } else if (!priceErr && priceItems?.length === 0) {
          // No prices for this cycle yet — show all items so images can be managed
          // (prices may not be imported yet but images should still be settable)
        }
      }

      const { data, error } = await query
      if (error) throw error
      setItems(data || [])
    } catch (error) {
      console.error('Error fetching items:', error)
      setMessage({ type: 'error', text: 'Failed to load items' })
    } finally {
      setLoading(false)
    }
  }

  const withVersion = (url) => {
    if (!url) return url
    return url.includes('v=') ? url : (url.includes('?') ? `${url}&v=${Date.now()}` : `${url}?v=${Date.now()}`)
  }

  /* ── Bulk image assignment ──────────────────────────────────────── */
  const toggleBulkItem = (id) =>
    setBulkSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectCurrentPage = (pageItems) =>
    setBulkSelected((prev) => {
      const next = new Set(prev)
      for (const it of pageItems) next.add(it.item_id)
      return next
    })

  const exitBulk = () => {
    setBulkMode(false)
    setBulkSelected(new Set())
    setBulkImage('')
  }

  const applyBulkImage = async () => {
    if (bulkBusy || !bulkImage || bulkSelected.size === 0) return
    setBulkBusy(true)
    try {
      const res = await fetch('/api/admin/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ item_ids: [...bulkSelected], image_url: withVersion(bulkImage) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Bulk assign failed')
      await fetchItems()
      setRefreshKey((p) => p + 1)
      setBulkSelected(new Set())
      const skipped = json.requested - json.updated
      setMessage({
        type: 'success',
        text: `Image assigned to ${json.updated} item${json.updated === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} unchanged)` : ''}`,
      })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Bulk assign failed' })
    } finally {
      setBulkBusy(false)
    }
  }

  const updateItemImage = async (itemId, imageUrl) => {
    try {
      const versionedUrl = withVersion(imageUrl)
      const { error } = await supabase
        .from('items')
        .update({ image_url: versionedUrl })
        .eq('item_id', itemId)

      if (error) throw error

      // Refresh data from database to ensure consistency
      await fetchItems()
      
      // Force component refresh
      setRefreshKey(prev => prev + 1)

      setMessage({ type: 'success', text: 'Image updated successfully' })
      setShowImageUpload(false)
      setSelectedItem(null)
    } catch (error) {
      console.error('Error updating item image:', error)
      setMessage({ type: 'error', text: 'Failed to update image' })
    }
  }

  const handleImageUploaded = (imageUrl) => {
    if (selectedItem) {
      // Optimistically update local UI for instant feedback
      const versionedUrl = withVersion(imageUrl)
      setItems(prev => prev.map(it => (it.item_id === selectedItem.item_id ? { ...it, image_url: versionedUrl } : it)))
      setRefreshKey(prev => prev + 1)
      // Persist change to the database
      updateItemImage(selectedItem.item_id, versionedUrl)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    )
  }

  // Pagination logic
  const totalPages = Math.ceil(items.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentItems = items.slice(startIndex, endIndex)

  const goToPage = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }

  const getPageItems = (total, current) => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    const points = new Set([1, total, current - 1, current, current + 1])
    const nums = Array.from(points).filter(n => n >= 1 && n <= total).sort((a, b) => a - b)
    const out = []
    let prev = null
    for (const n of nums) {
      if (prev != null && n - prev > 1) out.push('…')
      out.push(n)
      prev = n
    }
    return out
  }

  const pageItems = getPageItems(totalPages, currentPage)

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-h2 font-semibold text-fg">Item Image Management</h2>
          {activeCycleName && (
            <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-info-bg border border-info-border text-xs text-info-fg">
              <span className="font-medium">{activeCycleName}</span>
              {activeCycleCode && <span className="text-info-fg/60">({activeCycleCode})</span>}
              <span className="text-info-fg/60">•</span>
              <span>Items with prices in this cycle</span>
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
          <Button
            variant={bulkMode ? 'brand' : 'secondary'}
            size="sm"
            onClick={() => (bulkMode ? exitBulk() : setBulkMode(true))}
          >
            {bulkMode ? 'Exit bulk mode' : 'Bulk assign'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              fetchItems()
              setRefreshKey(prev => prev + 1)
              setMessage({ type: 'success', text: 'Data refreshed' })
            }}
          >
            Refresh
          </Button>
          <div className="text-xs sm:text-sm text-muted whitespace-normal break-words min-w-0">
            {items.length} items total • Page {currentPage} of {totalPages} • Showing {currentItems.length} items
          </div>
        </div>
      </div>

      {/* Bulk assign bar — pick one bank image, tick items, apply to all */}
      {bulkMode && (
        <div className="rounded-lg border border-brand/40 bg-subtle/50 p-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <ItemImagePicker
              value={bulkImage}
              onChange={setBulkImage}
              label="Image to assign (search the bank)"
            />
            <div className="flex flex-col justify-end gap-2">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => selectCurrentPage(currentItems)}
                  className="font-semibold text-brand underline"
                >
                  Select this page ({currentItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => setBulkSelected(new Set())}
                  disabled={bulkSelected.size === 0}
                  className="font-semibold text-muted underline disabled:opacity-50"
                >
                  Clear selection
                </button>
                <span className="text-muted">{bulkSelected.size} selected</span>
              </div>
              <Button
                onClick={applyBulkImage}
                loading={bulkBusy}
                disabled={bulkBusy || !bulkImage || bulkSelected.size === 0}
              >
                {bulkBusy
                  ? 'Assigning…'
                  : `Assign image to ${bulkSelected.size} item${bulkSelected.size === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
          <p className="text-caption text-muted">
            Tick the items below (your selection persists across pages), choose the bank image on the left, then
            apply — every selected item starts showing it right away, in every branch and cycle.
          </p>
        </div>
      )}

      {message && (
        <div className={`p-3 rounded-lg text-sm ${
          message.type === 'success' 
            ? 'bg-success-bg text-success-fg border border-success-border' 
            : 'bg-danger-bg text-danger-fg border border-danger-border'
        }`}>
          {message.text}
        </div>
      )}

      {/* Items Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
        {currentItems.map(item => (
          <div key={item.item_id} className="bg-surface border border-line-subtle rounded-lg p-3 hover:shadow-md transition-shadow overflow-hidden">
            {/* Bulk selection */}
            {bulkMode && (
              <label className="mb-2 flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-fg">
                <input
                  type="checkbox"
                  checked={bulkSelected.has(item.item_id)}
                  onChange={() => toggleBulkItem(item.item_id)}
                  aria-label={`Select ${item.name} for bulk image assignment`}
                  className="h-4 w-4 rounded border-line"
                />
                {bulkSelected.has(item.item_id) ? 'Selected' : 'Select for bulk assign'}
              </label>
            )}
            {/* Item Image */}
            <div className="mb-3">
              <div className="relative w-full h-28 bg-muted rounded-lg overflow-hidden">
                {item.image_url ? (
                  <Image
                    key={refreshKey}
                    src={item.image_url}
                    alt={item.name}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 25vw, (max-width: 1536px) 20vw, 16vw"
                    loading="lazy"
                    unoptimized
                    className="object-contain"
                  />
                ) : (
                  <Image
                    src="/images/items/placeholder.svg"
                    alt="No image"
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 25vw, (max-width: 1536px) 20vw, 16vw"
                    loading="lazy"
                    unoptimized
                    className="object-contain opacity-50"
                  />
                )}
              </div>
            </div>

            {/* Item Info */}
            <div className="space-y-2">
              <h3 className="font-medium text-fg text-sm leading-tight">
                {item.name}
              </h3>
              <div className="text-xs text-subtext">
                SKU: {item.sku}
              </div>
              <div className="text-xs text-subtext">
                {item.unit} • {item.category}
              </div>
              
              {/* Upload Button (single-item mode only — bulk mode uses the bar above) */}
              {!bulkMode && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => {
                    setSelectedItem(item)
                    setShowImageUpload(true)
                  }}
                >
                  {item.image_url ? 'Change Image' : 'Add Image'}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="px-3 py-2 bg-subtle hover:bg-muted border border-line-subtle text-fg disabled:bg-subtle disabled:border-transparent disabled:text-subtext rounded-lg transition-colors text-sm font-medium"
          >
            Previous
          </button>
          
          <div className="flex flex-wrap items-center justify-center gap-1">
            {pageItems.map((page, idx) =>
              page === '…' ? (
                <span key={`ellipsis-${idx}`} className="px-2 py-2 text-sm text-subtext select-none">
                  …
                </span>
              ) : (
                <button
                  key={page}
                  onClick={() => goToPage(page)}
                  aria-current={currentPage === page ? 'page' : undefined}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    currentPage === page
                      ? 'bg-brand text-on-accent'
                      : 'bg-subtle hover:bg-muted border border-line-subtle text-fg'
                  }`}
                >
                  {page}
                </button>
              )
            )}
          </div>
          
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="px-3 py-2 bg-subtle hover:bg-muted border border-line-subtle text-fg disabled:bg-subtle disabled:border-transparent disabled:text-subtext rounded-lg transition-colors text-sm font-medium"
          >
            Next
          </button>
        </div>
      )}

      {items.length === 0 && (
        <div className="text-center py-8">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-subtext">No items found</p>
        </div>
      )}

      {/* Image Upload Modal */}
      {showImageUpload && selectedItem && (
        <div className="fixed inset-0 bg-transparent flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[15px] font-semibold">
                Upload Image for {selectedItem.name}
              </h3>
              <button
                onClick={() => {
                  setShowImageUpload(false)
                  setSelectedItem(null)
                }}
                className="text-gray-400 hover:text-muted"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="mb-4">
              <div className="text-sm text-muted mb-2">
                SKU: {selectedItem.sku}
              </div>
            </div>

            <ImageUpload
              onImageUploaded={handleImageUploaded}
              currentImageUrl={selectedItem.image_url}
              itemSku={selectedItem.sku}
            />
          </div>
        </div>
      )}
    </div>
  )
}
