"use client"

// app/admin/food/survey/page.jsx
// Food Distribution · Item Survey — every rep submission (price + photo per
// item), with full admin control:
//   - open/close the survey per cycle (reps can only submit while it's open)
//   - edit any submission (name, branch, cycle, entries incl. per-entry category)
//   - add entries yourself (same form the reps use)
//   - download or delete individual images
//   - manage the survey item catalog (add items, fix categories)
//   - filter by cycle / branch / search
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import FoodSurveyForm from '../../../components/FoodSurveyForm'
import Button from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import Label from '../../../components/ui/Label'
import Badge from '../../../components/ui/Badge'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import EmptyState from '../../../components/ui/EmptyState'
import {
  Camera,
  ClipboardList,
  Copy,
  Download,
  FileSpreadsheet,
  ImageOff,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Undo2,
} from 'lucide-react'

const fmtPrice = (v) =>
  Number(v || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-NG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

const entryKey = (e, i) => e.id ?? `n_${i}`

// End-of-day semantics for date-only cycle end dates ('YYYY-MM-DD' parses as
// UTC midnight; the survey stays usable for the whole of that day).
const endsAtMs = (value) => {
  const t = new Date(value).getTime()
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? t + 24 * 60 * 60 * 1000 : t
}

const fmtDay = (value) => {
  try {
    return new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return value
  }
}

/* ── Catalog manager ───────────────────────────────────────────────────── */

function CatalogManager({ open, onClose }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [search, setSearch] = useState('') // quick find over name / category / unit
  const [catFilter, setCatFilter] = useState('') // '' = every category
  const [drafts, setDrafts] = useState({}) // unsaved inline edits, keyed by item id
  const [savingId, setSavingId] = useState(null) // row whose Save is in flight
  const [newUnit, setNewUnit] = useState('')
  const [dragId, setDragId] = useState(null) // item being dragged
  const [reordering, setReordering] = useState(false)
  const itemsRef = useRef([])
  itemsRef.current = items

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/food-survey/catalog', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Failed to load catalog')
      setItems(json.items || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const categories = useMemo(() => {
    const set = new Set()
    for (const i of items) if (i.category) set.add(i.category)
    return [...set].sort()
  }, [items])

  // Table growth: search + a category dropdown instead of pagination — pages
  // would split one drag-to-reorder list, while a filter keeps every item one
  // keystroke away in a single reorderable view.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (catFilter && String(i.category || '') !== catFilter) return false
      if (q && !`${i.name} ${i.category || ''} ${i.unit || ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, search, catFilter])

  const filterActive = !!catFilter || !!search.trim()

  const addItem = async (e) => {
    e.preventDefault()
    if (newName.trim().length < 2) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/food-survey/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), category: newCategory.trim() || 'Other', unit: newUnit.trim() }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Failed to add item')
      setItems((prev) => [...prev, json.item])
      setNewName('')
      setNewCategory('')
      setNewUnit('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const patchItem = async (id, patch) => {
    setError(null)
    try {
      const res = await fetch('/api/admin/food-survey/catalog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Failed to update item')
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...json.item } : i)))
      return json.item
    } catch (err) {
      setError(err.message)
      return null
    }
  }

  /* ── Inline edits — drafts until Save ────────────────────────────────
     Fields are edited into a per-row draft; nothing touches the API until
     the row's Save button (or Enter) is pressed, so every change is an
     explicit, visible commit. */
  const val = (item, field) => {
    const d = drafts[item.id]
    if (d && d[field] !== undefined) return d[field]
    return field === 'unit' ? String(item.unit || '') : item[field]
  }

  const editField = (item, field, value) =>
    setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], [field]: value } }))

  const isDirty = (item) => {
    const d = drafts[item.id]
    if (!d) return false
    if (d.name !== undefined && d.name !== item.name) return true
    if (d.category !== undefined && d.category !== String(item.category || '')) return true
    if (d.unit !== undefined && d.unit !== String(item.unit || '')) return true
    return false
  }

  const revertRow = (id) =>
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

  // How many rows a category re-wording touches: wording that already exists
  // elsewhere = moving this row only; brand-new wording = renaming the old
  // category everywhere it is still used (so the form stays in one group).
  const categoryScope = (item) => {
    const next = String(drafts[item.id]?.category ?? '').trim()
    if (!next || next === String(item.category || '')) return 0
    const taken = items.some((i) => i.id !== item.id && String(i.category || '') === next)
    if (taken) return 1
    return items.filter((i) => String(i.category || '') === String(item.category || '')).length
  }

  const saveRow = async (item) => {
    const d = drafts[item.id]
    if (!d) return
    const patch = {}
    if (d.name !== undefined && d.name.trim() !== item.name) patch.name = d.name.trim()
    const cat = String(d.category ?? '').trim()
    if (d.category !== undefined && cat && cat !== String(item.category || '')) patch.category = cat
    if (d.unit !== undefined && d.unit.trim() !== String(item.unit || '')) patch.unit = d.unit.trim()
    if (!Object.keys(patch).length) return revertRow(item.id)
    if (patch.name !== undefined && patch.name.length < 2) {
      setError('An item name needs at least 2 characters.')
      return
    }
    setSavingId(item.id)
    setError(null)
    try {
      if (patch.category !== undefined && categoryScope(item) > 1) {
        const old = String(item.category || '')
        for (const sib of itemsRef.current) {
          if (sib.id === item.id || String(sib.category || '') !== old) continue
          const savedSibling = await patchItem(sib.id, { category: patch.category })
          if (!savedSibling) return // error is shown; keep the draft unsaved
        }
      }
      const saved = await patchItem(item.id, patch)
      if (saved) revertRow(item.id)
    } finally {
      setSavingId(null)
    }
  }

  // ── Reorder (drag & drop on desktop, ↑/↓ buttons on touch) ─────────
  const moveItem = (fromId, toId) =>
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === fromId)
      const to = prev.findIndex((i) => i.id === toId)
      if (from < 0 || to < 0 || from === to) return prev
      const next = [...prev]
      const [row] = next.splice(from, 1)
      next.splice(to, 0, row)
      return next
    })

  const persistOrder = async (list) => {
    const ids = (list || itemsRef.current).map((i) => i.id)
    setReordering(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/food-survey/catalog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: ids }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Failed to save the new order')
    } catch (err) {
      setError(err.message)
      load() // restore the server order after a failed save
    } finally {
      setReordering(false)
      setDragId(null)
    }
  }

  const moveBy = async (index, delta) => {
    const next = [...itemsRef.current]
    const to = index + delta
    if (to < 0 || to >= next.length) return
    const [row] = next.splice(index, 1)
    next.splice(to, 0, row)
    setItems(next)
    await persistOrder(next)
  }

  const deleteItem = async () => {
    if (!pendingDelete) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/food-survey/catalog?id=${pendingDelete.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Failed to delete item')
      setItems((prev) => prev.filter((i) => i.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="mb-6 rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">Survey item list</h2>
          <p className="mt-0.5 text-xs text-muted">
            The items reps see on the survey form. Edit a field, then press <strong>Save</strong> to keep it;
            re-wording a category re-groups every item still using the old wording. Use the search box or the
            category dropdown to find items in a long list, and drag by the ⠿ handle (or ↑ ↓) to set the order — reps
            see them in this exact order.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {/* Add item */}
      <form onSubmit={addItem} className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="cat-name">Item name</Label>
          <Input id="cat-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Semovita" maxLength={255} />
        </div>
        <div className="flex-1">
          <Label htmlFor="cat-category">Category</Label>
          <Input id="cat-category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Cereals & Grains" list="cat-categories" maxLength={100} />
          <datalist id="cat-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="sm:w-36">
          <Label htmlFor="cat-unit">Unit</Label>
          <Input id="cat-unit" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} placeholder="e.g. Bag" list="cat-units" maxLength={50} />
          <datalist id="cat-units">
            {['Bag', 'Carton', 'Gallon', 'Bucket', 'Crate', 'Piece', 'Kg', 'Log', 'Tin', 'Bale'].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <Button type="submit" loading={saving} leftIcon={Plus}>
          Add item
        </Button>
      </form>

      {/* Search + category filter: keeps a growing list manageable without
          splitting it into pages (which would break drag reordering). */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtext" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            aria-label="Search the item list"
            className="pl-8"
          />
        </div>
        <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="sm:w-52" aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        {filterActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('')
              setCatFilter('')
            }}
          >
            Clear
          </Button>
        )}
        <p className="text-xs text-muted sm:pl-1">
          {filterActive ? `${filtered.length} of ${items.length} items` : `${items.length} items`}
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-danger-border bg-danger-bg p-2.5 text-sm text-danger-fg">{error}</div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="sakani-skeleton h-9 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs sm:text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="w-8 p-2">
                  <span className="sr-only">Reorder</span>
                </th>
                <th className="p-2 font-medium">Item</th>
                <th className="p-2 font-medium">Category</th>
                <th className="p-2 font-medium">Unit</th>
                <th className="p-2 font-medium">Shown</th>
                <th className="p-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((item) => {
                const idx = items.findIndex((i) => i.id === item.id)
                const dirty = isDirty(item)
                const scope = dirty ? categoryScope(item) : 0
                return (
                <tr
                  key={item.id}
                  onDragOver={(e) => {
                    if (!dragId) return
                    e.preventDefault()
                    if (dragId !== item.id) moveItem(dragId, item.id)
                  }}
                  className={[dragId === item.id ? 'opacity-50' : '', dirty ? 'bg-brand-subtle/50' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <td className="p-2">
                    <span
                      draggable={!filterActive}
                      onDragStart={() => !filterActive && setDragId(item.id)}
                      onDragEnd={() => {
                        if (dragId) persistOrder()
                        else setDragId(null)
                      }}
                      title={filterActive ? 'Clear the search/filter to reorder' : 'Drag to reorder'}
                      className={`inline-flex h-7 w-6 items-center justify-center rounded text-subtext transition-colors hover:bg-subtle hover:text-fg ${
                        filterActive ? 'cursor-not-allowed opacity-40' : 'cursor-grab active:cursor-grabbing'
                      }`}
                    >
                      <GripVertical className="h-4 w-4" strokeWidth={2} />
                    </span>
                  </td>
                  <td className="p-2">
                    <Input
                      value={val(item, 'name')}
                      onChange={(e) => editField(item, 'name', e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          saveRow(item)
                        }
                      }}
                      className="h-8 text-xs sm:text-sm"
                      aria-label={`Item name for ${item.name}`}
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      value={val(item, 'category')}
                      list="cat-categories"
                      onChange={(e) => editField(item, 'category', e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          saveRow(item)
                        }
                      }}
                      className="h-8 text-xs sm:text-sm"
                      aria-label={`Category for ${item.name}`}
                    />
                    {scope > 1 && (
                      <p className="mt-1 text-[10px] leading-tight text-muted">
                        Saving renames “{item.category}” on all {scope} items
                      </p>
                    )}
                  </td>
                  <td className="p-2">
                    <Input
                      value={val(item, 'unit')}
                      list="cat-units"
                      onChange={(e) => editField(item, 'unit', e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          saveRow(item)
                        }
                      }}
                      placeholder="—"
                      className="h-8 text-xs sm:text-sm"
                      aria-label={`Unit for ${item.name}`}
                    />
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => patchItem(item.id, { active: !item.active })}
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      title="Toggle visibility on the form"
                    >
                      <Badge tone={item.active ? 'success' : 'neutral'} variant="subtle">
                        {item.active ? 'Visible' : 'Hidden'}
                      </Badge>
                    </button>
                  </td>
                  <td className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {dirty && (
                        <>
                          <button
                            type="button"
                            onClick={() => saveRow(item)}
                            disabled={savingId === item.id}
                            aria-label={`Save changes to ${item.name}`}
                            title="Save this row (or press Enter inside a field)"
                            className="inline-flex h-7 items-center rounded-md bg-brand px-2 text-[11px] font-semibold text-on-accent transition-colors hover:bg-brand-hover disabled:opacity-60"
                          >
                            {savingId === item.id ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => revertRow(item.id)}
                            aria-label={`Discard changes to ${item.name}`}
                            title="Discard changes"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-fg"
                          >
                            <Undo2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => moveBy(idx, -1)}
                        disabled={filterActive || idx === 0 || reordering}
                        aria-label={`Move ${item.name} up`}
                        title="Move up"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" strokeWidth={2.2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBy(idx, 1)}
                        disabled={filterActive || idx === items.length - 1 || reordering}
                        aria-label={`Move ${item.name} down`}
                        title="Move down"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(item)}
                        aria-label={`Delete ${item.name}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger-bg hover:text-danger-fg"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
              {!items.length && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted">
                    No items yet — add the first one above.
                  </td>
                </tr>
              )}
              {items.length > 0 && !filtered.length && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted">
                    Nothing matches your search or filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={deleteItem}
        loading={saving}
        title="Remove this item?"
        message={`"${pendingDelete?.name}" disappears from the survey form. Existing submissions keep their saved copy.`}
        confirmLabel="Remove"
      />
    </div>
  )
}

/* ── Survey activation (open/close per cycle) ────────────────────────── */

function SurveyStatusPanel({ cycles, togglingId, onToggle }) {
  if (!cycles.length) return null

  // survey_open is null until migrations/cycle-survey-open.sql has been run.
  if (cycles.every((c) => c.survey_open == null)) {
    return (
      <div className="mb-5 rounded-xl border border-warning-border bg-warning-bg p-4 text-xs text-warning-fg shadow-xs">
        <p className="font-semibold">Survey activation is not enabled yet</p>
        <p className="mt-1">
          Run <code className="rounded bg-surface px-1.5 py-0.5 font-semibold text-fg">migrations/cycle-survey-open.sql</code>{' '}
          in the Supabase SQL editor to open/close the survey per cycle. Until then it behaves as before (open while
          a cycle is active).
        </p>
      </div>
    )
  }

  const dateOpen = (c) => !!c.survey_open && (!c.ends_at || endsAtMs(c.ends_at) > Date.now())
  const openCycle = cycles.find(dateOpen)
  const flaggedExpired = cycles.filter((c) => c.survey_open && !dateOpen(c))

  return (
    <div className="mb-5 rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-fg">Survey activation</h2>
          <p className="mt-0.5 text-xs text-muted">
            Reps (and the public link) can only submit while a cycle has the survey open. Opening one cycle
            closes it for the others; a cycle end date closes it automatically.
          </p>
        </div>
        <Badge tone={openCycle ? 'success' : 'neutral'} variant="subtle">
          {openCycle ? `Open — ${openCycle.name}` : 'Closed for reps'}
        </Badge>
      </div>

      <ul className="space-y-2">
        {cycles.map((c) => {
          const isOpen = dateOpen(c)
          const expired = !!c.survey_open && !!c.ends_at && endsAtMs(c.ends_at) <= Date.now()
          return (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-subtle/40 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{c.name}</span>
                <span className="block text-xs text-muted">
                  {c.code ? `${c.code} · ` : ''}
                  {c.ends_at ? `Ends ${fmtDay(c.ends_at)}` : 'No end date'}
                </span>
              </div>
              <Badge tone={isOpen ? 'success' : expired ? 'warning' : 'neutral'} variant="subtle">
                {isOpen ? 'Survey open' : expired ? 'Date passed' : 'Closed'}
              </Badge>
              {expired ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled
                  title="The end date has passed — extend the cycle's end date in Data Management to reopen"
                >
                  Date passed
                </Button>
              ) : (
                <Button
                  variant={isOpen ? 'secondary' : 'brand'}
                  size="sm"
                  loading={togglingId === c.id}
                  disabled={togglingId != null}
                  onClick={() => onToggle(c, !isOpen)}
                >
                  {isOpen ? 'Close survey' : 'Open survey'}
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      {flaggedExpired.length > 0 && (
        <p className="mt-2 text-xs text-warning-fg">
          {flaggedExpired.length === 1 ? 'A cycle has' : 'Cycles have'} the survey flagged open but its end date has
          passed — extend the end date in Data Management, or close it here.
        </p>
      )}
    </div>
  )
}

/* ── Submission card ───────────────────────────────────────────────────── */

function SubmissionCard({ sub, onEdit, onDelete, onPhotoDeleted }) {
  const [open, setOpen] = useState(false)
  const [expandedPhoto, setExpandedPhoto] = useState(null)
  const [photoBusy, setPhotoBusy] = useState(false)

  const itemCount = sub.entries?.length || 0

  const downloadPhoto = async (entry) => {
    if (!entry.photo_url) return
    try {
      const res = await fetch(entry.photo_url)
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `${entry.item_name.replace(/[^\w-]+/g, '_')}_${entry.id}.jpg`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
    } catch {
      // Cross-origin fallback — open it so the user can save it.
      window.open(entry.photo_url, '_blank', 'noopener')
    }
  }

  const deletePhoto = async (entry) => {
    setPhotoBusy(true)
    try {
      const res = await fetch(`/api/admin/food-survey/photo?entry_id=${entry.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Failed to delete image')
      onPhotoDeleted(sub.id, entry.id)
      setExpandedPhoto((cur) => (cur && cur.id === entry.id ? { ...cur, photo_url: null } : cur))
    } catch (e) {
      alert(e.message)
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface shadow-xs">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-fg">{sub.rep_name}</span>
            <Badge tone={sub.source === 'admin' ? 'accent' : 'brand'} variant="subtle">
              {sub.source === 'admin' ? 'Admin entry' : 'Rep'}
            </Badge>
            {sub.cycle && (
              <Badge tone="info" variant="subtle">
                {sub.cycle.name}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {sub.branch?.name || 'Unknown branch'}
            {sub.branch?.code ? ` (${sub.branch.code})` : ''}
            {sub.phone ? ` · ${sub.phone}` : ''} · {fmtDate(sub.created_at)} ·{' '}
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </p>
          {sub.notes && (
            <p className="mt-1 rounded-lg bg-subtle px-2.5 py-1.5 text-xs text-fg/80">{sub.notes}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onEdit(sub)} leftIcon={Pencil}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(sub)} leftIcon={Trash2}>
            Delete
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} rightIcon={ChevronDown}>
            {open ? 'Hide' : `View ${itemCount}`}
          </Button>
        </div>
      </div>

      {/* Entries grid */}
      {open && (
        <div className="border-t border-line p-4">
          {itemCount === 0 ? (
            <p className="text-sm text-muted">No items in this submission.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {sub.entries.map((e, i) => (
                <div
                  key={entryKey(e, i)}
                  className="group overflow-hidden rounded-xl border border-line bg-subtle"
                >
                  <button
                    type="button"
                    onClick={() => e.photo_url && setExpandedPhoto(e)}
                    className="relative block aspect-square w-full overflow-hidden bg-canvas"
                    disabled={!e.photo_url}
                    title={e.photo_url ? 'View photo' : 'No photo'}
                  >
                    {e.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={e.photo_url}
                        alt={e.item_name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted">
                        <ImageOff className="h-6 w-6" strokeWidth={1.8} />
                        <span className="text-[11px]">No photo</span>
                      </span>
                    )}
                    {e.photo_url && (
                      <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-full bg-canvas/90 px-1.5 py-0.5 text-[11px] font-semibold text-fg shadow-xs">
                        <Camera className="h-3 w-3" strokeWidth={2.2} />
                        View
                      </span>
                    )}
                  </button>
                  <div className="p-2.5">
                    <p className="truncate text-xs font-medium text-fg">{e.item_name}</p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] text-muted">{e.category}</span>
                      <span className="shrink-0 text-xs font-semibold text-fg">₦{fmtPrice(e.price)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => downloadPhoto(e)}
                        disabled={!e.photo_url}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-line bg-surface px-1.5 py-1 text-[11px] font-medium text-fg transition-colors hover:bg-subtle disabled:opacity-40"
                      >
                        <Download className="h-3 w-3" strokeWidth={2.2} />
                        Download
                      </button>
                      <button
                        type="button"
                        onClick={() => deletePhoto(e)}
                        disabled={!e.photo_url || photoBusy}
                        className="inline-flex items-center justify-center rounded-md border border-line bg-surface px-1.5 py-1 text-muted transition-colors hover:border-danger-border hover:bg-danger-bg hover:text-danger-fg disabled:opacity-40"
                        aria-label="Delete image"
                        title="Delete image"
                      >
                        <Trash2 className="h-3 w-3" strokeWidth={2.2} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Photo lightbox */}
      {expandedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setExpandedPhoto(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {expandedPhoto.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={expandedPhoto.photo_url}
                alt={expandedPhoto.item_name}
                className="max-h-[65vh] w-full object-contain bg-canvas"
              />
            ) : (
              <div className="flex h-48 flex-col items-center justify-center gap-2 bg-canvas text-muted">
                <ImageOff className="h-8 w-8" strokeWidth={1.6} />
                <span className="text-sm">Image deleted</span>
              </div>
            )}
            <div className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-fg">{expandedPhoto.item_name}</p>
                  <p className="text-xs text-muted">{expandedPhoto.category}</p>
                </div>
                <span className="text-base font-bold text-fg">₦{fmtPrice(expandedPhoto.price)}</span>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={Download}
                  disabled={!expandedPhoto.photo_url}
                  onClick={() => downloadPhoto(expandedPhoto)}
                >
                  Download
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  leftIcon={Trash2}
                  loading={photoBusy}
                  disabled={!expandedPhoto.photo_url}
                  onClick={() => deletePhoto(expandedPhoto)}
                >
                  Delete image
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setExpandedPhoto(null)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function AdminFoodSurveyPage() {
  const [submissions, setSubmissions] = useState([])
  const [cycles, setCycles] = useState([])
  const [allBranches, setAllBranches] = useState([]) // full list for the branch filter
  const [togglingSurvey, setTogglingSurvey] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [cycleFilter, setCycleFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingSub, setEditingSub] = useState(null)
  const [showCatalog, setShowCatalog] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/food-survey', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Failed to load submissions')
      setSubmissions(json.submissions || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCycles = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/cycles', { cache: 'no-store', credentials: 'same-origin' })
      const json = await res.json()
      if (json.ok) setCycles(json.cycles || [])
    } catch {
      // Cycle filter is optional — stays empty on failure.
    }
  }, [])

  const loadBranches = useCallback(async () => {
    // The branch filter must list every branch, not just branches that happen
    // to have submissions — otherwise it's empty on a fresh cycle.
    try {
      const res = await fetch('/api/branches/list', { cache: 'no-store' })
      const json = await res.json()
      if (json.ok) setAllBranches(json.branches || [])
    } catch {
      // Falls back to branches seen on submissions below.
    }
  }, [])

  const toggleSurvey = async (cycle, open) => {
    if (togglingSurvey != null) return
    setTogglingSurvey(cycle.id)
    setError(null)
    try {
      const res = await fetch('/api/admin/cycles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: cycle.id, survey_open: open }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update the survey status')
      await loadCycles()
    } catch (e) {
      setError(e.message)
    } finally {
      setTogglingSurvey(null)
    }
  }

  useEffect(() => {
    load()
    loadCycles()
    loadBranches()
  }, [load, loadCycles, loadBranches])

  const branchOptions = useMemo(() => {
    const map = new Map()
    for (const b of allBranches) map.set(b.id, b)
    // Keep any submission branch the API list doesn't have (defensive).
    for (const s of submissions) {
      if (s.branch && !map.has(s.branch.id)) map.set(s.branch.id, s.branch)
    }
    return [...map.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [allBranches, submissions])

  const cycleOptions = useMemo(() => {
    const map = new Map()
    for (const c of cycles) map.set(c.id, c.name)
    for (const s of submissions) if (s.cycle) map.set(s.cycle.id, s.cycle.name)
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [cycles, submissions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return submissions.filter((s) => {
      if (branchFilter && String(s.branch?.id) !== branchFilter) return false
      if (cycleFilter && String(s.cycle?.id) !== cycleFilter) return false
      if (!q) return true
      if ((s.rep_name || '').toLowerCase().includes(q)) return true
      if ((s.branch?.name || '').toLowerCase().includes(q)) return true
      if ((s.cycle?.name || '').toLowerCase().includes(q)) return true
      return (s.entries || []).some((e) => (e.item_name || '').toLowerCase().includes(q))
    })
  }, [submissions, search, branchFilter, cycleFilter])

  const stats = useMemo(() => {
    const source = cycleFilter ? submissions.filter((s) => String(s.cycle?.id) === cycleFilter) : submissions
    const items = source.reduce((n, s) => n + (s.entries?.length || 0), 0)
    const reps = new Set(source.map((s) => s.rep_name)).size
    const branches = new Set(source.map((s) => s.branch?.id).filter(Boolean)).size
    return { submissions: source.length, items, reps, branches }
  }, [submissions, cycleFilter])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/survey`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy the survey link:', `${window.location.origin}/survey`)
    }
  }

  // Export what the filters show — one row per item, with a clickable
  // "View Image" hyperlink on every photo (same exceljs pattern as the
  // RAM / food reports pages).
  const exportExcel = async () => {
    if (!filtered.length || exporting) return
    setExporting(true)
    setError(null)
    try {
      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Item Survey')
      ws.columns = [
        { header: 'Rep Name', key: 'rep_name', width: 24 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'Branch', key: 'branch', width: 24 },
        { header: 'Cycle', key: 'cycle', width: 18 },
        { header: 'Source', key: 'source', width: 11 },
        { header: 'Submitted', key: 'submitted', width: 18 },
        { header: 'Item', key: 'item', width: 28 },
        { header: 'Category', key: 'category', width: 24 },
        { header: 'Price (₦)', key: 'price', width: 14 },
        { header: 'Photo', key: 'photo', width: 14 },
        { header: 'Notes', key: 'notes', width: 36 },
      ]

      // Brand header bar + frozen first row.
      const header = ws.getRow(1)
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D6746' } }
      header.alignment = { vertical: 'middle' }
      ws.views = [{ state: 'frozen', ySplit: 1 }]
      ws.autoFilter = 'A1:K1'

      for (const s of filtered) {
        // Submissions with no items still get one row so nothing is lost.
        const entries = (s.entries || []).length ? s.entries : [null]
        for (const e of entries) {
          const row = ws.addRow({
            rep_name: s.rep_name || '',
            phone: s.phone || '',
            branch: `${s.branch?.name || 'Unknown'}${s.branch?.code ? ` (${s.branch.code})` : ''}`,
            cycle: s.cycle?.name || '',
            source: s.source === 'admin' ? 'Admin' : 'Rep',
            submitted: fmtDate(s.created_at),
            item: e?.item_name || '',
            category: e?.category || '',
            price: e ? Number(e.price || 0) : '',
            photo: '',
            notes: s.notes || '',
          })
          if (e) row.getCell('price').numFmt = '"₦"#,##0.00'
          if (e?.photo_url) {
            const cell = row.getCell('photo')
            // Dev fallback photos are site-relative — make them absolute so
            // Excel can open them too.
            const href = String(e.photo_url).startsWith('/')
              ? `${window.location.origin}${e.photo_url}`
              : e.photo_url
            cell.value = { text: 'View Image', hyperlink: href }
            cell.font = { color: { argb: 'FF2563EB' }, underline: true }
          }
        }
      }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cycleSlug = cycleFilter
        ? (cycleOptions.find((c) => String(c.id) === cycleFilter)?.name || 'cycle')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
        : 'all-cycles'
      a.download = `food-survey_${cycleSlug || 'all-cycles'}_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e?.message || 'Excel export failed')
    } finally {
      setExporting(false)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/food-survey?id=${pendingDelete.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Delete failed')
      setSubmissions((prev) => prev.filter((s) => s.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const startEdit = (sub) => {
    setEditingSub(sub)
    setShowForm(false)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const onPhotoDeleted = (submissionId, entryId) => {
    setSubmissions((prev) =>
      prev.map((s) =>
        s.id === submissionId
          ? { ...s, entries: s.entries.map((e) => (e.id === entryId ? { ...e, photo_url: null } : e)) }
          : s
      )
    )
    setEditingSub((cur) =>
      cur && cur.id === submissionId
        ? { ...cur, entries: cur.entries.map((e) => (e.id === entryId ? { ...e, photo_url: null } : e)) }
        : cur
    )
  }

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="mx-auto max-w-7xl p-3 sm:p-4 md:p-6">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">Food Distribution · Item Survey</h1>
            <p className="mt-1 text-sm text-muted">
              Prices and photos submitted by reps before the food cycle opens.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={copyLink} leftIcon={copied ? undefined : Link2}>
              {copied ? 'Copied!' : 'Copy survey link'}
            </Button>
            <Button
              variant="secondary"
              onClick={exportExcel}
              loading={exporting}
              disabled={!filtered.length}
              leftIcon={FileSpreadsheet}
              title={filtered.length ? 'Download the filtered list as .xlsx' : 'No submissions to export'}
            >
              Export Excel
            </Button>
            <Button variant="secondary" onClick={() => setShowCatalog((v) => !v)} leftIcon={Settings2}>
              {showCatalog ? 'Hide items' : 'Manage items'}
            </Button>
            <Button variant="secondary" onClick={load} loading={loading} leftIcon={RefreshCw}>
              Refresh
            </Button>
            <Button
              onClick={() => {
                setEditingSub(null)
                setShowForm((v) => !v)
              }}
              leftIcon={showForm ? undefined : Plus}
            >
              {showForm ? 'Close form' : 'Add entry'}
            </Button>
          </div>
        </div>

        {/* Share hint */}
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-info-border bg-info-bg px-3.5 py-2.5 text-xs text-info-fg">
          <Copy className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          Share this link with reps — no login required:{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 font-semibold text-fg">
            {typeof window !== 'undefined' ? `${window.location.origin}/survey` : '/survey'}
          </code>
        </div>

        {/* Survey open/close per cycle */}
        <SurveyStatusPanel cycles={cycles} togglingId={togglingSurvey} onToggle={toggleSurvey} />

        {/* Catalog manager */}
        <CatalogManager open={showCatalog} onClose={() => setShowCatalog(false)} />

        {/* Edit form */}
        {editingSub && (
          <div className="mb-6">
            <FoodSurveyForm
              key={`edit_${editingSub.id}`}
              variant="admin"
              initialSubmission={editingSub}
              onCancelEdit={() => setEditingSub(null)}
              onSubmitted={() => {
                setEditingSub(null)
                load()
              }}
            />
          </div>
        )}
        {showForm && !editingSub && (
          <div className="mb-6">
            <FoodSurveyForm
              variant="admin"
              onCancelEdit={() => setShowForm(false)}
              onSubmitted={() => {
                setShowForm(false)
                load()
              }}
            />
          </div>
        )}

        {/* Stats */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Submissions', stats.submissions],
            ['Reps responded', stats.reps],
            ['Branches covered', stats.branches],
            ['Items collected', stats.items],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line-subtle bg-surface p-3">
              <div className="text-[13px] font-medium text-muted">{label}</div>
              <div className="mt-1 text-[clamp(1.25rem,1.25rem+0.38vw,1.75rem)] font-semibold leading-tight tracking-tight text-fg">
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rep, branch, cycle or item"
              className="pl-9"
            />
          </div>
          <Select
            value={cycleFilter}
            onChange={(e) => setCycleFilter(e.target.value)}
            className="sm:w-56"
            aria-label="Filter by cycle"
          >
            <option value="">All cycles</option>
            {cycleOptions.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="sm:w-56"
            aria-label="Filter by branch"
          >
            <option value="">All branches</option>
            {branchOptions.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg p-3.5 text-sm font-medium text-danger-fg">
            {error}
          </div>
        )}

        {/* Submissions */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="sakani-skeleton h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface">
            <EmptyState
              icon={ClipboardList}
              title={submissions.length ? 'No matching submissions' : 'No submissions yet'}
              description={
                submissions.length
                  ? 'Try a different search, branch or cycle filter.'
                  : 'Share the survey link with your reps — submissions will appear here in real time.'
              }
            >
              {!submissions.length && (
                <Button variant="secondary" onClick={copyLink} leftIcon={Copy}>
                  {copied ? 'Copied!' : 'Copy survey link'}
                </Button>
              )}
            </EmptyState>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((s) => (
              <SubmissionCard
                key={s.id}
                sub={s}
                onEdit={startEdit}
                onDelete={setPendingDelete}
                onPhotoDeleted={onPhotoDeleted}
              />
            ))}
          </div>
        )}

        <ConfirmDialog
          open={!!pendingDelete}
          onClose={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
          loading={deleting}
          title="Delete this submission?"
          message={
            pendingDelete
              ? `All ${pendingDelete.entries?.length || 0} item entries from ${pendingDelete.rep_name} will be removed (photos included). This cannot be undone.`
              : ''
          }
          confirmLabel="Delete"
        />
      </div>
    </ProtectedRoute>
  )
}
