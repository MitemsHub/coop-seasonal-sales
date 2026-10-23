'use client'

// app/admin/members/page.jsx
// Members Settings — one home for member administration used by every module:
//   • Members Import (moved from the food Import page) with the import log
//   • Member details set/reset — name, phone, and account management
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, FileSpreadsheet, Pencil, RefreshCw, RotateCcw, Search, UserRound } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import DraggableModal from '../../components/DraggableModal'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Input from '../../components/ui/Input'
import Label from '../../components/ui/Label'
import Badge from '../../components/ui/Badge'
import Skeleton from '../../components/ui/Skeleton'

function MembersImportSection() {
  const [membersFile, setMembersFile] = useState(null)
  const [log, setLog] = useState('')
  const [loading, setLoading] = useState(false)
  const [schema, setSchema] = useState(null)

  // Fetch the import schema on mount — single source of truth for template columns.
  useEffect(() => {
    fetch('/api/admin/import/members/schema', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setSchema(j) })
      .catch(() => {})
  }, [])

  const upload = async () => {
    if (!membersFile) {
      setLog('Please choose a file first.')
      return
    }
    setLoading(true)
    setLog('')
    try {
      const fd = new FormData()
      fd.append('file', membersFile)
      const res = await fetch('/api/admin/import/members', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || `Upload failed with status ${res.status}`)
      setLog(JSON.stringify(json, null, 2))
    } catch (e) {
      setLog(`Error: ${e.message}`)
      console.error('Upload error:', e)
    } finally {
      setLoading(false)
    }
  }

  const dlTemplate = async () => {
    // Fetch the schema from the server (single source of truth).
    // Fall back to a hardcoded list if the endpoint is unreachable.
    let headers = ['member_id', 'full_name', 'grade', 'savings', 'loans', 'global_limit']
    let sampleRow = { member_id: 'A12345', full_name: 'John Doe', grade: 'Director', savings: 2000000, loans: 0, global_limit: 40000000 }
    try {
      const res = await fetch('/api/admin/import/members/schema', { cache: 'no-store' })
      const j = await res.json()
      if (j?.ok && j.headers?.length) {
        headers = j.headers
        sampleRow = j.sampleRow
      }
    } catch {}

    const ExcelJSMod = await import('exceljs')
    const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Members')
    ws.addRow(headers)
    ws.addRow(headers.map((h) => sampleRow[h] ?? ''))
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Members_Template.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Members Import</Card.Title>
        <Card.Description>{schema?.description || 'Loading expected columns…'}</Card.Description>
      </Card.Header>
      <Card.Body className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setMembersFile(e.target.files?.[0] || null)}
            className="w-full sm:flex-1 text-sm p-2 border border-line rounded-lg bg-surface"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={upload} loading={loading} disabled={!membersFile} className="flex-1 sm:flex-none">
              Upload Members
            </Button>
            <Button variant="secondary" leftIcon={FileSpreadsheet} onClick={dlTemplate} className="flex-1 sm:flex-none">
              Download Template
            </Button>
          </div>
        </div>
        {log && <pre className="whitespace-pre-wrap rounded-lg bg-subtle p-3 text-xs text-fg overflow-x-auto">{log}</pre>}
      </Card.Body>
    </Card>
  )
}

// Display order for the Global limits editor — management hierarchy, not
// alphabetical. Matches the reference list provided by the admin; grades not
// in this list are appended alphabetically at the end.
const GRADE_ORDER = [
  'Deputy Governor',
  'Director',
  'Deputy Director',
  'Assistant Director',
  'Principal Manager',
  'Senior Manager',
  'Manager',
  'Deputy Manager',
  'Assistant Manager',
  'Senior Supervisor 1',
  'Senior Supervisor 2',
  'Supervisor',
  'Senior Clerk',
  'Treasury Assistant',
  'Clerk',
  'Treasury Assistant 1',
  'Drivers',
  'Pensioner',
  'Retiree',
  'Coop Staff',
  'Undefined',
]

