'use client'

// app/admin/exhibition/data/page.jsx
// Coop Exhibition operations "Data" page — the exhibition equivalent of the
// food data-management page. Contains:
//   • Cycles — create / activate / close / edit seasons (merged from the
//     standalone Cycles page, so operations live in one place).
//   • Exhibition Loan Limits (Selected Cycle) — annual-limit rules: category
//     amounts for Junior/Senior/Executive, two pensioner figures, and the
//     fixed retiree rule. Loan interest and vendor deduction rates live in the
//     cycle settings.
//
// Exhibition availability is determined solely by cycle status: opening a
// cycle (status='active') opens the exhibition for every branch; closing it closes it.
import { useCallback, useEffect, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Button from '../../../components/ui/Button'
import Card from '../../../components/ui/Card'
import Input from '../../../components/ui/Input'
import Label from '../../../components/ui/Label'
import Select from '../../../components/ui/Select'
import Skeleton from '../../../components/ui/Skeleton'
import { ExhibitionCyclesContent } from '../cycles/page'

const money = (value) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

/* ─── Exhibition Loan Limits (Selected Cycle) ──────────────────── */

function LoanLimitsSection() {
  const [cycles, setCycles] = useState([])
  const [loading, setLoading] = useState(true)
  const [cycleId, setCycleId] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [editing, setEditing] = useState(false)

  // Members by category — the grace amount that applies once five times
  // savings (less everything already taken) has no space left.
  const [junior, setJunior] = useState('700000')
  const [senior, setSenior] = useState('1500000')
  const [executive, setExecutive] = useState('3000000')

  // Pensioners are separate: they do not use the annual limit at all.
  const [pensionerEligible, setPensionerEligible] = useState('0')
  const [pensionerNonEligible, setPensionerNonEligible] = useState('0')

  const [includeInterest, setIncludeInterest] = useState(true)

  const applyCycle = (c) => {
    setJunior(String(Number(c?.exh_no_space_junior ?? 700000)))
    setSenior(String(Number(c?.exh_no_space_senior ?? 1500000)))
    setExecutive(String(Number(c?.exh_no_space_executive ?? 3000000)))
    setPensionerEligible(String(Number(c?.exh_loan_eligible_amount_cap_pensioner || 0)))
    setPensionerNonEligible(String(Number(c?.exh_loan_grace_amount_cap_pensioner || 0)))
    setIncludeInterest(c?.exh_loan_cap_include_interest !== false)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/exhibition/cycles', { cache: 'no-store' })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to load cycles')
      const list = json.cycles || []
      setCycles(list)
      setCycleId((cur) => {
        if (cur && list.some((c) => String(c.id) === String(cur))) return cur
        const active = list.find((c) => c.status === 'active') || list[0]
        if (active) applyCycle(active)
        return active ? String(active.id) : ''
      })
      const active = list.find((c) => c.status === 'active') || list[0]
      if (active) applyCycle(active)
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const pickCycle = (e) => {
    const next = e.target.value
    setCycleId(next)
    const c = cycles.find((x) => String(x.id) === String(next))
    if (c) applyCycle(c)
    setEditing(false)
    setMsg(null)
  }

  const save = async () => {
    if (!cycleId) return
    if (saving) return
    const nums = [junior, senior, executive, pensionerEligible, pensionerNonEligible].map((v) => {
      const n = Math.trunc(Number(v === '' ? 0 : v))
      return Number.isFinite(n) && n >= 0 ? n : null
    })
    if (nums.some((n) => n == null)) {
      setMsg({ type: 'error', text: 'All amounts must be non-negative numbers' })
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/exhibition/cycles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: Number(cycleId),
          exh_no_space_junior: nums[0],
          exh_no_space_senior: nums[1],
          exh_no_space_executive: nums[2],
          exh_loan_eligible_amount_cap_pensioner: nums[3],
          exh_loan_grace_amount_cap_pensioner: nums[4],
          exh_loan_cap_include_interest: includeInterest,
        }),
      })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to save limits')
      setMsg({ type: 'success', text: 'Loan limits saved' })
      setEditing(false)
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  const numInput = (value, onChange, disabled) => (
    <Input
      type="number"
      min="0"
      step="1"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  )
  const disabled = loading || saving || !cycleId || !editing

  return (
    <Card>
      <Card.Header>
        <Card.Title>Exhibition Loan Limits (Selected Cycle)</Card.Title>
        <Card.Description>
          How much a member may borrow this season. Active staff get five times their savings minus everything
          already taken (this cycle&apos;s food included), and never more than their global limit; once that is
          used up, the grace amount for their grade category applies. Pensioners use the same space with their own
          ceiling and grace; retirees are strictly savings minus loans, with no grace.
        </Card.Description>
      </Card.Header>
      <Card.Body>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : cycles.length === 0 ? (
          <p className="rounded-lg bg-subtle px-4 py-6 text-center text-sm text-muted">
            No exhibition cycles yet — create one above to set its loan limits.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="exh-loan-cycle">Cycle</Label>
              <Select id="exh-loan-cycle" value={cycleId} onChange={pickCycle} className="w-full sm:w-80">
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code}){c.status === 'active' ? ' · Active' : ''}</option>
                ))}
              </Select>
            </div>

            {/* Members by category — grace for active staff */}
            <div className="rounded-xl border border-line-subtle p-3 bg-subtle/40">
              <div className="mb-1 flex flex-wrap items-baseline gap-2">
                <div className="text-sm font-medium text-fg">Junior · Senior · Executive</div>
                <div className="text-xs text-muted">Grace amount, used when savings space is gone</div>
              </div>
              <p className="mb-3 text-xs text-muted">
                A member&apos;s limit is five times savings minus outstanding loans and this cycle&apos;s food and
                exhibition orders, never above their global limit (Global limits page). Once that space is used up,
                the grace amount for their grade category applies instead.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <div className="mb-1 text-xs text-muted">Junior</div>
                  {numInput(junior, setJunior, disabled)}
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted">Senior</div>
                  {numInput(senior, setSenior, disabled)}
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted">Executive</div>
                  {numInput(executive, setExecutive, disabled)}
                </div>
              </div>
            </div>

            {/* Pensioner */}
            <div className="rounded-xl border border-line-subtle p-3 bg-subtle/40">
              <div className="mb-1 flex flex-wrap items-baseline gap-2">
                <div className="text-sm font-medium text-fg">Pensioner</div>
                <div className="text-xs text-muted">Own ceiling and grace amount</div>
              </div>
              <p className="mb-3 text-xs text-muted">
                A pensioner&apos;s limit is five times savings minus everything taken, with the eligible amount as
                the ceiling. With no space left they get the non-eligible (grace) amount instead.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs text-muted">Eligible amount</div>
                  {numInput(pensionerEligible, setPensionerEligible, disabled)}
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted">Non-eligible amount</div>
                  {numInput(pensionerNonEligible, setPensionerNonEligible, disabled)}
                </div>
              </div>
            </div>

            {/* Retiree */}
            <div className="rounded-xl border border-line-subtle p-3 bg-subtle/40">
              <div className="text-sm font-medium text-fg">Retiree</div>
              <p className="mt-1 text-xs text-muted">
                Fixed rule, nothing to set: savings minus all loans, no grace. A retiree with no savings left after
                their loans cannot take the Loan option.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-line-subtle p-3 bg-subtle/40 sm:max-w-md">
              <div>
                <div className="text-sm font-medium text-fg">Include Interest In Limit</div>
                <div className="text-xs text-muted">
                  When ON, interest is counted inside the available amount. When OFF, it applies to principal only.
                </div>
              </div>
              <label
                className={`flex items-center gap-2 cursor-pointer select-none ${!editing ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={() => setIncludeInterest((v) => !v)}
              >
                <div className={`w-12 h-6 rounded-full px-1 flex items-center transition-colors duration-200 ${includeInterest ? 'bg-success-fg justify-end' : 'bg-muted justify-start'}`}>
                  <div className="w-4 h-4 bg-surface rounded-full shadow" />
                </div>
                <span className={`text-sm font-medium ${includeInterest ? 'text-success-fg' : 'text-muted'}`}>
                  {includeInterest ? 'On' : 'Off'}
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                loading={saving}
                disabled={saving || loading || !cycleId}
                onClick={async () => {
                  if (!editing) {
                    setEditing(true)
                    return
                  }
                  await save()
                }}
              >
                {saving ? 'Saving…' : editing ? 'Save' : 'Edit'}
              </Button>
              <Button variant="secondary" onClick={load} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </Button>
              {msg && (
                <span className={`text-sm ${msg.type === 'error' ? 'text-danger-fg' : 'text-success-fg'}`}>{msg.text}</span>
              )}
            </div>
          </div>
        )}
      </Card.Body>
    </Card>
  )
}

/* ─── Reprice orders ───────────────────────────────────────────── */

// A season's loan rate (and a product's price) is read at the moment an order
// is created, so changing them afterwards leaves every existing order on the
// old numbers. This is the exhibition twin of the Food Price Repricer: it
// recalculates the still-open orders of the chosen season.
function RepriceOrdersSection() {
  const [cycles, setCycles] = useState([])
  const [cycleId, setCycleId] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [impact, setImpact] = useState(null)
  const [impactBusy, setImpactBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/exhibition/cycles', { cache: 'no-store' })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to load seasons')
      const list = json.cycles || []
      setCycles(list)
      setCycleId((cur) => {
        if (cur && list.some((c) => String(c.id) === String(cur))) return cur
        const active = list.find((c) => c.status === 'active') || list[0]
        return active ? String(active.id) : ''
      })
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const selected = cycles.find((c) => String(c.id) === String(cycleId))
  const ready = !!selected && confirmText.trim().toUpperCase() === 'REPRICE ORDERS'

  // A reprice raises what a member owes, which can push them past their loan
  // room. This preview computes the new totals without saving anything, so the
  // admin can see who would go over before committing.
  const checkImpact = useCallback(
    async (seasonId) => {
      const id = String(seasonId || cycleId || '')
      if (!id || impactBusy) return
      setImpactBusy(true)
      try {
        const res = await fetch(
          `/api/admin/exhibition/orders/reprice-impact?cycle_id=${encodeURIComponent(id)}`,
          { cache: 'no-store' }
        )
        const json = await res.json()
        if (!json?.ok) throw new Error(json?.error || 'Failed to check the loan room')
        setImpact(json)
      } catch (e) {
        setImpact({ error: e.message })
      } finally {
        setImpactBusy(false)
      }
    },
    [cycleId, impactBusy]
  )

  const reprice = async () => {
    if (!ready || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/exhibition/orders/reprice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycle_id: Number(cycleId) }),
      })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to reprice orders')
      setConfirmText('')
      checkImpact(cycleId)
      setMsg({
        type: 'success',
        text:
          json.updated_orders === 0
            ? `Nothing to change — all ${json.scanned_orders} open order(s) already match the current prices and the ${json.loan_interest_rate_pct}% loan rate.`
            : `Repriced ${json.updated_orders} of ${json.scanned_orders} open order(s) at the ${json.loan_interest_rate_pct}% loan rate — ${json.updated_lines} line(s) and ${json.updated_payables} unpaid vendor payable(s) updated.`,
      })
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Reprice Exhibition Orders</Card.Title>
        <Card.Description>
          A season&apos;s loan rate and a product&apos;s price are read when an order is created, so changing them
          leaves orders already placed on the old numbers. Reprice recalculates every Pending and Approved order in
          the season — each line at the product&apos;s current price and approved discount, and loan interest at the
          season&apos;s current rate. Confirmed, Delivered and Cancelled orders are never changed, and counter
          invoices keep the price the vendor typed.
        </Card.Description>
      </Card.Header>
      <Card.Body>
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : cycles.length === 0 ? (
          <p className="rounded-lg bg-subtle px-4 py-6 text-center text-sm text-muted">
            No exhibition seasons yet — create one above.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="flex-1">
                <Label htmlFor="reprice-cycle">Season</Label>
                <Select
                  id="reprice-cycle"
                  value={cycleId}
                  onChange={(e) => {
                    setCycleId(e.target.value)
                    setImpact(null)
                  }}
                  className="w-full"
                >
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code}){c.status === 'active' ? ' · Active' : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex-1">
                <Label htmlFor="reprice-confirm">Type REPRICE ORDERS to confirm</Label>
                <Input
                  id="reprice-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="REPRICE ORDERS"
                  autoComplete="off"
                />
              </div>
              <Button loading={busy} disabled={!ready || busy} onClick={reprice}>
                {busy ? 'Repricing…' : 'Reprice orders'}
              </Button>
              <Button
                variant="secondary"
                loading={impactBusy}
                disabled={!cycleId || impactBusy}
                onClick={() => checkImpact(cycleId)}
              >
                {impactBusy ? 'Checking…' : 'Check loan room'}
              </Button>
            </div>
            {selected && (
              <p className="text-xs text-muted">
                Loan interest: <span className="font-semibold text-fg">{Number(selected.loan_interest_rate_pct || 0)}%</span>
                {' · '}Vendor deduction: <span className="font-semibold text-fg">{Number(selected.vendor_deduction_rate_pct || 0)}%</span>
                {' · '}Cash and Savings orders are repriced without interest.
              </p>
            )}
            {impact?.error && (
              <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-danger-fg">{impact.error}</p>
            )}
            {impact && !impact.error && (
              <div
                className={`rounded-xl border p-3 ${
                  impact.over_members > 0 ? 'border-danger-border bg-danger-bg' : 'border-success-border bg-success-bg'
                }`}
              >
                <p
                  className={`text-sm font-medium ${
                    impact.over_members > 0 ? 'text-danger-fg' : 'text-success-fg'
                  }`}
                >
                  {impact.over_members === 0
                    ? `No one goes over: ${impact.members_checked} member(s) still fit at ${impact.loan_interest_rate_pct}%`
                    : `${impact.over_members} member(s) would go over their loan room by ${money(
                        impact.members.reduce((sum, m) => sum + Number(m.over_by || 0), 0)
                      )}`}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Preview only — nothing is saved. {impact.scanned_orders} open order(s) checked,{' '}
                  {impact.total_delta === 0 ? 'no change in totals' : `${money(impact.total_delta)} more owed in total`}.
                </p>
                {impact.over_members > 0 && (
                  <div className="mt-3 space-y-2">
                    {impact.members
                      .filter((m) => m.over_by > 0)
                      .map((m) => (
                        <div key={m.member_id} className="rounded-lg bg-surface/80 p-2.5 text-xs">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-medium text-fg">
                              {m.member_id}
                              {m.name ? ` · ${m.name}` : ''}
                              {m.category ? <span className="ml-1 text-muted">({m.category})</span> : null}
                            </span>
                            <span className="tabular-nums text-danger-fg">
                              room {m.room_now == null ? '—' : money(m.room_now)} → over by {money(m.over_by)}
                            </span>
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {m.orders
                              .filter((o) => o.delta > 0)
                              .map((o) => (
                                <div key={o.id} className="flex justify-between gap-3 text-muted">
                                  <span className="truncate">
                                    {o.order_id || `#${o.id}`} · {o.payment_option || '—'}
                                  </span>
                                  <span className="shrink-0 tabular-nums">
                                    {money(o.old_total)} → {money(o.new_total)}
                                  </span>
                                </div>
                              ))}
                          </div>
                          {m.room_warning ? <p className="mt-1 text-muted">{m.room_warning}</p> : null}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
            {msg && (
              <p className={`text-sm ${msg.type === 'error' ? 'text-danger-fg' : 'text-success-fg'}`}>{msg.text}</p>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  )
}

/* ─── Page ─────────────────────────────────────────────────────── */

function ExhibitionDataContent() {
  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition Operations · Data</h1>            <p className="text-sm text-muted">
              Seasons and loan settings for the Coop Exhibition.
            </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Cycles — merged from the standalone Cycles page */}
        <div className="rounded-2xl border border-line bg-surface">
          <ExhibitionCyclesContent />
        </div>

        {/* Rates only reach new orders — this recalculates the open ones. */}
        <RepriceOrdersSection />

        {/* Loan limits for the selected cycle */}
        <LoanLimitsSection />
      </div>
    </div>
  )
}

export default function ExhibitionDataPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <ExhibitionDataContent />
    </ProtectedRoute>
  )
}
