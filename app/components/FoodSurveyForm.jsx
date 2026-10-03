'use client'

// app/components/FoodSurveyForm.jsx
// Google-Forms-style food distribution item survey, shared by three surfaces:
//   variant="public" → /survey (no login) — POST /api/food-survey/submit,
//                      re-open via edit_token or name+branch lookup
//   variant="rep"     → /rep/survey (rep session) — branch locked to session
//   variant="admin"   → Admin → Item Survey — full edit incl. per-entry
//                      category, optional photos, cycle reassignment
//
// Flow: about-you (name + branch [+ cycle for admin]) → price + photo per item,
// grouped by category → free-text "Other" items → submit.
// - Photos upload immediately on pick (client-compressed first), so the final
//   submit is a light JSON payload.
// - A localStorage draft survives refreshes/accidental closes — critical for
//   reps on flaky mobile connections (suppressed while editing a saved
//   response, so the draft can't clobber it).
// - Item names are editable inline (reps mistype; admins correct) and admins
//   can re-categorise any entry.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CheckCircle2, Lock, Minus, Pencil, Plus, RotateCw, Search, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import Button from './ui/Button'
import { Input } from './ui/Input'
import Select from './ui/Select'
import Label from './ui/Label'
import Spinner from './ui/Spinner'
import Badge from './ui/Badge'
import Reveal from './ui/Reveal'

/* ── Image helpers ─────────────────────────────────────────────────────── */

// Downscale to max 1600px / JPEG 0.82 so phone photos (~5MB) go out as
// ~150–400KB. Falls back to the original file if the browser can't decode it
// (e.g. HEIC in non-Safari browsers) — the server accepts both.
function compressImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file || !file.type?.startsWith('image/')) return resolve(file)
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl)
          if (blob && blob.size < file.size) {
            const name = (file.name || 'photo').replace(/\.\w+$/, '')
            resolve(new File([blob], `${name}.jpg`, { type: 'image/jpeg' }))
          } else {
            resolve(file)
          }
        }, 'image/jpeg', quality)
      } catch {
        URL.revokeObjectURL(objectUrl)
        resolve(file)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(file)
    }
    img.src = objectUrl
  })
}

async function uploadPhoto(file) {
  const blob = await compressImage(file)
  const fd = new FormData()
  fd.append('file', blob, blob.name || 'photo.jpg')
  const res = await fetch('/api/food-survey/photo', { method: 'POST', body: fd })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) throw new Error(json?.error || 'Photo upload failed')
  return json.url
}

/* ── Draft persistence ─────────────────────────────────────────────────── */

const draftKey = (variant) => `food_survey_draft_${variant}`

function readDraft(variant) {
  try {
    const raw = window.localStorage.getItem(draftKey(variant))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function clearDraft(variant) {
  try {
    window.localStorage.removeItem(draftKey(variant))
  } catch {}
}

/* ── Row rendering pieces ──────────────────────────────────────────────── */

function PhotoControl({ photo, preview, uploading, error, onChange, onRemove, label = 'Photo' }) {
  const shown = preview || photo
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <label
        className={[
          'relative inline-flex h-9 cursor-pointer items-center justify-center overflow-hidden rounded-lg border transition-colors duration-150',
          shown ? 'w-16 shrink-0 border-line bg-canvas' : 'border-dashed border-line-strong bg-subtle hover:border-brand',
          error ? 'border-danger' : '',
        ].join(' ')}
        title={shown ? 'Tap to replace photo' : `Add ${label.toLowerCase()}`}
      >
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onChange(f)
            e.target.value = ''
          }}
        />
        {shown ? (
          <motion.span
            key={shown}
            initial={{ opacity: 0, scale: 1.12 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="absolute inset-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown} alt="" className="h-full w-full object-cover" />
          </motion.span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 text-xs font-medium text-muted">
            <Camera className="h-4 w-4" strokeWidth={2} />
            {label}
          </span>
        )}
        {uploading && (
          <span className="absolute inset-0 flex items-center justify-center bg-canvas/70">
            <Spinner size={14} />
          </span>
        )}
      </label>
      {!uploading && shown && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove photo"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger-bg hover:text-danger-fg"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}

function PriceInput({ value, onChange, invalid, className = '' }) {
  // Digits are what we store; the display gets thousands separators as soon
  // as the field is not focused, so big figures are readable at a glance.
  const [focused, setFocused] = useState(false)
  const digits = String(value || '').replace(/[^0-9]/g, '')
  const display = focused ? digits : digits ? Number(digits).toLocaleString('en-NG') : ''
  return (
    <div className={['relative w-32 shrink-0', className].join(' ')}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">₦</span>
      <Input
        type="text"
        inputMode="numeric"
        value={display}
        invalid={invalid}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Price"
        className="pl-7 text-right max-sm:text-[16px]!"
        aria-label="Price in naira"
      />
    </div>
  )
}

// Inline-editable item name — reps fix typos, admins correct names.
function EditableName({ value, defaultValue, onChange, className = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const start = () => {
    setDraft(value || defaultValue || '')
    setEditing(true)
  }
  const commit = () => {
    onChange(draft.trim().slice(0, 255))
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') setEditing(false)
          }}
          maxLength={255}
          className="h-9 min-w-40 flex-1 max-sm:text-[16px]!"
          aria-label="Item name"
        />
        <button
          type="button"
          onClick={commit}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-success-border bg-success-bg px-2.5 text-xs font-semibold text-success-fg transition-[filter] duration-150 hover:brightness-95"
        >
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.2} />
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="inline-flex h-8 shrink-0 items-center rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-fg"
        >
          Cancel
        </button>
      </span>
    )
  }

  return (
    <span className={['group/name inline-flex min-w-0 items-center gap-1.5', className].join(' ')}>
      <span className="truncate text-sm font-medium text-fg">{value || defaultValue}</span>
      <button
        type="button"
        onClick={start}
        aria-label={`Edit ${value || defaultValue}`}
        title="Edit this item name"
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[11px] font-medium text-muted transition-colors duration-150 hover:border-brand hover:text-brand"
      >
        <Pencil className="h-3 w-3" strokeWidth={2.2} />
        Edit
      </button>
    </span>
  )
}

