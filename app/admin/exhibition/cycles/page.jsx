'use client'

// app/admin/exhibition/cycles/page.jsx
// Exhibition cycle management — one season per branch. Create, activate,
// close and edit cycles; each branch runs its own exhibition with its own
// vendors.
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarPlus, Pencil, Play, RefreshCw, Trash2, X } from 'lucide-react'
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

const STATUS_STYLES = {
  active: 'success',
  draft: 'neutral',
  closed: 'neutral',
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

export function ExhibitionCyclesContent() {
  const [cycles, setCycles] = useState([])
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [modal, setModal] = useState(null) // 'create' | edit cycle object
  const [form, setForm] = useState({})
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const [c, b] = await Promise.all([
        fetch('/api/admin/exhibition/cycles', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/branches/list').then((r) => r.json()).catch(() => null),
      ])
      if (c?.ok) setCycles(c.cycles || [])
      else setMsg({ type: 'error', text: c?.error || 'Failed to load cycles' })
      if (b?.ok) setBranches(b.branches || [])
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setForm({ status: 'draft', vendor_deduction_rate_pct: 6, loan_interest_rate_pct: 13 })
    setModal('create')
  }

  const openEdit = (c) => {
    setForm({
      branch_id: c.branch_id || '',
      name: c.name || '',
      code: c.code || '',
      status: c.status || 'draft',
      starts_at: c.starts_at ? String(c.starts_at).slice(0, 10) : '',
      ends_at: c.ends_at ? String(c.ends_at).slice(0, 10) : '',
      vendor_deduction_rate_pct: c.vendor_deduction_rate_pct,
      loan_interest_rate_pct: c.loan_interest_rate_pct,
    })
    setModal(c)
  }

  const saveCreate = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/exhibition/cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: Number(form.branch_id),
          name: form.name,
          code: form.code,
          status: form.status,
          starts_at: form.starts_at ? `${form.starts_at}T00:00:00` : null,
          ends_at: form.ends_at ? `${form.ends_at}T23:59:59` : null,
          vendor_deduction_rate_pct: Number(form.vendor_deduction_rate_pct),
          loan_interest_rate_pct: Number(form.loan_interest_rate_pct),
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to create cycle')
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
      const res = await fetch('/api/admin/exhibition/cycles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: modal.id,
          branch_id: Number(form.branch_id),
          name: form.name,
          code: form.code,
          status: form.status,
          starts_at: form.starts_at ? `${form.starts_at}T00:00:00` : null,
          ends_at: form.ends_at ? `${form.ends_at}T23:59:59` : null,
          vendor_deduction_rate_pct: Number(form.vendor_deduction_rate_pct),
          loan_interest_rate_pct: Number(form.loan_interest_rate_pct),
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to update cycle')
      setModal(null)
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (c, status) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/exhibition/cycles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, status }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to update status')
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    const id = Number(deleteTarget?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (deleting) return
    setDeleting(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/exhibition/cycles?id=${encodeURIComponent(String(id))}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!json?.ok) throw new Error(json?.error || 'Failed to delete cycle')
      setDeleteTarget(null)
      setMsg({ type: 'success', text: `Deleted "${deleteTarget.name || 'cycle'}"` })
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition Cycles</h1>
            <p className="mt-0.5 text-sm text-muted">Each branch runs its own exhibition season with its own vendors.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={load} disabled={loading || busy}>
              Refresh
            </Button>
            <Button size="sm" leftIcon={CalendarPlus} onClick={openCreate}>
              New Cycle
            </Button>
          </div>
        </div>

        {msg && (
          <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'}`}>
            {msg.text}
          </div>
        )}

        <Card className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : cycles.length === 0 ? (
            <div className="rounded-xl bg-subtle px-4 py-10 text-center text-sm text-muted">
              No exhibition cycles yet. Create the first one to open a branch's exhibition.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Cycle</TH>
                  <TH>Branch</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Vendors</TH>
                  <TH className="text-right">Products</TH>
                  <TH className="text-right">Orders</TH>
                  <TH>Dates</TH>
                  <TH className="text-right">Rates</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {cycles.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <div className="font-medium text-fg">{c.name}</div>
                      <div className="text-xs text-muted">{c.code}</div>
                    </TD>
                    <TD className="text-muted">{c.branch_name || `#${c.branch_id}`}</TD>
                    <TD>
                      <Badge tone={STATUS_STYLES[c.status] || 'neutral'} variant="subtle">
                        {c.status}
                      </Badge>
                    </TD>
                    <TD className="text-right tabular-nums">{c.vendors}</TD>
                    <TD className="text-right tabular-nums">{c.products}</TD>
                    <TD className="text-right tabular-nums">{c.orders}</TD>
                    <TD className="text-muted">
                      <div>{fmtDate(c.starts_at)}</div>
                      <div className="text-xs">→ {fmtDate(c.ends_at)}</div>
                    </TD>
                    <TD className="text-right">
                      <div className="text-xs text-muted">loan {c.loan_interest_rate_pct}%</div>
                      <div className="text-xs text-muted">vend {c.vendor_deduction_rate_pct}%</div>
                    </TD>
                    <TD>
                      <div className="flex items-center gap-1">
                        {c.status !== 'active' ? (
                          <Button size="sm" variant="success" leftIcon={Play} onClick={() => setStatus(c, 'active')} disabled={busy}>
                            Open
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => setStatus(c, 'closed')} disabled={busy}>
                            Close
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" leftIcon={Pencil} onClick={() => openEdit(c)} disabled={busy}>
                          Edit
                        </Button>
                        <Button size="sm" variant="danger" leftIcon={Trash2} onClick={() => setDeleteTarget(c)} disabled={busy || c.status === 'active'} title={c.status === 'active' ? 'Close the cycle before deleting' : 'Delete cycle'}>
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

        <DraggableModal
          open={!!modal}
          onClose={() => setModal(null)}
          title={modal === 'create' ? 'New exhibition cycle' : 'Edit cycle'}
        >
          <div className="space-y-4">
            <div>
              <Label htmlFor="exh-cycle-branch">Branch (delivery location)</Label>
              <Select
                id="exh-cycle-branch"
                value={form.branch_id || ''}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                className="w-full"
              >
                <option value="">Select branch</option>
                {branches.map((b) => (
                  <option key={b.branch_id || b.id || b.code} value={b.branch_id || b.id || b.code}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted">This exhibition season serves one branch — members of that branch shop and pick up here.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exh-cycle-name">Cycle name</Label>
                <Input id="exh-cycle-name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Coop Exhibition 2026" />
              </div>
              <div>
                <Label htmlFor="exh-cycle-code">Code</Label>
                <Input id="exh-cycle-code" value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. EXH-2026" />
              </div>
            </div>
            <div>
              <Label htmlFor="exh-cycle-status">Status</Label>
              <Select id="exh-cycle-status" value={form.status || 'draft'} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full">
                <option value="draft">Draft (preparing)</option>
                <option value="active">Active (open now)</option>
                <option value="closed">Closed</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exh-cycle-start">Starts</Label>
                <Input id="exh-cycle-start" type="date" value={form.starts_at || ''} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="exh-cycle-end">Ends</Label>
                <Input id="exh-cycle-end" type="date" value={form.ends_at || ''} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exh-cycle-loan-rate">Loan interest (%)</Label>
                <Input id="exh-cycle-loan-rate" type="number" value={form.loan_interest_rate_pct ?? 13} onChange={(e) => setForm({ ...form, loan_interest_rate_pct: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="exh-cycle-vend-rate">Vendor deduction (%)</Label>
                <Input id="exh-cycle-vend-rate" type="number" value={form.vendor_deduction_rate_pct ?? 6} onChange={(e) => setForm({ ...form, vendor_deduction_rate_pct: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button loading={busy} onClick={modal === 'create' ? saveCreate : saveEdit}>
                {modal === 'create' ? 'Create cycle' : 'Save changes'}
              </Button>
            </div>
          </div>
        </DraggableModal>

        <DraggableModal
          open={!!deleteTarget}
          onClose={() => {
            if (deleting) return
            setDeleteTarget(null)
          }}
          title="Delete exhibition cycle?"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-danger-border bg-danger-bg/50 p-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-fg" strokeWidth={2} />
              <div className="text-sm text-fg">
                <p className="font-semibold text-danger-fg">{deleteTarget?.name || 'This cycle'}</p>
                <p className="mt-1 text-xs text-muted">
                  This permanently deletes the season and its vendors, products and categories.
                  Cycles that already have orders can&apos;t be deleted.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="danger" leftIcon={Trash2} loading={deleting} onClick={confirmDelete}>
                {deleting ? 'Deleting…' : 'Delete cycle'}
              </Button>
            </div>
          </div>
        </DraggableModal>
      </div>
  )
}

export default function ExhibitionCyclesPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <ExhibitionCyclesContent />
    </ProtectedRoute>
  )
}
