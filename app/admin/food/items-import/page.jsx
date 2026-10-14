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
// picked from the shared Image Bank — never re-uploaded.
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
  BarChart3,
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

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

// Live SKU preview — the exact rule the server applies when the field is
// left blank: name → uppercase, letters and digits only, capped at 32
// chars ("Abakaliki Rice 25Kg" → "ABAKALIKIRICE25KG"). Shown while typing
// and fully editable the moment the admin types in the SKU field.
const skuPreview = (name) => String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 32)

// Field-by-field comparison of the SAVED shop item vs the rep's draft.
// The editor shows the full table so refining is an informed decision; the
// collapsed card just shows how many fields differ.
const draftDiffs = (saved, draft) => {
  if (!saved || !draft) return []
  const savedPrice = saved.price == null || saved.price === '' ? null : Number(saved.price)
  return [
    { field: 'Name', saved: saved.name || '', draft: draft.draft_name || '', changed: norm(saved.name) !== norm(draft.draft_name) },
    { field: 'Category', saved: saved.category || '', draft: draft.draft_category || '', changed: norm(saved.category) !== norm(draft.draft_category) },
    { field: 'Unit', saved: saved.unit || '', draft: draft.draft_unit || '', changed: norm(saved.unit) !== norm(draft.draft_unit) },
    {
      field: 'Price (₦)',
      saved: savedPrice != null && savedPrice > 0 ? fmtPrice(savedPrice) : '—',
      draft: Number(draft.draft_price) > 0 ? fmtPrice(draft.draft_price) : '—',
      changed: (savedPrice || 0) !== Number(draft.draft_price || 0),
    },
  ]
}

// Pagination: both lists page at 10 rows so a big cycle never renders as one
// endless scroll, and the outsourced branch cards page on their own so 13+
// branches don't stack at once either. Same visual language as ItemManagement.
const ROWS_PER_PAGE = 10
const GROUPS_PER_PAGE = 5

// Fallback unit list — the server's taxonomy GET supersedes it when loaded.
const DEFAULT_UNITS = ['Bag', 'Carton', 'Gallon', 'Bucket', 'Crate', 'Piece', 'Kg', 'Log', 'Tin', 'Bale']

const clampPage = (p, total) => Math.max(1, Math.min(p, Math.max(1, total)))