/* ── Main form ─────────────────────────────────────────────────────────── */

const emptyRow = () => ({ name: '', category: '', price: '', photo: null, preview: null, uploading: false, error: null })
const emptyOther = (key) => ({
  key: key || `o_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  name: '',
  category: 'Other',
  price: '',
  photo: null,
  preview: null,
  uploading: false,
  error: null,
})

// Endpoints per surface.
const API = {
  public: { create: '/api/food-survey/submit', edit: '/api/food-survey/submission' },
  rep: { create: '/api/rep/survey', edit: '/api/rep/survey' },
  admin: { create: '/api/admin/food-survey', edit: '/api/admin/food-survey' },
}

/* ── Motion presets ──────────────────────────────────────────────────────── */
// Same easing curve as ui/Reveal so every surface in the app eases alike.
const EASE = [0.21, 0.47, 0.32, 0.98]
// Quick in/out used by banners and alerts (mirrors the admin toast motion).
const popIn = {
  initial: { opacity: 0, y: -8, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.99 },
  transition: { duration: 0.18, ease: 'easeOut' },
}

function FoodSurveyFormInner({
  variant = 'public',
  source, // legacy prop from earlier callers; variant supersedes it
  presetBranchId = null,
  lockBranch = false,
  initialSubmission = null, // { id, rep_name, branch_id, cycle_id?, entries[], edit_token? }
  onCancelEdit = null,
  onSubmitted = null,
  className = '',
}) {
  const api = API[variant] || API.public
  const requirePhoto = variant === 'public' // photos optional for staff surfaces

  const [branches, setBranches] = useState([])
  const [catalog, setCatalog] = useState([])
  const [cycles, setCycles] = useState([]) // admin only
  const [surveyStatus, setSurveyStatus] = useState(null) // non-admin: { open, reason, message, cycle }
  const [loadError, setLoadError] = useState(null)
  const [loading, setLoading] = useState(true)

  const [repName, setRepName] = useState('')
  const [phone, setPhone] = useState('')
  const [branchId, setBranchId] = useState(presetBranchId ? String(presetBranchId) : '')
  const [cycleId, setCycleId] = useState('') // admin only
  const [rows, setRows] = useState({}) // catalogId -> { name, category, price, photo, preview, uploading, error }
  const [others, setOthers] = useState([])

  const [editing, setEditing] = useState(null) // { id, edit_token?, match_rep_name?, match_branch_id? }
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [done, setDone] = useState(null) // { name, branchName, count, cycleName, edited, editToken }

  // Public lookup panel (re-edit without a token)
  const [lookupOpen, setLookupOpen] = useState(false)
  const [lookupName, setLookupName] = useState('')
  const [lookupBranch, setLookupBranch] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupResults, setLookupResults] = useState([])
  const [lookupSearched, setLookupSearched] = useState(false)

  const draftRestored = useRef(false)
  const previews = useRef(new Set()) // object URLs to revoke on unmount
  const hydratedRef = useRef(null) // last initialSubmission id applied

  const isEditing = !!editing

  /* ── Load catalog + branches (+ cycles for admin) ── */
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const jobs = [
      fetch('/api/food-survey/catalog', { cache: 'no-store' }),
      fetch('/api/branches/list', { cache: 'no-store' }),
    ]
    if (variant === 'admin') jobs.push(fetch('/api/admin/cycles', { cache: 'no-store', credentials: 'same-origin' }))
    else jobs.push(fetch('/api/food-survey/status', { cache: 'no-store' }))
    const results = await Promise.allSettled(jobs)

    let err = null
    let cat = null
    let br = null
    let cy = []

    try {
      if (results[0].status !== 'fulfilled') throw new Error('Could not reach the server')
      const cj = await results[0].value.json()
      if (!cj.ok) throw new Error(cj.error || 'Could not load the item list')
      cat = cj.items || []
    } catch (e) {
      err = e.message
    }
    try {
      if (results[1].status !== 'fulfilled') throw new Error('Could not reach the server')
      const bj = await results[1].value.json()
      if (!bj.ok) throw new Error(bj.error || 'Could not load branches')
      br = bj.branches || []
    } catch (e) {
      err = err || e.message
    }
    if (variant === 'admin' && results[2]) {
      try {
        if (results[2].status !== 'fulfilled') throw new Error('Could not load cycles')
        const yj = await results[2].value.json()
        if (yj.ok) cy = yj.cycles || []
      } catch {
        // Cycles are optional — the select just stays empty.
      }
    } else if (results[2]) {
      try {
        if (results[2].status === 'fulfilled') {
          const sj = await results[2].value.json()
          if (sj.ok) setSurveyStatus({ open: !!sj.open, reason: sj.reason, message: sj.message, cycle: sj.cycle || null })
        }
        // Fail-open on network errors: keep showing the form; the write
        // endpoints enforce the closed-survey rule server-side anyway.
      } catch {}
    }

    setCatalog(cat || [])
    setBranches(br || [])
    setCycles(cy)
    setLoadError(err)
    setLoading(false)
  }, [variant])

  useEffect(() => {
    load()
  }, [load])

  // Admin: default the cycle select to the active one when creating — but
  // never default to a cycle whose end date has already passed.
  useEffect(() => {
    if (variant !== 'admin' || cycleId || !cycles.length) return
    const now = Date.now()
    const live = (c) => {
      if (!c.ends_at) return true
      const t = new Date(c.ends_at).getTime()
      return (/^\d{4}-\d{2}-\d{2}$/.test(String(c.ends_at)) ? t + 86400000 : t) > now
    }
    const active =
      cycles.find((c) => c.is_active && live(c)) ||
      cycles.find(live) ||
      cycles.find((c) => c.is_active) ||
      cycles[0]
    if (active) setCycleId(String(active.id))
  }, [variant, cycles, cycleId])

  // Branch preset for the rep portal (session branch arrives async).
  useEffect(() => {
    if (presetBranchId && !branchId) setBranchId(String(presetBranchId))
  }, [presetBranchId, branchId])

  /* ── Hydrate a saved submission into the form (edit mode) ── */
  const hydrateSubmission = useCallback(
    (sub) => {
      if (!sub) return
      setRepName(sub.rep_name || '')
      setPhone(sub.phone || '')
      setBranchId(String(sub.branch_id || presetBranchId || ''))
      setCycleId(sub.cycle_id ? String(sub.cycle_id) : cycleId)
      const nextRows = {}
      const nextOthers = []
      const catById = new Map(catalog.map((c) => [c.id, c]))
      for (const e of sub.entries || []) {
        const item = e.catalog_id != null ? catById.get(e.catalog_id) : null
        if (item) {
          nextRows[item.id] = {
            ...emptyRow(),
            name: String(e.item_name || '') !== item.name ? e.item_name : '',
            // Per-entry category override (admin edit) — empty means “keep the catalog’s”.
            category: e.category && e.category !== item.category ? e.category : '',
            price: e.price != null ? String(Number(e.price)) : '',
            photo: e.photo_url || null,
          }
        } else {
          const o = emptyOther(`e_${e.id}`)
          o.name = e.item_name || ''
          o.category = e.category || 'Other'
          o.price = e.price != null ? String(Number(e.price)) : ''
          o.photo = e.photo_url || null
          nextOthers.push(o)
        }
      }
      setRows(nextRows)
      setOthers(nextOthers)
      setFormError(null)
      setDone(null)
      setEditing({
        id: sub.id,
        edit_token: sub.edit_token || null,
        match_rep_name: sub.rep_name || '',
        match_branch_id: sub.branch_id,
      })
      hydratedRef.current = sub.id
      clearDraft(variant) // an explicit edit supersedes any stored draft
    },
    [catalog, presetBranchId, cycleId, variant]
  )

  // Apply initialSubmission once catalog + submission are both present.
  useEffect(() => {
    if (!initialSubmission || loading) return
    if (hydratedRef.current === initialSubmission.id) return
    hydrateSubmission(initialSubmission)
  }, [initialSubmission, loading, hydrateSubmission])

  // Restore any saved draft once (only when not editing).
  useEffect(() => {
    if (draftRestored.current || isEditing) return
    draftRestored.current = true
    const d = readDraft(variant)
    if (!d) return
    if (typeof d.repName === 'string') setRepName(d.repName)
    if (typeof d.phone === 'string') setPhone(d.phone)
    if (d.branchId && !presetBranchId) setBranchId(String(d.branchId))
    if (d.rows && typeof d.rows === 'object') {
      const restored = {}
      for (const [id, r] of Object.entries(d.rows)) {
        restored[id] = { ...emptyRow(), name: r?.name || '', category: r?.category || '', price: r?.price || '', photo: r?.photo || null }
      }
      setRows(restored)
    }
    if (Array.isArray(d.others)) {
      setOthers(d.others.map((o) => ({ ...emptyOther(), name: o?.name || '', category: o?.category || 'Other', price: o?.price || '', photo: o?.photo || null })))
    }
  }, [variant, isEditing, presetBranchId])

  // Debounced draft save — only for fresh (unsaved) responses.
  useEffect(() => {
    if (done || isEditing) return
    const t = setTimeout(() => {
      try {
        const slimRows = {}
        for (const [id, r] of Object.entries(rows)) {
          if (r.price || r.photo || r.name) slimRows[id] = { name: r.name, category: r.category || '', price: r.price, photo: r.photo }
        }
        const slimOthers = others
          .filter((o) => o.name || o.price || o.photo)
          .map((o) => ({ name: o.name, category: o.category, price: o.price, photo: o.photo }))
        const has = repName || phone || branchId || Object.keys(slimRows).length || slimOthers.length
        if (has) {
          window.localStorage.setItem(draftKey(variant), JSON.stringify({ repName, phone, branchId, rows: slimRows, others: slimOthers }))
        } else {
          window.localStorage.removeItem(draftKey(variant))
        }
      } catch {}
    }, 400)
    return () => clearTimeout(t)
  }, [repName, phone, branchId, rows, others, variant, done, isEditing])

  // Revoke object URLs on unmount
  useEffect(() => {
    const set = previews.current
    return () => {
      for (const url of set) URL.revokeObjectURL(url)
    }
  }, [])

  /* ── Catalog row actions ── */

  const handlePick = async (id, file) => {
    const preview = URL.createObjectURL(file)
    previews.current.add(preview)
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] || emptyRow()), preview, uploading: true, error: null } }))
    try {
      const url = await uploadPhoto(file)
      setRows((prev) => ({ ...prev, [id]: { ...(prev[id] || emptyRow()), photo: url, preview: null, uploading: false } }))
    } catch (e) {
      setRows((prev) => ({ ...prev, [id]: { ...(prev[id] || emptyRow()), preview: null, uploading: false, error: e.message } }))
    }
  }

  const handleRemove = (id) => {
    setRows((prev) => {
      const cur = prev[id] || emptyRow()
      if (cur.preview) URL.revokeObjectURL(cur.preview)
      return { ...prev, [id]: { ...cur, photo: null, preview: null, error: null } }
    })
  }

  /* ── Other-item row actions ── */

  const addOther = (category) =>
    setOthers((prev) => [...prev, { ...emptyOther(), category: category || 'Other' }])

  const updateOther = (key, patch) =>
    setOthers((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)))

  const removeOther = (key) =>
    setOthers((prev) => {
      const cur = prev.find((o) => o.key === key)
      if (cur?.preview) URL.revokeObjectURL(cur.preview)
      return prev.filter((o) => o.key !== key)
    })

  const handlePickOther = async (key, file) => {
    const preview = URL.createObjectURL(file)
    previews.current.add(preview)
    updateOther(key, { preview, uploading: true, error: null })
    try {
      const url = await uploadPhoto(file)
      updateOther(key, { photo: url, preview: null, uploading: false })
    } catch (e) {
      updateOther(key, { preview: null, uploading: false, error: e.message })
    }
  }

  /* ── Derived ── */

  const groups = useMemo(() => {
    const map = new Map()
    for (const item of catalog) {
      const cat = item.category || 'Other'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat).push(item)
    }
    return [...map.entries()]
  }, [catalog])

  const groupSet = useMemo(() => new Set(groups.map(([c]) => c)), [groups])

  const categoryOptions = useMemo(() => {
    const set = new Set(groups.map(([c]) => c))
    for (const o of others) if (o.category) set.add(o.category)
    // Any per-entry overrides already stored on catalog rows (admin edits).
    for (const r of Object.values(rows)) if (r.category) set.add(r.category)
    set.add('Other')
    return [...set]
  }, [groups, others, rows])

  const completedCount = useMemo(() => {
    let n = 0
    for (const item of catalog) {
      const r = rows[item.id]
      if (r?.price && (r?.photo || !requirePhoto) && !r?.uploading) n++
    }
    for (const o of others) {
      if (o.name && o.price && (o.photo || !requirePhoto) && !o.uploading) n++
    }
    return n
  }, [catalog, rows, others, requirePhoto])

  const totalItems = catalog.length + others.length
  const progressPct = totalItems ? Math.min(100, Math.round((completedCount / totalItems) * 100)) : 0

  const branchName = branches.find((b) => String(b.id) === String(branchId))?.name || ''

  /* ── Public lookup ── */

  const runLookup = async (e) => {
    e?.preventDefault?.()
    if (lookupName.trim().length < 2 || !lookupBranch) {
      setFormError('Enter your name and choose your branch to find your response.')
      return
    }
    setFormError(null)
    setLookupBusy(true)
    try {
      const qs = new URLSearchParams({ rep_name: lookupName.trim(), branch_id: String(lookupBranch) })
      const res = await fetch(`/api/food-survey/submission?${qs}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Lookup failed')
      setLookupResults(json.submissions || [])
      setLookupSearched(true)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setLookupBusy(false)
    }
  }

  /* ── Submit ── */

  const submit = async (e) => {
    e?.preventDefault?.()
    setFormError(null)

    const name = repName.trim()
    if (name.length < 2) {
      setFormError('Please enter your name.')
      return
    }
    if (!branchId) {
      setFormError('Please choose your branch.')
      return
    }
    const phoneVal = phone.trim()
    if (phoneVal && !/^\+?\d{7,15}$/.test(phoneVal.replace(/[\s\-().]/g, ''))) {
      setFormError('Please enter a valid phone number — digits only, 7 to 15 digits — or leave it blank.')
      return
    }

    // Validate catalog rows: complete or untouched; partial is an error.
    const entries = []
    const rowErrors = {}
    for (const item of catalog) {
      const r = rows[item.id]
      if (!r) continue
      const hasPrice = !!r.price
      const hasPhoto = !!r.photo
      if (r.uploading) {
        setFormError('Please wait for the photo uploads to finish.')
        return
      }
      if (hasPhoto && !hasPrice) {
        rowErrors[item.id] = 'Add the price, or remove the photo.'
        continue
      }
      if (hasPrice && !hasPhoto && requirePhoto) {
        rowErrors[item.id] = 'Add a photo, or clear the price if this item is not in your branch.'
        continue
      }
      if (hasPrice) {
        entries.push({
          catalog_id: item.id,
          item_name: (r.name || item.name).trim(),
          category: r.category || item.category || 'Other',
          price: Number(r.price),
          photo_url: r.photo,
        })
      }
    }

    // Validate free-text rows
    const nextOthers = others.map((o) => {
      if (o.uploading) return { ...o, error: 'Wait for the upload to finish' }
      const filled = !!(o.name.trim() || o.price || o.photo)
      if (!filled) return { ...o, error: null }
      if (!o.name.trim()) return { ...o, error: 'Name required' }
      if (!o.price) return { ...o, error: 'Price required' }
      if (!o.photo && requirePhoto) return { ...o, error: 'Photo required' }
      return { ...o, error: null }
    })
    setOthers(nextOthers)

    const otherProblems = nextOthers.filter((o) => o.error)
    const rowProblemIds = Object.keys(rowErrors)
    if (rowProblemIds.length || otherProblems.length) {
      setRows((prev) => {
        const next = { ...prev }
        for (const id of rowProblemIds) {
          next[id] = { ...(next[id] || emptyRow()), error: rowErrors[id] }
        }
        for (const item of catalog) {
          if (!rowErrors[item.id] && next[item.id]?.error) {
            next[item.id] = { ...next[item.id], error: null }
          }
        }
        return next
      })
      setFormError('Some items are incomplete — fix the highlighted rows below.')
      return
    }

    for (const o of nextOthers) {
      if (!o.error && o.name.trim()) {
        entries.push({
          catalog_id: null,
          item_name: o.name.trim(),
          category: o.category || 'Other',
          price: Number(o.price),
          photo_url: o.photo,
        })
      }
    }

    if (!entries.length) {
      setFormError('Fill at least one item before submitting.')
      return
    }

    setSubmitting(true)
    try {
      let payload
      let url = api.create
      let method = 'POST'
      if (isEditing) {
        url = api.edit
        method = 'PATCH'
        if (variant === 'public') {
          payload = {
            token: editing.edit_token || undefined,
            submission_id: editing.edit_token ? undefined : editing.id,
            match_rep_name: editing.match_rep_name,
            match_branch_id: editing.match_branch_id,
            rep_name: name,
            branch_id: Number(branchId),
            phone: phoneVal,
            entries,
          }
        } else if (variant === 'rep') {
          payload = { submission_id: editing.id, rep_name: name, phone: phoneVal, entries }
        } else {
          payload = {
            submission_id: editing.id,
            rep_name: name,
            branch_id: Number(branchId),
            cycle_id: cycleId ? Number(cycleId) : null,
            phone: phoneVal,
            entries,
          }
        }
      } else {
        if (variant === 'public') {
          payload = { rep_name: name, branch_id: Number(branchId), source: 'rep', phone: phoneVal, entries }
        } else if (variant === 'rep') {
          payload = { rep_name: name, phone: phoneVal, entries }
        } else {
          payload = {
            rep_name: name,
            branch_id: Number(branchId),
            cycle_id: cycleId ? Number(cycleId) : null,
            phone: phoneVal,
            entries,
          }
        }
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Submission failed')

      clearDraft(variant)
      const cycleName =
        variant === 'admin'
          ? cycles.find((c) => String(c.id) === String(cycleId))?.name || ''
          : json?.cycle?.name || ''
      setDone({
        name,
        branchName,
        count: entries.length,
        cycleName,
        edited: isEditing,
        editToken: json?.edit_token || editing?.edit_token || null,
        submissionId: json?.submission_id || editing?.id || null,
      })
      if (onSubmitted) onSubmitted(json)
    } catch (err) {
      setFormError(err.message || 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setDone(null)
    setEditing(null)
    hydratedRef.current = null
    setRepName('')
    if (!presetBranchId) setBranchId('')
    setPhone('')
    setRows({})
    setOthers([])
    setFormError(null)
    setLookupResults([])
    setLookupSearched(false)
    draftRestored.current = true
  }

  const cancelEdit = () => {
    setEditing(null)
    hydratedRef.current = null
    setFormError(null)
    if (onCancelEdit) onCancelEdit()
    else reset()
  }

  /* ── Success screen ── */

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE }}
        className={['rounded-xl border border-line bg-surface p-6 text-center shadow-xs sm:p-8', className].join(' ')}
      >
        <span className="relative mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-success-bg">
          <motion.span
            initial={{ scale: 1, opacity: 0.45 }}
            animate={{ scale: 2.1, opacity: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut', delay: 0.12 }}
            className="pointer-events-none absolute inset-0 rounded-full bg-success-bg"
            aria-hidden="true"
          />
          <motion.span
            initial={{ scale: 0, rotate: -14 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 15, delay: 0.05 }}
            className="inline-flex"
          >
            <CheckCircle2 className="h-7 w-7 text-success-fg" strokeWidth={2} />
          </motion.span>
        </span>
        <h2 className="mt-4 text-h2 font-bold tracking-tight text-fg">
          {done.edited ? 'Changes saved' : 'Survey submitted'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Thank you, {done.name}.{' '}
          {done.edited ? (
            <>
              Your response was updated — <strong className="text-fg">{done.count}</strong> item
              {done.count === 1 ? '' : 's'}
              {done.branchName ? (
                <>
                  {' '}for <strong className="text-fg">{done.branchName}</strong>
                </>
              ) : null}
              .
            </>
          ) : (
            <>
              We received <strong className="text-fg">{done.count}</strong> item
              {done.count === 1 ? '' : 's'}
              {done.branchName ? (
                <>
                  {' '}for <strong className="text-fg">{done.branchName}</strong>
                </>
              ) : null}
              {done.cycleName ? (
                <>
                  {' '}— cycle <strong className="text-fg">{done.cycleName}</strong>
                </>
              ) : null}
              . The admin can now review your prices and photos ahead of the food cycle.
            </>
          )}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {done.edited && onCancelEdit ? (
            <Button variant="secondary" onClick={onCancelEdit}>
              Back to list
            </Button>
          ) : (
            <Button variant="secondary" onClick={reset} leftIcon={RotateCw}>
              Fill another response
            </Button>
          )}
        </div>
      </motion.div>
    )
  }

  /* ── Loading / load error ── */

  if (loading) {
    return (
      <div className={['rounded-xl border border-line bg-surface p-6', className].join(' ')}>
        <div className="space-y-3">
          <div className="sakani-skeleton h-5 w-48 rounded" />
          <div className="sakani-skeleton h-9 w-full rounded-lg" />
          <div className="sakani-skeleton h-9 w-2/3 rounded-lg" />
          <div className="sakani-skeleton h-32 w-full rounded-xl" />
        </div>
        <p className="mt-4 text-sm text-muted">Loading the survey…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className={['rounded-xl border border-danger-border bg-danger-bg p-6', className].join(' ')}>
        <p className="text-sm font-medium text-danger-fg">The survey could not be loaded</p>
        <p className="mt-1 text-sm text-danger-fg/80">{loadError}</p>
        <Button className="mt-4" variant="secondary" onClick={load} leftIcon={RotateCw}>
          Try again
        </Button>
      </div>
    )
  }

  // Survey closed for this cycle (admin closed it, or its end date passed) —
  // show why instead of the form. Admins keep access to manage responses.
  if (variant !== 'admin' && surveyStatus && !surveyStatus.open) {
    const ended = surveyStatus.reason === 'ended'
    return (
      <div className={['rounded-xl border border-line bg-surface p-6 text-center shadow-xs sm:p-8', className].join(' ')}>
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-subtle">
          <Lock className="h-6 w-6 text-muted" strokeWidth={2} />
        </span>
        <h2 className="mt-4 text-h2 font-bold tracking-tight text-fg">
          {ended ? 'The survey is closed' : 'The survey is not open yet'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          {surveyStatus.message || 'Ask the admin to open the survey for the current food cycle.'}
        </p>
        {surveyStatus.cycle ? (
          <p className="mt-1 text-xs text-muted">Cycle: {surveyStatus.cycle.name}</p>
        ) : null}
        <p className="mt-4 text-xs text-muted">
          Once it is opened, refresh this page to fill in the survey.
        </p>
        <Button className="mt-4" variant="secondary" onClick={load} leftIcon={RotateCw}>
          Check again
        </Button>
      </div>
    )
  }

  if (!catalog.length) {
    return (
      <div className={['rounded-xl border border-line bg-surface p-6 text-center', className].join(' ')}>
        <p className="text-sm font-medium text-fg">The item list is not set up yet</p>
        <p className="mt-1 text-sm text-muted">Ask the admin to add the survey items before filling this form.</p>
      </div>
    )
  }

  /* ── Form ── */

  return (
    <form onSubmit={submit} className={['space-y-6', className].join(' ')} noValidate>
      {/* Editing banner */}
      <AnimatePresence initial={false}>
      {isEditing && (
        <motion.div key="editing-banner" {...popIn} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-700/40 bg-brand-subtle px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-fg">
            <Pencil className="h-4 w-4 text-brand" strokeWidth={2.2} />
            <span>
              Editing the response of <strong>{editing.match_rep_name || repName}</strong>
              {editing.edit_token ? ' (saved on this device)' : ''}
            </span>
          </div>
          {onCancelEdit ? (
            <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit}>
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              Cancel
            </Button>
          )}
        </motion.div>
      )}
      </AnimatePresence>

      {/* Public: lookup a previous response without a token */}
      {variant === 'public' && !isEditing && !done && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
          <AnimatePresence initial={false} mode="wait">
          {!lookupOpen ? (
            <motion.button
              key="lookup-trigger"
              type="button"
              onClick={() => setLookupOpen(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex w-full items-center gap-2 text-left text-sm font-medium text-brand hover:underline"
            >
              <Search className="h-4 w-4" strokeWidth={2.2} />
              Already submitted? Find and edit your previous response
            </motion.button>
          ) : (
            <motion.div
              key="lookup-panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-fg">Find your previous response</h3>
                <button
                  type="button"
                  onClick={() => {
                    setLookupOpen(false)
                    setLookupSearched(false)
                    setLookupResults([])
                  }}
                  aria-label="Close lookup"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-subtle"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label htmlFor="fs-lookup-name">Your name</Label>
                  <Input
                    id="fs-lookup-name"
                    value={lookupName}
                    onChange={(e) => setLookupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        runLookup()
                      }
                    }}
                    placeholder="Exactly as you entered it"
                    maxLength={100}
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor="fs-lookup-branch">Branch</Label>
                  <Select
                    id="fs-lookup-branch"
                    value={lookupBranch}
                    onChange={(e) => setLookupBranch(e.target.value)}
                    placeholder="Choose your branch"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                        {b.code ? ` (${b.code})` : ''}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="button" loading={lookupBusy} onClick={() => runLookup()}>
                  Find
                </Button>
              </div>
              {lookupSearched && (
                <div className="mt-3 space-y-2">
                  {lookupResults.length === 0 ? (
                    <p className="text-sm text-muted">
                      No response found for that name at that branch. Check the spelling, or submit a new response
                      below.
                    </p>
                  ) : (
                    lookupResults.map((sub, idx) => (
                      <motion.button
                        key={sub.id}
                        type="button"
                        onClick={() => hydrateSubmission(sub)}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, delay: idx * 0.05, ease: EASE }}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-subtle/50 px-3 py-2.5 text-left transition-colors hover:border-brand"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-fg">{sub.rep_name}</span>
                          <span className="block text-xs text-muted">
                            {new Date(sub.created_at).toLocaleString('en-NG', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            · {sub.entries?.length || 0} item{(sub.entries?.length || 0) === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-on-accent">
                          Edit
                        </span>
                      </motion.button>
                    ))
                  )}
                </div>
              )}
            </motion.div>
          )}
          </AnimatePresence>
        </section>
      )}

      {/* Step 1 — about you */}
      <Reveal delay={0.04}>
      <section className="rounded-xl border border-line bg-surface p-4 shadow-xs sm:p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-on-accent">1</span>
          <h3 className="text-base font-semibold text-fg">About you</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fs-name">Your name</Label>
            <Input
              id="fs-name"
              value={repName}
              onChange={(e) => setRepName(e.target.value)}
              placeholder="Enter your full name"
              maxLength={100}
              autoComplete="name"
              className="max-sm:text-[16px]!"
            />
          </div>
          <div>
            <Label htmlFor="fs-branch">Branch</Label>
            <Select
              id="fs-branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              placeholder="Choose your branch"
              disabled={lockBranch}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.code ? ` (${b.code})` : ''}
                </option>
              ))}
            </Select>
            {lockBranch && <p className="mt-1 text-xs text-muted">Locked to your portal branch.</p>}
            {!branches.length && <p className="mt-1 text-xs text-muted">Branches unavailable — retry by reloading the page.</p>}
          </div>
          <div>
            <Label htmlFor="fs-phone">Phone number</Label>
            <Input
              id="fs-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Enter your phone number"
              maxLength={30}
              autoComplete="tel"
              className="max-sm:text-[16px]!"
            />
          </div>
          {variant === 'admin' && (
            <div>
              <Label htmlFor="fs-cycle">Food cycle</Label>
              <Select id="fs-cycle" value={cycleId} onChange={(e) => setCycleId(e.target.value)} placeholder="Choose a cycle">
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.is_active ? ' · Active' : ''}
                  </option>
                ))}
              </Select>
              {!cycles.length && <p className="mt-1 text-xs text-muted">No cycles found — submissions default to the latest.</p>}
            </div>
          )}
        </div>
      </section>
      </Reveal>

      {/* Step 2 — items by category */}
      <Reveal delay={0.08}>
      <section className="rounded-xl border border-line bg-surface p-4 shadow-xs sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-on-accent">2</span>
            <h3 className="text-base font-semibold text-fg">Item prices &amp; photos</h3>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-1 text-xs font-medium text-muted">
            <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${completedCount ? 'bg-success-fg' : 'bg-muted'}`} />
            <motion.span
              key={completedCount}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="inline-block"
            >
              {completedCount} of {totalItems} completed
            </motion.span>
          </span>
        </div>
        <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
          <motion.div
            className={`h-full rounded-full transition-colors duration-300 ${progressPct >= 100 ? 'bg-success-fg' : 'bg-brand'}`}
            initial={false}
            animate={{ width: `${progressPct}%` }}
            transition={{ type: 'spring', stiffness: 130, damping: 22 }}
          />
        </div>
        <p className="mb-4 text-sm text-muted">
          Enter the price and snap a photo of each item in your branch. Leave an item completely blank if it is not
          stocked — blanks are skipped.
          {requirePhoto ? '' : ' Photos are optional here.'}
        </p>

        {groups.map(([category, items]) => {
          const catOthers = others.filter((o) => (o.category || 'Other') === category)
          return (
          <div key={category} className="mb-5 last:mb-0">
            <div className="mb-2 flex items-center gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{category}</h4>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="divide-y divide-line rounded-xl border border-line overflow-hidden">
              {items.map((item) => {
                const r = rows[item.id] || emptyRow()
                const rowDone = !!r.price && (r.photo || !requirePhoto) && !r.uploading && !r.error
                return (
                  <div
                    key={item.id}
                    className={[
                      'flex flex-col gap-2.5 p-3 transition-colors duration-300 sm:flex-row sm:items-center sm:gap-3',
                      r.error ? 'bg-danger-bg/40' : rowDone ? 'bg-success-bg/40' : '',
                    ].join(' ')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <EditableName
                          value={r.name}
                          defaultValue={item.name}
                          onChange={(v) => setRows((prev) => ({ ...prev, [item.id]: { ...(prev[item.id] || emptyRow()), name: v === item.name ? '' : v } }))}
                        />
                        <AnimatePresence>
                          {rowDone && (
                            <motion.span
                              key="done"
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0, opacity: 0 }}
                              transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                              className="inline-flex shrink-0"
                              title="Complete"
                            >
                              <CheckCircle2 className="h-4 w-4 text-success-fg" strokeWidth={2.2} />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        {variant === 'admin' ? (
                          <Select
                            value={r.category || item.category || 'Other'}
                            onChange={(e) =>
                              setRows((prev) => ({
                                ...prev,
                                [item.id]: { ...(prev[item.id] || emptyRow()), category: e.target.value, error: null },
                              }))
                            }
                            className="w-40 max-w-full"
                            aria-label={`Category for ${item.name}`}
                          >
                            {categoryOptions.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Badge tone="neutral" variant="subtle">
                            {item.category}
                          </Badge>
                        )}
                        {variant === 'admin' && r.name && (
                          <span className="text-[11px] text-muted">renamed from “{item.name}”</span>
                        )}
                      </div>
                      {r.error && <p className="mt-1 text-xs font-medium text-danger-fg">{r.error}</p>}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <PriceInput
                        value={r.price}
                        invalid={!!r.error && !r.photo && requirePhoto}
                        onChange={(v) => setRows((prev) => ({ ...prev, [item.id]: { ...(prev[item.id] || emptyRow()), price: v, error: null } }))}
                      />
                      <PhotoControl
                        photo={r.photo}
                        preview={r.preview}
                        uploading={r.uploading}
                        error={!!r.error && !r.photo && requirePhoto}
                        onChange={(f) => handlePick(item.id, f)}
                        onRemove={() => handleRemove(item.id)}
                      />
                    </div>
                  </div>
                )
              })}
              {/* Rows the rep/admin added directly under this category */}
              <AnimatePresence initial={false}>
                {catOthers.map((o) => (
                  <motion.div
                    key={o.key}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0, transition: { duration: 0.15, ease: 'easeOut' } }}
                    transition={{ duration: 0.28, ease: EASE }}
                    className={[
                      'overflow-hidden transition-colors duration-300',
                      o.error ? 'bg-danger-bg/40' : '',
                      !o.error && o.name.trim() && o.price && (o.photo || !requirePhoto) && !o.uploading
                        ? 'bg-success-bg/40'
                        : '',
                    ].join(' ')}
                  >
                    <div className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center sm:gap-3">
                      <div className="min-w-0 flex-1">
                        <Input
                          value={o.name}
                          onChange={(e) => updateOther(o.key, { name: e.target.value, error: null })}
                          placeholder="Item name"
                          maxLength={255}
                          aria-label={`${category} item name`}
                          className="max-sm:text-[16px]!"
                        />
                        {o.error && <p className="mt-1 text-xs font-medium text-danger-fg">{o.error}</p>}
                      </div>
                      <div className="flex items-center gap-2.5">
                        <PriceInput
                          value={o.price}
                          invalid={!!o.error && !o.photo && requirePhoto}
                          onChange={(v) => updateOther(o.key, { price: v, error: null })}
                        />
                        <PhotoControl
                          photo={o.photo}
                          preview={o.preview}
                          uploading={o.uploading}
                          error={!!o.error && !o.photo && requirePhoto}
                          onChange={(f) => handlePickOther(o.key, f)}
                          onRemove={() => removeOther(o.key)}
                          label="Photo"
                        />
                        <button
                          type="button"
                          onClick={() => removeOther(o.key)}
                          aria-label="Remove this row"
                          title="Remove this row (−)"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted transition-colors duration-150 hover:border-danger-border hover:bg-danger-bg hover:text-danger-fg"
                        >
                          <Minus className="h-4 w-4" strokeWidth={2.2} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            {/* + button — add another row straight into this category */}
            <button
              type="button"
              onClick={() => addOther(category)}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong py-2 text-xs font-medium text-muted transition-colors duration-150 hover:border-brand hover:bg-brand-subtle/40 hover:text-brand"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
              Add item to {category}
            </button>
          </div>
          )
        })}
      </section>
      </Reveal>

      {/* Step 3 — other items */}
      <Reveal delay={0.12}>
      <section className="rounded-xl border border-line bg-surface p-4 shadow-xs sm:p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-on-accent">3</span>
          <h3 className="text-base font-semibold text-fg">Other items</h3>
        </div>
        <p className="mb-3 text-sm text-muted">Something not on the list? Add it here with its price and photo.</p>

        <AnimatePresence initial={false}>
        {others.filter((o) => !groupSet.has(o.category || 'Other')).map((o) => (
          <motion.div
            key={o.key}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15, ease: 'easeOut' } }}
            transition={{ duration: 0.3, ease: EASE }}
            className={[
              'mb-3 rounded-xl border p-3 transition-colors duration-300',
              o.error ? 'border-danger-border bg-danger-bg/40' : 'border-line',
              !o.error && o.name.trim() && o.price && (o.photo || !requirePhoto) && !o.uploading ? 'bg-success-bg/40' : '',
            ].join(' ')}
          >
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <Input
                value={o.name}
                onChange={(e) => updateOther(o.key, { name: e.target.value, error: null })}
                placeholder="Item name"
                maxLength={255}
                className="sm:w-56"
                aria-label="Other item name"
              />
              <Select
                value={o.category}
                onChange={(e) => updateOther(o.key, { category: e.target.value })}
                className="sm:w-48"
                aria-label="Other item category"
              >
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>
              <div className="flex flex-1 items-center gap-2.5">
                <PriceInput
                  value={o.price}
                  invalid={!!o.error && !o.photo && requirePhoto}
                  onChange={(v) => updateOther(o.key, { price: v, error: null })}
                />
                <PhotoControl
                  photo={o.photo}
                  preview={o.preview}
                  uploading={o.uploading}
                  error={!!o.error && !o.photo && requirePhoto}
                  onChange={(f) => handlePickOther(o.key, f)}
                  onRemove={() => removeOther(o.key)}
                  label="Photo"
                />
                <button
                  type="button"
                  onClick={() => removeOther(o.key)}
                  aria-label="Remove item"
                  className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger-bg hover:text-danger-fg sm:ml-0"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            </div>
            {o.error && <p className="mt-1.5 text-xs font-medium text-danger-fg">{o.error}</p>}
          </motion.div>
        ))}
        </AnimatePresence>

        <Button type="button" variant="secondary" onClick={() => addOther('Other')} leftIcon={Plus}>
          Add another item
        </Button>
      </section>
      </Reveal>

      {/* Errors + submit */}
      <AnimatePresence>
      {formError && (
        <motion.div
          key="form-error"
          role="alert"
          {...popIn}
          className="rounded-xl border border-danger-border bg-danger-bg p-3.5 text-sm font-medium text-danger-fg"
        >
          {formError}
        </motion.div>
      )}
      </AnimatePresence>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted">
            {completedCount > 0
              ? `${completedCount} item${completedCount === 1 ? '' : 's'} ready to ${isEditing ? 'save' : 'submit'}`
              : isEditing
                ? 'Changes are saved when you press the button below.'
                : 'Your progress is saved on this device automatically.'}
          </p>
          {variant !== 'admin' && surveyStatus?.cycle && !isEditing && (
            <p className="text-xs text-muted">
              Recorded under the{' '}
              <strong className="font-semibold text-fg">{surveyStatus.cycle.name}</strong> cycle survey
              {surveyStatus.cycle.ends_at
                ? ` — closes ${new Date(surveyStatus.cycle.ends_at).toLocaleDateString('en-NG', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}`
                : ''}
              .
            </p>
          )}
        </div>
        <Button type="submit" size="lg" loading={submitting} disabled={submitting}>
          {submitting ? (isEditing ? 'Saving…' : 'Submitting…') : isEditing ? 'Save changes' : 'Submit survey'}
        </Button>
      </div>
    </form>
  )
}

// MotionConfig honours the OS reduced-motion preference for every animation
// inside the form: transforms and layout snaps are skipped, gentle opacity
// fades remain (same behaviour as ui/Reveal).
export default function FoodSurveyForm(props) {
  return (
    <MotionConfig reducedMotion="user">
      <FoodSurveyFormInner {...props} />
    </MotionConfig>
  )
}
