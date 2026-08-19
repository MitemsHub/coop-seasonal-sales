'use client'

// app/admin/exhibition/payouts/page.jsx
// Vendor payouts for an exhibition cycle. The co-op collects member payments
// (savings / cash / loan) and pays vendors later — gross line totals minus the
// cycle's vendor deduction rate. Mark a vendor paid once the money goes out.
import { useCallback, useEffect, useState } from 'react'
import { BadgeCheck, Banknote, CheckCircle2, RefreshCw, Store, Undo2 } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Button from '../../../components/ui/Button'
import Card from '../../../components/ui/Card'
import { Table, THead, TBody, TR, TH, TD } from '../../../components/ui/Table'
import Select from '../../../components/ui/Select'
import Skeleton from '../../../components/ui/Skeleton'

const naira = (v) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(
    Number(v || 0)
  )

export default function ExhibitionPayoutsPage() {
  const [cycles, setCycles] = useState([])
  const [cycleId, setCycleId] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const loadCycles = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/exhibition/cycles', { cache: 'no-store' })
      const json = await res.json()
      if (json?.ok) {
        const list = json.cycles || []
        setCycles(list)
        // Prefer the active cycle; fall back to the first.
        const preferred = list.find((c) => c.status === 'active') || list[0]
        if (preferred && !cycleId) setCycleId(String(preferred.id))
      }
    } catch {
      setCycles([])
    }
  }, [cycleId])

  const loadPayouts = useCallback(async () => {
    if (!cycleId) return
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/exhibition/payouts?cycle_id=${cycleId}`, { cache: 'no-store' })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to load payouts')
      setData(json)
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [cycleId])

  useEffect(() => {
    loadCycles()
  }, [loadCycles])

  useEffect(() => {
    if (cycleId) loadPayouts()
  }, [cycleId, loadPayouts])

  const togglePaid = async (v) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/exhibition/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor_id: v.id, cycle_id: Number(cycleId), paid: !v.paid, amount: v.paid ? v.paid_amount : v.net }),
      })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to update payment')
      await loadPayouts()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const vendors = data?.vendors || []
  const totals = data?.totals || {}
  const cycle = data?.cycle || {}

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">Vendor Payouts</h1>
            <p className="mt-0.5 text-sm text-muted">
              What the co-op owes each vendor for this cycle. Gross sales minus the deduction rate.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={cycleId} onChange={(e) => setCycleId(e.target.value)} className="sm:w-64">
              <option value="">Select cycle</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </Select>
            <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={loadPayouts} disabled={loading || busy || !cycleId}>
              Refresh
            </Button>
          </div>
        </div>

        {msg && (
          <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${msg.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 'border-success-border bg-success-bg text-success-fg'}`}>
            {msg.text}
          </div>
        )}

        {!cycleId ? (
          <Card className="p-10 text-center text-sm text-muted">
            <Store className="mx-auto mb-2 h-8 w-8 text-muted" strokeWidth={1.5} />
            Select a cycle to see vendor payouts.
          </Card>
        ) : (
          <>
            {/* Summary */}
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="ui-card p-4">
                <div className="text-xs font-medium text-subtext">Gross owed</div>
                <div className="mt-1 text-xl font-bold tabular-nums text-fg">{naira(totals.gross)}</div>
                <div className="text-xs text-muted">Sum of non-cancelled line amounts</div>
              </div>
              <div className="ui-card p-4">
                <div className="text-xs font-medium text-subtext">Deduction ({cycle.deduction_rate_pct}%)</div>
                <div className="mt-1 text-xl font-bold tabular-nums text-fg">{naira(totals.deduction)}</div>
                <div className="text-xs text-muted">Held by the co-op</div>
              </div>
              <div className="ui-card p-4">
                <div className="text-xs font-medium text-subtext">Net to vendors</div>
                <div className="mt-1 text-xl font-bold tabular-nums text-fg">{naira(totals.net)}</div>
                <div className="text-xs text-muted">{vendors.length} vendor{vendors.length === 1 ? '' : 's'}</div>
              </div>
              <div className="ui-card p-4">
                <div className="text-xs font-medium text-subtext">Paid / balance</div>
                <div className="mt-1 text-xl font-bold tabular-nums text-fg">
                  <span className="text-success-fg">{naira(totals.paid)}</span>
                  <span className="text-muted"> / </span>
                  {naira(totals.balance)}
                </div>
                <div className="text-xs text-muted">Outstanding payout balance</div>
              </div>
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
                  No vendors in this cycle, or no orders yet.
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Vendor</TH>
                      <TH className="text-right">Gross</TH>
                      <TH className="text-right">Deduction</TH>
                      <TH className="text-right">Net</TH>
                      <TH className="text-right">Paid</TH>
                      <TH>Status</TH>
                      <TH>Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {vendors.map((v) => (
                      <TR key={v.id}>
                        <TD>
                          <div className="font-medium text-fg">{v.name}</div>
                          <div className="font-mono text-xs text-muted">{v.code}</div>
                          <div className="text-xs text-muted">{v.address || v.phone || ''}</div>
                        </TD>
                        <TD className="text-right tabular-nums">{naira(v.gross)}</TD>
                        <TD className="text-right tabular-nums text-muted">−{naira(v.deduction)}</TD>
                        <TD className="text-right font-medium tabular-nums text-fg">{naira(v.net)}</TD>
                        <TD className="text-right tabular-nums text-muted">{v.paid ? naira(v.paid_amount) : '—'}</TD>
                        <TD>
                          {v.paid ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-1 text-xs font-medium text-success-fg">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Paid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2.5 py-1 text-xs font-medium text-warning-fg">
                              <Banknote className="h-3.5 w-3.5" /> Owed {naira(v.balance)}
                            </span>
                          )}
                        </TD>
                        <TD>
                          <Button
                            size="sm"
                            variant={v.paid ? 'secondary' : 'success'}
                            leftIcon={v.paid ? Undo2 : BadgeCheck}
                            onClick={() => togglePaid(v)}
                            disabled={busy || v.net <= 0}
                          >
                            {v.paid ? 'Mark unpaid' : 'Mark paid'}
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          </>
        )}
      </div>
    </ProtectedRoute>
  )
}
