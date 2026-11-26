'use client'

// app/admin/exhibition/products/page.jsx
// Admin product oversight — every vendor's products across the branch's
// exhibition. Admins can create products on a vendor's behalf, adjust the
// quantities, status, and archive (delete is blocked for
// products on orders — archive instead).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImageOff, Plus, RefreshCw, Search, Store, Upload } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import { thumbSrcSet, thumbUrl } from '../../../../lib/imageUrl'
import Card from '../../../components/ui/Card'
import Pagination from '../../../components/ui/Pagination'
import SelectionBar from '../../../components/ui/SelectionBar'
import { Table, THead, TBody, TR, TH, TD } from '../../../components/ui/Table'
import Input from '../../../components/ui/Input'
import Label from '../../../components/ui/Label'
import Select from '../../../components/ui/Select'
import DraggableModal from '../../../components/DraggableModal'
import Skeleton from '../../../components/ui/Skeleton'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import ProductImportModal from '../../../components/ProductImportModal'
import ProductImagesUpload from '../../../components/ProductImagesUpload'
import ShelfPicker from '../../../components/ShelfPicker'
import usePhotoShelfSuggestion from '../../../hooks/usePhotoShelfSuggestion'
import { productImages } from '../../../../lib/exhibitionProductImages'

const naira = (v) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(
    Number(v || 0)
  )

const STATUS_STYLES = { active: 'success', draft: 'neutral', archived: 'neutral' }

// Colour of the number in each "catalogue at a glance" tile.
const TILE_TONE = {
  fg: 'text-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
  muted: 'text-muted',
}

const memberPrice = (listPrice, discountPct) =>
  Math.round((Number(listPrice || 0) * (100 - Math.min(90, Math.max(0, Number(discountPct || 0))))) / 100)