function ListPager({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null
  const current = clampPage(page, totalPages)
  const nums = []
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages <= 7 || i === 1 || i === totalPages || Math.abs(i - current) <= 1) nums.push(i)
    else if (nums[nums.length - 1] !== '…') nums.push('…')
  }
  const btn =
    'rounded-lg border border-line-subtle bg-subtle px-2.5 py-1.5 text-caption font-medium text-fg transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-subtle'
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 pt-3">
      <button type="button" className={btn} disabled={current === 1} onClick={() => onChange(current - 1)}>
        ‹ Prev
      </button>
      {nums.map((n, i) =>
        n === '…' ? (
          <span key={`ellipsis-${i}`} className="px-1 text-caption text-muted select-none">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-current={current === n ? 'page' : undefined}
            className={
              current === n
                ? 'rounded-lg bg-brand px-2.5 py-1.5 text-caption font-bold text-on-accent'
                : btn
            }
          >
            {n}
          </button>
        )
      )}
      <button type="button" className={btn} disabled={current === totalPages} onClick={() => onChange(current + 1)}>
        Next ›
      </button>
    </div>
  )
}

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
  // Expanded branches keyed by branch group key — empty means all collapsed.
  // Kept expanded for the current cycle/state only; resets on refresh so the
  // admin always lands on the group headers instead of a fully-open list.
  const [expandedBranches, setExpandedBranches] = useState(() => new Set())
  const [branchReport, setBranchReport] = useState(null) // submission report for the cycle
  const [reportOpen, setReportOpen] = useState(false)

  /* ── Pagination (rows are paged per list; branch cards too) ────── */
  const [genPage, setGenPage] = useState(1)
  const [outGroupPage, setOutGroupPage] = useState(1)
  const [outRowPages, setOutRowPages] = useState({}) // groupKey → page

  /* ── Shop preview (one branch, as members see it) ─────────────── */
  const [preview, setPreview] = useState(null) // { branchId, branchName, loading, error, data }
  const [previewLimit, setPreviewLimit] = useState(24)

  /* ── Category / unit pick lists (admin-managed) ───────────────── */
  const [tax, setTax] = useState({ categories: [], units: [] })
  const [taxPanel, setTaxPanel] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [newUnit, setNewUnit] = useState('')
  const [taxBusy, setTaxBusy] = useState(false)

  /* ── Full catalog (for the "pick an existing item" name dropdown) ─ */
  const [allItems, setAllItems] = useState([])

  const [editKey, setEditKey] = useState(null) // 'general:<id>' | 'outsourced:<key>' | null
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)

  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState(emptyNew)
  const [newBusy, setNewBusy] = useState(false)
  const [newErr, setNewErr] = useState(null)
  // Once the admin types in the SKU field themselves, the live
  // name-derived preview stops — their value wins from then on.
  const [newSkuTouched, setNewSkuTouched] = useState(false)

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
      const [gRes, oRes, rRes] = await Promise.all([
        fetch(`/api/admin/items?section=general&${qs}`, { cache: 'no-store', credentials: 'same-origin' }),
        fetch(`/api/admin/items?section=outsourced&${qs}`, { cache: 'no-store', credentials: 'same-origin' }),
        fetch(`/api/admin/items?section=submission_report&${qs}`, { cache: 'no-store', credentials: 'same-origin' }),
      ])
      const g = await gRes.json()
      const o = await oRes.json()
      if (!gRes.ok || !g.ok) throw new Error(g.error || 'Failed to load general items')
      if (!oRes.ok || !o.ok) throw new Error(o.error || 'Failed to load outsourced items')
      setGeneralRows(g.rows || [])
      setOutRows(o.rows || [])
      // The report is a nicety — its failure must never break the sections.
      const r = await rRes.json().catch(() => ({}))
      if (rRes.ok && r.ok) setBranchReport(r)
      else setBranchReport(null)
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

  // Paging restarts whenever the underlying list changes (new search, new cycle).
  // Branches also reset to collapsed after a refresh so the admin always lands
  // at the group headers instead of a fully-expanded list.
  useEffect(() => {
    setGenPage(1)
  }, [genSearch, selectedCycleId])
  useEffect(() => {
    setOutGroupPage(1)
    setOutRowPages({})
    setExpandedBranches(new Set())
  }, [outSearch, selectedCycleId])

  // Admin-managed pick lists (Categories & units panel) — loaded once.
  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/items/taxonomy', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && j.ok) setTax({ categories: j.categories || [], units: j.units || [] })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Full catalog for the "pick an existing item" name dropdown, so admins
  // reuse bank rows (and their images) instead of duplicating items.
  const loadAllItems = useCallback(() => {
    fetch('/api/admin/items?section=all', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setAllItems(j.items || [])
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    loadAllItems()
  }, [loadAllItems])

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

  // Pick lists merge admin-added entries with whatever is already in use,
  // so the choices only ever grow (and still work if the fetch failed).
  const categoryOptions = useMemo(
    () => [...new Set([...categories, ...tax.categories])].sort((a, b) => a.localeCompare(b)),
    [categories, tax.categories]
  )
  const unitOptions = useMemo(
    () => [...new Set([...tax.units, ...DEFAULT_UNITS])].sort((a, b) => a.localeCompare(b)),
    [tax.units]
  )

  // ── "Item name" behaves like a search box over the whole catalog ─────
  // Typing an existing item's name (exact match) fills the blank fields with
  // its SKU / category / unit / image and warns that saving UPDATES that row
  // instead of creating a duplicate.
  const existingName = useMemo(
    () => allItems.find((it) => norm(it.name) === norm(newForm.name)) || null,
    [allItems, newForm.name]
  )

  const onNewNameChange = (value) => {
    setNewForm((f) => {
      const next = { ...f, name: value }
      const match = allItems.find((it) => norm(it.name) === norm(value))
      if (match) {
        // Reuse the existing bank item — fill only blank fields, never clobber.
        if (!next.category) next.category = match.category || ''
        if (!next.unit) next.unit = match.unit || ''
        if (!next.image_url) next.image_url = match.image_url || ''
      }
      // The SKU follows the name until the admin edits it by hand: an
      // existing item contributes its real SKU, otherwise it is derived
      // from the name exactly like the server would.
      if (!newSkuTouched) next.sku = match?.sku ? String(match.sku).toUpperCase() : skuPreview(value)
      return next
    })
  }

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
      // Snapshot of what is actually in the shop right now — the diff table
      // in the editor compares the draft against THESE, not the prefilled
      // form values (which mix draft and saved fields on purpose).
      saved_values:
        section === 'outsourced' && row.saved && row.draft
          ? { name: row.name || '', category: row.category || '', unit: row.unit || '', price: row.price }
          : null,
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
      const json = await postItem(
        JSON.parse(
          JSON.stringify({
            section: form.section,
            item_id: form.item_id,
            sku: form.sku,
            name: form.name,
            category: form.category,
            unit: form.unit,
            price: form.price,
            markup: form.markup,
            image_url: form.image_url,
            ...(form.draft
              ? {
                  draft: JSON.parse(
                    JSON.stringify({
                      branch_id: form.draft.branch_id,
                      branch_name: form.draft.branch_name,
                      branch_code: form.draft.branch_code,
                      rep_name: form.draft.rep_name,
                      rep_photo: form.draft.rep_photo,
                      draft_id: form.draft.entry_id ?? null,
                      draft_name: form.draft.draft_name,
                      draft_category: form.draft.draft_category,
                      draft_unit: form.draft.draft_unit,
                      draft_price: form.draft.draft_price,
                      saved: form.draft.saved,
                      key: form.draft.key,
                    })
                  ),
                }
              : {}),
          })
        )
      )

      flash(
        (() => {
          const branchLabel =
            form.section === 'outsourced' && form.draft?.branch_name
              ? ` for ${form.draft.branch_name}`
              : ''
          const branchSufix = json.branches_priced === 1 ? '' : 'es'
          return (
            'Saved — “' + json.item.name + '” is live' + branchLabel +
            ' in ' + json.branches_priced + ' branch' + branchSufix + ' for this cycle' +
            (json.markup_branches ? ' with markup in ' + json.markup_branches + ' branch' + branchSufix : '') +
            '. It shows in the shop immediately.'
          )
        })()
      )

      cancelEdit()
      loadSections()
    } catch (e) {
      setSaveErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const addTaxonomy = async (kind) => {
    const value = (kind === 'category' ? newCat : newUnit).trim()
    if (!value || taxBusy) return
    setTaxBusy(true)
    try {
      const res = await fetch('/api/admin/items/taxonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ kind, value }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || `Could not add the ${kind}`)
      const key = kind === 'category' ? 'categories' : 'units'
      setTax((t) => ({ ...t, [key]: [...new Set([...t[key], json.value])].sort((a, b) => a.localeCompare(b)) }))
      if (kind === 'category') setNewCat('')
      else setNewUnit('')
      flash(`Added “${json.value}” to the ${kind} list`)
    } catch (e) {
      flash(e.message, 'error')
    } finally {
      setTaxBusy(false)
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
      flash(
        `Added — “${json.item.name}” is live in all ${json.branches_priced} branches for this cycle.`
      )
      setNewForm(emptyNew)
      setNewSkuTouched(false)
      setShowNew(false)
      loadSections()
      loadAllItems()
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

  const genTotalPages = Math.ceil(filteredGeneral.length / ROWS_PER_PAGE) || 1
  const genPageClamped = clampPage(genPage, genTotalPages)
  const genStart = (genPageClamped - 1) * ROWS_PER_PAGE
  const pagedGeneral = filteredGeneral.slice(genStart, genStart + ROWS_PER_PAGE)

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
    setExpandedBranches((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const setAllBranches = (collapsed) =>
    setExpandedBranches(collapsed ? new Set() : new Set(branchGroups.map((g) => g.key)))

  const outGroupTotalPages = Math.ceil(branchGroups.length / GROUPS_PER_PAGE) || 1
  const outGroupPageClamped = clampPage(outGroupPage, outGroupTotalPages)
  const outGroupsStart = (outGroupPageClamped - 1) * GROUPS_PER_PAGE
  const pagedBranchGroups = branchGroups.slice(outGroupsStart, outGroupsStart + GROUPS_PER_PAGE)

  /* ── Submission report (who filed the survey, who hasn't) ───────── */
  const reportSubmitted = useMemo(
    () =>
      (branchReport?.branches || [])
        .filter((b) => b.submitted)
        .sort((a, b) => b.entries - a.entries || String(a.name).localeCompare(String(b.name))),
    [branchReport]
  )
  const reportMissing = useMemo(
    () =>
      (branchReport?.branches || [])
        .filter((b) => !b.submitted)
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [branchReport]
  )

  const openShopPreview = async (branchId, branchName) => {
    setPreviewLimit(24)
    setPreview({ branchId, branchName, loading: true, error: null, data: null })
    try {
      const res = await fetch(
        `/api/admin/items?section=shop_preview&cycle_id=${encodeURIComponent(String(selectedCycleId))}&branch_id=${branchId}`,
        { cache: 'no-store', credentials: 'same-origin' }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load the shop preview')
      setPreview({ branchId, branchName, loading: false, error: null, data: json })
    } catch (e) {
      setPreview({
        branchId,
        branchName,
        loading: false,
        error: e.message || 'Failed to load the shop preview',
        data: null,
      })
    }
  }

  /* ── Row editor (shared by both sections) ────────────────────────── */
  const editor = () => {
    if (!form) return null
    const isOut = form.section === 'outsourced'
    const diffRows = isOut && form.saved_values && form.draft ? draftDiffs(form.saved_values, form.draft) : []
    const diffChanged = diffRows.filter((r) => r.changed).length
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

        {/* Diff: rep draft vs. what is actually in the shop right now */}
        {diffRows.length > 0 && (
          <div className="mb-3 rounded-lg border border-line bg-surface p-2.5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-fg">Rep draft vs. saved item</p>
              {diffChanged === 0 ? (
                <span className="rounded-full bg-success-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-success-fg">
                  Identical
                </span>
              ) : (
                <span className="rounded-full bg-warning-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-warning-fg">
                  {diffChanged} of {diffRows.length} fields differ
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-1 pr-2 font-medium">Field</th>
                    <th className="py-1 pr-2 font-medium">Saved in shop</th>
                    <th className="py-1 font-medium">Rep draft</th>
                  </tr>
                </thead>
                <tbody>
                  {diffRows.map((r) => (
                    <tr key={r.field} className={`border-t border-line-subtle ${r.changed ? 'bg-warning-bg' : ''}`}>
                      <td className="py-1.5 pr-2 font-medium text-fg">{r.field}</td>
                      <td className="py-1.5 pr-2 text-muted">{r.saved || '—'}</td>
                      <td className={`py-1.5 ${r.changed ? 'font-semibold text-warning-fg' : 'text-muted'}`}>
                        {r.draft || '—'}
                        {r.changed && (
                          <span className="ml-1.5 rounded bg-surface px-1 py-px text-[10px] font-bold uppercase tracking-wide text-warning-fg">
                            differs
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-caption text-muted">
              Saving replaces the shop copy with your refined values — the draft column is what{' '}
              {form.draft.rep_name ? `${form.draft.rep_name} ` : 'the rep '}
              {form.draft.branch_name ? `submitted for ${form.draft.branch_name}` : 'submitted'}.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="edit-name">Item name</Label>
            <Input
              id="edit-name"
              value={form.name}
              onChange={(e) => {
                const value = e.target.value
                setField('name', value)
                // SKU follows the name whenever the SKU field is empty or
                // holds the stale auto-generated value of the OLD name (so
                // a full rename produces a matching SKU) — but a SKU the
                // admin typed deliberately is never overwritten.
                const stale = form.sku && form.sku === skuPreview(form.name)
                if (!form.sku || stale) setField('sku', skuPreview(value))
              }}
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
              Price (₦){form.draft ? ' — for ' + form.draft.branch_name : ' — applied to every branch'}{form.price_varies ? ' (varies by branch)' : ''}
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
              Markup (₦){form.draft ? ' — for ' + form.draft.branch_name : ' — applied to every branch'}{form.markup_varies ? ' (varies by branch)' : ''}
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
              onChange={(url, bankRow) => {
                setField('image_url', url)
                // Picking a bank item adopts its identity — the rep's draft
                // name ("Kings Oil 5 Litres") becomes the bank's refined
                // name ("Kings Oil 5Ltrs") with the bank's real SKU, so the
                // item joins the catalog instead of duplicating it.
                if (bankRow) {
                  setField('name', bankRow.name || '')
                  setField('sku', String(bankRow.sku || '').toUpperCase())
                  if (bankRow.category && !form.category) setField('category', bankRow.category)
                  if (bankRow.unit && !form.unit) setField('unit', bankRow.unit)
                }
              }}
              name={form.name}
              sku={form.sku}
              label="Refined image (linked from the Image Bank)"
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
            {form.draft
              ? `Saves the refined item into ${form.draft.branch_name}'s shop for this cycle — price and markup apply to that branch only, not the whole co-op.`
              : `Saves the item once and writes its price to every branch of ${cycle?.name || 'this cycle'} — no duplicate uploads, no redundant rows.`}
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
    const draftDiff =
      section === 'outsourced' && row.saved && row.draft
        ? draftDiffs(row, row.draft).filter((r) => r.changed).length
        : 0

    return (
      <div key={key} className={`rounded-lg border bg-surface p-3 ${expanded ? 'border-brand/50' : section === 'outsourced' && saved ? 'border-success-border' : 'border-line-subtle'}`}>
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
                  <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
                  {section === 'outsourced' ? '✓ Worked on · in shop' : 'In shop'}
                </span>
              ) : saved ? (
                <span className="rounded-full bg-warning-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-warning-fg">
                  {section === 'outsourced' ? '✓ Worked on · not in shop' : 'Not in shop yet'}
                </span>
              ) : (
                <span
                  className={`rounded-full px-2 py-0.5 text-chips font-bold uppercase tracking-wide ${
                    section === 'outsourced' ? 'bg-warning-bg text-warning-fg' : 'bg-info-bg text-info-fg'
                  }`}
                >
                  {section === 'outsourced' ? 'Not worked on yet' : 'Survey draft'}
                </span>
              )}
              {!img && (
                <span className="rounded-full bg-subtle px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-muted">
                  No bank image
                </span>
              )}
              {draftDiff > 0 && (
                <span
                  className="rounded-full bg-warning-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-warning-fg"
                  title="The rep's draft differs from the saved item — open Edit to compare"
                >
                  draft differs ({draftDiff})
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
              variant="secondary"
              size="sm"
              onClick={() => (expanded ? cancelEdit() : startEdit(section, row))}
            >
              {expanded ? 'Close' : saved ? 'Edit' : 'Edit & save'}
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
          <div className="w-full">
            <Label htmlFor="items-cycle">Target cycle</Label>
            <Select
              id="items-cycle"
              value={selectedCycleId ?? ''}
              onChange={(e) => setSelectedCycleId(e.target.value ? Number(e.target.value) : null)}
              disabled={loadingCycles || cycles.length === 0}
              className="w-full"
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
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setTaxPanel((v) => !v)} leftIcon={Plus}>
            {taxPanel ? 'Hide lists' : 'Categories & units'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { loadCycles(); loadSections() }} loading={loadingCycles || sectionsLoading} leftIcon={RefreshCw}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Category & unit pick lists — add once, usable everywhere below */}
      {taxPanel && (
        <div className="mb-4 rounded-xl border border-line bg-surface p-4">
          <h2 className="text-h3 font-semibold text-fg mb-1">Categories & units</h2>
          <p className="text-body text-muted mb-3">
            Add a name once and it becomes a choice in every category/unit field on this page. An item only carries
            the category you save on it — saving writes the shared item, so the shop, reports and previews pick the
            change up immediately.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="tax-new-category">Add a category</Label>
              <div className="flex gap-2">
                <Input
                  id="tax-new-category"
                  value={newCat}
                  onChange={(e) => setNewCat(e.target.value)}
                  placeholder="e.g. Instant Noodles"
                  maxLength={60}
                />
                <Button onClick={() => addTaxonomy('category')} loading={taxBusy} disabled={taxBusy || !newCat.trim()}>
                  Add
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {categoryOptions.length === 0 ? (
                  <span className="text-caption text-muted">No categories yet.</span>
                ) : (
                  categoryOptions.map((c) => (
                    <span
                      key={c}
                      className="rounded-full border border-line-subtle bg-subtle px-2 py-0.5 text-chips text-muted"
                    >
                      {c}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="tax-new-unit">Add a unit</Label>
              <div className="flex gap-2">
                <Input
                  id="tax-new-unit"
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  placeholder="e.g. Pallet"
                  maxLength={60}
                />
                <Button onClick={() => addTaxonomy('unit')} loading={taxBusy} disabled={taxBusy || !newUnit.trim()}>
                  Add
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {unitOptions.map((u) => (
                  <span
                    key={u}
                    className="rounded-full border border-line-subtle bg-subtle px-2 py-0.5 text-chips text-muted"
                  >
                    {u}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

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
              <Button size="sm" leftIcon={Plus} onClick={() => { setShowNew((v) => !v); setNewSkuTouched(false); cancelEdit() }}>
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
                    onChange={(e) => onNewNameChange(e.target.value)}
                    list="existing-item-names"
                    placeholder="Type to search the item bank, or enter a new name"
                    maxLength={255}
                  />
                  {existingName ? (
                    <p className="mt-1 text-caption text-success-fg">
                      Existing item found — saving updates it everywhere (SKU {existingName.sku}) instead of creating a
                      duplicate.
                    </p>
                  ) : (
                    <p className="mt-1 text-caption text-muted">
                      Pick an existing item to reuse its SKU, category, unit and image — or type a new name to create
                      one.
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="new-sku">SKU (optional)</Label>
                  <Input
                    id="new-sku"
                    value={newForm.sku}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase()
                      setNewForm((f) => ({ ...f, sku: v }))
                      // Clearing the field hands SKU control back to the
                      // name — otherwise a single touch disables the
                      // auto-generated SKU for the rest of the form's life.
                      setNewSkuTouched(v.trim().length > 0)
                    }}
                    placeholder="Generated from the name as you type"
                    maxLength={100}
                  />
                  <p className="mt-1 text-caption text-muted">
                    {newSkuTouched
                      ? 'Your own SKU — clear the field to make it follow the name again.'
                      : 'Derived from the item name — type in the field to set your own.'}
                  </p>
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
                    onChange={(url, bankRow) => {
                      setNewForm((f) => ({
                        ...f,
                        image_url: url,
                        // Adopting a bank item fills every blank field from
                        // the bank row — name, SKU, category, unit.
                        ...(bankRow
                          ? {
                              name: bankRow.name || f.name,
                              sku: String(bankRow.sku || '').toUpperCase() || f.sku,
                              category: f.category || bankRow.category || '',
                              unit: f.unit || bankRow.unit || '',
                            }
                          : {}),
                      }))
                    }}
                    name={newForm.name}
                    sku={newForm.sku}
                    label="Refined image (linked from the Image Bank)"
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
              <>
                {pagedGeneral.map((r) => rowCard('general', r))}
                <p className="pt-1 text-center text-caption text-muted">
                  Showing {genStart + 1}–{Math.min(genStart + ROWS_PER_PAGE, filteredGeneral.length)} of{' '}
                  {filteredGeneral.length} items · {ROWS_PER_PAGE} items per page
                </p>
                <ListPager page={genPageClamped} totalPages={genTotalPages} onChange={setGenPage} />
              </>
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
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setReportOpen((v) => !v)}
                leftIcon={BarChart3}
              >
                {reportOpen ? 'Hide report' : 'Submission report'}
                {branchReport ? ` · ${branchReport.submitted}/${branchReport.total}` : ''}
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-info-border bg-info-bg px-3 py-2 text-caption text-info-fg">
            <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
            Images come from the shared bank — if a refined photo is missing, add it in{' '}
            <Link href="/admin/food/image-bank" className="font-semibold underline">
              Image Bank
            </Link>{' '}
            (or use “Add image” inside the picker) and it becomes reusable for every future cycle.
          </div>

          {/* Submission report — who filed the survey this cycle, who hasn't */}
          {reportOpen && (
            <div className="mt-3 rounded-lg border border-line bg-subtle/40 p-3">
              {!branchReport ? (
                <p className="text-body text-muted">
                  No report data for this cycle — press Refresh above, or check that reps can submit surveys.
                </p>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="text-body font-semibold text-fg">
                      {branchReport.submitted} of {branchReport.total} branches submitted
                    </p>
                    <span className="rounded-full bg-info-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-info-fg">
                      {branchReport.draft_count} drafts
                    </span>
                    {reportMissing.length > 0 ? (
                      <span className="rounded-full bg-warning-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-warning-fg">
                        {reportMissing.length} not submitted
                      </span>
                    ) : (
                      <span className="rounded-full bg-success-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-success-fg">
                        All in
                      </span>
                    )}
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-success-fg">
                        Submitted ({reportSubmitted.length})
                      </p>
                      {reportSubmitted.length === 0 ? (
                        <p className="text-body text-muted">No submissions yet for this cycle.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {reportSubmitted.map((b) => (
                            <button
                              key={b.branch_id}
                              type="button"
                              onClick={() => setOutSearch(b.name)}
                              title={`${b.entries} draft${b.entries === 1 ? '' : 's'}${
                                b.reps?.length ? ` · ${b.reps.join(', ')}` : ''
                              }${b.last_at ? ` · last at ${new Date(b.last_at).toLocaleString()}` : ''} — click to filter the list`}
                              className="rounded-full border border-success-border bg-success-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-success-fg transition-opacity hover:opacity-75"
                            >
                              {b.name}
                              {b.code ? ` (${b.code})` : ''} · {b.entries}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-warning-fg">
                        Not yet submitted ({reportMissing.length})
                      </p>
                      {reportMissing.length === 0 ? (
                        <p className="text-body text-success-fg">Every branch has submitted — nothing outstanding.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {reportMissing.map((b) => (
                            <span
                              key={b.branch_id}
                              className="rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-chips font-bold uppercase tracking-wide text-warning-fg"
                            >
                              {b.name}
                              {b.code ? ` (${b.code})` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="mt-2 text-caption text-muted">
                    Counts the drafts that appear in this list for {cycle?.name || 'the selected cycle'} — click a
                    submitted branch to filter the list below. Branches are flagged missing as soon as a new cycle
                    starts, so chasing submissions is a glance, not a query.
                  </p>
                </>
              )}
            </div>
          )}

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

                {pagedBranchGroups.map((g) => {
                  const collapsed = !expandedBranches.has(g.key)
                  const savedCount = g.rows.filter((r) => r.saved).length
                  const rowsTotal = Math.ceil(g.rows.length / ROWS_PER_PAGE) || 1
                  const rowsPage = clampPage(outRowPages[g.key] ?? 1, rowsTotal)
                  const rowsStart = (rowsPage - 1) * ROWS_PER_PAGE
                  const pagedRows = g.rows.slice(rowsStart, rowsStart + ROWS_PER_PAGE)
                  const branchDraft = g.rows.find((r) => r.draft?.branch_id != null)?.draft || null
                  return (
                    <div key={g.key} className="overflow-hidden rounded-lg border border-line-subtle bg-subtle/40">
                      <div className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-subtle">
                        <button
                          type="button"
                          onClick={() => toggleBranch(g.key)}
                          aria-expanded={!collapsed}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
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
                        {branchDraft && (
                          <Button
                            variant="secondary"
                            size="sm"
                            leftIcon={Store}
                            className="shrink-0"
                            onClick={() => openShopPreview(branchDraft.branch_id, branchDraft.branch_name)}
                          >
                            Shop preview
                          </Button>
                        )}
                      </div>
                      {!collapsed && (
                        <div className="space-y-2 border-t border-line-subtle p-2">
                          {pagedRows.map((r) => rowCard('outsourced', r))}
                          {rowsTotal > 1 && (
                            <>
                              <p className="text-center text-caption text-muted">
                                Showing {rowsStart + 1}–
                                {Math.min(rowsStart + ROWS_PER_PAGE, g.rows.length)} of {g.rows.length} items in{' '}
                                {g.label}
                              </p>
                              <ListPager
                                page={rowsPage}
                                totalPages={rowsTotal}
                                onChange={(p) => setOutRowPages((prev) => ({ ...prev, [g.key]: p }))}
                              />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                <p className="text-center text-caption text-muted">
                  Branches {outGroupsStart + 1}–
                  {Math.min(outGroupsStart + GROUPS_PER_PAGE, branchGroups.length)} of {branchGroups.length} ·{' '}
                  {GROUPS_PER_PAGE} branches per page
                </p>
                <ListPager page={outGroupPageClamped} totalPages={outGroupTotalPages} onChange={setOutGroupPage} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Shop preview — one branch's shop exactly as members see it */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Shop preview — ${preview.branchName}`}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-h3 font-semibold text-fg">🛒 {preview.branchName} — shop preview</h3>
                <p className="mt-0.5 text-caption text-muted">
                  {cycle?.name || 'This cycle'}
                  {preview.data
                    ? ` · ${preview.data.total} items live${
                        preview.data.draft_hits ? ` · ${preview.data.draft_hits} from this branch's drafts` : ''
                      }`
                    : ''}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                Close
              </Button>
            </div>

            <div className="overflow-y-auto p-4">
              {preview.loading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="sakani-skeleton h-32 w-full rounded-lg" />
                  ))}
                </div>
              ) : preview.error ? (
                <p className="rounded-lg border border-danger-border bg-danger-bg p-4 text-body text-danger-fg">
                  {preview.error}
                </p>
              ) : !preview.data || preview.data.items.length === 0 ? (
                <p className="rounded-lg border border-line-subtle bg-subtle/40 p-6 text-center text-body text-muted">
                  Nothing is priced for this branch in {cycle?.name || 'this cycle'} yet — save an item and it shows
                  up here immediately.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {preview.data.items.slice(0, previewLimit).map((it) => (
                      <div
                        key={it.item_id}
                        className={`rounded-lg border p-2 ${
                          it.from_draft ? 'border-brand/50 bg-subtle/40' : 'border-line-subtle bg-surface'
                        }`}
                      >
                        <div className="relative mb-2 h-20 w-full overflow-hidden rounded-md bg-canvas">
                          {it.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={it.image_url}
                              alt={it.name}
                              loading="lazy"
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-muted">
                              <ImageIcon className="h-5 w-5" strokeWidth={1.8} />
                            </span>
                          )}
                          {it.from_draft && (
                            <span className="absolute left-1 top-1 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-on-accent">
                              Draft
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs font-semibold text-fg" title={it.name}>
                          {it.name}
                        </p>
                        <p className="text-[11px] text-muted">
                          {it.unit}
                          {it.category ? ` · ${it.category}` : ''}
                        </p>
                        <p className="text-sm font-bold text-fg">₦{fmtPrice(it.price)}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-center text-caption text-muted">
                    Showing {Math.min(previewLimit, preview.data.items.length)} of {preview.data.items.length} items —
                    exactly what members see in {preview.branchName}&apos;s shop (price includes this branch&apos;s
                    markup).
                  </p>
                  {preview.data.items.length > previewLimit && (
                    <div className="mt-2 text-center">
                      <Button variant="secondary" size="sm" onClick={() => setPreviewLimit((l) => l + 24)}>
                        Show more
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Shared datalists for category/unit inputs */}
      <datalist id="item-categories">
        {categoryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="item-units">
        {unitOptions.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <datalist id="existing-item-names">
        {allItems.slice(0, 400).map((it) => (
          <option key={it.item_id} value={it.name}>
            {it.sku}
            {it.category ? ` · ${it.category}` : ''}
          </option>
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
