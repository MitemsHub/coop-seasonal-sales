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
