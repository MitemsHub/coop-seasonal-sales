'use client'

// app/admin/food/items-import/page.jsx
// Food Distribution · Items Management › Items Import.
//
// Everything that *creates or bulk-updates* items for a cycle lives here
// (moved off the Data page):
//   1. Food Price Repricer            (moved from Data)
//   2. Items / Prices Import          (moved from Data)
//   3. General Items                  (new — add once, priced in EVERY branch
//                                       for the active cycle, markup editable)
//   4. Outsourced Items               (new — rep survey drafts, grouped by the
//                                       branch that submitted them, refined and
//                                       saved into the shop; images always
//                                       linked from the image bank)
//
// Saving writes the item once (items row) + a price for every branch of the
// selected cycle, so it appears in every branch's shop immediately. Images are
// picked from the shared bank (Items Image Mang.) — never re-uploaded.
//
// Typography follows the design system: text-h2 page title, text-h3 section
// headings, text-body copy, text-caption helper text, text-chips pills, and
// the shared Input/Select/Label field components.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import Label from '../../../components/ui/Label'
import ItemImagePicker from '../../../components/ItemImagePicker'
import {
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Image as ImageIcon,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Store,
} from 'lucide-react'

const fmtPrice = (v) => Number(v || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })

const emptyNew = { name: '', sku: '', category: '', unit: '', price: '', markup: '', image_url: '' }

