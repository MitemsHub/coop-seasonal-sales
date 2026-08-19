'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Package, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Label from '../../components/ui/Label'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import Skeleton from '../../components/ui/Skeleton'
import ImageResizeUpload from '../../components/ImageResizeUpload'

const fmtNaira = (n) => `NGN ${Number(n || 0).toLocaleString()}`

const emptyForm = () => ({
  name: '',
  sku: '',
  unit: 'each',
  category_id: '',
  vendor_price: '',
  admin_markup: '',
  qty: '',
  status: 'active',
  image_url: '',
})

export default function VendorProductsPage() {
  const [products, setProducts] = useState(null) // null = loading
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null) // product being edited or null for create
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

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
    fetch('/api/vendor/exhibition/categories', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => j.ok && setCategories(j.categories))
      .catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setMsg('')
    setModalOpen(true)
  }

  const openEdit = (p) => {
    setEditing(p)
    setForm({
      name: p.name,
      sku: p.sku,
      unit: p.unit || 'each',
      category_id: p.category_id ? String(p.category_id) : '',
      vendor_price: String(p.vendor_price ?? ''),
      admin_markup: p.admin_markup === null || p.admin_markup === undefined ? '' : String(p.admin_markup),
      qty: p.qty === null || p.qty === undefined ? '' : String(p.qty),
      status: p.status || 'active',
      image_url: p.image_url || '',
    })
    setMsg('')
    setModalOpen(true)
  }

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        unit: form.unit.trim() || 'each',
        vendor_price: Number(form.vendor_price || 0),
        admin_markup: Number(form.admin_markup || 0),
        qty: form.qty === '' ? null : Number(form.qty),
        category_id: form.category_id ? Number(form.category_id) : null,
        image_url: form.image_url,
        status: form.status,
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

  const archive = async (p) => {
    if (!window.confirm(`Archive "${p.name}"? It stays on past orders but stops appearing in the shop.`)) return
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
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return
    const res = await fetch(`/api/vendor/exhibition/products/${p.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.ok) load()
    else setMsg(json.error || 'Failed to delete')
  }

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
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-h1 font-bold tracking-tight text-fg">Products</h1>
          <p className="mt-1 text-sm text-muted">Your stand&apos;s catalog. Prices shown are what members pay before any negotiated deal.</p>
        </div>
        <Button variant="brand" leftIcon={Plus} onClick={openCreate}>
          Add product
        </Button>
      </div>

      {!!msg && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{msg}</div>}

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
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="divide-y divide-line">
            {paged.map((p) => (
              <div key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="h-14 w-14 shrink-0 rounded-xl border border-line-subtle object-cover" />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-subtle text-muted">
                    <Package className="h-6 w-6" strokeWidth={1.5} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-fg">{p.name}</p>
                    <span className="text-chips text-muted">{p.sku}</span>
                    <Badge tone={p.status === 'active' ? 'success' : p.status === 'draft' ? 'warning' : 'muted'}>
                      {p.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-chips text-muted">
                    {p.category_name || 'Uncategorised'} · {p.qty === null ? 'Unlimited qty' : `${p.qty} in stock`}
                  </p>
                </div>
                <div className="flex items-center gap-4 sm:shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-fg">{fmtNaira(p.final_price)}</p>
                    {Number(p.admin_markup || 0) !== 0 && (
                      <p className="text-chips text-muted">
                        base {fmtNaira(p.vendor_price)} {Number(p.admin_markup) > 0 ? '+' : ''}{fmtNaira(p.admin_markup)}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <Button variant="ghost" size="sm" leftIcon={Pencil} onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`} />
                    {p.status === 'archived' ? (
                      <Button variant="ghost" size="sm" leftIcon={Trash2} onClick={() => remove(p)} aria-label={`Delete ${p.name}`} />
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => archive(p)} aria-label={`Archive ${p.name}`}>
                        Archive
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination — vendors with many items get pages instead of one endless list */}
          {filtered.length > pageSize && (
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
                  {[10, 25, 50].map((s) => (
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
          </div>
          <div>
            <Label htmlFor="p-sku">SKU</Label>
            <Input id="p-sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} placeholder="e.g. ANK-TOTE-01" disabled={!!editing} />
          </div>
          <div>
            <Label htmlFor="p-unit">Unit</Label>
            <Input id="p-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="each, pair, bag…" />
          </div>
          <div>
            <Label htmlFor="p-price">Price (₦)</Label>
            <Input id="p-price" type="number" min="1" value={form.vendor_price} onChange={(e) => setForm({ ...form, vendor_price: e.target.value })} placeholder="0" />
          </div>
          <div>
            <Label htmlFor="p-markup">Markup (₦)</Label>
            <Input id="p-markup" type="number" min="0" value={form.admin_markup} onChange={(e) => setForm({ ...form, admin_markup: e.target.value })} placeholder="0" />
          </div>
          <div className="sm:col-span-2">
            <p className="rounded-lg bg-subtle px-3 py-2 text-chips text-muted">
              Members pay <span className="font-semibold text-fg">{fmtNaira(Number(form.vendor_price || 0) + Number(form.admin_markup || 0))}</span> — your price plus markup.
            </p>
          </div>
          <div>
            <Label htmlFor="p-qty">Quantity in stock</Label>
            <Input id="p-qty" type="number" min="0" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="Leave empty for unlimited" />
          </div>
          <div>
            <Label htmlFor="p-cat">Category</Label>
            <Select id="p-cat" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="p-status">Status</Label>
            <Select id="p-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Active (visible to members)</option>
              <option value="draft">Draft (hidden)</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Product photo</Label>
            <ImageResizeUpload
              itemSku={form.sku || 'product'}
              currentImageUrl={form.image_url}
              onImageUploaded={(url) => setForm((f) => ({ ...f, image_url: url }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