function sortGradeLimits(rows) {
  const rank = (grade) => {
    const i = GRADE_ORDER.findIndex((x) => x.toLowerCase() === String(grade).trim().toLowerCase())
    return i === -1 ? GRADE_ORDER.length : i
  }
  return [...rows].sort((a, b) => {
    const d = rank(a.grade) - rank(b.grade)
    if (d !== 0) return d
    return String(a.grade).localeCompare(String(b.grade))
  })
}

function GradeLimitsSection() {
  // Live editor for the grade_limits table — the per-grade DEFAULT loan limits
  // the member import picks up when a member's global_limit cell is blank.
  // Per-member overrides still come from the template's global_limit column.
  const [limits, setLimits] = useState([])
  const [drafts, setDrafts] = useState({}) // grade → edited limit (only dirty rows)
  const [editing, setEditing] = useState({}) // grade → input open while true
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setMsg('')
    try {
      const res = await fetch('/api/admin/grade-limits', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load grade limits')
      setLimits(sortGradeLimits(json.limits || []))
      setDrafts({})
    } catch (e) {
      setMsg(e.message || 'Failed to load grade limits')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const dirty = Object.keys(drafts).length > 0

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const updates = Object.entries(drafts).map(([grade, v]) => ({ grade, global_limit: Number(v) }))
      const res = await fetch('/api/admin/grade-limits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save')
      await load()
      setMsg(`Saved — ${updates.length} grade${updates.length === 1 ? '' : 's'} updated.`)
      setTimeout(() => setMsg(''), 4000)
    } catch (e) {
      setMsg(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Global limits</Card.Title>
        <Card.Description>
          Default loan limit per grade (₦). Saving applies immediately to every member of the grade — their Global Limit and loan eligibility update together. New member imports with a blank global_limit column also use these.
        </Card.Description>
      </Card.Header>
      <Card.Body className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-2 rounded-lg bg-subtle px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <span>Grade</span>
              <span>Default limit (₦)</span>
            </div>
            <div className="divide-y divide-line max-h-96 overflow-y-auto rounded-xl border border-line">
              {limits.map((g) => {
                const draft = drafts[g.grade]
                const changed = draft != null && Number(draft) !== Number(g.global_limit ?? 0)
                const isOpen = Boolean(editing[g.grade])
                // Clear no-op edits so only real changes get saved
                const clearNoOp = () =>
                  setDrafts((d) => {
                    const next = { ...d }
                    const cur = Number(next[g.grade])
                    if (!Number.isFinite(cur) || cur < 0 || !Number.isInteger(cur)) return next
                    if (cur === Number(g.global_limit ?? 0)) delete next[g.grade]
                    return next
                  })
                return (
                  <div
                    key={g.grade}
                    className={`grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-1.5 ${changed ? 'bg-brand-subtle/40' : ''}`}
                  >
                    <span className="text-sm text-fg">{g.grade}{g.category ? <span className="ml-2 text-xs text-muted">· {g.category}</span> : null}</span>
                    {isOpen ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          autoFocus
                          type="number"
                          min="0"
                          step="1"
                          className="w-44 text-right"
                          value={draft != null ? draft : (g.global_limit ?? 0)}
                          onChange={(e) => setDrafts((d) => ({ ...d, [g.grade]: e.target.value }))}
                          onBlur={clearNoOp}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            clearNoOp()
                            setEditing((e) => ({ ...e, [g.grade]: false }))
                          }}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-brand hover:bg-subtle"
                          aria-label={`Done editing ${g.grade}`}
                          title="Done"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="w-44 text-right text-sm tabular-nums text-fg">
                          {Number(changed ? draft : g.global_limit ?? 0).toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditing((e) => ({ ...e, [g.grade]: true }))}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
                          aria-label={`Edit ${g.grade}`}
                          title="Edit limit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              {limits.length === 0 && (
                <p className="px-4 py-5 text-center text-sm text-muted">No grades found.</p>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-muted">
                {dirty ? `${Object.keys(drafts).length} change${Object.keys(drafts).length === 1 ? '' : 's'} pending` : 'All graded limits saved'}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" leftIcon={RefreshCw} onClick={load} loading={loading} disabled={loading}>
                  Refresh
                </Button>
                <Button onClick={save} loading={saving} disabled={!dirty || saving}>
                  Save changes
                </Button>
              </div>
            </div>
          </>
        )}
        {!!msg && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              msg.startsWith('Saved')
                ? 'border-success-border bg-success-bg text-success-fg'
                : 'border-danger-border bg-danger-bg text-danger-fg'
            }`}
          >
            {msg}
          </div>
        )}
      </Card.Body>
    </Card>
  )
}

function MemberLookupSection() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null) // null = not searched
  const [searching, setSearching] = useState(false)
  const [msg, setMsg] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [member, setMember] = useState(null)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [savings, setSavings] = useState('')
  const [loans, setLoans] = useState('')
  const [portalEnabled, setPortalEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const debounceRef = useRef(null)

  const search = useCallback(async (term) => {
    if (String(term || '').trim().length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    setMsg('')
    try {
      const res = await fetch(`/api/admin/members/search?q=${encodeURIComponent(String(term).trim())}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Search failed')
      setResults(json.members || [])
    } catch (e) {
      setMsg(e.message || 'Search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const onSearchInput = (value) => {
    setQ(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 300)
  }

  const openEdit = (m) => {
    setMember(m)
    setFullName(m.full_name || '')
    setPhone(m.phone || '')
    setEmail(m.email || '')
    setSavings(m.savings != null && m.savings !== '' ? String(m.savings) : '')
    setLoans(m.loans != null && m.loans !== '' ? String(m.loans) : '')
    setPortalEnabled(m.portal_enabled !== false)
    setMsg('')
    setModalOpen(true)
  }

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const payload = { member_id: member.member_id }
      if (fullName.trim() && fullName.trim() !== member.full_name) payload.full_name = fullName.trim()
      if (phone.trim() !== member.phone) payload.phone = phone.trim()
      const emailVal = email.trim().toLowerCase()
      if (emailVal !== (member.email || '').toLowerCase()) payload.email = emailVal
      const numField = (v, cur) => {
        if (String(v ?? '').trim() === '') return null
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0) throw new Error('Savings and loans must be non-negative numbers')
        return n
      }
      const savingsVal = numField(savings, member.savings)
      if (savingsVal != null && savingsVal !== Number(member.savings || 0)) payload.savings = savingsVal
      const loansVal = numField(loans, member.loans)
      if (loansVal != null && loansVal !== Number(member.loans || 0)) payload.loans = loansVal
      if (portalEnabled !== (member.portal_enabled !== false)) payload.portal_enabled = portalEnabled
      if (Object.keys(payload).length === 1) {
        setMsg('Nothing to update — make a change and try again.')
        return
      }
      const res = await fetch('/api/admin/members/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update')
      setMsg('')
      setModalOpen(false)
      search(q)
    } catch (e) {
      setMsg(e.message || 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Member details</Card.Title>
        <Card.Description>Look up a member and edit their name, phone, email, savings or loans.</Card.Description>
      </Card.Header>
      <Card.Body className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => onSearchInput(e.target.value)} placeholder="Search by staff ID, name or phone… (min 2 characters)" className="pl-9" />
        </div>

        {!!msg && <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg">{msg}</div>}

        {searching ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : results !== null && results.length === 0 ? (
          <p className="rounded-lg bg-subtle px-4 py-5 text-center text-sm text-muted">No members found.</p>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line">
            {(results || []).map((m) => (
              <div key={m.member_id} className="flex items-center gap-3 px-4 py-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                  <UserRound className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">
                    {m.full_name || m.member_id}
                    {m.portal_enabled === false && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger-fg">
                        No portal access
                      </span>
                    )}
                  </p>
                  <p className="text-chips text-muted">
                    {m.member_id} · {m.branch_name || '—'} · {m.phone || 'no phone'} · savings ₦{Number(m.savings || 0).toLocaleString()} · loans ₦{Number(m.loans || 0).toLocaleString()}
                  </p>
                </div>
                <Button size="sm" variant="secondary" leftIcon={Pencil} onClick={() => openEdit(m)}>
                  Edit
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card.Body>

      <DraggableModal open={modalOpen} onClose={() => setModalOpen(false)} title={`Edit member · ${member?.member_id || ''}`}>
        <div className="space-y-4">
          {member && (
            <div className="rounded-lg bg-subtle px-3 py-2 text-sm">
              <p className="font-semibold text-fg">{member.full_name || member.member_id}</p>
              <p className="text-xs text-muted">{member.branch_name || '—'} · savings ₦{Number(member.savings || 0).toLocaleString()} · loans ₦{Number(member.loans || 0).toLocaleString()} · limit ₦{Number(member.global_limit || 0).toLocaleString()}</p>
            </div>
          )}
          <div>
            <Label htmlFor="m-full-name">Full name</Label>
            <Input id="m-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Member name" />
          </div>
          <div>
            <Label htmlFor="m-phone">Phone number</Label>
            <Input id="m-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0803 123 4567" />
          </div>
          <div>
            <Label htmlFor="m-email">Email address</Label>
            <Input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="member@example.com" />
            <p className="mt-1 text-[11px] text-muted">Required for member auth signup — OTP will be sent to this email.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="m-savings">Savings (₦)</Label>
              <Input id="m-savings" type="number" min="0" step="0.01" value={savings} onChange={(e) => setSavings(e.target.value)} placeholder="e.g. 2000000" />
            </div>
            <div>
              <Label htmlFor="m-loans">Loans (₦)</Label>
              <Input id="m-loans" type="number" min="0" step="0.01" value={loans} onChange={(e) => setLoans(e.target.value)} placeholder="e.g. 500000" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-subtle px-3 py-3">
            <div className="min-w-0">
              <Label htmlFor="m-portal-toggle">Portal access</Label>
              <p className="text-[11px] text-muted">
                {portalEnabled
                  ? 'Member can sign in and use the member portal.'
                  : 'Excluded — member is invisible to the portal and cannot sign in.'}
              </p>
            </div>
            <button
              id="m-portal-toggle"
              type="button"
              role="switch"
              aria-checked={portalEnabled}
              disabled={saving}
              onClick={() => {
                if (portalEnabled) {
                  const ok = window.confirm(
                    `Exclude ${member?.full_name || member?.member_id || 'this member'} (${member?.member_id || ''}) from the portal? They will no longer be able to sign in. You can re-enable them from the Excluded members tab.`
                  )
                  if (!ok) return
                }
                setPortalEnabled((v) => !v)
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                portalEnabled ? 'bg-brand' : 'bg-line'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  portalEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
          {!!msg && <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg">{msg}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              Save changes
            </Button>
          </div>
        </div>
      </DraggableModal>
    </Card>
  )
}

// Members currently excluded from the portal (portal_enabled = false) with a
// search filter, tick-any-row selection, and one-click re-enable.
function ExcludedMembersSection() {
  const [rows, setRows] = useState(null) // null = loading
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('') // per-row button
  const [bulkBusy, setBulkBusy] = useState(false)
  const [selected, setSelected] = useState({}) // member_id → true

  const load = useCallback(async () => {
    setLoading(true)
    setMsg('')
    try {
      const res = await fetch('/api/admin/members/excluded', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load excluded members')
      setRows(json.members || [])
      setSelected({})
    } catch (e) {
      setMsg(e.message || 'Failed to load excluded members')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const reEnable = async (ids, opts = {}) => {
    const list = Array.isArray(ids) ? ids : [ids]
    if (!list.length || (opts.confirm && list.length > 20 && !window.confirm(`Re-enable ${list.length} members? They will be able to sign in again immediately.`))) return
    if (list.length === 1) setBusyId(list[0])
    else setBulkBusy(true)
    setMsg('')
    try {
      const res = await fetch('/api/admin/members/excluded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(list.length === 1 ? { member_id: list[0] } : { ids: list }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to re-enable')
      setRows((r) => (r || []).filter((m) => !list.includes(m.member_id)))
      setSelected((s) => {
        const next = { ...s }
        for (const id of list) delete next[id]
        return next
      })
      setMsg(`Re-enabled ${json.enabled ?? list.length} member${(json.enabled ?? list.length) === 1 ? '' : 's'} — they can sign in again.`)
      setTimeout(() => setMsg(''), 5000)
    } catch (e) {
      setMsg(e.message || 'Failed to re-enable')
    } finally {
      setBusyId('')
      setBulkBusy(false)
    }
  }

  const term = q.trim().toLowerCase()
  const filtered = (rows || []).filter(
    (m) => !term || m.member_id.toLowerCase().includes(term) || (m.full_name || '').toLowerCase().includes(term) || (m.email || '').toLowerCase().includes(term)
  )
  const selectedIds = filtered.filter((m) => selected[m.member_id]).map((m) => m.member_id)
  const allShownSelected = filtered.length > 0 && filtered.every((m) => selected[m.member_id])

  return (
    <Card>
      <Card.Header>
        <Card.Title>Excluded members</Card.Title>
        <Card.Description>
          Members not in the portal cohort — they cannot sign in and don't receive portal emails. Tick rows to re-enable several at once.
        </Card.Description>
      </Card.Header>
      <Card.Body className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by ID, name or email…" />
          <Button variant="secondary" leftIcon={RefreshCw} onClick={load} loading={loading} disabled={loading} className="shrink-0">
            Refresh
          </Button>
        </div>

        {!!msg && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              msg.startsWith('Re-enabled')
                ? 'border-success-border bg-success-bg text-success-fg'
                : 'border-danger-border bg-danger-bg text-danger-fg'
            }`}
          >
            {msg}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : (rows || []).length === 0 ? (
          <p className="rounded-lg bg-subtle px-4 py-5 text-center text-sm text-muted">No excluded members — everyone is in the portal.</p>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-3 rounded-t-xl border border-line bg-subtle px-3 py-2">
              <label className="flex items-center gap-2 text-xs font-medium text-muted">
                <input
                  type="checkbox"
                  checked={allShownSelected}
                  onChange={(e) =>
                    setSelected(() => {
                      if (e.target.checked) {
                        const next = {}
                        for (const m of filtered) next[m.member_id] = true
                        return next
                      }
                      return {}
                    })
                  }
                  className="h-4 w-4 rounded border-line accent-brand"
                />
                Select all shown ({filtered.length})
              </label>
              <Button
                size="sm"
                leftIcon={RotateCcw}
                onClick={() => reEnable(selectedIds, { confirm: true })}
                loading={bulkBusy}
                disabled={!selectedIds.length || bulkBusy}
              >
                Re-enable selected ({selectedIds.length})
              </Button>
            </div>
            <div className="divide-y divide-line max-h-96 overflow-y-auto rounded-b-xl border border-t-0 border-line">
              {filtered.map((m) => (
                <div key={m.member_id} className="flex items-center gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[m.member_id])}
                    onChange={(e) => setSelected((s) => ({ ...s, [m.member_id]: e.target.checked }))}
                    className="h-4 w-4 shrink-0 rounded border-line accent-brand"
                    aria-label={`Select ${m.member_id}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">
                      {m.full_name || m.member_id}
                      <span className="ml-2 text-xs font-normal text-muted">{m.member_id}</span>
                    </p>
                    <p className="text-chips text-muted">
                      {m.grade || '—'} · {m.email || 'no email'} · savings ₦{Number(m.savings || 0).toLocaleString()}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" leftIcon={RotateCcw} loading={busyId === m.member_id} onClick={() => reEnable([m.member_id])}>
                    Re-enable
                  </Button>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="px-4 py-5 text-center text-sm text-muted">No members match “{q}”.</p>
              )}
            </div>
          </div>
        )}
      </Card.Body>
    </Card>
  )
}

function MembersSettingsContent() {
  const [tab, setTab] = useState('members')
  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 font-bold tracking-tight text-fg">Members Settings</h1>
          <p className="text-sm text-muted">Member administration — imports, details and account management in one place.</p>
        </div>
      </div>
      <div className="flex gap-1 border-b border-line">
        {[
          { id: 'members', label: 'Members' },
          { id: 'excluded', label: 'Excluded members' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative -mb-px inline-flex items-center border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'members' ? (
        <>
          <MembersImportSection />
          <MemberLookupSection />
          <GradeLimitsSection />
        </>
      ) : (
        <ExcludedMembersSection />
      )}
    </div>
  )
}

export default function MembersSettingsPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <MembersSettingsContent />
    </ProtectedRoute>
  )
}
