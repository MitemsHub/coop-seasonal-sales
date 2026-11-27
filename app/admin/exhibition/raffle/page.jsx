'use client'

// app/admin/exhibition/raffle/page.jsx
// Raffle desk for the exhibition. Set the amount that qualifies, see which
// members earned a ticket, then spin the wheel to draw the winner.
//
// The draw is decided in code, not by where the pointer looks: a random
// index is picked first and the wheel is spun to land on it. When more
// members qualify than the wheel has slices, a random set of finalists is
// drawn first — each member's chance of being on the wheel times their chance
// of winning it still comes out equal, so nobody is favoured.
import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Ticket, Trophy } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import Card from '../../../components/ui/Card'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import Skeleton from '../../../components/ui/Skeleton'
import { Table, THead, TBody, TR, TH, TD } from '../../../components/ui/Table'

const naira = (v) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(Number(v || 0))

const stamp = (iso) => {
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

const SLICE_COLORS = ['#0d9488', '#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444', '#22c55e', '#0ea5e9', '#db2777']
const MAX_SLICES = 36
const SPIN_MS = 4800

function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function lastName(member) {
  const name = String(member?.member_name || '').trim()
  if (!name) return member?.member_id || '—'
  const parts = name.split(/\s+/)
  return parts.length > 2 ? parts.slice(-2).join(' ') : name
}

function SpinWheel({ pool, rotation, spinning }) {
  const n = pool.length
  const seg = n ? 360 / n : 360
  const fontSize = Math.max(7, Math.min(12, 200 / Math.max(n, 1)))

  const arc = (i) => {
    const a0 = ((i * seg - 90) * Math.PI) / 180
    const a1 = (((i + 1) * seg - 90) * Math.PI) / 180
    const large = seg > 180 ? 1 : 0
    const x0 = 160 + 150 * Math.cos(a0)
    const y0 = 160 + 150 * Math.sin(a0)
    const x1 = 160 + 150 * Math.cos(a1)
    const y1 = 160 + 150 * Math.sin(a1)
    return `M160,160 L${x0},${y0} A150,150 0 ${large} 1 ${x1},${y1} Z`
  }

  return (
    <div className="relative mx-auto w-full max-w-[360px]">
      <svg viewBox="0 0 320 320" className="h-auto w-full" role="img" aria-label="Raffle wheel">
        <g
          style={{
            transform: `rotate(${rotation}deg)`,
            transformOrigin: '160px 160px',
            transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.15, 0.65, 0.14, 1)` : 'none',
          }}
        >
          {n === 0 ? (
            <circle cx="160" cy="160" r="150" fill="#e5e7eb" />
          ) : n === 1 ? (
            <>
              <circle cx="160" cy="160" r="150" fill={SLICE_COLORS[0]} />
              <g transform="rotate(0 160 160)">
                <text
                  x="242"
                  y={164}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize={fontSize}
                  fontWeight="600"
                >
                  {lastName(pool[0]).slice(0, 16)}
                </text>
              </g>
            </>
          ) : (
            pool.map((entry, i) => (
              <g key={`${entry.member_id}-${i}`}>
                <path d={arc(i)} fill={SLICE_COLORS[i % SLICE_COLORS.length]} stroke="#fff" strokeWidth="0.6" />
                <g transform={`rotate(${(i + 0.5) * seg} 160 160)`}>
                  <text
                    x={244}
                    y={164}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize={fontSize}
                    fontWeight="600"
                  >
                    {lastName(entry).slice(0, n > 24 ? 10 : 16)}
                  </text>
                </g>
              </g>
            ))
          )}
          <circle cx="160" cy="160" r="24" fill="#fff" stroke="#d1d5db" strokeWidth="2" />
        </g>
        <polygon points="160,2 148,24 172,24" fill="#ef4444" />
      </svg>
    </div>
  )
}

export default function ExhibitionRafflePage() {
  const [cycles, setCycles] = useState([])
  const [cycleId, setCycleId] = useState('')
  const [minAmount, setMinAmount] = useState('1000000')
  const [entries, setEntries] = useState([])
  const [totals, setTotals] = useState({ members: 0, orders: 0, amount: 0, shopping_members: 0 })
  const [cycle, setCycle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)

  const [pool, setPool] = useState([])
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [winner, setWinner] = useState(null)
  // Audit trail: every completed spin is stored server-side, and the page
  // reloads this season's past draws alongside the entries.
  const [draws, setDraws] = useState([])
  const [drawNote, setDrawNote] = useState('')
  const timer = useRef(null)

  const load = useCallback(async (opts = {}) => {
    const nextCycle = opts.cycleId ?? cycleId
    const nextMin = opts.minAmount ?? minAmount
    setLoading(true)
    setMsg(null)
    try {
      const qs = new URLSearchParams()
      if (nextCycle) qs.set('cycle_id', String(nextCycle))
      if (String(nextMin).trim() !== '') qs.set('min_amount', String(nextMin))
      const res = await fetch(`/api/admin/exhibition/raffle?${qs}`, { cache: 'no-store' })
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) throw new Error(`Unexpected response (${res.status})`)
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load raffle entries')

      setCycles(json.cycles || [])
      setCycle(json.cycle || null)
      if (!nextCycle && json.cycle?.id) setCycleId(String(json.cycle.id))
      setEntries(json.entries || [])
      setTotals(json.totals || { members: 0, orders: 0, amount: 0, shopping_members: 0 })
      setPool(shuffle(json.entries || []).slice(0, MAX_SLICES))
      setWinner(null)

      // Past draws are scoped to the season the entries came from.
      const drawQs = new URLSearchParams({ limit: '25' })
      if (json.cycle?.id) drawQs.set('cycle_id', String(json.cycle.id))
      const drawRes = await fetch(`/api/admin/exhibition/raffle/draws?${drawQs}`, { cache: 'no-store' })
      const drawJson = await drawRes.json().catch(() => null)
      if (drawJson?.ok) {
        setDraws(drawJson.draws || [])
        setDrawNote(
          drawJson.migration_required
            ? `Draws are not being saved yet — run ${drawJson.migration_file || 'the raffle-draws migration'}, then reload.`
            : ''
        )
      }
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to load raffle entries' })
    } finally {
      setLoading(false)
    }
  }, [cycleId, minAmount])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const redrawFinalists = () => {
    if (spinning) return
    setWinner(null)
    setPool(shuffle(entries).slice(0, MAX_SLICES))
  }

  const recordDraw = useCallback(
    async (winnerEntry) => {
      if (!cycle?.id || !winnerEntry) return
      try {
        const res = await fetch('/api/admin/exhibition/raffle/draws', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cycle_id: cycle.id,
            min_amount: Number(minAmount) || 0,
            finalists: pool,
            winner_member_id: winnerEntry.member_id,
          }),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) {
          setDrawNote(json?.error || 'This draw was not recorded.')
          return
        }
        setDrawNote('')
        setDraws((prev) => [json.draw, ...prev])
      } catch (e) {
        setDrawNote(`This draw was not recorded: ${e?.message || 'network error'}`)
      }
    },
    [cycle?.id, minAmount, pool]
  )

  const spin = () => {
    if (spinning || !pool.length) return
    const index = Math.floor(Math.random() * pool.length)
    const seg = 360 / pool.length
    const target = (360 - (index + 0.5) * seg) % 360
    const current = ((rotation % 360) + 360) % 360
    const delta = (target - current + 360) % 360
    setSpinning(true)
    setWinner(null)
    setRotation(rotation + 360 * 6 + delta)
    timer.current = setTimeout(() => {
      setSpinning(false)
      setWinner(pool[index])
      // Record only once the wheel has settled, so the audit row can never
      // claim a winner the desk did not see.
      recordDraw(pool[index])
    }, SPIN_MS + 150)
  }

  const qualifyingLabel = cycle?.name || cycle?.code || 'this season'

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-5">
          <h1 className="text-h2 font-bold tracking-tight text-fg">Raffle Ticket</h1>
          <p className="mt-0.5 text-sm text-muted">
            Members who shopped at or above the qualifying amount in {qualifyingLabel} earn a
            ticket. Spin the wheel to draw the winner.
          </p>
        </div>

        {msg && (
          <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">
            {msg.text}
          </div>
        )}

        {/* Controls */}
        <Card className="mb-5 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-medium text-subtext" htmlFor="raffle-cycle">
                Season
              </label>
              <Select
                id="raffle-cycle"
                value={cycleId}
                onChange={(e) => {
                  const next = e.target.value
                  setCycleId(next)
                  load({ cycleId: next })
                }}
                className="w-full"
              >
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.code || `Season #${c.id}`}
                    {c.status === 'active' ? ' (Active)' : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-subtext" htmlFor="raffle-min">
                Qualifying amount
              </label>
              <Input
                id="raffle-min"
                type="number"
                min="0"
                step="50000"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') load()
                }}
                className="sm:w-48"
              />
            </div>
            <Button leftIcon={RefreshCw} onClick={() => load()} loading={loading}>
              Load entries
            </Button>
          </div>
          <p className="text-xs text-muted">
            Qualifying spend is the member's total exhibition orders for the season. Cancelled
            orders do not count.
          </p>
        </Card>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Headline numbers */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-surface px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  Qualifying members
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums text-fg">{totals.members}</div>
                <div className="mt-0.5 text-xs text-muted">
                  of {totals.shopping_members || 0} who shopped this season
                </div>
              </div>
              <div className="rounded-xl border border-line bg-surface px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  Tickets in the hat
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums text-fg">{totals.members}</div>
                <div className="mt-0.5 text-xs text-muted">One ticket per qualifying member</div>
              </div>
              <div className="rounded-xl border border-line bg-surface px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  Qualifying spend
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums text-fg">{naira(totals.amount)}</div>
                <div className="mt-0.5 text-xs text-muted">{totals.orders} orders</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              {/* Wheel */}
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-fg">The wheel</h2>
                  <Badge tone="neutral">
                    {pool.length} of {entries.length} on the wheel
                  </Badge>
                </div>

                {entries.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted">
                    No member reached {naira(minAmount)} in {qualifyingLabel} yet. Lower the
                    qualifying amount or pick another season.
                  </p>
                ) : (
                  <>
                    <SpinWheel pool={pool} rotation={rotation} spinning={spinning} />
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button onClick={spin} loading={spinning} leftIcon={Ticket}>
                        {spinning ? 'Spinning…' : 'Spin the wheel'}
                      </Button>
                      <Button variant="secondary" onClick={redrawFinalists} disabled={spinning}>
                        Redraw finalists
                      </Button>
                    </div>
                    {entries.length > MAX_SLICES && (
                      <p className="text-center text-xs text-muted">
                        More entries than slices: the wheel shows {MAX_SLICES} randomly drawn
                        finalists. Every entry has the same chance overall.
                      </p>
                    )}
                  </>
                )}

                {winner && (
                  <div className="rounded-xl border border-success-border bg-success-bg px-4 py-4 text-center">
                    <div className="mx-auto mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-success-fg text-white">
                      <Trophy className="h-5 w-5" strokeWidth={2} />
                    </div>
                    <div className="text-xs font-medium uppercase tracking-wide text-success-fg">
                      Winner
                    </div>
                    <div className="mt-0.5 text-lg font-bold text-success-fg">
                      {winner.member_name || winner.member_id}
                    </div>
                    <div className="mt-0.5 text-sm text-success-fg">
                      {winner.member_id}
                      {winner.phone ? ` · ${winner.phone}` : ''}
                    </div>
                    <div className="mt-0.5 text-xs text-success-fg">
                      Shopped {naira(winner.amount)} in {winner.orders} order
                      {winner.orders === 1 ? '' : 's'}
                    </div>
                  </div>
                )}
              </Card>

              {/* Entries */}
              <Card className="p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-fg">Ticket holders</h2>
                  <span className="text-xs text-muted">Highest spend first</span>
                </div>
                {entries.length === 0 ? (
                  <p className="text-sm text-muted">No qualifying members.</p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH className="pl-0">#</TH>
                        <TH>Member</TH>
                        <TH className="text-right">Orders</TH>
                        <TH className="text-right">Spend</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {entries.map((e, i) => (
                        <TR key={e.member_id}>
                          <TD className="pl-0 text-xs text-muted">{i + 1}</TD>
                          <TD>
                            <div className="font-medium text-fg">{e.member_name || '—'}</div>
                            <div className="text-xs text-muted">
                              {e.member_id}
                              {e.phone ? ` · ${e.phone}` : ''}
                            </div>
                          </TD>
                          <TD className="text-right tabular-nums text-muted">{e.orders}</TD>
                          <TD className="text-right font-medium tabular-nums text-fg">
                            {naira(e.amount)}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </Card>
            </div>

            {/* Past draws — the audit trail */}
            <Card className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-fg">Past draws</h2>
                <span className="text-xs text-muted">
                  {draws.length} recorded{cycle ? ` · ${qualifyingLabel}` : ''}
                </span>
              </div>

              {drawNote && (
                <div className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-fg">
                  {drawNote}
                </div>
              )}

              {draws.length === 0 ? (
                <p className="text-sm text-muted">No draws recorded for this season yet.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="pl-0">Drawn</TH>
                      <TH>Season</TH>
                      <TH className="text-right">Qualifying</TH>
                      <TH>Wheel</TH>
                      <TH>Winner</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {draws.map((d) => (
                      <TR key={d.id}>
                        <TD className="whitespace-nowrap pl-0 text-xs text-muted">{stamp(d.drawn_at)}</TD>
                        <TD className="text-xs text-muted">{d.cycle_name || `#${d.cycle_id}`}</TD>
                        <TD className="text-right text-xs tabular-nums text-muted">
                          {naira(d.min_amount)}
                        </TD>
                        <TD>
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-brand">
                              {d.finalist_count} finalist{Number(d.finalist_count) === 1 ? '' : 's'}
                            </summary>
                            <ul className="mt-1 space-y-0.5 text-xs text-muted">
                              {(d.finalists || []).map((f) => (
                                <li key={f.member_id}>
                                  {f.member_name || f.member_id}
                                  <span className="text-subtext">
                                    {' '}
                                    · {f.member_id} · {naira(f.amount)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        </TD>
                        <TD>
                          <div className="font-medium text-fg">{d.winner_name || d.winner_member_id}</div>
                          <div className="text-xs text-muted">
                            {d.winner_member_id} · {naira(d.winner_amount)}
                            {d.drawn_by ? ` · by ${d.drawn_by}` : ''}
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}
