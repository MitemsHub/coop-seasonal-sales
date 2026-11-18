'use client'

// app/admin/exhibition/vendors/page.jsx
// Vendor accounts for the exhibition — admin creates them (code + passcode are
// generated when left blank), vendors sign into /vendor with those credentials.
// Admins can edit the login details and email them to the vendor. Suspend,
// edit and delete live here too.
import { useCallback, useEffect, useState } from 'react'
import { Mail, Pencil, Plus, RefreshCw, Search, Store, Trash2, Upload } from 'lucide-react'
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
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import VendorImportModal from '../../../components/VendorImportModal'

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
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
      if (v?.ok) setVendors(v.vendors || [])
      else setMsg({ type: 'error', text: v?.error || 'Failed to load vendors' })
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

  const openCreate = () => {
    setForm({ status: 'active', email: '', code: '', passcode: '' })
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

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition Vendors</h1>
            <p className="mt-0.5 text-sm text-muted">Codes and passcodes auto-generate. Vendors sign in with their stand and passcode; you can email the details.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={load} disabled={loading || busy}>
              Refresh
            </Button>
            <Button size="sm" variant="secondary" leftIcon={Upload} onClick={() => setImportOpen(true)}>
              Import vendors
            </Button>
            <Button size="sm" leftIcon={Plus} onClick={openCreate}>
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
                  disabled={busy || !createdLogin.email}
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

        <Card className="p-0">
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
              <div className="hidden md:block">
                <Table>
                  <THead>
                <TR>
                  <TH>Vendor</TH>
                  <TH>Code</TH>
                  <TH>Branch</TH>
                  <TH>Cycle</TH>
                  <TH>Contact</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {vendors.map((v) => (
                  <TR key={v.id}>
                    <TD className="font-medium text-fg">{v.name}</TD>
                    <TD className="font-mono text-xs text-muted">{v.code}</TD>
                    <TD className="text-muted">{v.branch_name || `#${v.branch_id}`}</TD>
                    <TD className="text-muted">{v.cycle_name || `#${v.cycle_id}`}</TD>
                    <TD>
                      <div className="text-xs text-muted">{v.email || '—'}</div>
                      <div className="text-xs text-muted">{v.phone || '—'}</div>
                      <div className="text-xs text-muted">{v.address || ''}</div>
                    </TD>
                    <TD>
                      <Badge tone={v.status === 'active' ? 'success' : 'neutral'} variant="subtle">
                        {v.status}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-muted">{fmtDate(v.created_at)}</TD>
                    <TD>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" leftIcon={Pencil} onClick={() => openEdit(v)} disabled={busy}>
                          Edit
                        </Button>
                        <Button size="sm" variant={v.status === 'active' ? 'warning' : 'success'} onClick={() => toggleStatus(v)} disabled={busy}>
                          {v.status === 'active' ? 'Suspend' : 'Activate'}
                        </Button>
                        <Button size="sm" variant="danger" leftIcon={Trash2} onClick={() => { setConfirmTarget(v); setConfirmOpen(true) }} disabled={busy}>
                          Delete
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
                </Table>
              </div>

              {/* Phones get cards for the vendor details and actions. */}
              <div className="divide-y divide-line md:hidden">
                {vendors.map((v) => (
                  <div key={v.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-fg">{v.name}</div>
                        <div className="font-mono text-xs text-muted">{v.code}</div>
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
                      <Button size="sm" variant="ghost" leftIcon={Pencil} onClick={() => openEdit(v)} disabled={busy}>
                        Edit
                      </Button>
                      <Button size="sm" variant={v.status === 'active' ? 'warning' : 'success'} onClick={() => toggleStatus(v)} disabled={busy}>
                        {v.status === 'active' ? 'Suspend' : 'Activate'}
                      </Button>
                      <div className="col-span-2">
                        <Button className="w-full" size="sm" variant="danger" leftIcon={Trash2} onClick={() => { setConfirmTarget(v); setConfirmOpen(true) }} disabled={busy}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

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
                  placeholder={modal === 'create' ? 'Blank = auto-generate' : 'e.g. V-ABJ-03'}
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
