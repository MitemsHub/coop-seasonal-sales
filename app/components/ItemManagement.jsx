'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'
import ImageUpload from './ImageUpload'
import Button from './ui/Button'
import Input from './ui/Input'
import ConfirmDialog from './ui/ConfirmDialog'
import { Trash2, RotateCcw } from 'lucide-react'

export default function ItemManagement({ reloadToken }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState(null)
  const [showImageUpload, setShowImageUpload] = useState(false)
  const [message, setMessage] = useState(null)
  const [editingItem, setEditingItem] = useState(null) // { item_id, field: 'name'|'sku', value }
  const [editMessage, setEditMessage] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(8)
  // Deleted (retired) items — collapsed panel listing is_active=false rows
  // with restore actions. Load on demand: the icon in the header hides the
  // fetch until the admin asks for it.
  const [showDeleted, setShowDeleted] = useState(false)
  const [deletedItems, setDeletedItems] = useState([])
  const [deletedLoaded, setDeletedLoaded] = useState(false)
  const [deletedLoading, setDeletedLoading] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null) // item card being removed
  const [deleting, setDeleting] = useState(false)
  const [restoringId, setRestoringId] = useState(null)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const apply = () => setItemsPerPage(mq.matches ? 10 : 8)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [itemsPerPage])

  useEffect(() => {
    fetchItems()
  }, [])

  // ── Deleted (retired) items panel ───────────────────────────────────
  // Retire = items.is_active=false (keeps order history intact, hides the
  // item from the shop and every picker). Restore flips the flag back.
  // Hard-delete is offered ONLY for items never priced in any branch —
  // the server refuses the rest with 409 so order history can't break.
  const loadDeleted = async () => {
    setDeletedLoading(true)
    try {
      const { data, error } = await supabase
        .from('items')
        .select('item_id, sku, name, category, image_url, is_active')
        .eq('is_active', false)
        .order('name')
      if (error) throw error
      setDeletedItems(data || [])
      setDeletedLoaded(true)
    } catch (e) {
      console.error('Error fetching deleted items:', e)
      setMessage({ type: 'error', text: e?.message || 'Failed to load deleted items' })
    } finally {
      setDeletedLoading(false)
    }
  }

  const toggleDeleted = () => {
    const next = !showDeleted
    setShowDeleted(next)
    if (next && !deletedLoaded) loadDeleted()
  }

  const restoreItem = async (item) => {
    setRestoringId(item.item_id)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/items?item_id=${item.item_id}&mode=restore`, { method: 'DELETE', credentials: 'same-origin' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not restore the item')
      setDeletedItems((prev) => prev.filter((it) => it.item_id !== item.item_id))
      await fetchItems()
      setMessage({ type: 'success', text: `“${item.name}” is restored — it shows in the bank and can be priced for a cycle again.` })
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setRestoringId(null)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/items?item_id=${pendingDelete.item_id}`, { method: 'DELETE', credentials: 'same-origin' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not cancel the item')
      // The card leaves the active list immediately; if the deleted panel
      // is open its list refreshes too.
      setItems((prev) => prev.filter((it) => it.item_id !== pendingDelete.item_id))
      if (deletedLoaded) loadDeleted()
      setMessage({ type: 'success', text: `“${pendingDelete.name}” cancelled — find it under Deleted items to bring it back.` })
      setPendingDelete(null)
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setDeleting(false)
    }
  }
  useEffect(() => {
    if (!reloadToken) return
    fetchItems()
    setRefreshKey((p) => p + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  const fetchItems = async () => {
    try {
      // Only active catalogue items belong on the authority cards —
      // cancelled items live in the Deleted-items panel below.
      const { data, error } = await supabase.from('items').select('*').eq('is_active', true).order('name')
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
    return url.includes('v=') ? url : url.includes('?') ? `${url}&v=${Date.now()}` : `${url}?v=${Date.now()}`
  }

  const updateItemImage = async (itemId, imageUrl) => {
    try {
      const versionedUrl = withVersion(imageUrl)
      const { error } = await supabase.from('items').update({ image_url: versionedUrl }).eq('item_id', itemId)

      if (error) throw error

      await fetchItems()
      setRefreshKey((prev) => prev + 1)
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
      const versionedUrl = withVersion(imageUrl)
      setItems((prev) =>
        prev.map((it) => (it.item_id === selectedItem.item_id ? { ...it, image_url: versionedUrl } : it))
      )
      setRefreshKey((prev) => prev + 1)
      updateItemImage(selectedItem.item_id, versionedUrl)
    }
  }

  const startEdit = (item, field) => {
    if (!item) return
    // sku/name/category/unit are all inline-editable on the card. The value
    // handed to the editor mirrors what saveFieldEdit will persist.
    const currentValue =
      field === 'sku' ? item.sku ?? '' : field === 'category' ? item.category ?? '' : field === 'unit' ? item.unit ?? '' : item.name ?? ''
    setEditingItem({ item_id: item.item_id, field, value: currentValue })
    setEditMessage(null)
  }

  const cancelEdit = () => {
    setEditingItem(null)
    setEditMessage(null)
  }

  const saveFieldEdit = async ({ item_id, field, value }) => {
    setEditMessage(null)
    const trimmed = String(value ?? '').trim()
    // category/unit may be cleared on purpose (the server allows an empty
    // string so an admin can strip a wrong label and redo it); name/sku
    // must stay non-empty because the card has nothing to display without
    // them.
    const canBeEmpty = field === 'category' || field === 'unit'
    if (!item_id || !field || (!trimmed && !canBeEmpty)) {
      if (!canBeEmpty) {
        setEditMessage({ type: 'error', text: 'Nothing to save.' })
        setEditingItem(null)
      } else if (!item_id || !field) {
        setEditMessage({ type: 'error', text: 'Nothing to save.' })
        setEditingItem(null)
      }
      return
    }

    let normalized = trimmed
    if (field === 'sku') {
      const candidate = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (!candidate) {
        setEditMessage({ type: 'error', text: 'SKU must contain at least one letter or number.' })
        return
      }
      if (candidate.length > 100) {
        setEditMessage({ type: 'error', text: 'SKU is too long.' })
        return
      }
      normalized = candidate
    }
    if (field === 'name' && normalized.length > 255) {
      setEditMessage({ type: 'error', text: 'Item name is too long.' })
      return
    }
    if (field === 'category' && normalized.length > 100) {
      setEditMessage({ type: 'error', text: 'Category is too long.' })
      return
    }
    if (field === 'unit' && normalized.length > 50) {
      setEditMessage({ type: 'error', text: 'Unit is too long.' })
      return
    }

    try {
      const res = await fetch('/api/admin/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ item_ids: [item_id], [field]: normalized }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not save the change')

      setItems((prev) =>
        prev.map((it) =>
          it.item_id === item_id
            ? { ...it, [field]: field === 'sku' ? normalized : normalized }
            : it
        )
      )
      setEditMessage({
        type: 'success',
        text: normalized
          ? `“${normalized}” saved for ${
              field === 'name'
                ? 'the name'
                : field === 'sku'
                  ? 'the SKU'
                  : field === 'category'
                    ? 'the category'
                    : 'the unit'
            }.`
          : `The ${field} was cleared.`,
      })
      setEditingItem(null)
    } catch (error) {
      console.error('Error saving item field:', error)
      setEditMessage({ type: 'error', text: error.message || 'Failed to save the change' })
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentItems = items.slice(startIndex, endIndex)

  const goToPage = (page) => setCurrentPage(Math.max(1, Math.min(page, totalPages)))

  const pageNumbers = (() => {
    const total = totalPages
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    const current = currentPage
    const nums = new Set([1, total, current - 1, current, current + 1].filter((n) => n >= 1 && n <= total))
    const ordered = Array.from(nums).sort((a, b) => a - b)
    const out = []
    let prev = null
    for (const n of ordered) {
      if (prev != null && n - prev > 1) out.push('…')
      out.push(n)
      prev = n
    }
    return out
  })()

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden p-3 sm:p-6">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleDeleted}
            aria-expanded={showDeleted}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              deletedItems.length
                ? 'border-danger-border bg-danger-bg text-danger-fg'
                : 'border-line-subtle text-muted hover:bg-subtle hover:text-fg'
            }`}
            title="Items you cancelled — restore them here"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            Deleted items{deletedItems.length ? ` (${deletedItems.length})` : ''}
          </button>
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted">
            Stored once per item — used by every branch, cycle and import section.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              fetchItems()
              setRefreshKey((prev) => prev + 1)
              setMessage({ type: 'success', text: 'Data refreshed' })
            }}
          >
            Refresh
          </Button>
          <div className="text-xs sm:text-sm text-muted whitespace-normal break-words min-w-0">
            {items.length} items total · Page {currentPage} of {totalPages} · Showing {currentItems.length} items
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-success-bg text-success-fg border border-success-border'
              : 'bg-danger-bg text-danger-fg border border-danger-border'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
        {currentItems.map((item) => (
          <div
            key={item.item_id}
            className="bg-surface border border-line-subtle rounded-lg p-3 hover:shadow-md transition-shadow overflow-hidden"
          >
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

            <div className="space-y-2">
              <div className="space-y-1">
                {editingItem?.item_id === item.item_id && editingItem.field === 'name' ? (
                  <Input
                    size="sm"
                    value={editingItem.value}
                    onChange={(e) =>
                      setEditingItem((prev) => (prev ? { ...prev, value: e.target.value } : null))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveFieldEdit(editingItem)
                      } else if (e.key === 'Escape') {
                        cancelEdit()
                      }
                    }}
                    className="max-w-full font-medium"
                    autoFocus
                  />
                ) : (
                  <h3 className="font-medium text-fg text-sm leading-tight truncate">{item.name}</h3>
                )}
                {editingItem?.item_id === item.item_id && editingItem.field === 'name' && (
                  <div className="flex gap-1.5">
                    <Button variant="secondary" size="sm" className="flex-1" onClick={() => saveFieldEdit(editingItem)}>
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" className="flex-1" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>

              <div className="text-xs text-subtext">SKU: {item.sku}</div>
              {/* Unit + category are inline-editable: clicking either label
                  opens its editor on this card (same pattern as Edit name /
                  Edit SKU). Suggestions come from the shared datalists the
                  page renders (item-categories / item-units). */}
              <div className="text-xs text-subtext">
                {editingItem?.item_id === item.item_id && editingItem.field === 'unit' ? (
                  <input
                    type="text"
                    value={editingItem.value}
                    onChange={(e) => setEditingItem((prev) => (prev ? { ...prev, value: e.target.value } : null))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveFieldEdit(editingItem)
                      } else if (e.key === 'Escape') {
                        cancelEdit()
                      }
                    }}
                    list="item-units"
                    maxLength={50}
                    className="w-full rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-fg font-mono"
                    autoFocus
                  />
                ) : editingItem?.item_id === item.item_id && editingItem.field === 'category' ? (
                  <input
                    type="text"
                    value={editingItem.value}
                    onChange={(e) => setEditingItem((prev) => (prev ? { ...prev, value: e.target.value } : null))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveFieldEdit(editingItem)
                      } else if (e.key === 'Escape') {
                        cancelEdit()
                      }
                    }}
                    list="item-categories"
                    maxLength={100}
                    className="w-full rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-fg font-mono"
                    autoFocus
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => startEdit(item, 'unit')}
                      className="underline decoration-dotted underline-offset-2 hover:text-fg cursor-pointer"
                      title="Edit unit"
                    >
                      {item.unit || '—'}
                    </button>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => startEdit(item, 'category')}
                      className="underline decoration-dotted underline-offset-2 hover:text-fg cursor-pointer"
                      title="Edit category"
                    >
                      {item.category || '—'}
                    </button>
                  </>
                )}
              </div>

              <div className="mt-2 flex flex-col gap-2">
                {editingItem?.item_id === item.item_id && editingItem.field === 'sku' ? (
                  <Input
                    size="sm"
                    value={editingItem.value}
                    onChange={(e) =>
                      setEditingItem((prev) => (prev ? { ...prev, value: e.target.value.toUpperCase() } : null))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveFieldEdit(editingItem)
                      } else if (e.key === 'Escape') {
                        cancelEdit()
                      }
                    }}
                    className="max-w-full font-mono text-sm"
                    autoFocus
                  />
                ) : (
                  <div />
                )}
                {editingItem?.item_id === item.item_id && editingItem.field === 'sku' && (
                  <div className="flex gap-1.5">
                    <Button variant="secondary" size="sm" className="flex-1" onClick={() => saveFieldEdit(editingItem)}>
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" className="flex-1" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                )}

                {!editingItem && (
                  <div className="flex gap-1.5">
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => startEdit(item, 'name')}>
                      Edit name
                    </Button>
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => startEdit(item, 'sku')}>
                      Edit SKU
                    </Button>
                  </div>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full mt-1"
                  onClick={() => {
                    setSelectedItem(item)
                    setShowImageUpload(true)
                  }}
                >
                  {item.image_url ? 'Change Image' : 'Add Image'}
                </Button>

                <button
                  type="button"
                  onClick={() => setPendingDelete(item)}
                  className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-line-subtle px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:border-danger-border hover:bg-danger-bg hover:text-danger-fg"
                  title="Cancel this item — it leaves the bank and every shop; restorable under Deleted items"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  Cancel item
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editMessage && (
        <div
          className={`p-3 rounded-lg text-sm ${
            editMessage.type === 'success'
              ? 'bg-success-bg text-success-fg border border-success-border'
              : 'bg-danger-bg text-danger-fg border border-danger-border'
          }`}
        >
          {editMessage.text}
        </div>
      )}

      {/* Deleted (cancelled) items — restore them back into circulation */}
      {showDeleted && (
        <div className="rounded-lg border border-line bg-subtle/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-fg">
              Cancelled items{deletedItems.length ? ` — ${deletedItems.length}` : ''}
            </p>
            <Button variant="ghost" size="sm" onClick={toggleDeleted}>
              Hide
            </Button>
          </div>
          {deletedLoading ? (
            <div className="space-y-2 pt-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="sakani-skeleton h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : deletedItems.length === 0 ? (
            <p className="pt-2 text-sm text-muted">Nothing cancelled yet — every item in the bank is live.</p>
          ) : (
            <ul className="divide-y divide-line">
              {deletedItems.map((it) => (
                <li key={it.item_id} className="flex items-center gap-3 py-2">
                  <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-line bg-canvas">
                    {it.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.image_url} alt={it.name} className="h-full w-full object-contain" loading="lazy" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{it.name}</span>
                    <span className="block truncate text-caption text-muted">{it.sku}</span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={RotateCcw}
                    loading={restoringId === it.item_id}
                    onClick={() => restoreItem(it)}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Cancel this item?"
        message={`“${pendingDelete?.name}” leaves the bank, the shop and every picker immediately. Nothing is deleted outright — order history is kept, the Survey entry stays with a Cancelled badge, and you can restore from Deleted items at any time.`}
        confirmLabel="Cancel item"
      />

      {items.length === 0 && (
        <div className="text-center py-8">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
          <p className="text-subtext">No items found</p>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
          <button
            type="button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="px-3 py-2 bg-subtle hover:bg-muted border border-line-subtle text-fg disabled:bg-subtle disabled:border-transparent disabled:text-subtext rounded-lg transition-colors text-sm font-medium"
          >
            Previous
          </button>
          <div className="flex flex-wrap items-center justify-center gap-1">
            {pageNumbers.map((page, idx) =>
              page === '…' ? (
                <span key={`ellipsis-${idx}`} className="px-2 py-2 text-sm text-subtext select-none">
                  …
                </span>
              ) : (
                <button
                  key={page}
                  type="button"
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
            type="button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="px-3 py-2 bg-subtle hover:bg-muted border border-line-subtle text-fg disabled:bg-subtle disabled:border-transparent disabled:text-subtext rounded-lg transition-colors text-sm font-medium"
          >
            Next
          </button>
        </div>
      )}

      {showImageUpload && selectedItem && (
        <div className="fixed inset-0 bg-transparent flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[15px] font-semibold">Upload Image for {selectedItem.name}</h3>
              <button
                type="button"
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
              <div className="text-sm text-muted mb-2">SKU: {selectedItem.sku}</div>
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