export default function ExhibitionProductsPage() {
  const [products, setProducts] = useState([])
  const [cycles, setCycles] = useState([])
  const [vendors, setVendors] = useState([])
  const [cycleFilter, setCycleFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [term, setTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [modal, setModal] = useState(null) // 'create' | product object (edit)
  const [importOpen, setImportOpen] = useState(false)
  const [imageKey, setImageKey] = useState('') // unique storage key for a new product's photos
  const [form, setForm] = useState({})
  const [categories, setCategories] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState(new Set())
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const fetchSeq = useRef(0)
  // The filters the list was last loaded with. A refresh after approving must
  // not count as a filter change, or the desk is thrown back to page 1 every
  // time it acts on page 7.
  const loadedFiltersRef = useRef('')
  const pageSizeRef = useRef(pageSize)
  useEffect(() => {
    pageSizeRef.current = pageSize
  }, [pageSize])

  // keepMessage: a caller that is about to show its own confirmation (approve,
  // reject) must not have it wiped by the refresh it triggers. Without this the
  // success banner was set and then cleared in the same tick, so a completed
  // approval looked like nothing had happened.
  const load = useCallback(async ({ keepMessage = false } = {}) => {
    // Two filter changes in a row, or a search pressed while a refresh is
    // already in flight, leave more than one request open. Only the newest one
    // may touch state: an older response arriving last would otherwise put the
    // previous filter's rows on screen and prune the selection against rows the
    // desk is no longer showing — leaving a count for products nobody can see.
    const seq = ++fetchSeq.current
    setLoading(true)
    if (!keepMessage) setMsg(null)
    // Returns the rows it just fetched, so a caller can report on the queue it
    // acted on without a second round trip.
    let fetched = []
    try {
      const params = new URLSearchParams()
      if (cycleFilter) params.set('cycle_id', cycleFilter)
      if (vendorFilter) params.set('vendor_id', vendorFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (term.trim()) params.set('q', term.trim())
      const [p, c, v] = await Promise.all([
        fetch(`/api/admin/exhibition/products?${params}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/admin/exhibition/cycles', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        fetch('/api/admin/exhibition/vendors', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ])
      if (seq !== fetchSeq.current) return []
      if (p?.ok) {
        fetched = p.products || []
        setProducts(fetched)
        // A refresh can drop rows (a filter change, a search, or a delete
        // elsewhere); the selection must not keep ids that are no longer in
        // the list, or a bulk action would report on rows that are gone.
        setSelected((prev) => {
          if (!prev.size) return prev
          const live = new Set(fetched.map((row) => row.id))
          const next = new Set([...prev].filter((id) => live.has(id)))
          return next.size === prev.size ? prev : next
        })
        // Filtering or searching starts at page 1; a refresh after an approval,
        // archive or edit stays where the desk was — clamped to the last page
        // that still has rows, so clearing the final page does not show an
        // empty one.
        const signature = `${cycleFilter}|${vendorFilter}|${statusFilter}|${term.trim()}`
        if (loadedFiltersRef.current !== signature) {
          loadedFiltersRef.current = signature
          setPage(1)
        } else {
          const lastPage = Math.max(1, Math.ceil(fetched.length / pageSizeRef.current))
          setPage((current) => (current > lastPage ? lastPage : current))
        }
      } else setMsg({ type: 'error', text: p?.error || 'Failed to load products' })
      if (c?.ok) setCycles(c.cycles || [])
      if (v?.ok) setVendors(v.vendors || [])
    } catch (e) {
      if (seq === fetchSeq.current) setMsg({ type: 'error', text: e.message })
    } finally {
      // A superseded request must not clear the newer one's spinner.
      if (seq === fetchSeq.current) setLoading(false)
    }
    return fetched
  }, [cycleFilter, vendorFilter, statusFilter, term])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleFilter, vendorFilter, statusFilter])

  useEffect(() => {
    const active = cycles.find((c) => c.status === 'active')
    if (active) setCycleFilter((current) => current || String(active.id))
  }, [cycles])

  // Shelves for the picker, per cycle. The endpoint creates the shop's shelves
  // for a cycle that has none, so this is never an empty select.
  useEffect(() => {
    if (!modal) return undefined
    const cycleId = String(form.cycle_id || '')
    if (!cycleId) {
      setCategories([])
      return undefined
    }
    let alive = true
    fetch(`/api/admin/exhibition/categories?cycle_id=${encodeURIComponent(cycleId)}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (alive && json.ok) setCategories(json.categories || [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [modal, form.cycle_id])

  // A photo can suggest a shelf when the name cannot. It only pre-selects the
  // picker; the admin still confirms the shelf before creating the product.
  const { suggestion: photoShelf, reset: resetPhotoShelf } = usePhotoShelfSuggestion({
    enabled: modal === 'create',
    name: form.name || '',
    imageUrl: (form.images || [])[0] || '',
    categories,
    categoryId: form.category_id || '',
    onSuggestion: (_suggestion, categoryId) =>
      setForm((f) => (f.category_id ? f : { ...f, category_id: categoryId })),
  })

  const openCreate = () => {
    const active = cycles.find((c) => c.status === 'active')
    setImageKey(`draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
    setForm({ status: 'active', unit: 'each', cycle_id: active?.id || '', images: [] })
    resetPhotoShelf()
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
      discount_pct: p.discount_pct ?? 0,
      qty: p.qty ?? '',
      status: p.status || 'active',
      description: p.description || '',
      category_id: p.category_id ? String(p.category_id) : '',
      cycle_id: p.cycle_id || '',
      images: productImages(p),
    })
    resetPhotoShelf()
    setModal(p)
  }

  // How long a product has been waiting — the queue is worked oldest first.
  const ageLabel = (iso) => {
    if (!iso) return ''
    const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
    if (!Number.isFinite(hours) || hours < 0) return ''
    if (hours < 1) return 'just now'
    if (hours < 24) return `${hours}h waiting`
    return `${Math.floor(hours / 24)}d waiting`
  }

  // Vendor approval — publish a submitted product (and any pending price
  // change) or reject it. Rejecting a live product keeps its approved price.
  const setApproval = async (p, action) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/exhibition/products/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_action: action,
          ...(action === 'reject'
            ? { approval_note: String(window.prompt('Why is this product being rejected? The vendor sees this.') || '') }
            : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to update approval')
      await load({ keepMessage: true })
      setMsg({
        type: 'success',
        text: action === 'approve' ? `"${p.name}" approved and published.` : `"${p.name}" rejected.`,
      })
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  // One decision for the whole queue, so fifty products don't cost fifty
  // round trips. The bulk endpoint takes at most 200 ids per call, so a queue
  // past that (the catalogue can now run into the thousands) is approved in
  // consecutive batches instead of silently leaving the overflow pending.
  const approveAllPending = async () => {
    const ids = products.filter((p) => p.approval_status === 'pending').map((p) => p.id)
    if (!ids.length) return
    setBusy(true)
    setMsg(null)
    const BATCH = 200
    const approvedIds = new Set()
    let failure = null
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        try {
          const res = await fetch('/api/admin/exhibition/products/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve', ids: ids.slice(i, i + BATCH) }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json.ok) {
            failure = json.error || 'Bulk approval failed'
            break
          }
          // The route reports rows it could not write separately; those stay
          // pending, so keep going with the next batch instead of losing it.
          for (const id of json.approved || []) approvedIds.add(Number(id))
        } catch (e) {
          failure = e.message || 'Bulk approval failed'
          break
        }
      }
    } finally {
      // A batch can die after some of its rows were written, so count what is
      // actually still pending from the refreshed list rather than trusting our
      // own tally. (approval_status, not status — a pending product is usually
      // still a draft.)
      const fresh = await load({ keepMessage: true })
      const wanted = new Set(ids.map(Number))
      const stillPending = Array.isArray(fresh) && fresh.length
        ? fresh.filter((p) => wanted.has(Number(p.id)) && p.approval_status === 'pending').length
        : Math.max(0, ids.length - approvedIds.size)

      const done = approvedIds.size
      if (!failure && stillPending === 0) {
        setMsg({ type: 'success', text: `${done} product(s) approved and published.` })
      } else if (done > 0) {
        setMsg({
          type: 'error',
          text: `${done} of ${ids.length} approved and published — ${stillPending} still pending${failure ? ` (${failure})` : ''}. Approve again to finish the queue.`,
        })
      } else {
        setMsg({
          type: 'error',
          text: `Nothing was approved — ${stillPending || ids.length} still pending${failure ? `: ${failure}` : ''}.`,
        })
      }
      setBusy(false)
    }
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
          name: form.name,
          unit: form.unit,
          vendor_price: Number(form.vendor_price),
          discount_pct: Number(form.discount_pct || 0),
          qty: form.qty,
          image_url: (form.images || [])[0] || '',
          image_urls: form.images || [],
          description: form.description || '',
          status: form.status,
          category_id: form.category_id ? Number(form.category_id) : null,
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
          discount_pct: Number(form.discount_pct || 0),
          qty: form.qty,
          status: form.status,
          description: form.description || '',
          category_id: form.category_id ? Number(form.category_id) : null,
          image_url: (form.images || [])[0] || '',
          image_urls: form.images || [],
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

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState(null)

  const removeProduct = async (p) => {
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

  const handleConfirmDelete = () => {
    if (confirmTarget) removeProduct(confirmTarget)
    setConfirmOpen(false)
    setConfirmTarget(null)
  }

  const cycleVendors = useMemo(() => {
    if (!cycleFilter) return vendors
    return vendors.filter((v) => String(v.cycle_id) === String(cycleFilter))
  }, [vendors, cycleFilter])

  const totals = useMemo(
    () => ({
      active: products.filter((p) => p.status === 'active').length,
      value: products.reduce((s, p) => s + Number(p.vendor_price || 0), 0),
    }),
    [products]
  )

  // One row, one question: "may this be sold?". The shelf row (Active /
  // Drafts / Archived) answered a second question the desk does not act on from
  // here, so it is gone; the approval row still adds up to Products, since
  // every product carries exactly one approval decision.
  const stats = useMemo(() => {
    const is = (p, key, value) => String(p[key] || '') === value
    return {
      total: products.length,
      approved: products.filter((p) => is(p, 'approval_status', 'approved')).length,
      pending: products.filter((p) => is(p, 'approval_status', 'pending')).length,
      rejected: products.filter((p) => is(p, 'approval_status', 'rejected')).length,
    }
  }, [products])

  const statGroups = [
    {
      tiles: [
        { key: 'total', label: 'Products', value: stats.total, tone: 'fg' },
        { key: 'approved', label: 'Approved', value: stats.approved, tone: 'success' },
        { key: 'pending', label: 'Awaiting approval', value: stats.pending, tone: 'warning' },
        { key: 'rejected', label: 'Rejected', value: stats.rejected, tone: 'danger' },
      ],
    },
  ]

  const totalPages = Math.max(1, Math.ceil(products.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageProducts = products.slice(pageStart, pageStart + pageSize)

  // ── Selection ───────────────────────────────────────────────────────────
  // One select-all checkbox in the bar above the table (the table header has
  // none, so there is a single control that also works on phones), plus
  // "select all N" for the whole filtered list, so an admin can
  // act on a subset (one vendor's shelf, or everything still pending) without
  // working through the rows one at a time.
  const pageIds = pageProducts.map((p) => p.id)
  const selectedIds = products.filter((p) => selected.has(p.id)).map((p) => p.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const somePageSelected = pageIds.some((id) => selected.has(id))
  const allFilteredSelected = products.length > 0 && products.every((p) => selected.has(p.id))

  const toggleSelected = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleSelectPage = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of pageIds) {
        if (allPageSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })

  // Bulk actions cover everything selected, not just the visible page.
  // Approve uses the bulk route (it applies pending prices and notifies the
  // stand's followers); archive, restore and delete reuse the single-product
  // route so its order guard still stops a product that is already on an order.
  const runBulk = async (action) => {
    const ids = selectedIds
    if (!ids.length) return
    const labels = {
      approve: 'approved and published',
      archive: 'archived',
      restore: 'restored',
      delete: 'deleted',
    }
    setBusy(true)
    setMsg(null)
    // Products this run actually changed. Whatever is missing at the end is
    // what still needs attention — derived from outcomes rather than counted
    // from responses, because a refused batch or a thrown request never
    // reports per row.
    const changed = new Set()
    let failure = null
    const noteFailure = (text) => {
      if (!failure) failure = text
    }
    try {
      if (action === 'approve') {
        for (let i = 0; i < ids.length; i += 200) {
          const batch = ids.slice(i, i + 200)
          const res = await fetch('/api/admin/exhibition/products/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve', ids: batch }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json.ok) {
            // The call was refused before writing, so none of this batch moved.
            noteFailure(json.error || 'Bulk approval failed')
            break
          }
          for (const id of json.approved || []) changed.add(Number(id))
          // The route writes row by row and returns the rows it could not
          // touch in `failed` while still answering ok. Counting only
          // `approved` would report a partial approval as a clean success.
          for (const id of json.failed || []) {
            noteFailure(`product #${id} could not be approved`)
          }
        }
      } else {
        // Small batches: the per-product route is the one that owns the
        // archive/restore/delete guards, so keep the fan-out modest.
        for (let i = 0; i < ids.length; i += 5) {
          const batch = ids.slice(i, i + 5)
          const results = await Promise.all(
            batch.map(async (id) => {
              const res = await fetch(`/api/admin/exhibition/products/${id}`, {
                method: action === 'delete' ? 'DELETE' : 'PATCH',
                ...(action === 'delete'
                  ? {}
                  : {
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: action === 'archive' ? 'archived' : 'active' }),
                    }),
              })
              const json = await res.json().catch(() => ({}))
              return res.ok && json.ok ? null : json.error || 'Failed'
            })
          )
          results.forEach((error, index) => {
            if (error) noteFailure(error)
            else changed.add(Number(batch[index]))
          })
        }
      }
    } catch (e) {
      // The request that threw never reported back, so its products count as
      // unchanged and stay selected below.
      noteFailure(e.message || 'Bulk action failed')
    } finally {
      const done = changed.size
      const failed = ids.length - done
      // Keep only the products that did not change selected, so retrying them
      // is one bulk action instead of hunting each one down. load() prunes this
      // against the refreshed list, so a row that is gone cannot linger.
      setSelected(new Set(ids.filter((id) => !changed.has(Number(id)))))
      await load({ keepMessage: true })
      if (!failed) {
        setMsg({ type: 'success', text: `${done} product(s) ${labels[action]}.` })
      } else if (done > 0) {
        setMsg({
          type: 'error',
          text: `${done} of ${ids.length} product(s) ${labels[action]} — ${failed} did not change (${failure}).`,
        })
      } else {
        setMsg({ type: 'error', text: `Nothing was changed — ${failure}` })
      }
      setBusy(false)
    }
  }

  // One compact action control per row, mirroring the Food Distribution order
  // desk. Native selects stay usable on phones and never clip inside a table.
  const productActionSelect = (p, className = '') => (
    <select
      aria-label={`Actions for ${p.name}`}
      defaultValue=""
      disabled={busy}
      className={`rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm font-medium text-fg focus:border-brand focus:outline-none disabled:opacity-50 ${className}`}
      onChange={(e) => {
        const action = e.target.value
        e.target.value = ''
        if (action === 'edit') openEdit(p)
        if (action === 'approve' || action === 'reject') setApproval(p, action)
        if (action === 'archive') setStatus(p, 'archived')
        if (action === 'restore') setStatus(p, 'active')
        if (action === 'delete') { setConfirmTarget(p); setConfirmOpen(true) }
      }}
    >
      <option value="" disabled>Actions</option>
      <option value="edit">Edit</option>
      {p.approval_status === 'pending' && <option value="approve">Approve</option>}
      {p.approval_status === 'pending' && <option value="reject">Reject</option>}
      {p.status === 'archived' ? (
        <option value="restore">Restore</option>
      ) : (
        <option value="archive">Archive</option>
      )}
      <option value="delete">Delete</option>
    </select>
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
            <Button size="sm" variant="secondary" leftIcon={Upload} onClick={() => setImportOpen(true)}>
              Import list
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
              className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
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

        {/* Catalogue at a glance — the queue used to be a single sentence, so
            there was no telling whether the catalogue was growing because of
            new products or because approvals were not being worked. */}
        <div className="mb-4 rounded-2xl border border-line bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">Catalogue at a glance</h2>
            <span className="text-chips text-muted">
              {products.length
                ? 'Counted across the products these filters show'
                : 'No products in this view'}
            </span>
          </div>
          {statGroups.map((group, groupIndex) => (
            <div key={group.title || groupIndex} className="mb-2 last:mb-0">
              {group.title && (
                <p className="mb-1 text-chips font-medium uppercase tracking-wide text-subtext">{group.title}</p>
              )}
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {group.tiles.map((t) => (
                  <div
                    key={t.key}
                    className={`rounded-xl border px-3 py-2 ${
                      t.tone === 'warning' && t.value > 0
                        ? 'border-warning-border bg-warning-bg/40'
                        : 'border-line-subtle bg-subtle/40'
                    }`}
                  >
                    <dt className="text-chips font-medium uppercase tracking-wide text-muted">{t.label}</dt>
                    <dd className={`mt-0.5 text-h3 font-bold tabular-nums ${TILE_TONE[t.tone]}`}>
                      {loading && !products.length ? '—' : t.value.toLocaleString()}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          {stats.pending > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle pt-3">
              <p className="text-chips text-muted">
                Approving publishes a product to the shop at the vendor&apos;s price. The shop only lists
                products that are both approved and active, so a price change awaiting review keeps an
                otherwise-live product off the shelf until it is approved.
              </p>
              <Button size="sm" variant="success" onClick={approveAllPending} disabled={busy}>
                Approve all {stats.pending.toLocaleString()} pending
              </Button>
            </div>
          )}
        </div>

        {/* Selection bar — the shared one, so "select these" reads the same
            here and in the vendor's own catalogue. Always visible so "select
            all shown" is reachable before anything is ticked. */}
        {!loading && products.length > 0 && (
          <SelectionBar
            selectedCount={selected.size}
            selectAllLabel={`Select all shown (${pageProducts.length})`}
            allSelected={allPageSelected}
            someSelected={somePageSelected}
            onToggleSelectAll={toggleSelectPage}
            onClear={() => setSelected(new Set())}
            selectAllDisabled={!pageProducts.length}
            busy={busy}
            hint={allPageSelected && !allFilteredSelected ? `Only this page — ${products.length.toLocaleString()} in the filter` : ''}
          >
            {selected.size > 0 && !allFilteredSelected && (
              <button
                type="button"
                onClick={() => setSelected(new Set(products.map((p) => p.id)))}
                className="text-xs font-medium text-brand underline-offset-2 hover:underline"
              >
                Select all {products.length}
              </button>
            )}
            {selected.size > 0 && (
              <select
                aria-label="Bulk action"
                defaultValue=""
                disabled={busy}
                onChange={(e) => {
                  const action = e.target.value
                  e.target.value = ''
                  if (action === 'delete') setBulkConfirmOpen(true)
                  else runBulk(action)
                }}
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm font-medium text-fg focus:border-brand focus:outline-none disabled:opacity-50"
              >
                <option value="" disabled>Bulk actions</option>
                <option value="approve">Approve selected</option>
                <option value="archive">Archive selected</option>
                <option value="restore">Restore selected</option>
                <option value="delete">Delete selected</option>
              </select>
            )}
          </SelectionBar>
        )}

        <Card className="gap-0 overflow-hidden p-0">
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
            <>
            <div className="hidden lg:block">
            <Table className="min-w-[720px]">
              <THead>
                <TR>
                  {/* The select-all control lives in the bar above the table,
                      where it is also reachable on phones. */}
                  <TH className="w-[1%]" aria-label="Select" />
                  <TH>Product</TH>
                  <TH>Vendor</TH>
                  <TH className="text-right">Price</TH>
                  <TH className="text-right">Qty</TH>
                  <TH>Status</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {pageProducts.map((p) => (
                  <TR key={p.id} className={selected.has(p.id) ? 'bg-brand-subtle/40' : ''}>
                    <TD className="w-[1%]">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelected(p.id)}
                        aria-label={`Select ${p.name}`}
                        className="h-4 w-4 rounded border-line accent-brand"
                      />
                    </TD>
                    <TD className="w-[40%]">
                      <div className="flex items-center gap-2.5">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumbUrl(p.image_url, 112)} srcSet={thumbSrcSet(p.image_url, 112)} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-line-subtle bg-subtle object-contain" />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-subtle text-subtext">
                            <ImageOff className="h-4 w-4" strokeWidth={1.5} />
                          </span>
                        )}
                        <div className="min-w-0">
                          {/* Long catalog names wrap to two lines instead of
                              widening the table into a horizontal scroll. */}
                          <div className="line-clamp-2 break-words font-medium text-fg" title={p.name}>{p.name}</div>
                          <div className="truncate font-mono text-xs text-muted">{p.sku}</div>
                        </div>
                      </div>
                    </TD>
                    <TD className="w-[16%]">
                      <div className="line-clamp-2 break-words text-muted" title={p.vendor_name || ''}>
                        {p.vendor_name || `#${p.vendor_id}`}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">
                      {naira(p.vendor_price)}
                      {Number(p.discount_pct || 0) > 0 && (
                        <div className="text-chips font-medium text-danger-fg">
                          −{p.discount_pct}% · {naira(memberPrice(p.vendor_price, p.discount_pct))}
                        </div>
                      )}
                      {p.pending_vendor_price != null && (
                        <div className="text-chips text-warning-fg">→ {naira(p.pending_vendor_price)}</div>
                      )}
                      {p.pending_discount_pct != null && (
                        <div className="text-chips text-warning-fg">→ −{p.pending_discount_pct}%</div>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{p.qty == null ? '∞' : Number(p.qty).toLocaleString()}</TD>
                    <TD>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={STATUS_STYLES[p.status] || 'neutral'} variant="subtle">{p.status}</Badge>
                        {p.approval_status === 'pending' && (
                          <>
                            <Badge tone="warning" variant="subtle">Pending approval</Badge>
                            {p.approval_requested_at && (
                              <span className="text-[10px] font-medium text-warning-fg">
                                {ageLabel(p.approval_requested_at)}
                              </span>
                            )}
                          </>
                        )}
                        {p.approval_status === 'rejected' && (
                          <Badge tone="danger" variant="subtle">Rejected</Badge>
                        )}
                      </div>
                    </TD>
                    <TD className="w-[1%] whitespace-nowrap text-right">{productActionSelect(p)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            </div>

            {/* Phones get cards; a seven-column table cannot stay readable. */}
            <div className="divide-y divide-line lg:hidden">
              {pageProducts.map((p) => (
                <div key={`product-card-${p.id}`} className="p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelected(p.id)}
                      aria-label={`Select ${p.name}`}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-line accent-brand"
                    />
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbUrl(p.image_url, 160)} srcSet={thumbSrcSet(p.image_url, 160)} alt="" className="h-14 w-14 shrink-0 rounded-xl border border-line-subtle bg-subtle object-contain" />
                    ) : (
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-subtle text-subtext">
                        <ImageOff className="h-5 w-5" strokeWidth={1.5} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold text-fg">{p.name}</p>
                      <p className="font-mono text-xs text-muted">{p.sku}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone={STATUS_STYLES[p.status] || 'neutral'} variant="subtle">{p.status}</Badge>
                        {p.approval_status === 'pending' && <Badge tone="warning" variant="subtle">Pending approval</Badge>}
                        {p.approval_status === 'rejected' && <Badge tone="danger" variant="subtle">Rejected</Badge>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-subtle/50 p-2.5 text-xs">
                    <div className="col-span-2 min-w-0">
                      <p className="text-chips text-muted">Vendor</p>
                      <p className="break-words font-medium text-fg">{p.vendor_name || `#${p.vendor_id}`}</p>
                    </div>
                    <div>
                      <p className="text-chips text-muted">Price</p>
                      <p className="font-semibold tabular-nums text-fg">
                        {naira(p.vendor_price)}
                        {Number(p.discount_pct || 0) > 0 && (
                          <span className="block text-chips font-medium text-danger-fg">
                            −{p.discount_pct}% · {naira(memberPrice(p.vendor_price, p.discount_pct))}
                          </span>
                        )}
                        {p.pending_vendor_price != null && (
                          <span className="block text-chips text-warning-fg">→ {naira(p.pending_vendor_price)}</span>
                        )}
                        {p.pending_discount_pct != null && (
                          <span className="block text-chips text-warning-fg">→ −{p.pending_discount_pct}%</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-chips text-muted">Qty</p>
                      <p className="font-semibold tabular-nums text-fg">{p.qty == null ? '∞' : Number(p.qty).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="mt-3">{productActionSelect(p, 'w-full')}</div>
                </div>
              ))}
            </div>
            </>
          )}
          {!loading && products.length > 0 && (
            <Pagination
              page={currentPage}
              pageCount={totalPages}
              pageSize={pageSize}
              totalItems={products.length}
              itemLabel="products"
              onPageChange={(next) => setPage(next)}
              onPageSizeChange={(next) => {
                setPageSize(next)
                setPage(1)
              }}
              disabled={busy}
            />
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
                <Label>SKU</Label>
                <p className="rounded-lg border border-line-subtle bg-subtle px-3 py-2 font-mono text-xs text-muted">
                  {modal === 'create' ? 'Generated automatically' : modal?.sku || '—'}
                </p>
              </div>
            </div>
            <div>
              <ShelfPicker
                id="exh-p-shelf"
                categories={categories}
                name={form.name || ''}
                description={form.description || ''}
                value={form.category_id || ''}
                onChange={(category_id) => setForm((f) => ({ ...f, category_id }))}
                photoNote={
                  photoShelf ? `Suggested from the photo (${photoShelf.label}) — confirm it or pick another shelf.` : ''
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exh-p-vprice">Price (₦)</Label>
                <Input id="exh-p-vprice" type="number" value={form.vendor_price ?? ''} onChange={(e) => setForm({ ...form, vendor_price: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="exh-p-discount">Discount (%)</Label>
                <Input id="exh-p-discount" type="number" min="0" max="90" value={form.discount_pct ?? 0} onChange={(e) => setForm({ ...form, discount_pct: e.target.value })} />
                {Number(form.discount_pct || 0) > 0 && Number(form.vendor_price) > 0 && (
                  <p className="mt-1 text-chips text-muted">
                    Members pay {naira(memberPrice(form.vendor_price, form.discount_pct))}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="exh-p-qty">Qty (blank = ∞)</Label>
                <Input id="exh-p-qty" type="number" value={form.qty ?? ''} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="exh-p-description">Description (optional)</Label>
              <textarea
                id="exh-p-description"
                rows={3}
                maxLength={2000}
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What it is, size, material, condition — anything a buyer should know."
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <Label htmlFor="exh-p-unit">Unit</Label>
              <Input id="exh-p-unit" value={form.unit || 'each'} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="each / kg / bag" />
            </div>
            <div>
              <Label>Product photos</Label>
              <ProductImagesUpload
                itemSku={modal === 'create' ? imageKey || 'product' : modal?.sku || 'product'}
                vendorId={modal === 'create' ? form.vendor_id || null : modal?.vendor_id || null}
                images={form.images || []}
                onChange={(images) => setForm((f) => ({ ...f, images }))}
              />
              {modal === 'create' && !form.vendor_id && (
                <p className="mt-1 text-chips text-muted">Choose a vendor first, so the photos are stored on that stand.</p>
              )}
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

        <ConfirmDialog
          open={confirmOpen}
          onClose={() => { setConfirmOpen(false); setConfirmTarget(null) }}
          onConfirm={handleConfirmDelete}
          title="Delete product?"
          message={`Delete "${confirmTarget?.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
        />

        <ConfirmDialog
          open={bulkConfirmOpen}
          onClose={() => setBulkConfirmOpen(false)}
          onConfirm={() => {
            setBulkConfirmOpen(false)
            runBulk('delete')
          }}
          title={`Delete ${selected.size} product(s)?`}
          message="Products already on an order cannot be deleted — archive those instead. This cannot be undone."
          confirmLabel="Delete"
          variant="danger"
        />

        <ProductImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          endpoint="/api/admin/exhibition/products/import"
          cycles={cycles}
          vendors={vendors}
          requireTarget
          onDone={load}
        />
      </div>
    </ProtectedRoute>
  )
}