function ItemsImportContent() {
  const router = useRouter()

  /* ── Cycle targeting ─────────────────────────────────────────────── */
  const [cycles, setCycles] = useState([])
  const [selectedCycleId, setSelectedCycleId] = useState(null)
  const [loadingCycles, setLoadingCycles] = useState(true)

  /* ── Page feedback ───────────────────────────────────────────────── */
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState('success')
  const flash = (text, type = 'success') => {
    setMsg(text)
    setMsgType(type)
    if (type === 'success') setTimeout(() => setMsg(''), 6000)
  }

  /* ── Repricer ────────────────────────────────────────────────────── */
  const [confirmReprice, setConfirmReprice] = useState('')
  const [repricing, setRepricing] = useState(false)

  /* ── Items / Prices Import ───────────────────────────────────────── */
  const [pricesFile, setPricesFile] = useState(null)
  const [pricesLog, setPricesLog] = useState('')
  const [pricesBusy, setPricesBusy] = useState(false)
  const [isDemandTrackingMode, setIsDemandTrackingMode] = useState(false)
  const [loadingMode, setLoadingMode] = useState(true)

  /* ── General + Outsourced sections ───────────────────────────────── */
  const [generalRows, setGeneralRows] = useState([])
  const [outRows, setOutRows] = useState([])
  const [sectionsLoading, setSectionsLoading] = useState(false)
  const [sectionsError, setSectionsError] = useState(null)
  const [genSearch, setGenSearch] = useState('')
  const [outSearch, setOutSearch] = useState('')
  const [collapsedBranches, setCollapsedBranches] = useState(() => new Set())

  const [editKey, setEditKey] = useState(null) // 'general:<id>' | 'outsourced:<key>' | null
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)

  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState(emptyNew)
  const [newBusy, setNewBusy] = useState(false)
  const [newErr, setNewErr] = useState(null)

  /* ── Loaders ─────────────────────────────────────────────────────── */
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
    } catch (e) {
      flash(e.message, 'error')
    } finally {
      setLoadingCycles(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadSections = useCallback(async () => {
    if (selectedCycleId == null) return
    setSectionsLoading(true)
    setSectionsError(null)
    try {
      const qs = `cycle_id=${encodeURIComponent(String(selectedCycleId))}`
      const [gRes, oRes] = await Promise.all([
        fetch(`/api/admin/items?section=general&${qs}`, { cache: 'no-store', credentials: 'same-origin' }),
        fetch(`/api/admin/items?section=outsourced&${qs}`, { cache: 'no-store', credentials: 'same-origin' }),
      ])
      const g = await gRes.json()
      const o = await oRes.json()
      if (!gRes.ok || !g.ok) throw new Error(g.error || 'Failed to load general items')
      if (!oRes.ok || !o.ok) throw new Error(o.error || 'Failed to load outsourced items')
      setGeneralRows(g.rows || [])
      setOutRows(o.rows || [])
    } catch (e) {
      setSectionsError(e.message)
    } finally {
      setSectionsLoading(false)
    }
  }, [selectedCycleId])

  useEffect(() => {
    loadCycles()
  }, [loadCycles])

  useEffect(() => {
    loadSections()
  }, [loadSections])

  // Demand tracking mode — when on, the items upload needs no stock column.
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/admin/system/mode')
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setIsDemandTrackingMode(!!data.isDemandTrackingMode)
        }
      } catch {
        setIsDemandTrackingMode(false)
      } finally {
        if (!cancelled) setLoadingMode(false)
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  const cycle = cycles.find((c) => c.id === selectedCycleId) || null

  /* ── Repricer (moved from the Data page) ─────────────────────────── */
  const repriceFoodOrders = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (repricing) return
    if (confirmReprice !== 'REPRICE ORDERS') {
      flash('Please type "REPRICE ORDERS" to confirm', 'error')
      return
    }
    setRepricing(true)
    flash('Repricing orders using current prices…', 'info')
    try {
      const response = await fetch('/api/admin/data-management/reprice-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: selectedCycleId != null ? JSON.stringify({ cycle_id: selectedCycleId }) : JSON.stringify({}),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) {
        flash(`Error: ${result.error || 'Failed to reprice orders'}`, 'error')
      } else {
        const cycleLabel = result.cycle_id != null ? ` (cycle_id=${result.cycle_id})` : ''
        flash(`Repriced ${result.updated_lines} order lines and ${result.updated_orders} orders${cycleLabel}`)
        setConfirmReprice('')
      }
    } catch (error) {
      flash(`Error: ${error.message}`, 'error')
    } finally {
      setRepricing(false)
    }
  }

  /* ── Items / Prices Import (moved from the Data page) ────────────── */
  const uploadPrices = async () => {
    if (!pricesFile) {
      setPricesLog('Please choose a file first.')
      return
    }
    setPricesBusy(true)
    setPricesLog('')
    try {
      const fd = new FormData()
      fd.append('file', pricesFile)
      const res = await fetch('/api/admin/import/prices', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || `Upload failed with status ${res.status}`)
      setPricesLog(JSON.stringify(json, null, 2))
      flash('Items/Prices imported')
      loadSections()
    } catch (e) {
      setPricesLog(`Error: ${e.message}`)
    } finally {
      setPricesBusy(false)
    }
  }

  const downloadPricesTemplate = async () => {
    const ExcelJSMod = await import('exceljs')
    const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Items_Prices')
    const templateData = {
      sku: 'RICE50KG',
      item_name: 'Rice (50kg)',
      unit: 'bag',
      category: 'Food',
      branch_code: 'DUTSE',
      price: 49500,
    }
    ws.addRow(Object.keys(templateData))
    ws.addRow(Object.values(templateData))
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Items_Prices_Template.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ── Editing rows ────────────────────────────────────────────────── */
  const categories = useMemo(() => {
    const set = new Set()
    for (const r of [...generalRows, ...outRows]) {
      if (r.category) set.add(r.category)
      if (r.draft?.draft_category) set.add(r.draft.draft_category)
    }
    return [...set].sort()
  }, [generalRows, outRows])

  const startEdit = (section, row) => {
    setEditKey(`${section}:${section === 'general' ? row.item_id : row.draft?.key || row.item_id}`)
    setSaveErr(null)
    setShowNew(false)
    setForm({
      section,
      item_id: row.item_id || null,
      sku: row.sku || '',
      name: (section === 'outsourced' && row.draft ? row.draft.draft_name : row.name) || '',
      category: (section === 'outsourced' && row.draft && !row.saved ? row.draft.draft_category : row.category) || '',
      unit: (section === 'outsourced' && row.draft && !row.saved ? row.draft.draft_unit : row.unit) || '',
      price: String(row.price ?? row.draft?.draft_price ?? ''),
      markup: String(row.markup ?? ''),
      price_varies: !!row.price_varies,
      markup_varies: !!row.markup_varies,
      image_url: row.image_url || '',
      draft: row.draft || null,
      saved: !!row.saved,
    })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => {
    setEditKey(null)
    setForm(null)
    setSaveErr(null)
  }

  const setField = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  const postItem = async (payload) => {
    const res = await fetch('/api/admin/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ cycle_id: selectedCycleId, ...payload }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.ok) throw new Error(json.error || 'Save failed')
    return json
  }

  const saveEdit = async () => {
    if (!form || saving) return
    setSaving(true)
    setSaveErr(null)
    try {
      const json = await postItem({
        section: form.section,
        item_id: form.item_id,
        sku: form.sku,
        name: form.name,
        category: form.category,
        unit: form.unit,
        price: form.price,
        markup: form.markup,
        image_url: form.image_url,
      })
      flash(
        `Saved — “${json.item.name}” now has a price in ${json.branches_priced} branch${json.branches_priced === 1 ? '' : 'es'} for this cycle${
          json.markup_branches ? ` and markup in ${json.markup_branches}` : ''
        }. It shows in the shop immediately.`
      )
      cancelEdit()
      loadSections()
    } catch (e) {
      setSaveErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const addGeneral = async (e) => {
    e.preventDefault()
    if (newBusy) return
    setNewBusy(true)
    setNewErr(null)
    try {
      const json = await postItem({
        section: 'general',
        item_id: null,
        sku: newForm.sku,
        name: newForm.name,
        category: newForm.category,
        unit: newForm.unit,
        price: newForm.price,
        markup: newForm.markup,
        image_url: newForm.image_url,
      })
      flash(`Added — “${json.item.name}” is live in all ${json.branches_priced} branches for this cycle.`)
      setNewForm(emptyNew)
      setShowNew(false)
      loadSections()
    } catch (err) {
      setNewErr(err.message)
    } finally {
      setNewBusy(false)
    }
  }

  /* ── Filtering + branch grouping ─────────────────────────────────── */
  const filteredGeneral = useMemo(() => {
    const q = genSearch.trim().toLowerCase()
    if (!q) return generalRows
    return generalRows.filter((r) => `${r.name} ${r.category} ${r.sku} ${r.unit}`.toLowerCase().includes(q))
  }, [generalRows, genSearch])

  const filteredOutsourced = useMemo(() => {
    const q = outSearch.trim().toLowerCase()
    if (!q) return outRows
    return outRows.filter((r) =>
      `${r.draft?.draft_name || r.name} ${r.draft?.draft_category || r.category} ${r.sku} ${r.draft?.branch_name || ''} ${r.draft?.branch_code || ''}`.toLowerCase().includes(q)
    )
  }, [outRows, outSearch])

  // One card per submitting branch so the admin works through submissions
  // branch by branch instead of one long mixed list. Saved items whose survey
  // draft disappeared land in their own trailing group so they stay editable.
  const branchGroups = useMemo(() => {
    const map = new Map()
    for (const r of filteredOutsourced) {
      const key = r.draft ? String(r.draft.branch_id ?? 'none') : 'saved'
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: r.draft
            ? `${r.draft.branch_name || 'Unknown branch'}${r.draft.branch_code ? ` (${r.draft.branch_code})` : ''}`
            : 'Saved items — no survey draft',
          rows: [],
        })
      }
      map.get(key).rows.push(r)
    }
    return [...map.values()]
  }, [filteredOutsourced])

  const toggleBranch = (key) =>
    setCollapsedBranches((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const setAllBranches = (collapsed) =>
    setCollapsedBranches(collapsed ? new Set(branchGroups.map((g) => g.key)) : new Set())

  /* ── Row editor (shared by both sections) ────────────────────────── */
  const editor = () => {
    if (!form) return null
    const isOut = form.section === 'outsourced'
    return (
      <div className="mt-3 rounded-lg border border-brand/40 bg-subtle/50 p-3">
        {isOut && form.draft && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-2.5">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-line bg-canvas">
              {form.draft.rep_photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.draft.rep_photo} alt="Rep photo (reference)" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-caption text-muted">No photo</span>
              )}
            </div>
            <div className="min-w-0 flex-1 text-body">
              <p className="font-semibold text-fg">Rep draft — reference only</p>
              <p className="text-muted">
                {form.draft.draft_name}
                {form.draft.draft_category ? ` · ${form.draft.draft_category}` : ''}
                {form.draft.draft_price ? ` · ₦${fmtPrice(form.draft.draft_price)}` : ''}
                {form.draft.branch_name ? ` · ${form.draft.branch_name}` : ''}
                {form.draft.rep_name ? ` · submitted by ${form.draft.rep_name}` : ''}
              </p>
              <p className="mt-0.5 text-caption text-warning-fg">
                Rep photos are raw and not used in the shop — pick the refined image from the bank below.
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="edit-name">Item name</Label>
            <Input
              id="edit-name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              maxLength={255}
            />
          </div>
          <div>
            <Label htmlFor="edit-sku">SKU</Label>
            <Input
              id="edit-sku"
              value={form.sku}
              onChange={(e) => setField('sku', e.target.value.toUpperCase())}
              placeholder="Generated from the name if blank"
              maxLength={100}
            />
          </div>
          <div>
            <Label htmlFor="edit-category">Category</Label>
            <Input
              id="edit-category"
              value={form.category}
              onChange={(e) => setField('category', e.target.value)}
              list="item-categories"
              maxLength={100}
            />
          </div>
          <div>
            <Label htmlFor="edit-unit">Unit</Label>
            <Input
              id="edit-unit"
              value={form.unit}
              onChange={(e) => setField('unit', e.target.value)}
              list="item-units"
              maxLength={50}
            />
          </div>
          <div>
            <Label htmlFor="edit-price">
              Price (₦) — applied to every branch{form.price_varies ? ' (branches differ; saving unifies)' : ''}
            </Label>
            <Input
              id="edit-price"
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(e) => setField('price', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="edit-markup">
              Markup (₦) — applied to every branch{form.markup_varies ? ' (branches differ; saving unifies)' : ''}
            </Label>
            <Input
              id="edit-markup"
              type="number"
              min="0"
              step="0.01"
              value={form.markup}
              onChange={(e) => setField('markup', e.target.value)}
              placeholder="Blank keeps current markups"
            />
          </div>
          <div className="sm:col-span-2">
            <ItemImagePicker
              value={form.image_url}
              onChange={(url) => setField('image_url', url)}
              name={form.name}
              sku={form.sku}
              label="Refined image (linked from Items Image Mang.)"
            />
          </div>
        </div>

        {saveErr && (
          <p className="mt-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-1.5 text-caption text-danger-fg">{saveErr}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={saveEdit} loading={saving} leftIcon={Store}>
            {saving ? 'Saving…' : 'Save & publish to shop'}
          </Button>
          <Button variant="secondary" onClick={cancelEdit} disabled={saving}>
            Cancel
          </Button>
          <p className="text-caption text-muted">
            Saves the item once and writes its price to every branch of {cycle?.name || 'this cycle'} — no duplicate
            uploads, no redundant rows.
          </p>
        </div>
      </div>
    )
  }

  const rowCard = (section, row) => {
    const key = `${section}:${section === 'general' ? row.item_id : row.draft?.key || row.item_id}`
    const expanded = editKey === key
    const title = section === 'outsourced' && row.draft ? row.draft.draft_name : row.name
    const saved = section === 'general' || row.saved
    const price = row.price ?? row.draft?.draft_price ?? null
    const img = row.image_url || ''

    return (
      <div key={key} className={`rounded-lg border bg-surface p-3 ${expanded ? 'border-brand/50' : 'border-line-subtle'}`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-line bg-canvas">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt={title} loading="lazy" className="h-full w-full object-contain" />
            ) : section === 'outsourced' && row.draft?.rep_photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.draft.rep_photo}
                alt={`${title} (rep draft photo)`}
                loading="lazy"
                className="h-full w-full object-cover opacity-50 grayscale"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-muted">
                <ImageIcon className="h-4 w-4" strokeWidth={1.8} />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-fg">{title}</span>
              {saved && row.in_shop ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-success-fg">
                  <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} /> In shop
                </span>
              ) : saved ? (
                <span className="rounded-full bg-warning-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-warning-fg">
                  Not in shop yet
                </span>
              ) : (
                <span className="rounded-full bg-info-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-info-fg">
                  Survey draft
                </span>
              )}
              {!img && (
                <span className="rounded-full bg-subtle px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-muted">
                  No bank image
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-caption text-muted">
              {[row.category || row.draft?.draft_category, row.unit || row.draft?.draft_unit, row.sku]
                .filter(Boolean)
                .join(' · ') || '—'}
              {section === 'outsourced' && row.draft?.rep_name ? ` · rep: ${row.draft.rep_name}` : ''}
              {saved && row.branches_priced ? ` · priced in ${row.branches_priced} branches` : ''}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-bold text-fg">₦{fmtPrice(price)}</p>
              <p className="text-caption text-muted">
                {row.markup != null ? `markup ₦${fmtPrice(row.markup)}${row.markup_varies ? ' (varies)' : ''}` : 'no markup'}
              </p>
            </div>
            <Button
              variant={expanded ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => (expanded ? cancelEdit() : startEdit(section, row))}
            >
              {expanded ? 'Close' : saved ? 'Edit' : 'Refine & save'}
            </Button>
          </div>
        </div>
        {expanded && editor()}
      </div>
    )
  }

  /* ── Page ────────────────────────────────────────────────────────── */
  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-2 sm:flex sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 gap-2">
        <div className="col-span-1">
          <h1 className="text-h2 font-semibold tracking-tight text-fg">Admin · Items Import</h1>
          <p className="mt-1 text-body text-muted">
            Bulk uploads, the repricer, General Items and Outsourced Items — everything that puts items into the
            shop for a cycle.
          </p>
        </div>
        <Button variant="secondary" onClick={() => router.back()} className="justify-self-end col-span-1">
          ← Back
        </Button>
      </div>

      {msg && (
        <div
          className={`p-4 rounded-lg mb-6 text-body ${
            msgType === 'error'
              ? 'bg-danger-bg text-danger-fg border border-danger-border'
              : msgType === 'info'
                ? 'bg-info-bg text-info-fg border border-info-border'
                : 'bg-success-bg text-success-fg border border-success-border'
          }`}
        >
          {msg}
        </div>
      )}

      {/* Target cycle bar */}
      <div className="mb-4 rounded-xl border border-line bg-surface p-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="sm:w-72">
            <Label htmlFor="items-cycle">Target cycle</Label>
            <Select
              id="items-cycle"
              value={selectedCycleId ?? ''}
              onChange={(e) => setSelectedCycleId(e.target.value ? Number(e.target.value) : null)}
              disabled={loadingCycles || cycles.length === 0}
            >
              {cycles.length === 0 ? (
                <option value="">{loadingCycles ? 'Loading…' : 'No cycles found'}</option>
              ) : (
                cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code}){c.is_active ? ' · Active' : ''}
                  </option>
                ))
              )}
            </Select>
          </div>
          <p className="text-caption text-muted sm:pb-2">
            Repricer, uploads and every Save below target this cycle.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => { loadCycles(); loadSections() }} loading={loadingCycles || sectionsLoading} leftIcon={RefreshCw}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-3">
        {/* ── 1. Repricer + 2. Items/Prices Import (moved from Data) ── */}
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
            <h2 className="text-h3 font-semibold text-fg mb-1">💱 Food Price Repricer</h2>
            <p className="text-body text-muted mb-3">
              Recomputes order line prices and order totals using the latest branch prices and markups.
            </p>
            {cycle && (
              <div className="mb-3 px-2 py-1.5 rounded-lg bg-info-bg border border-info-border text-caption text-info-fg">
                Targeting cycle: <strong>{cycle.name}</strong>
                {cycle.is_active ? ' (Active)' : ''}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Input
                value={confirmReprice}
                onChange={(e) => setConfirmReprice(e.target.value)}
                placeholder='Type "REPRICE ORDERS"'
                disabled={repricing}
                aria-label='Type "REPRICE ORDERS" to confirm'
              />
              <Button onClick={repriceFoodOrders} loading={repricing} disabled={repricing}>
                {repricing ? 'Repricing…' : 'Reprice Orders'}
              </Button>
            </div>
          </div>

          <div className="bg-surface rounded-xl shadow-lg border border-line-subtle p-4 lg:col-span-2">
            <h2 className="text-h3 font-semibold text-fg mb-1">📥 Items / Prices Import</h2>
            <p className="text-body text-muted mb-3">
              {loadingMode ? (
                <span className="inline-block h-3 w-64 animate-pulse rounded bg-muted" />
              ) : (
                'Expected columns: sku, item_name, unit, category, branch_code, price'
              )}
            </p>
            {cycle && (
              <div className="mb-3 px-2 py-1.5 rounded-lg bg-info-bg border border-info-border text-caption text-info-fg">
                Prices will be saved to cycle: <strong>{cycle.name}</strong>
                {cycle.is_active ? ' (Active)' : ''}
              </div>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setPricesFile(e.target.files?.[0] || null)}
                className="w-full sm:flex-1 sm:min-w-0 text-sm p-2 border border-line-subtle rounded-lg bg-surface text-fg"
              />
              <Button onClick={uploadPrices} loading={pricesBusy} disabled={!pricesFile || loadingMode} className="min-w-[170px]">
                {pricesBusy ? 'Uploading…' : isDemandTrackingMode ? 'Upload Items/Prices' : 'Upload Items/Prices/Stock'}
              </Button>
              <Button
                variant="secondary"
                leftIcon={FileSpreadsheet}
                onClick={downloadPricesTemplate}
                disabled={loadingMode}
                className="min-w-[170px]"
              >
                Download Excel Template
              </Button>
            </div>
            {pricesLog && (
              <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-subtle p-3 text-caption text-fg overflow-x-auto">{pricesLog}</pre>
            )}
          </div>
        </div>

        {/* ── 3. General Items ─────────────────────────────────────── */}
        <div className="bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-h3 font-semibold text-fg mb-1">🧾 General Items</h2>
              <p className="text-body text-muted">
                Added once — priced in <strong>every branch</strong> for the selected cycle and visible in the shop
                immediately. Edit name, category, unit, price, <strong>markup</strong> and image; the image is always
                linked from the bank, never re-uploaded.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" />
                <Input
                  value={genSearch}
                  onChange={(e) => setGenSearch(e.target.value)}
                  placeholder="Search general items…"
                  aria-label="Search general items"
                  className="w-44 pl-9"
                />
              </div>
              <Button size="sm" leftIcon={Plus} onClick={() => { setShowNew((v) => !v); cancelEdit() }}>
                {showNew ? 'Close form' : 'Add general item'}
              </Button>
            </div>
          </div>

          {showNew && (
            <form onSubmit={addGeneral} className="mt-3 rounded-lg border border-brand/40 bg-subtle/50 p-3">
              <p className="mb-2 text-sm font-semibold text-fg">New general item → all branches, {cycle?.name || 'this cycle'}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="new-name">Item name</Label>
                  <Input
                    id="new-name"
                    required
                    minLength={2}
                    value={newForm.name}
                    onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                    maxLength={255}
                  />
                </div>
                <div>
                  <Label htmlFor="new-sku">SKU (optional)</Label>
                  <Input
                    id="new-sku"
                    value={newForm.sku}
                    onChange={(e) => setNewForm((f) => ({ ...f, sku: e.target.value.toUpperCase() }))}
                    placeholder="Generated from the name if blank"
                    maxLength={100}
                  />
                </div>
                <div>
                  <Label htmlFor="new-category">Category</Label>
                  <Input
                    id="new-category"
                    value={newForm.category}
                    onChange={(e) => setNewForm((f) => ({ ...f, category: e.target.value }))}
                    list="item-categories"
                    maxLength={100}
                  />
                </div>
                <div>
                  <Label htmlFor="new-unit">Unit</Label>
                  <Input
                    id="new-unit"
                    value={newForm.unit}
                    onChange={(e) => setNewForm((f) => ({ ...f, unit: e.target.value }))}
                    list="item-units"
                    maxLength={50}
                  />
                </div>
                <div>
                  <Label htmlFor="new-price">Price (₦) — every branch</Label>
                  <Input
                    id="new-price"
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={newForm.price}
                    onChange={(e) => setNewForm((f) => ({ ...f, price: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="new-markup">Markup (₦) — every branch</Label>
                  <Input
                    id="new-markup"
                    type="number"
                    min="0"
                    step="0.01"
                    value={newForm.markup}
                    onChange={(e) => setNewForm((f) => ({ ...f, markup: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
                <div className="sm:col-span-2">
                  <ItemImagePicker
                    value={newForm.image_url}
                    onChange={(url) => setNewForm((f) => ({ ...f, image_url: url }))}
                    name={newForm.name}
                    sku={newForm.sku}
                    label="Refined image (linked from Items Image Mang.)"
                  />
                </div>
              </div>
              {newErr && (
                <p className="mt-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-1.5 text-caption text-danger-fg">{newErr}</p>
              )}
              <div className="mt-3">
                <Button type="submit" loading={newBusy} leftIcon={Store}>
                  {newBusy ? 'Saving…' : 'Save & publish to all branches'}
                </Button>
              </div>
            </form>
          )}

          <div className="mt-3 space-y-2">
            {sectionsLoading && !generalRows.length ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="sakani-skeleton h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : filteredGeneral.length === 0 ? (
              <p className="rounded-lg border border-line-subtle bg-subtle/40 p-4 text-center text-body text-muted">
                {generalRows.length === 0
                  ? 'No general items priced in this cycle yet — add the first one above.'
                  : 'Nothing matches your search.'}
              </p>
            ) : (
              filteredGeneral.map((r) => rowCard('general', r))
            )}
          </div>
        </div>

        {/* ── 4. Outsourced Items (from the reps' survey, by branch) ── */}
        <div className="bg-surface rounded-xl shadow-lg border border-line-subtle p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-h3 font-semibold text-fg mb-1">🌍 Outsourced Items</h2>
              <p className="text-body text-muted">
                The drafts reps filled in the{' '}
                <Link href="/admin/food/survey" className="font-semibold underline">
                  Items Survey
                </Link>
                , grouped by branch. Refine name, category, unit and price, then attach the{' '}
                <strong>refined</strong> image from the bank (rep photos are never used). Save once → it appears in
                every branch&apos;s shop for this cycle.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" />
                <Input
                  value={outSearch}
                  onChange={(e) => setOutSearch(e.target.value)}
                  placeholder="Search survey drafts…"
                  aria-label="Search outsourced items"
                  className="w-44 pl-9"
                />
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-info-border bg-info-bg px-3 py-2 text-caption text-info-fg">
            <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
            Images come from the shared bank — if a refined photo is missing, add it in{' '}
            <Link href="/admin/food/item-images" className="font-semibold underline">
              Items Image Mang.
            </Link>{' '}
            (or use “Add image” inside the picker) and it becomes reusable for every future cycle.
          </div>

          <div className="mt-3 space-y-2">
            {sectionsLoading && !outRows.length ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="sakani-skeleton h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : sectionsError ? (
              <p className="rounded-lg border border-danger-border bg-danger-bg p-4 text-body text-danger-fg">{sectionsError}</p>
            ) : filteredOutsourced.length === 0 ? (
              <p className="rounded-lg border border-line-subtle bg-subtle/40 p-4 text-center text-body text-muted">
                {outRows.length === 0
                  ? 'No survey submissions for this cycle yet — rep drafts will land here automatically.'
                  : 'Nothing matches your search.'}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-caption text-muted">
                    {branchGroups.length} branch{branchGroups.length === 1 ? '' : 'es'} · {filteredOutsourced.length}{' '}
                    item{filteredOutsourced.length === 1 ? '' : 's'}
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setAllBranches(false)}
                      className="text-caption font-semibold text-brand underline"
                    >
                      Expand all
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllBranches(true)}
                      className="text-caption font-semibold text-brand underline"
                    >
                      Collapse all
                    </button>
                  </div>
                </div>

                {branchGroups.map((g) => {
                  const collapsed = collapsedBranches.has(g.key)
                  const savedCount = g.rows.filter((r) => r.saved).length
                  return (
                    <div key={g.key} className="overflow-hidden rounded-lg border border-line-subtle bg-subtle/40">
                      <button
                        type="button"
                        onClick={() => toggleBranch(g.key)}
                        aria-expanded={!collapsed}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-subtle"
                      >
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-subtext transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
                          strokeWidth={2}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-fg">{g.label}</span>
                          <span className="block truncate text-caption text-muted">
                            {g.rows.length} item{g.rows.length === 1 ? '' : 's'}
                            {savedCount ? ` · ${savedCount} saved to shop` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-muted">
                          {g.rows.length}
                        </span>
                      </button>
                      {!collapsed && (
                        <div className="space-y-2 border-t border-line-subtle p-2">
                          {g.rows.map((r) => rowCard('outsourced', r))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Shared datalists for category/unit inputs */}
      <datalist id="item-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="item-units">
        {['Bag', 'Carton', 'Gallon', 'Bucket', 'Crate', 'Piece', 'Kg', 'Log', 'Tin', 'Bale'].map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
    </div>
  )
}

export default function ItemsImportPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <ItemsImportContent />
    </ProtectedRoute>
  )
}
