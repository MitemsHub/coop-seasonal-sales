'use client'

// app/admin/exhibition/vendors/page.jsx
// Vendor accounts for the exhibition — admin creates them (code + passcode are
// generated when left blank), vendors sign into /vendor with those credentials.
// Admins can edit the login details and email them to the vendor. Suspend,
// edit and delete live here too.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Mail, Pencil, Plus, RefreshCw, Search, Store, Trash2, Upload, UserCheck, Users } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Card from '../../../components/ui/Card'
import Input from '../../../components/ui/Input'
import Label from '../../../components/ui/Label'
import Select from '../../../components/ui/Select'
import DraggableModal from '../../../components/DraggableModal'
import Skeleton from '../../../components/ui/Skeleton'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import VendorImportModal from '../../../components/VendorImportModal'
import { VENDOR_EMAIL_INTERVAL_MS } from '../../../../lib/vendorEmailLimits'
import { sendVendorLoginEmails } from '../../../../lib/vendorLoginEmailQueue'

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

function fmtDayMonth(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  } catch {
    return ''
  }
}

function fmtTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

// How each sign-in cohort should be chased. Keys match the `loginCohorts`
// buckets built below.
const SIGN_IN_COHORTS = [
  {
    key: 'delivery',
    label: 'Likely delivery problem',
    hint: 'Credentials were emailed but never used, and no passcode was rejected. The email probably never arrived — re-send to the vendor, check the address, or call them.',
  },
  {
    key: 'credential',
    label: 'Credential problem',
    hint: 'The vendor tried to sign in and the passcode was rejected. Confirm the code and passcode they are using, then reset the passcode and send the new one.',
  },
  {
    key: 'signedIn',
    label: 'Signed in',
    hint: 'At least one successful sign-in recorded. No action needed.',
  },
  {
    key: 'neverEmailed',
    label: 'Never emailed',
    hint: 'No login details sent yet (or no email address on file). Send their login details.',
  },
]

function fmtDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

const failedCountOf = (v) => Number(v.failed_login_count || 0)

// A rejected passcode only matters while it is newer than the vendor's last
// successful sign-in. Once they get in, the earlier attempt is settled, so it
// stops flagging them as a credential problem.
function hasOpenFailures(v) {
  if (failedCountOf(v) === 0) return false
  if (!v.last_login_at) return true
  if (!v.last_failed_login_at) return false
  return new Date(v.last_failed_login_at) > new Date(v.last_login_at)
}

