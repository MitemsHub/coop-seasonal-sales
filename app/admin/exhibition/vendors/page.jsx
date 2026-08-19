'use client'

// app/admin/exhibition/vendors/page.jsx
// Vendor accounts for the exhibition — admin creates them (code + passcode),
// vendors sign into /vendor with those credentials. Suspend, edit and delete.
import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, RefreshCw, Search, Store, Trash2 } from 'lucide-react'
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
  const [form, setForm] = useState({})

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
    setForm({ status: 'active' })
    setModal('create')
  }

  const openEdit = (v) => {
    setForm({
      name: v.name || '',
      phone: v.phone || '',
      address: v.address || '',
      passcode: '',
      cycle_id: v.cycle_id,
      branch_id: v.branch_id,
    })
    setModal(v)
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
          phone: form.phone,
          address: form.address,
          status: form.status,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to create vendor')
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
      const payload = { name: form.name, phone: form.phone, address: form.address }
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

  const removeVendor = async (v) => {
    if (!window.confirm(`Delete vendor "${v.name}"? This cannot be undone.`)) return
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

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition Vendors</h1>
            <p className="mt-0.5 text-sm text-muted">Accounts are created here. Vendors sign in with their code and passcode.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={load} disabled={loading || busy}>
              Refresh
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

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="Search name, code or phone…"
              className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
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
                        <Button size="sm" variant="danger" leftIcon={Trash2} onClick={() => removeVendor(v)} disabled={busy}>
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

        <DraggableModal open={!!modal} onClose={() => setModal(null)} title={modal === 'create' ? 'New vendor account' : 'Edit vendor'}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exh-v-name">Vendor name</Label>
                <Input id="exh-v-name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Abuja Foods" />
              </div>
              <div>
                <Label htmlFor="exh-v-code">Code</Label>
                <Input id="exh-v-code" value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. VND-001" disabled={modal !== 'create'} />
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
                <Label htmlFor="exh-v-phone">Phone</Label>
                <Input id="exh-v-phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="exh-v-passcode">{modal === 'create' ? 'Passcode' : 'New passcode (blank = keep)'}</Label>
                <Input id="exh-v-passcode" value={form.passcode || ''} onChange={(e) => setForm({ ...form, passcode: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="exh-v-address">Address / stand location</Label>
              <Input id="exh-v-address" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button loading={busy} onClick={modal === 'create' ? saveCreate : saveEdit}>
                {modal === 'create' ? 'Create vendor' : 'Save changes'}
              </Button>
            </div>
          </div>
        </DraggableModal>
      </div>
    </ProtectedRoute>
  )
}
