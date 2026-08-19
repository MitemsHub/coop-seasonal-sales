'use client'

// app/admin/exhibition/products/page.jsx
// Admin product oversight — every vendor's products across the branch's
// exhibition. Admins can create products on a vendor's behalf, adjust the
// admin markup, quantities, status, and archive (delete is blocked for
// products on orders — archive instead).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, ImageOff, Package, Pencil, Plus, RefreshCw, Search, Store, Trash2 } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Card from '../../../components/ui/Card'
import { Table, THead, TBody, TR, TH, TD } from '../../../components/ui/Table'
import Input from '../../../components/ui/Input'
import Label from '../../../components/ui/Label'
import Select from '../../../components/ui/Select'
import DraggableModal from '../../../components/DraggableModal'
import Skeleton from '../../../components/ui/Skeleton'

const naira = (v) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(
    Number(v || 0)
  )

const STATUS_STYLES = { active: 'success', draft: 'neutral', archived: 'neutral' }

export default function ExhibitionProductsPage() {
  const [products, setProducts] = useState([])
  const [cycles, setCycles] = useState([])
  const [vendors, setVendors] = useState([])
  const [categories, setCategories] = useState([])
  const [cycleFilter, setCycleFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [term, setTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [modal, setModal] = useState(null) // 'create' | product object (edit)
  const [form, setForm] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const params = new URLSearchParams()
      if (cycleFilter) params.set('cycle_id', cycleFilter)
      if (vendorFilter) params.set('vendor_id', vendorFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (term.trim()) params.set('q', term.trim())
      const [p, c, v, cat] = await Promise.all([
        fetch(`/api/admin/exhibition/products?${params}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/admin/exhibition/cycles', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        fetch('/api/admin/exhibition/vendors', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        fetch('/api/exhibition/categories', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ])
      if (p?.ok) setProducts(p.products || [])
      else setMsg({ type: 'error', text: p?.error || 'Failed to load products' })
      if (c?.ok) setCycles(c.cycles || [])
      if (v?.ok) setVendors(v.vendors || [])
      if (cat?.ok) setCategories(cat.categories || [])
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }, [cycleFilter, vendorFilter, statusFilter, term])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleFilter, vendorFilter, statusFilter])

  const openCreate = () => {
    setForm({ status: 'active', unit: 'each', admin_markup: 0 })
    setModal('create')
  }

  const pickVendor = (vendorId) => {
    const v = vendors.find((x) => String(x.id) === String(vendorId))
    setForm((f) => ({
      ...f,
      vendor_id: vendorId,
      branch_id: v?.branch_id ? String(v.branch_id) : f.branch_id || '',
    }))
  }

  const openEdit = (p) => {
    setForm({
      name: p.name || '',
      unit: p.unit || 'each',
      vendor_price: p.vendor_price,
      admin_markup: p.admin_markup ?? 0,
      qty: p.qty ?? '',
      status: p.status || 'active',
      image_url: p.image_url || '',
    })
    setModal(p)
  }

  const saveCreate = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/exhibition/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycle_id: Number(form.cycle_id),
          vendor_id: Number(form.vendor_id),
          branch_id: Number(form.branch_id),
          category_id: form.category_id ? Number(form.category_id) : null,
          name: form.name,
          sku: form.sku,
          unit: form.unit,
          vendor_price: Number(form.vendor_price),
          admin_markup: Number(form.admin_markup || 0),
          qty: form.qty,
          image_url: form.image_url,
          status: form.status,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to create product')
      setModal(null)
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/exhibition/products/${modal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          unit: form.unit,
          vendor_price: Number(form.vendor_price),
          admin_markup: Number(form.admin_markup || 0),
          qty: form.qty,
          status: form.status,
          ...(form.image_url !== undefined ? { image_url: form.image_url } : {}),
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to update product')
      setModal(null)
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (p, status) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/exhibition/products/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to update product')
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const removeProduct = async (p) => {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/exhibition/products/${p.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to delete product')
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const cycleVendors = useMemo(() => {
    if (!cycleFilter) return vendors
    return vendors.filter((v) => String(v.cycle_id) === String(cycleFilter))
  }, [vendors, cycleFilter])

  const totals = useMemo(
    () => ({
      active: products.filter((p) => p.status === 'active').length,
      value: products.reduce((s, p) => s + Number(p.vendor_price || 0) + Number(p.admin_markup || 0), 0),
    }),
    [products]
  )

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition Products</h1>
            <p className="mt-0.5 text-sm text-muted">
              {totals.active} active · {naira(totals.value)} catalog value
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={load} disabled={loading || busy}>
              Refresh
            </Button>
            <Button size="sm" leftIcon={Plus} onClick={openCreate}>
              New Product
            </Button>
          </div>
        </div>

        {msg && (
          <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'}`}>
            {msg.text}
          </div>
        )}

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="Search name or SKU…"
              className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={cycleFilter} onChange={(e) => setCycleFilter(e.target.value)} className="sm:w-56">
              <option value="">All cycles</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </Select>
            <Select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="sm:w-56">
              <option value="">All vendors</option>
              {cycleVendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-40">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
        </div>

        <Card className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-xl bg-subtle px-4 py-10 text-center text-sm text-muted">
              <Store className="mx-auto mb-2 h-8 w-8 text-muted" strokeWidth={1.5} />
              No products match. Create the first product for a vendor.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>Vendor</TH>
                  <TH>Category</TH>
                  <TH className="text-right">Vendor price</TH>
                  <TH className="text-right">Markup</TH>
                  <TH className="text-right">Final</TH>
                  <TH className="text-right">Qty</TH>
                  <TH>Status</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {products.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-subtle text-subtext">
                            <ImageOff className="h-4 w-4" strokeWidth={1.5} />
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-fg">{p.name}</div>
                          <div className="font-mono text-xs text-muted">{p.sku}</div>
                        </div>
                      </div>
                    </TD>
                    <TD className="text-muted">{p.vendor_name || `#${p.vendor_id}`}</TD>
                    <TD className="text-muted">{p.category_name || '—'}</TD>
                    <TD className="text-right tabular-nums">{naira(p.vendor_price)}</TD>
                    <TD className="text-right tabular-nums text-muted">{p.admin_markup ? `+${naira(p.admin_markup)}` : '—'}</TD>
                    <TD className="text-right font-medium tabular-nums text-fg">{naira(p.final_price)}</TD>
                    <TD className="text-right tabular-nums">{p.qty == null ? '∞' : Number(p.qty).toLocaleString()}</TD>
                    <TD>
                      <Badge tone={STATUS_STYLES[p.status] || 'neutral'} variant="subtle">{p.status}</Badge>
                    </TD>
                    <TD>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" leftIcon={Pencil} onClick={() => openEdit(p)} disabled={busy}>
                          Edit
                        </Button>
                        {p.status !== 'archived' ? (
                          <Button size="sm" variant="warning" leftIcon={Archive} onClick={() => setStatus(p, 'archived')} disabled={busy}>
                            Archive
                          </Button>
                        ) : (
                          <Button size="sm" variant="success" onClick={() => setStatus(p, 'active')} disabled={busy}>
                            Restore
                          </Button>
                        )}
                        <Button size="sm" variant="danger" leftIcon={Trash2} onClick={() => removeProduct(p)} disabled={busy}>
                          Delete
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <DraggableModal open={!!modal} onClose={() => setModal(null)} title={modal === 'create' ? 'New exhibition product' : 'Edit product'}>
          <div className="space-y-4">
            {modal === 'create' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="exh-p-cycle">Cycle</Label>
                  <Select id="exh-p-cycle" value={form.cycle_id || ''} onChange={(e) => setForm({ ...form, cycle_id: e.target.value })} className="w-full">
                    <option value="">Select cycle</option>
                    {cycles.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="exh-p-vendor">Vendor</Label>
                  <Select id="exh-p-vendor" value={form.vendor_id || ''} onChange={(e) => pickVendor(e.target.value)} className="w-full">
                    <option value="">Select vendor</option>
                    {cycleVendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </Select>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exh-p-name">Product name</Label>
                <Input id="exh-p-name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Premium rice 50kg" />
              </div>
              <div>
                <Label htmlFor="exh-p-sku">SKU</Label>
                <Input id="exh-p-sku" value={form.sku || ''} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} placeholder="e.g. RICE-50" disabled={modal !== 'create'} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="exh-p-vprice">Vendor price (₦)</Label>
                <Input id="exh-p-vprice" type="number" value={form.vendor_price ?? ''} onChange={(e) => setForm({ ...form, vendor_price: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="exh-p-markup">Admin markup (₦)</Label>
                <Input id="exh-p-markup" type="number" value={form.admin_markup ?? 0} onChange={(e) => setForm({ ...form, admin_markup: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="exh-p-qty">Qty (blank = ∞)</Label>
                <Input id="exh-p-qty" type="number" value={form.qty ?? ''} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exh-p-cat">Category</Label>
                <Select id="exh-p-cat" value={form.category_id || ''} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full">
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="exh-p-unit">Unit</Label>
                <Input id="exh-p-unit" value={form.unit || 'each'} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="each / kg / bag" />
              </div>
            </div>
            {modal === 'create' && form.branch_id && (
              <div className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
                Branch {vendors.find((v) => String(v.id) === String(form.vendor_id))?.branch_name || `#${form.branch_id}`}, taken from the vendor&apos;s account.
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button loading={busy} onClick={modal === 'create' ? saveCreate : saveEdit}>
                {modal === 'create' ? 'Create product' : 'Save changes'}
              </Button>
            </div>
          </div>
        </DraggableModal>
      </div>
    </ProtectedRoute>
  )
}