export default function ExhibitionVendorsPage() {
  const [vendors, setVendors] = useState([])
  const [cycles, setCycles] = useState([])
  const [branches, setBranches] = useState([])
  const [cycleFilter, setCycleFilter] = useState('')
  const [term, setTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [modal, setModal] = useState(null) // 'create' | vendor object (edit)
  const [importOpen, setImportOpen] = useState(false)
  const [form, setForm] = useState({})
  const [createdLogin, setCreatedLogin] = useState(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState(new Set())
  const [emailing, setEmailing] = useState(null)
  const [signedInOpen, setSignedInOpen] = useState(false)
  const [failedOpen, setFailedOpen] = useState(false)
  const [cohortOpen, setCohortOpen] = useState(false)
  const [cohortTab, setCohortTab] = useState('delivery')

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const params = new URLSearchParams()
      if (cycleFilter) params.set('cycle_id', cycleFilter)
      if (term.trim()) params.set('q', term.trim())
      const [v, c, b] = await Promise.all([
        fetch(`/api/admin/exhibition/vendors?${params}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/admin/exhibition/cycles', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        fetch('/api/branches/list').then((r) => r.json()).catch(() => null),
      ])
      if (v?.ok) {
        setVendors(v.vendors || [])
        setPage(1)
        setSelected(new Set())
      } else setMsg({ type: 'error', text: v?.error || 'Failed to load vendors' })
      if (c?.ok) setCycles(c.cycles || [])
      if (b?.ok) setBranches(b.branches || [])
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }, [cycleFilter, term])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleFilter])

  useEffect(() => {
    const active = cycles.find((c) => c.status === 'active')
    if (active) setCycleFilter((current) => current || String(active.id))
  }, [cycles])

  const openCreate = () => {
    const active = cycles.find((c) => c.status === 'active')
    setForm({ status: 'active', email: '', code: '', passcode: '', cycle_id: active?.id || '' })
    setModal('create')
  }

  const openEdit = (v) => {
    setForm({
      name: v.name || '',
      code: v.code || '',
      email: v.email || '',
      phone: v.phone || '',
      address: v.address || '',
      passcode: '',
      cycle_id: v.cycle_id,
      branch_id: v.branch_id,
    })
    setModal(v)
  }

  // 'reminder' repeats the sign-in steps without rotating the passcode;
  // 'reset' is the only path that invalidates what the vendor already holds.
  const sendLoginFor = async (vendorId, { passcode = '', mode = 'reminder' } = {}) => {
    const res = await fetch(`/api/admin/exhibition/vendors/${vendorId}/send-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(passcode ? { passcode } : { mode }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not send login details')
    setMsg({
      type: 'success',
      text: json.passcode
        ? `Login details sent to ${json.sent_to}. Passcode: ${json.passcode}`
        : `Reminder sent to ${json.sent_to}. Their existing passcode still works.`,
    })
    return json
  }

  const saveCreate = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/exhibition/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycle_id: Number(form.cycle_id),
          branch_id: Number(form.branch_id),
          name: form.name,
          code: form.code,
          passcode: form.passcode,
          email: form.email,
          phone: form.phone,
          address: form.address,
          status: form.status,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to create vendor')
      setCreatedLogin({
        id: json.vendor.id,
        name: json.vendor.name,
        email: json.vendor.email || '',
        code: json.credentials.code,
        passcode: json.credentials.passcode,
      })
      setModal(null)
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async (emailLogin = false) => {
    if (emailLogin && !String(form.email || '').trim()) {
      setMsg({ type: 'error', text: 'Add an email address for this vendor first.' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const payload = { name: form.name, code: form.code, email: form.email, phone: form.phone, address: form.address }
      if (form.passcode) payload.passcode = form.passcode
      if (form.cycle_id) payload.cycle_id = Number(form.cycle_id)
      if (form.branch_id) payload.branch_id = Number(form.branch_id)
      const res = await fetch(`/api/admin/exhibition/vendors/${modal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to update vendor')
      setModal(null)
      await load()
      if (emailLogin) {
        const emailChanged =
          String(form.email || '').trim().toLowerCase() !== String(modal.email || '').trim().toLowerCase()
        await sendLoginFor(modal.id, {
          passcode: form.passcode,
          // A new passcode was typed, the address changed (the new address never
          // received the old passcode), or the vendor was never sent details:
          // send fresh details. Otherwise just remind them, no rotation.
          mode: form.passcode || emailChanged || !modal.login_sent_at ? 'reset' : 'reminder',
        })
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const emailCreatedLogin = async () => {
    if (!createdLogin?.email) return
    setBusy(true)
    setMsg(null)
    try {
      await sendLoginFor(createdLogin.id, { passcode: createdLogin.passcode })
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const toggleStatus = async (v) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/exhibition/vendors/${v.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: v.status === 'active' ? 'suspended' : 'active' }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to update vendor')
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [emailConfirm, setEmailConfirm] = useState(null)

  const removeVendor = async (v) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/exhibition/vendors/${v.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to delete vendor')
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmDelete = () => {
    if (confirmTarget) removeVendor(confirmTarget)
    setConfirmOpen(false)
    setConfirmTarget(null)
  }

  const isEmailing = Boolean(emailing)
  const totalPages = Math.max(1, Math.ceil(vendors.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageVendors = vendors.slice(pageStart, pageStart + pageSize)
  const pageEmailable = pageVendors.filter((v) => String(v.email || '').trim())
  const emailableVendors = vendors.filter((v) => String(v.email || '').trim())
  const allPageSelected = pageEmailable.length > 0 && pageEmailable.every((v) => selected.has(v.id))
  const selectedVendors = emailableVendors.filter((v) => selected.has(v.id))
  const allEmailableSelected = emailableVendors.length > 0 && selectedVendors.length === emailableVendors.length
  // Who has actually signed in at least once (last_login_at is set by the
  // vendor login route), most recent first.
  const signedInVendors = useMemo(
    () =>
      vendors
        .filter((v) => v.last_login_at)
        .sort((a, b) => new Date(b.last_login_at) - new Date(a.last_login_at)),
    [vendors]
  )
  // Vendors whose passcode was rejected and who have not signed in since,
  // most recent first.
  const failedLoginVendors = useMemo(
    () =>
      vendors
        .filter((v) => hasOpenFailures(v))
        .sort((a, b) => new Date(b.last_failed_login_at || 0) - new Date(a.last_failed_login_at || 0)),
    [vendors]
  )
  // Split the vendors we emailed by what actually happened next, so the two
  // kinds of silence are chased differently: an email that never landed vs a
  // passcode that was rejected. Vendors who got in are excluded from both.
  const loginCohorts = useMemo(() => {
    const cohorts = { delivery: [], credential: [], signedIn: [], neverEmailed: [] }
    for (const v of vendors) {
      if (v.last_login_at) cohorts.signedIn.push(v)
      else if (!String(v.email || '').trim() || !v.login_sent_at) cohorts.neverEmailed.push(v)
      else if (hasOpenFailures(v)) cohorts.credential.push(v)
      else cohorts.delivery.push(v)
    }
    cohorts.delivery.sort((a, b) => new Date(a.login_sent_at || 0) - new Date(b.login_sent_at || 0))
    cohorts.credential.sort((a, b) => new Date(b.last_failed_login_at || 0) - new Date(a.last_failed_login_at || 0))
    cohorts.signedIn.sort((a, b) => new Date(b.last_login_at || 0) - new Date(a.last_login_at || 0))
    cohorts.neverEmailed.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    return cohorts
  }, [vendors])
  const chaseCount = loginCohorts.delivery.length + loginCohorts.credential.length
  const activeCohort = SIGN_IN_COHORTS.find((c) => c.key === cohortTab) || SIGN_IN_COHORTS[0]
  const cohortRows = loginCohorts[activeCohort.key] || []
  const cohortMeta = (v) => {
    if (cohortTab === 'delivery') return `Sent ${fmtDate(v.login_sent_at)}`
    if (cohortTab === 'credential') return `${failedCountOf(v)} failed · ${fmtDate(v.last_failed_login_at)}`
    if (cohortTab === 'signedIn') return fmtDateTime(v.last_login_at)
    return v.email || 'No email address'
  }

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectPage = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        for (const v of pageEmailable) next.delete(v.id)
      } else {
        for (const v of pageEmailable) next.add(v.id)
      }
      return next
    })
  }

  // 'auto' keeps vendors who already hold details on a reminder and only issues
  // credentials to vendors who have never been sent any.
  const sendVendorEmails = async (list, mode = 'auto') => {
    if (isEmailing) return
    const planned = list.map((vendor) => ({
      id: vendor.id,
      mode: mode === 'auto' ? (vendor.login_sent_at ? 'reminder' : 'reset') : mode,
    }))
    const reminderCount = planned.filter((p) => p.mode === 'reminder').length
    const resetCount = planned.length - reminderCount
    setEmailing({ done: 0, total: list.length })
    setMsg(null)
    try {
      const { sent, failed } = await sendVendorLoginEmails({
        vendors: list,
        send: async (vendor) => {
          const entry = planned.find((p) => p.id === vendor.id)
          const res = await fetch(`/api/admin/exhibition/vendors/${vendor.id}/send-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: entry?.mode || 'reminder' }),
          })
          const json = await res.json().catch(() => null)
          return { res, json }
        },
        onProgress: ({ done, total }) => setEmailing({ done, total }),
      })

      if (failed.length) {
        const details = failed
          .slice(0, 3)
          .map(({ vendor, error }) => `${vendor.name}: ${error}`)
          .join(' · ')
        const more = failed.length > 3 ? ` · …and ${failed.length - 3} more` : ''
        setMsg({ type: 'error', text: `Sent ${sent} of ${list.length}. ${details}${more}` })
        setSelected(new Set(failed.map(({ vendor }) => vendor.id)))
      } else {
        const parts = []
        if (reminderCount) {
          parts.push(`${reminderCount} reminder${reminderCount === 1 ? '' : 's'} (passcode unchanged)`)
        }
        if (resetCount) {
          parts.push(`${resetCount} with new login details`)
        }
        setMsg({
          type: 'success',
          text: `Sent ${sent} email${sent === 1 ? '' : 's'}: ${parts.join(' and ')}.`,
        })
        setSelected(new Set())
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message || 'Could not send login details' })
    } finally {
      setEmailing(null)
    }
  }

  const emailConfirmList = emailConfirm?.list || []
  const emailConfirmMode = emailConfirm?.mode || 'auto'
  const emailConfirmMinutes = Math.ceil((emailConfirmList.length * VENDOR_EMAIL_INTERVAL_MS) / 60000)

  const emailVendors = (targets, mode = 'auto') => {
    if (isEmailing) return
    const list = []
    const seen = new Set()
    for (const v of targets || []) {
      if (!v?.id || seen.has(v.id) || !String(v.email || '').trim()) continue
      seen.add(v.id)
      list.push(v)
    }
    if (!list.length) {
      setMsg({ type: 'error', text: 'Select at least one vendor with an email address.' })
      return
    }
    setEmailConfirm({ list, mode })
  }

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition Vendors</h1>
            <p className="mt-0.5 text-sm text-muted">Codes and passcodes auto-generate. Vendors sign in with their stand and passcode. Send a reminder to keep their passcode unchanged, or reset it to issue a new one.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={load} disabled={loading || busy || isEmailing}>
              Refresh
            </Button>
            <Button size="sm" variant="secondary" leftIcon={Upload} onClick={() => setImportOpen(true)} disabled={isEmailing}>
              Import vendors
            </Button>
            <Button size="sm" leftIcon={Plus} onClick={openCreate} disabled={isEmailing}>
              New Vendor
            </Button>
          </div>
        </div>

        {msg && (
          <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'}`}>
            {msg.text}
          </div>
        )}

        {createdLogin && (
          <div className="mb-4 rounded-xl border border-success-border bg-success-bg px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-success-fg">
                <p className="font-semibold">{createdLogin.name} created</p>
                <p className="mt-0.5 text-xs">
                  Code <span className="font-mono font-semibold">{createdLogin.code}</span> · Passcode{' '}
                  <span className="font-mono font-semibold">{createdLogin.passcode}</span>
                  {createdLogin.email ? ` · ${createdLogin.email}` : ' · no email on file'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={Mail}
                  onClick={emailCreatedLogin}
                  disabled={busy || isEmailing || !createdLogin.email}
                >
                  Email login
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreatedLogin(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="Search name, code, email or phone…"
              className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            />
          </div>
          <Select value={cycleFilter} onChange={(e) => setCycleFilter(e.target.value)} className="sm:w-64">
            <option value="">All cycles</option>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </Select>
        </div>

        <Card className="gap-0 overflow-hidden p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : vendors.length === 0 ? (
            <div className="rounded-xl bg-subtle px-4 py-10 text-center text-sm text-muted">
              <Store className="mx-auto mb-2 h-8 w-8 text-muted" strokeWidth={1.5} />
              No vendors match. Create vendor accounts for the exhibition.
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 border-b border-line bg-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSignedInOpen(true)}
                    title="See which vendors have signed in"
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-fg transition-colors hover:bg-line-subtle"
                  >
                    <UserCheck className="h-3.5 w-3.5 text-brand" />
                    Signed in {signedInVendors.length} / {vendors.length}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFailedOpen(true)}
                    title="See which vendors tried and could not sign in"
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                      failedLoginVendors.length > 0
                        ? 'border-warning-border bg-warning-bg text-warning-fg hover:brightness-105'
                        : 'border-line bg-surface text-fg hover:bg-line-subtle',
                    ].join(' ')}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Failed {failedLoginVendors.length} / {vendors.length}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCohortOpen(true)}
                    title="See who to chase and how"
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                      chaseCount > 0
                        ? 'border-brand bg-brand-subtle text-brand hover:brightness-105'
                        : 'border-line bg-surface text-fg hover:bg-line-subtle',
                    ].join(' ')}
                  >
                    <Users className="h-3.5 w-3.5" />
                    Cohorts {chaseCount}
                  </button>
                  <label className="flex items-center gap-2 text-xs font-medium text-muted">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectPage}
                      disabled={!pageEmailable.length || isEmailing}
                      className="h-4 w-4 rounded border-line accent-brand"
                    />
                    Select all shown ({pageEmailable.length})
                  </label>
                  {selectedVendors.length > 0 && (
                    <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-semibold text-brand">
                      {selectedVendors.length} selected
                    </span>
                  )}
                  {!allEmailableSelected && !isEmailing && emailableVendors.length > pageEmailable.length && (
                    <button
                      type="button"
                      onClick={() => setSelected(new Set(emailableVendors.map((v) => v.id)))}
                      className="text-xs font-medium text-brand underline-offset-2 hover:underline"
                    >
                      Select all {emailableVendors.length} with email
                    </button>
                  )}
                  {selected.size > 0 && !isEmailing && (
                    <button
                      type="button"
                      onClick={() => setSelected(new Set())}
                      className="text-xs font-medium text-muted underline-offset-2 hover:text-fg hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <Button
                  size="sm"
                  leftIcon={Mail}
                  onClick={() => emailVendors(selectedVendors)}
                  loading={isEmailing}
                  disabled={!selectedVendors.length || isEmailing}
                >
                  {isEmailing
                    ? `Sending ${Math.min(emailing.done + 1, emailing.total)} / ${emailing.total}…`
                    : `Email selected${selectedVendors.length ? ` (${selectedVendors.length})` : ''}`}
                </Button>
              </div>

              {isEmailing ? (
                <p className="border-b border-line bg-surface px-4 py-2 text-xs text-muted">
                  Sending {Math.min(emailing.done + 1, emailing.total)} of {emailing.total} — emails are paced at one every 10 seconds. Keep this page open until sending finishes.
                </p>
              ) : selectedVendors.length > 0 ? (
                <p className="border-b border-line bg-surface px-4 py-2 text-xs text-muted">
                  Vendors already sent details get a reminder and keep their current passcode; anyone never sent details gets a new passcode. {selectedVendors.length} email{selectedVendors.length === 1 ? '' : 's'} will take about {Math.ceil((selectedVendors.length * VENDOR_EMAIL_INTERVAL_MS) / 60000)} minute{Math.ceil((selectedVendors.length * VENDOR_EMAIL_INTERVAL_MS) / 60000) === 1 ? '' : 's'}.
                </p>
              ) : null}

              <div className="hidden md:block">
                <div className="overflow-hidden">
                  <table className="w-full table-fixed text-sm">
                    {/* Column widths live on the header cells so the optional
                        columns (Cycle, Created) can disappear below xl, where a
                        ten-column table only leaves a few pixels per column. */}
                    <thead className="sticky top-0 z-10 bg-surface">
                      <tr className="border-b border-line text-left">
                        <th className="w-9 p-2 xl:w-10 xl:p-3">
                          <input
                            type="checkbox"
                            checked={allPageSelected}
                            onChange={toggleSelectPage}
                            disabled={!pageEmailable.length || isEmailing}
                            aria-label="Select all vendors on this page"
                            className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                          />
                        </th>
                        <th className="p-2 text-xs font-semibold uppercase tracking-wide text-subtext xl:p-3">Vendor</th>
                        <th className="w-[56px] p-2 text-xs font-semibold uppercase tracking-wide text-subtext xl:w-[62px] xl:p-3">Code</th>
                        <th className="w-[72px] p-2 text-xs font-semibold uppercase tracking-wide text-subtext xl:w-[96px] xl:p-3">Branch</th>
                        <th className="hidden p-2 text-xs font-semibold uppercase tracking-wide text-subtext xl:table-cell xl:w-[112px] xl:p-3">Cycle</th>
                        <th className="w-[108px] p-2 text-xs font-semibold uppercase tracking-wide text-subtext xl:w-[150px] xl:p-3">Contact</th>
                        <th className="w-[70px] p-2 text-xs font-semibold uppercase tracking-wide text-subtext xl:w-[84px] xl:p-3">Status</th>
                        <th className="hidden p-2 text-xs font-semibold uppercase tracking-wide text-subtext xl:table-cell xl:w-[76px] xl:p-3">Created</th>
                        <th className="w-[74px] p-2 text-xs font-semibold uppercase tracking-wide text-subtext xl:w-[88px] xl:p-3">
                          <span className="xl:hidden">Sign-in</span>
                          <span className="hidden xl:inline">Last sign-in</span>
                        </th>
                        <th className="w-[104px] p-2 text-right text-xs font-semibold uppercase tracking-wide text-subtext xl:w-[116px] xl:p-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageVendors.map((v) => (
                        <tr key={v.id} className="border-b border-line transition-colors duration-150 ease-sakani last:border-0 hover:bg-subtle">
                          <td className="p-2 xl:p-3">
                            <input
                              type="checkbox"
                              checked={selected.has(v.id)}
                              onChange={() => toggleSelect(v.id)}
                              disabled={!String(v.email || '').trim() || isEmailing}
                              title={!String(v.email || '').trim() ? 'Add an email address for this vendor first' : undefined}
                              aria-label={`Select ${v.name}`}
                              className="h-4 w-4 rounded border-line text-brand focus:ring-brand disabled:opacity-40"
                            />
                          </td>
                          <td className="p-2 xl:p-3">
                            <div className="break-words font-medium text-fg">{v.name}</div>
                            {v.address ? (
                              <div className="mt-1 truncate text-xs text-subtext" title={v.address}>{v.address}</div>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap p-2 font-mono text-xs text-muted xl:p-3">{v.code}</td>
                          <td className="truncate p-2 text-muted xl:p-3" title={v.branch_name || `#${v.branch_id}`}>
                            {v.branch_name || `#${v.branch_id}`}
                          </td>
                          <td className="hidden truncate p-2 text-muted xl:table-cell xl:p-3" title={v.cycle_name || `#${v.cycle_id}`}>
                            {v.cycle_name || `#${v.cycle_id}`}
                          </td>
                          <td className="p-2 xl:p-3">
                            <div className="truncate text-xs text-muted" title={v.email || ''}>{v.email || '—'}</div>
                            <div className="text-xs text-subtext">{v.phone || '—'}</div>
                          </td>
                          <td className="p-2 xl:p-3">
                            <Badge tone={v.status === 'active' ? 'success' : 'neutral'} variant="subtle">
                              {v.status}
                            </Badge>
                            {hasOpenFailures(v) ? (
                              <div
                                className="mt-1 whitespace-nowrap text-xs font-semibold text-warning-fg"
                                title={`Last failed attempt ${fmtDateTime(v.last_failed_login_at)}`}
                              >
                                {failedCountOf(v)} failed
                              </div>
                            ) : null}
                          </td>
                          <td className="hidden p-2 text-xs text-muted xl:table-cell xl:p-3">{fmtDate(v.created_at)}</td>
                          <td
                            className="p-2 text-xs xl:p-3"
                            title={v.last_login_at ? fmtDateTime(v.last_login_at) : 'Has never signed in'}
                          >
                            {v.last_login_at ? (
                              <>
                                <div className="whitespace-nowrap text-muted">{fmtDayMonth(v.last_login_at)}</div>
                                <div className="whitespace-nowrap text-subtext">{fmtTime(v.last_login_at)}</div>
                              </>
                            ) : (
                              <span className="text-subtext">Never</span>
                            )}
                          </td>
                          <td className="p-2 text-right xl:p-3">
                            <select
                              className="w-full max-w-full rounded-lg border border-line bg-surface px-1.5 py-1.5 text-xs text-fg focus:border-brand focus:outline-none disabled:opacity-50 xl:px-2 xl:text-sm"
                              defaultValue=""
                              onChange={(e) => {
                                const action = e.target.value
                                e.target.value = ''
                                if (action === 'remind') emailVendors([v], 'reminder')
                                if (action === 'reset') emailVendors([v], 'reset')
                                if (action === 'edit') openEdit(v)
                                if (action === 'status') toggleStatus(v)
                                if (action === 'delete') { setConfirmTarget(v); setConfirmOpen(true) }
                              }}
                              disabled={busy || isEmailing}
                            >
                              <option value="" disabled>Actions</option>
                              <option value="remind" disabled={!String(v.email || '').trim() || !v.login_sent_at}>
                                Send reminder (keeps passcode)
                              </option>
                              <option value="reset" disabled={!String(v.email || '').trim()}>
                                Reset passcode &amp; send
                              </option>
                              <option value="edit">Edit</option>
                              <option value="status">{v.status === 'active' ? 'Suspend' : 'Activate'}</option>
                              <option value="delete">Delete</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Phones get cards for the vendor details and actions. */}
              <div className="divide-y divide-line md:hidden">
                {pageVendors.map((v) => (
                  <div key={v.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selected.has(v.id)}
                          onChange={() => toggleSelect(v.id)}
                          disabled={!String(v.email || '').trim() || isEmailing}
                          title={!String(v.email || '').trim() ? 'Add an email address for this vendor first' : undefined}
                          aria-label={`Select ${v.name}`}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-brand disabled:opacity-40"
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-fg">{v.name}</div>
                          <div className="font-mono text-xs text-muted">{v.code}</div>
                        </div>
                      </div>
                      <Badge tone={v.status === 'active' ? 'success' : 'neutral'} variant="subtle">
                        {v.status}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div>
                        <div className="text-subtext">Branch</div>
                        <div className="font-medium text-fg">{v.branch_name || `#${v.branch_id}`}</div>
                      </div>
                      <div>
                        <div className="text-subtext">Cycle</div>
                        <div className="font-medium text-fg">{v.cycle_name || `#${v.cycle_id}`}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-subtext">Contact</div>
                        <div className="text-fg">{v.email || '—'}</div>
                        <div className="text-fg">{v.phone || '—'}</div>
                        {v.address ? <div className="text-muted">{v.address}</div> : null}
                      </div>
                      <div className="col-span-2 text-subtext">Created {fmtDate(v.created_at)}</div>
                      <div className="col-span-2 text-subtext">
                        Last sign-in {v.last_login_at ? fmtDateTime(v.last_login_at) : 'Never'}
                      </div>
                      {hasOpenFailures(v) ? (
                        <div className="col-span-2 font-medium text-warning-fg">
                          {failedCountOf(v)} failed sign-in{failedCountOf(v) === 1 ? '' : 's'} · last{' '}
                          {fmtDateTime(v.last_failed_login_at)}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        className="col-span-2"
                        size="sm"
                        variant="secondary"
                        leftIcon={Mail}
                        onClick={() => emailVendors([v], 'reminder')}
                        disabled={busy || isEmailing || !String(v.email || '').trim() || !v.login_sent_at}
                      >
                        Send reminder
                      </Button>
                      <Button
                        className="col-span-2"
                        size="sm"
                        variant="ghost"
                        onClick={() => emailVendors([v], 'reset')}
                        disabled={busy || isEmailing || !String(v.email || '').trim()}
                      >
                        Reset passcode &amp; send
                      </Button>
                      <Button size="sm" variant="ghost" leftIcon={Pencil} onClick={() => openEdit(v)} disabled={busy || isEmailing}>
                        Edit
                      </Button>
                      <Button size="sm" variant={v.status === 'active' ? 'warning' : 'success'} onClick={() => toggleStatus(v)} disabled={busy || isEmailing}>
                        {v.status === 'active' ? 'Suspend' : 'Activate'}
                      </Button>
                      <div className="col-span-2">
                        <Button className="w-full" size="sm" variant="danger" leftIcon={Trash2} onClick={() => { setConfirmTarget(v); setConfirmOpen(true) }} disabled={busy || isEmailing}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted">
                  Showing {pageStart + 1}–{Math.min(pageStart + pageSize, vendors.length)} of {vendors.length} vendors
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted">
                    Rows
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value))
                        setPage(1)
                      }}
                      disabled={isEmailing}
                      className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg focus:border-brand focus:outline-none"
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </label>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={ChevronLeft}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1 || isEmailing}
                  >
                    Previous
                  </Button>
                  <span className="px-1 text-xs font-medium text-muted">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    rightIcon={ChevronRight}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages || isEmailing}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>

        <DraggableModal
          open={signedInOpen}
          onClose={() => setSignedInOpen(false)}
          title="Vendors who have signed in"
        >
          <div className="space-y-3">
            <p className="text-sm text-muted">
              <span className="font-semibold text-fg">{signedInVendors.length}</span> of{' '}
              <span className="font-semibold text-fg">{vendors.length}</span> vendors in this view have signed in at
              least once.
            </p>
            {signedInVendors.length === 0 ? (
              <p className="rounded-xl bg-subtle px-4 py-8 text-center text-sm text-muted">
                No vendor has signed in yet. Sign-ins are counted from now on.
              </p>
            ) : (
              <div className="max-h-[60vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {signedInVendors.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg" title={v.name}>{v.name}</p>
                      <p className="truncate text-xs text-muted">
                        <span className="font-mono">{v.code}</span>
                        {v.branch_name ? ` · ${v.branch_name}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-right text-xs text-muted">{fmtDateTime(v.last_login_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DraggableModal>

        <DraggableModal
          open={failedOpen}
          onClose={() => setFailedOpen(false)}
          title="Vendors who could not sign in"
        >
          <div className="space-y-3">
            <p className="text-sm text-muted">
              <span className="font-semibold text-fg">{failedLoginVendors.length}</span> of{' '}
              <span className="font-semibold text-fg">{vendors.length}</span>               vendors have had a passcode rejected since their last successful sign-in. A vendor who got in
              after a failed attempt is no longer counted here.
            </p>
            {failedLoginVendors.length === 0 ? (
              <p className="rounded-xl bg-subtle px-4 py-8 text-center text-sm text-muted">
                No failed sign-in attempts recorded yet.
              </p>
            ) : (
              <div className="max-h-[60vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {failedLoginVendors.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg" title={v.name}>{v.name}</p>
                      <p className="truncate text-xs text-muted">
                        <span className="font-mono">{v.code}</span>
                        {v.branch_name ? ` · ${v.branch_name}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs font-semibold text-warning-fg">
                        {failedCountOf(v)} failed
                      </div>
                      <div className="text-xs text-muted">{fmtDateTime(v.last_failed_login_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DraggableModal>

        <DraggableModal
          open={cohortOpen}
          onClose={() => setCohortOpen(false)}
          title="Vendor sign-in cohorts"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {SIGN_IN_COHORTS.map((cohort) => {
                const active = cohortTab === cohort.key
                return (
                  <button
                    key={cohort.key}
                    type="button"
                    onClick={() => setCohortTab(cohort.key)}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                      active
                        ? 'border-brand bg-brand-subtle text-brand'
                        : 'border-line bg-surface text-muted hover:bg-line-subtle',
                    ].join(' ')}
                  >
                    {cohort.label}
                    <span className="tabular-nums">{loginCohorts[cohort.key].length}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted">
              Counts follow the current cycle filter and search ({vendors.length} vendor
              {vendors.length === 1 ? '' : 's'} loaded).
            </p>
            <p className="rounded-xl bg-subtle px-3 py-2 text-xs text-muted">{activeCohort.hint}</p>
            {cohortRows.length === 0 ? (
              <p className="rounded-xl bg-subtle px-4 py-8 text-center text-sm text-muted">
                No vendors in this cohort.
              </p>
            ) : (
              <div className="max-h-[55vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {cohortRows.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg" title={v.name}>{v.name}</p>
                      <p className="truncate text-xs text-muted">
                        <span className="font-mono">{v.code}</span>
                        {v.branch_name ? ` · ${v.branch_name}` : ''}
                      </p>
                    </div>
                    <span
                      className={[
                        'shrink-0 text-right text-xs',
                        cohortTab === 'credential' ? 'font-semibold text-warning-fg' : 'text-muted',
                      ].join(' ')}
                    >
                      {cohortMeta(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DraggableModal>

        <DraggableModal open={!!modal} onClose={() => setModal(null)} title={modal === 'create' ? 'New vendor account' : 'Edit vendor'}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exh-v-name">Vendor name</Label>
                <Input id="exh-v-name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Abuja Foods" />
              </div>
              <div>
                <Label htmlFor="exh-v-code">Vendor code</Label>
                <Input
                  id="exh-v-code"
                  value={form.code || ''}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder={modal === 'create' ? 'Blank = auto-generate' : 'e.g. V0001'}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exh-v-cycle">Cycle</Label>
                <Select id="exh-v-cycle" value={form.cycle_id || ''} onChange={(e) => setForm({ ...form, cycle_id: e.target.value })} className="w-full">
                  <option value="">Select cycle</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="exh-v-branch">Branch</Label>
                <Select id="exh-v-branch" value={form.branch_id || ''} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} className="w-full">
                  <option value="">Select branch</option>
                  {branches.map((b) => (
                    <option key={b.branch_id || b.id || b.code} value={b.branch_id || b.id || b.code}>{b.name} ({b.code})</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exh-v-email">Email</Label>
                <Input
                  id="exh-v-email"
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="vendor@example.com"
                />
              </div>
              <div>
                <Label htmlFor="exh-v-phone">Phone</Label>
                <Input id="exh-v-phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exh-v-passcode">{modal === 'create' ? 'Passcode' : 'New passcode (blank = keep)'}</Label>
                <Input
                  id="exh-v-passcode"
                  value={form.passcode || ''}
                  onChange={(e) => setForm({ ...form, passcode: e.target.value })}
                  placeholder={modal === 'create' ? 'Blank = auto-generate' : 'Blank = unchanged'}
                />
              </div>
              <div>
                <Label htmlFor="exh-v-address">Address / stand location</Label>
                <Input id="exh-v-address" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            </div>
            {modal !== 'create' && (
              <p className="text-xs text-muted">
                Changing the code or passcode changes what the vendor signs in with. “Save &amp; email login” saves these edits first, then emails a reminder — or new details, if you typed a passcode.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              {modal !== 'create' && (
                <Button
                  variant="secondary"
                  leftIcon={Mail}
                  loading={busy}
                  onClick={() => saveEdit(true)}
                  disabled={!String(form.email || '').trim()}
                >
                  Save &amp; email login
                </Button>
              )}
              <Button loading={busy} onClick={() => (modal === 'create' ? saveCreate() : saveEdit(false))}>
                {modal === 'create' ? 'Create vendor' : 'Save changes'}
              </Button>
            </div>
          </div>
        </DraggableModal>

        <ConfirmDialog
          open={confirmOpen}
          onClose={() => { setConfirmOpen(false); setConfirmTarget(null) }}
          onConfirm={handleConfirmDelete}
          title="Delete vendor?"
          message={`Delete vendor "${confirmTarget?.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
        />

        <ConfirmDialog
          open={!!emailConfirm}
          onClose={() => setEmailConfirm(null)}
          onConfirm={() => {
            const pending = emailConfirm
            setEmailConfirm(null)
            if (pending) sendVendorEmails(pending.list, pending.mode)
          }}
          title={
            emailConfirmMode === 'reset'
              ? 'Reset passcodes and send?'
              : emailConfirmMode === 'reminder'
                ? 'Send sign-in reminders?'
                : 'Send vendor emails?'
          }
          message={
            emailConfirm
              ? `${emailConfirmMode === 'reset'
                  ? 'Each vendor gets a new passcode, so the passcode in their inbox will stop working. '
                  : emailConfirmMode === 'reminder'
                    ? 'Existing passcodes stay valid — nothing is rotated. '
                    : 'Vendors already sent details get a reminder and keep their passcode; vendors never sent details get new login details. '}Emails are paced at one every 10 seconds, so ${emailConfirmList.length} email${emailConfirmList.length === 1 ? '' : 's'} will take about ${emailConfirmMinutes} minute${emailConfirmMinutes === 1 ? '' : 's'}. Keep this page open until sending finishes.`
              : ''
          }
          confirmLabel={
            emailConfirmMode === 'reset'
              ? `Reset ${emailConfirmList.length} passcode${emailConfirmList.length === 1 ? '' : 's'}`
              : `Send ${emailConfirmList.length} email${emailConfirmList.length === 1 ? '' : 's'}`
          }
          variant="brand"
        />

        <VendorImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          cycles={cycles}
          branches={branches}
          onDone={load}
        />
      </div>
    </ProtectedRoute>
  )
}
