'use client'

// app/admin/exhibition/markups/page.jsx
// Exhibition markups — like a real market, the person who beats a price gets
// their own negotiated price. Admin sets/removes per-member prices on any
// product, and can also tweak the general admin markup.
import { useCallback, useEffect, useState } from 'react'
import { Percent, Plus, RefreshCw, Search, Trash2, UserRound } from 'lucide-react'
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

const naira = (v) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(
    Number(v || 0)
  )

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

export default function ExhibitionMarkupsPage() {
  const [products, setProducts] = useState([])
  const [cycles, setCycles] = useState([])
  const [cycleFilter, setCycleFilter] = useState('')
  const [term, setTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [detail, setDetail] = useState(null) // product object (prices modal)
  const [prices, setPrices] = useState([])
  const [pricesLoading, setPricesLoading] = useState(false)
  const [priceForm, setPriceForm] = useState({ member_id: '', price: '', note: '' })
  const [markupForm, setMarkupForm] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const params = new URLSearchParams()
      if (cycleFilter) params.set('cycle_id', cycleFilter)
      if (term.trim()) params.set('q', term.trim())
      const [m, c] = await Promise.all([
        fetch(`/api/admin/exhibition/markups?${params}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/admin/exhibition/cycles', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ])
      if (m?.ok) setProducts(m.products || [])
      else setMsg({ type: 'error', text: m?.error || 'Failed to load markups' })
      if (c?.ok) setCycles(c.cycles || [])
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

  const openDetail = async (p) => {
    setDetail(p)
    setPricesLoading(true)
    setPriceForm({ member_id: '', price: '', note: '' })
    setMarkupForm({ admin_markup: p.admin_markup ?? 0 })
    try {
      const res = await fetch(`/api/admin/exhibition/markups?product_id=${p.id}`, { cache: 'no-store' })
      const json = await res.json()
      if (json?.ok) setPrices(json.prices || [])
      else setMsg({ type: 'error', text: json?.error || 'Failed to load prices' })
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setPricesLoading(false)
    }
  }

  const saveMemberPrice = async () => {
    const memberId = String(priceForm.member_id || '').trim().toUpperCase()
    const price = Math.trunc(Number(priceForm.price))
    if (!memberId) return setMsg({ type: 'error', text: 'Member ID is required' })
    if (!Number.isFinite(price) || price <= 0) return setMsg({ type: 'error', text: 'Price must be greater than zero' })
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/exhibition/markups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: detail.id, member_id: memberId, price, note: priceForm.note || '' }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to save price')
      setPriceForm({ member_id: '', price: '', note: '' })
      await openDetail(detail)
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const removeMemberPrice = async (row) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/exhibition/markups', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: detail.id, member_id: row.member_id }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to remove price')
      await openDetail(detail)
      await load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const saveAdminMarkup = async () => {
    const markup = Math.trunc(Number(markupForm.admin_markup ?? 0))
    if (!Number.isFinite(markup)) return setMsg({ type: 'error', text: 'Invalid markup' })
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/exhibition/products/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_markup: markup }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to update markup')
      await openDetail(detail)
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
            <h1 className="text-h2 font-bold tracking-tight text-fg">Exhibition Markups</h1>
            <p className="mt-0.5 text-sm text-muted">
              Per-member negotiated prices. Like the market, whoever beats a price gets their own.
            </p>
          </div>
          <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={load} disabled={loading || busy}>
            Refresh
          </Button>
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
              placeholder="Search name or SKU…"
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
          ) : products.length === 0 ? (
            <div className="rounded-xl bg-subtle px-4 py-10 text-center text-sm text-muted">
              <Percent className="mx-auto mb-2 h-8 w-8 text-muted" strokeWidth={1.5} />
              No products yet. Upload products first, then set negotiated prices.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>Vendor</TH>
                  <TH className="text-right">Final price</TH>
                  <TH className="text-right">Negotiated</TH>
                  <TH className="text-right">Markup</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {products.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <div className="font-medium text-fg">{p.name}</div>
                      <div className="font-mono text-xs text-muted">{p.sku}</div>
                    </TD>
                    <TD className="text-muted">{p.vendor_name || `#${p.vendor_id}`}</TD>
                    <TD className="text-right font-medium tabular-nums text-fg">{naira(p.final_price)}</TD>
                    <TD className="text-right">
                      {p.negotiated_count > 0 ? (
                        <Badge tone="accent" variant="subtle">{p.negotiated_count} member{p.negotiated_count === 1 ? '' : 's'}</Badge>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums text-muted">{p.admin_markup ? `+${naira(p.admin_markup)}` : '—'}</TD>
                    <TD>
                      <Button size="sm" variant="ghost" leftIcon={UserRound} onClick={() => openDetail(p)} disabled={busy}>
                        Prices
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <DraggableModal open={!!detail} onClose={() => setDetail(null)} title={`Prices · ${detail?.name || ''}`} widthClass="max-w-2xl w-full mx-4">
          {detail && (
            <div className="space-y-5">
              {/* General admin markup */}
              <div className="rounded-xl border border-line bg-subtle p-4">
                <div className="mb-2 text-sm font-semibold text-fg">General markup</div>
                <div className="text-xs text-muted">
                  Base price {naira(detail.vendor_price)} · final for everyone {naira(detail.final_price)}. Adjust the general markup here.
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor="exh-m-general">Admin markup (₦)</Label>
                    <Input id="exh-m-general" type="number" value={markupForm.admin_markup ?? 0} onChange={(e) => setMarkupForm({ admin_markup: e.target.value })} />
                  </div>
                  <Button loading={busy} onClick={saveAdminMarkup}>Save markup</Button>
                </div>
              </div>

              {/* Per-member negotiated prices */}
              <div>
                <div className="mb-2 text-sm font-semibold text-fg">Negotiated prices</div>
                {pricesLoading ? (
                  <div className="space-y-2">
                    {[0, 1].map((i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : prices.length === 0 ? (
                  <div className="rounded-lg bg-subtle px-3 py-4 text-center text-xs text-muted">
                    No negotiated prices yet. Add one for a member who beats the price.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-line">
                    <table className="w-full text-sm">
                      <thead className="bg-surface">
                        <tr className="border-b border-line text-left">
                          <th className="p-2.5 text-xs font-semibold uppercase tracking-wide text-subtext">Member</th>
                          <th className="p-2.5 text-right text-xs font-semibold uppercase tracking-wide text-subtext">Price</th>
                          <th className="p-2.5 text-xs font-semibold uppercase tracking-wide text-subtext">Note</th>
                          <th className="p-2.5 text-xs font-semibold uppercase tracking-wide text-subtext">Set</th>
                          <th className="p-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {prices.map((r) => (
                          <tr key={r.id} className="border-b border-line last:border-b-0">
                            <td className="p-2.5 font-mono text-xs font-medium text-fg">{r.member_id}</td>
                            <td className="p-2.5 text-right font-medium tabular-nums text-fg">{naira(r.price)}</td>
                            <td className="p-2.5 text-xs text-muted">{r.note || '—'}</td>
                            <td className="p-2.5 text-xs text-muted">{fmtDate(r.updated_at)}</td>
                            <td className="p-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => removeMemberPrice(r)}
                                disabled={busy}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-danger-bg hover:text-danger disabled:opacity-50"
                                aria-label={`Remove price for ${r.member_id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-4 rounded-xl border border-line p-4">
                  <div className="mb-2 text-sm font-semibold text-fg">Add negotiated price</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <Label htmlFor="exh-m-member">Member ID</Label>
                      <Input id="exh-m-member" value={priceForm.member_id} onChange={(e) => setPriceForm({ ...priceForm, member_id: e.target.value })} placeholder="e.g. CBN00123" />
                    </div>
                    <div>
                      <Label htmlFor="exh-m-price">Price (₦)</Label>
                      <Input id="exh-m-price" type="number" value={priceForm.price} onChange={(e) => setPriceForm({ ...priceForm, price: e.target.value })} placeholder="e.g. 45000" />
                    </div>
                    <div>
                      <Label htmlFor="exh-m-note">Note (optional)</Label>
                      <Input id="exh-m-note" value={priceForm.note} onChange={(e) => setPriceForm({ ...priceForm, note: e.target.value })} placeholder="e.g. Beats cash price" />
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" leftIcon={Plus} loading={busy} onClick={saveMemberPrice}>
                      Save member price
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DraggableModal>
      </div>
    </ProtectedRoute>
  )
}
