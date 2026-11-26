'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Package, Plus, Search, Trash2, Upload } from 'lucide-react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Label from '../../components/ui/Label'
import Badge from '../../components/ui/Badge'
import { thumbSrcSet, thumbUrl } from '../../../lib/imageUrl'
import EmptyState from '../../components/ui/EmptyState'
import Skeleton from '../../components/ui/Skeleton'
import ProductImagesUpload from '../../components/ProductImagesUpload'
import { productImages } from '../../../lib/exhibitionProductImages'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import ProductImportModal from '../../components/ProductImportModal'
import ShelfPicker from '../../components/ShelfPicker'
import usePhotoShelfSuggestion from '../../hooks/usePhotoShelfSuggestion'

const fmtNaira = (n) => `NGN ${Number(n || 0).toLocaleString()}`

// Until the co-op approves a product it is the vendor's own draft and can be
// removed outright. Once approved it may sit on a member's order, so the most
// a vendor can do is archive it.
const isDeletable = (p) => !(p.approval_status === 'approved' && p.status !== 'archived')

const memberPrice = (listPrice, discountPct) =>
  Math.round((Number(listPrice || 0) * (100 - Math.min(90, Math.max(0, Number(discountPct || 0))))) / 100)

const emptyForm = () => ({
  name: '',
  unit: 'each',
  vendor_price: '',
  discount_pct: '0',
  qty: '',
  description: '',
  category_id: '',
  images: [],
})

// Same compact "Actions" control as the admin product desk: a native select,
// so it stays usable on phones and never clips inside the list.
function RowActions({ product, onEdit, onArchive, onRestore, onDelete }) {
  const isArchived = product.status === 'archived'
  // A product the co-op has not approved can simply be deleted. Once it is
  // approved it may already be on an order, so it is archived instead.
  const canDelete = product.approval_status !== 'approved' || isArchived

  return (
    <select
      aria-label={`Actions for ${product.name}`}
      value=""
      onChange={(e) => {
        const action = e.target.value
        if (action === 'edit') onEdit()
        else if (action === 'history') window.location.href = `/vendor/products/${product.id}/history`
        else if (action === 'archive') onArchive()
        else if (action === 'restore') onRestore()
        else if (action === 'delete') onDelete()
      }}
      className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm font-medium text-fg focus:border-brand focus:outline-none"
    >
      <option value="" disabled>Actions</option>
      <option value="edit">Edit</option>
      <option value="history">History</option>
      {isArchived ? <option value="restore">Restore</option> : <option value="archive">Archive</option>}
      {canDelete && <option value="delete">Delete</option>}
    </select>
  )
}

