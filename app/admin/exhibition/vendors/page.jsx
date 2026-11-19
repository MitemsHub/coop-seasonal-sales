'use client'

// app/admin/exhibition/vendors/page.jsx
// Vendor accounts for the exhibition — admin creates them (code + passcode are
// generated when left blank), vendors sign into /vendor with those credentials.
// Admins can edit the login details and email them to the vendor. Suspend,
// edit and delete live here too.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Mail, Pencil, Plus, RefreshCw, Search, Store, Trash2, Upload, UserCheck } from 'lucide-react'
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

  const sendLoginFor = async (vendorId, passcode = '') => {
    const res = await fetch(`/api/admin/exhibition/vendors/${vendorId}/send-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(passcode ? { passcode } : {}),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not send login details')
    setMsg({
      type: 'success',
      text: `Login details sent to ${json.sent_to}. Passcode: ${json.passcode}`,
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
      if (emailLogin) await sendLoginFor(modal.id, form.passcode)
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
      await sendLoginFor(createdLogin.id, createdLogin.passcode)
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

  const sendVendorEmails = async (list) => {
    if (isEmailing) return
    setEmailing({ done: 0, total: list.length })
    setMsg(null)
    try {
      const { sent, failed } = await sendVendorLoginEmails({
        vendors: list,
        send: async (vendor) => {
          const res = await fetch(`/api/admin/exhibition/vendors/${vendor.id}/send-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
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
        setMsg({
          type: 'success',
          text: `Login details emailed to ${sent} vendor${sent === 1 ? '' : 's'}. Each vendor now has a new passcode.`,
        })
        setSelected(new Set())
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message || 'Could not send login details' })
    } finally {
      setEmailing(null)
    }
  }

  const emailVendors = (targets) => {
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
    setEmailConfirm(list)
  }

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition Vendors</h1>
            <p className="mt-0.5 text-sm text-muted">Codes and passcodes auto-generate. Vendors sign in with their stand and passcode; you can email the details.</p>
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
                  Sending creates a new passcode for each selected vendor. {selectedVendors.length} email{selectedVendors.length === 1 ? '' : 's'} will take about {Math.ceil((selectedVendors.length * VENDOR_EMAIL_INTERVAL_MS) / 60000)} minute{Math.ceil((selectedVendors.length * VENDOR_EMAIL_INTERVAL_MS) / 60000) === 1 ? '' : 's'}.
                </p>
              ) : null}

              <div className="hidden md:block">
                <div className="overflow-hidden">
                  <table className="w-full table-fixed text-sm">
                    <colgroup>
                      <col className="w-10" />
                      <col className="w-[22%]" />
                      <col className="w-[7%]" />
                      <col className="w-[10%]" />
                      <col className="w-[11%]" />
                      <col className="w-[17%]" />
                      <col className="w-[8%]" />
                      <col className="w-[8%]" />
                      <col className="w-[12%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-surface">
                      <tr className="border-b border-line text-left">
                        <th className="w-10 p-3">
                          <input
                            type="checkbox"
                            checked={allPageSelected}
                            onChange={toggleSelectPage}
                            disabled={!pageEmailable.length || isEmailing}
                            aria-label="Select all vendors on this page"
                            className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                          />
                        </th>
                        <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Vendor</th>
                        <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Code</th>
                        <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Branch</th>
                        <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Cycle</th>
                        <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Contact</th>
                        <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Status</th>
                        <th className="p-3 text-xs font-semibold uppercase tracking-wide text-subtext">Created</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageVendors.map((v) => (
                        <tr key={v.id} className="border-b border-line transition-colors duration-150 ease-sakani last:border-0 hover:bg-subtle">
                          <td className="p-3">
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
                          <td className="p-3">
                            <div className="font-medium text-fg">{v.name}</div>
                            {v.address ? (
                              <div className="mt-1 truncate text-xs text-subtext" title={v.address}>{v.address}</div>
                            ) : null}
                          </td>
                          <td className="p-3 font-mono text-xs text-muted">{v.code}</td>
                          <td className="truncate p-3 text-muted" title={v.branch_name || `#${v.branch_id}`}>
                            {v.branch_name || `#${v.branch_id}`}
                          </td>
                          <td className="truncate p-3 text-muted" title={v.cycle_name || `#${v.cycle_id}`}>
                            {v.cycle_name || `#${v.cycle_id}`}
                          </td>
                          <td className="p-3">
                            <div className="truncate text-xs text-muted" title={v.email || ''}>{v.email || '—'}</div>
                            <div className="text-xs text-subtext">{v.phone || '—'}</div>
                          </td>
                          <td className="p-3">
                            <Badge tone={v.status === 'active' ? 'success' : 'neutral'} variant="subtle">
                              {v.status}
                            </Badge>
                          </td>
                          <td className="p-3 text-xs text-muted">{fmtDate(v.created_at)}</td>
                          <td className="p-3 text-right">
                            <select
                              className="w-full max-w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg focus:border-brand focus:outline-none disabled:opacity-50"
                              defaultValue=""
                              onChange={(e) => {
                                const action = e.target.value
                                e.target.value = ''
                                if (action === 'email') emailVendors([v])
                                if (action === 'edit') openEdit(v)
                                if (action === 'status') toggleStatus(v)
                                if (action === 'delete') { setConfirmTarget(v); setConfirmOpen(true) }
                              }}
                              disabled={busy || isEmailing}
                            >
                              <option value="" disabled>Actions</option>
                              <option value="email" disabled={!String(v.email || '').trim()}>Email login</option>
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
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        className="col-span-2"
                        size="sm"
                        variant="secondary"
                        leftIcon={Mail}
                        onClick={() => emailVendors([v])}
                        disabled={busy || isEmailing || !String(v.email || '').trim()}
                      >
                        Email login
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
                Changing the code or passcode changes what the vendor signs in with. “Save & email login” saves these edits first, then sends the new details.
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
            const list = emailConfirm || []
            setEmailConfirm(null)
            sendVendorEmails(list)
          }}
          title="Send vendor logins?"
          message={
            emailConfirm
              ? `Each vendor gets a new passcode, so any passcode you already shared will stop working. Emails are paced at one every 10 seconds, so ${emailConfirm.length} email${emailConfirm.length === 1 ? '' : 's'} will take about ${Math.ceil((emailConfirm.length * VENDOR_EMAIL_INTERVAL_MS) / 60000)} minute${Math.ceil((emailConfirm.length * VENDOR_EMAIL_INTERVAL_MS) / 60000) === 1 ? '' : 's'}. Keep this page open until sending finishes.`
              : ''
          }
          confirmLabel={`Email ${emailConfirm?.length || 0} login${emailConfirm?.length === 1 ? '' : 's'}`}
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