export default function VendorProductsPage() {
  const [products, setProducts] = useState(null) // null = loading
  const [importOpen, setImportOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null) // product being edited or null for create
  const [imageKey, setImageKey] = useState('') // unique storage key for a new draft's photo
  const [form, setForm] = useState(emptyForm())
  const [categories, setCategories] = useState([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [notice, setNotice] = useState(null) // success/warning banner for bulk actions
  const [selected, setSelected] = useState(new Set())
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = useCallback(async () => {
    const qs = new URLSearchParams()
    if (statusFilter !== 'all') qs.set('status', statusFilter)
    if (search.trim()) qs.set('q', search.trim())
    const res = await fetch(`/api/vendor/exhibition/products?${qs.toString()}`, { cache: 'no-store' })
    const json = await res.json()
    if (json.ok) setProducts(json.products)
    else setMsg(json.error || 'Failed to load products')
  }, [search, statusFilter])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // The shelves are read once; the API creates them for the vendor's cycle on
  // first call, so the picker is never an empty select.
  useEffect(() => {
    let alive = true
    fetch('/api/vendor/exhibition/categories', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (alive && json.ok) setCategories(json.categories || [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const openCreate = () => {
    setEditing(null)
    setImageKey(`draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
    setForm(emptyForm())
    resetPhotoShelf()
    setMsg('')
    setModalOpen(true)
  }

  const openEdit = (p) => {
    setEditing(p)
    setForm({
      name: p.name,
      unit: p.unit || 'each',
      vendor_price: String(p.vendor_price ?? ''),
      discount_pct: String(p.discount_pct ?? 0),
      qty: p.qty === null || p.qty === undefined ? '' : String(p.qty),
      description: p.description || '',
      category_id: p.category_id ? String(p.category_id) : '',
      images: productImages(p),
    })
    resetPhotoShelf()
    setMsg('')
    setModalOpen(true)
  }

  // Only what actually changed goes to the server. The form loads the whole
  // product, so resubmitting it made every save look like a price and discount
  // edit (and re-opened approval for photos); the request now carries just the
  // fields the vendor touched.
  const buildPayload = () => {
    const name = form.name.trim()
    const unit = form.unit.trim() || 'each'
    const price = Number(form.vendor_price || 0)
    const discount = Number(form.discount_pct || 0)
    const qty = form.qty === '' ? null : Number(form.qty)
    const description = form.description
    const images = form.images || []

    if (!editing) {
      return {
        name,
        unit,
        vendor_price: price,
        discount_pct: discount,
        qty,
        description,
        category_id: form.category_id ? Number(form.category_id) : null,
        image_url: images[0] || '',
        image_urls: images,
      }
    }

    const previousQty =
      editing.qty === null || editing.qty === undefined ? null : Number(editing.qty)
    const previousImages = productImages(editing)
    const imagesChanged =
      images.length !== previousImages.length || images.some((url, i) => url !== previousImages[i])

    const payload = {}
    if (name !== editing.name) payload.name = name
    if (unit !== (editing.unit || 'each')) payload.unit = unit
    if (price !== Number(editing.vendor_price || 0)) payload.vendor_price = price
    if (discount !== Number(editing.discount_pct || 0)) payload.discount_pct = discount
    if (qty !== previousQty) payload.qty = qty
    if (description !== (editing.description || '')) payload.description = description
    if (String(form.category_id || '') !== String(editing.category_id || '')) {
      payload.category_id = form.category_id ? Number(form.category_id) : null
    }
    if (imagesChanged) {
      payload.image_url = images[0] || ''
      payload.image_urls = images
    }
    return payload
  }

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const payload = buildPayload()
      // Nothing was touched — close instead of asking the server to save an
      // empty edit.
      if (editing && Object.keys(payload).length === 0) {
        setModalOpen(false)
        return
      }
      const res = await fetch(
        editing ? `/api/vendor/exhibition/products/${editing.id}` : '/api/vendor/exhibition/products',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save')
      setModalOpen(false)
      load()
    } catch (e) {
      setMsg(e.message || 'Failed to save product')
    } finally {
      setSaving(false)
    }
  }

  // A photo can suggest a shelf when the name cannot, but only as a default:
  // the vendor still confirms it before the listing is saved.
  const { suggestion: photoShelf, reset: resetPhotoShelf } = usePhotoShelfSuggestion({
    enabled: modalOpen && !editing,
    name: form.name,
    imageUrl: (form.images || [])[0] || '',
    categories,
    categoryId: form.category_id,
    onSuggestion: (_suggestion, categoryId) =>
      setForm((f) => (f.category_id ? f : { ...f, category_id: categoryId })),
  })

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null) // { type: 'archive'|'delete', product: p }

  const archive = async (p) => {
    const res = await fetch(`/api/vendor/exhibition/products/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    })
    const json = await res.json()
    if (json.ok) load()
    else setMsg(json.error || 'Failed to archive')
  }

  const remove = async (p) => {
    const res = await fetch(`/api/vendor/exhibition/products/${p.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.ok) load()
    else setMsg(json.error || 'Failed to delete')
  }

  const restore = async (p) => {
    // Approved products can go straight back on sale; a draft returns to draft.
    const res = await fetch(`/api/vendor/exhibition/products/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: p.approval_status === 'approved' ? 'active' : 'draft' }),
    })
    const json = await res.json()
    if (json.ok) load()
    else setMsg(json.error || 'Failed to restore')
  }

  const handleConfirm = () => {
    if (!confirmAction) return
    if (confirmAction.type === 'archive') archive(confirmAction.product)
    else if (confirmAction.type === 'delete') remove(confirmAction.product)
    setConfirmOpen(false)
    setConfirmAction(null)
  }

  const formDiscount = Math.min(90, Math.max(0, Number(form.discount_pct || 0)))
  const formMemberPrice = memberPrice(form.vendor_price, formDiscount)

  const filtered = useMemo(() => {
    if (!products) return []
    let list = products
    if (statusFilter !== 'all') list = list.filter((p) => p.status === statusFilter)
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
    }
    return list
  }, [products, search, statusFilter])

  // Bulk removal works on the filtered view, so "select all" clears every
  // unapproved product the vendor is looking at — not just the current page.
  const deletableFiltered = useMemo(() => filtered.filter(isDeletable), [filtered])
  const selectedDeletable = useMemo(
    () => deletableFiltered.filter((p) => selected.has(p.id)),
    [deletableFiltered, selected]
  )
  const allDeletableSelected = deletableFiltered.length > 0 && selectedDeletable.length === deletableFiltered.length

  // A refresh or filter change can drop rows; a stale id would make a bulk
  // delete report on products that are no longer there.
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size || !products) return prev
      const live = new Set(products.filter(isDeletable).map((p) => p.id))
      const next = new Set([...prev].filter((id) => live.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [products])

  const toggleSelected = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleSelectAll = () =>
    setSelected(() => (allDeletableSelected ? new Set() : new Set(deletableFiltered.map((p) => p.id))))

  const deleteSelected = async () => {
    const ids = selectedDeletable.map((p) => p.id)
    if (!ids.length || bulkBusy) return
    setBulkBusy(true)
    setBulkConfirmOpen(false)
    setNotice(null)
    try {
      const res = await fetch('/api/vendor/exhibition/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to delete the selected products')
      const deleted = Number(json.deleted?.length || 0)
      const skipped = json.skipped || []
      setSelected(new Set())
      if (skipped.length) {
        const detail = skipped.slice(0, 3).map((s) => `${s.name || `#${s.id}`} — ${s.reason}`).join('; ')
        setNotice({
          type: 'error',
          text: `${deleted} product(s) deleted. ${skipped.length} kept: ${detail}${skipped.length > 3 ? `, and ${skipped.length - 3} more` : ''}.`,
        })
      } else {
        setNotice({ type: 'success', text: `${deleted} product(s) deleted.` })
      }
      await load()
    } catch (e) {
      setNotice({ type: 'error', text: e.message })
    } finally {
      setBulkBusy(false)
    }
  }

  // Client-side pagination — vendors with hundreds of items get a tidy page
  // instead of one endless list.
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(Math.max(1, page), pageCount)
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  useEffect(() => {
    setPage(1)
  }, [search, statusFilter])
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-h1 font-bold tracking-tight text-fg">Products</h1>
          <p className="mt-1 text-sm text-muted">Add what you are bringing to the exhibition. The co-op reviews each product before it appears in the shop.</p>
        </div>
        <div className="flex shrink-0 flex-nowrap items-center gap-2">
          <Button variant="secondary" leftIcon={Upload} onClick={() => setImportOpen(true)}>
            Import list
          </Button>
          <Button variant="brand" leftIcon={Plus} onClick={openCreate}>
            Add product
          </Button>
        </div>
      </div>

      {!!msg && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{msg}</div>}

      {!!notice && (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'}`}
        >
          {notice.text}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products or SKU…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-44">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      {/* Bulk removal — one decision instead of one dialog per row. Only
          unapproved products can be deleted, so "select all" selects exactly
          those and the approved ones stay tick-disabled. */}
      {filtered.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-subtle/60 px-3 py-2">
          <label className="flex items-center gap-2 text-xs font-medium text-muted">
            <input
              type="checkbox"
              checked={allDeletableSelected}
              onChange={toggleSelectAll}
              ref={(el) => {
                if (el) el.indeterminate = !allDeletableSelected && selectedDeletable.length > 0
              }}
              disabled={!deletableFiltered.length || bulkBusy}
              aria-label="Select all removable products"
              className="h-4 w-4 rounded border-line accent-brand disabled:opacity-40"
            />
            Select all {deletableFiltered.length} removable
          </label>
          <span className="text-chips text-muted">Approved products can only be archived.</span>
          {selectedDeletable.length > 0 && (
            <>
              <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger-fg">
                {selectedDeletable.length} selected
              </span>
              <Button size="sm" variant="danger" leftIcon={Trash2} onClick={() => setBulkConfirmOpen(true)} loading={bulkBusy}>
                Delete selected
              </Button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs font-medium text-brand underline-offset-2 hover:underline"
              >
                Clear selection
              </button>
            </>
          )}
        </div>
      )}

      {!products ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title={products.length === 0 ? 'No products yet' : 'No matches'}
          description={products.length === 0 ? 'Add your first product to start selling at the exhibition.' : 'Try a different search or filter.'}
        >
          {products.length === 0 && (
            <Button variant="brand" leftIcon={Plus} onClick={openCreate}>
              Add product
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="rounded-2xl border border-line bg-surface">
          <div className="divide-y divide-line">
            {paged.map((p) => (
              <div key={p.id} className={`flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-center ${selected.has(p.id) ? 'bg-danger-bg/20' : ''}`}>
                <div className="flex items-center gap-3 sm:shrink-0">
                  <label
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line-subtle bg-subtle/60"
                    title={isDeletable(p) ? 'Select this product' : 'Approved products can only be archived, not deleted'}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelected(p.id)}
                      disabled={!isDeletable(p) || bulkBusy}
                      aria-label={`Select ${p.name}`}
                      className="h-4 w-4 rounded border-line accent-brand disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </label>
                  {productImages(p)[0] ? (
                    <img src={thumbUrl(productImages(p)[0], 160)} srcSet={thumbSrcSet(productImages(p)[0], 160)} alt={p.name} className="h-14 w-14 shrink-0 rounded-xl border border-line-subtle bg-subtle object-contain" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-subtle text-muted">
                      <Package className="h-6 w-6" strokeWidth={1.5} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words text-sm font-semibold text-fg">{p.name}</p>
                    <span className="text-chips text-muted">{p.sku}</span>
                    <Badge tone={p.status === 'active' ? 'success' : p.status === 'draft' ? 'warning' : 'muted'}>
                      {p.status}
                    </Badge>
                    {p.approval_status === 'pending' && (
                      <Badge tone="warning" variant="subtle">Pending approval</Badge>
                    )}
                    {p.approval_status === 'rejected' && (
                      <Badge tone="danger" variant="subtle">Rejected</Badge>
                    )}
                  </div>
                  {p.approval_note && (
                    <p className="mt-1 rounded-lg border border-danger-border bg-danger-bg/40 px-2 py-1 text-chips text-danger-fg">
                      Admin note: {p.approval_note}
                    </p>
                  )}
                  {!!p.description && (
                    <p className="mt-0.5 line-clamp-2 break-words text-chips text-muted">{p.description}</p>
                  )}
                  <p className="mt-0.5 text-chips text-muted">
                    {p.unit || 'each'} · {p.qty === null ? 'Unlimited qty' : `${p.qty} in stock`}
                  </p>
                </div>
                <div className="flex items-center gap-4 sm:shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-fg">{fmtNaira(p.vendor_price)}</p>
                    <p className="text-chips text-muted">
                      {p.approval_status === 'approved' ? 'listed price' : 'your price'}
                    </p>
                    {Number(p.discount_pct || 0) > 0 && (
                      <p className="text-chips font-medium text-danger-fg">
                        −{p.discount_pct}% · members pay {fmtNaira(memberPrice(p.vendor_price, p.discount_pct))}
                      </p>
                    )}
                    {p.pending_discount_pct != null && (
                      <p className="text-chips font-medium text-warning-fg">Awaiting approval: −{p.pending_discount_pct}%</p>
                    )}
                  </div>
                  <RowActions
                    product={p}
                    onEdit={() => openEdit(p)}
                    onArchive={() => { setConfirmAction({ type: 'archive', product: p }); setConfirmOpen(true) }}
                    onRestore={() => restore(p)}
                    onDelete={() => { setConfirmAction({ type: 'delete', product: p }); setConfirmOpen(true) }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Pagination — vendors with many items get pages instead of one endless list */}
          {filtered.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted">
                Showing <span className="font-medium text-fg">{(safePage - 1) * pageSize + 1}</span>–
                <span className="font-medium text-fg">{Math.min(safePage * pageSize, filtered.length)}</span> of{' '}
                <span className="font-medium text-fg">{filtered.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
                  }}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg"
                >
                  {[10, 25, 50, 100].map((s) => (
                    <option key={s} value={s}>{s} per page</option>
                  ))}
                </select>
                <Button variant="secondary" size="sm" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>
                  Prev
                </Button>
                <span className="text-sm text-muted">
                  Page <span className="font-medium text-fg">{safePage}</span> / {pageCount}
                </span>
                <Button variant="secondary" size="sm" onClick={() => setPage(Math.min(pageCount, safePage + 1))} disabled={safePage >= pageCount}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add product'}
        description={editing ? 'Update your product details below.' : 'List a new product on your stand.'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="brand" onClick={save} loading={saving}>
              {editing ? 'Save changes' : 'Add product'}
            </Button>
          </>
        }
      >
        {!!msg && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">{msg}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="p-name">Product name</Label>
            <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Handwoven Ankara Tote" />
            <div className="mt-3">
              <ShelfPicker
                id="p-shelf"
                categories={categories}
                name={form.name}
                description={form.description}
                value={form.category_id}
                onChange={(category_id) => setForm((f) => ({ ...f, category_id }))}
                photoNote={
                  photoShelf ? `Suggested from the photo (${photoShelf.label}) — confirm it or pick another shelf.` : ''
                }
              />
            </div>
            <div className="mt-3">
              <Label htmlFor="p-description">Description (optional)</Label>
              <textarea
                id="p-description"
                rows={3}
                maxLength={2000}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What it is, size, material, condition — anything a buyer should know."
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="p-unit">Unit</Label>
            <Input id="p-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="each, pair, bag…" />
          </div>
          <div>
            <Label>SKU</Label>
            <p className="rounded-lg border border-line-subtle bg-subtle px-3 py-2 font-mono text-xs text-muted">
              {editing ? editing.sku : 'Generated automatically'}
            </p>
          </div>
          <div>
            <Label htmlFor="p-price">Price (₦)</Label>
            <Input id="p-price" type="number" min="1" value={form.vendor_price} onChange={(e) => setForm({ ...form, vendor_price: e.target.value })} placeholder="0" />
          </div>
          <div>
            <Label htmlFor="p-discount">Discount (%)</Label>
            <Input
              id="p-discount"
              type="number"
              min="0"
              max="90"
              value={form.discount_pct}
              onChange={(e) => setForm({ ...form, discount_pct: e.target.value })}
              placeholder="0"
            />
            <p className="mt-1 text-chips text-muted">
              {formDiscount > 0 && Number(form.vendor_price) > 0
                ? `Members pay ${fmtNaira(formMemberPrice)} instead of ${fmtNaira(form.vendor_price)} — that is the price on their invoice.`
                : 'Optional. Leave 0 for no discount. Maximum 90%.'}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="rounded-lg border border-warning-border bg-warning-bg/60 px-3 py-2 text-chips text-warning-fg">
              New products, and any price or discount change on a product already on sale, are reviewed by the co-op before members see them. The discounted price is what members are charged.
            </p>
          </div>
          <div>
            <Label htmlFor="p-qty">Quantity in stock</Label>
            <Input id="p-qty" type="number" min="0" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="Leave empty for unlimited" />
          </div>
          <div className="sm:col-span-2">
            <Label>Product photos</Label>
            <ProductImagesUpload
              itemSku={editing?.sku || imageKey || 'product'}
              images={form.images}
              onChange={(images) => setForm((f) => ({ ...f, images }))}
            />
            <p className="mt-1 text-chips text-muted">
              The first photo is the cover. Products with more than one photo show a carousel in the shop.
            </p>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={bulkConfirmOpen}
        onClose={() => (bulkBusy ? null : setBulkConfirmOpen(false))}
        onConfirm={deleteSelected}
        loading={bulkBusy}
        title={`Delete ${selectedDeletable.length} product${selectedDeletable.length === 1 ? '' : 's'}?`}
        message={`${selectedDeletable.length} unapproved product(s) will be removed from your list for good. Approved products are kept (archive them instead), and anything already on a member's order is kept and reported back. This cannot be undone.`}
        confirmLabel="Delete selected"
      />

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmAction(null) }}
        onConfirm={handleConfirm}
        title={confirmAction?.type === 'archive' ? 'Archive product?' : 'Delete product?'}
        message={confirmAction?.type === 'archive'
          ? `Archive "${confirmAction?.product?.name}"? It stops appearing in the shop and cannot be sold again, but it stays in your records and on any past orders. Approved products are archived rather than deleted.`
          : `Delete "${confirmAction?.product?.name}"? It is removed from your list for good. This cannot be undone.`}
        confirmLabel={confirmAction?.type === 'archive' ? 'Archive' : 'Delete'}
        variant={confirmAction?.type === 'archive' ? 'secondary' : 'danger'}
      />

      <ProductImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/api/vendor/exhibition/products/import"
        onDone={load}
      />
    </div>
  )
}
