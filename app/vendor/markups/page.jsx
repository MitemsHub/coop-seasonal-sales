'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { BadgePercent, Search, Trash2, UserRound, X } from 'lucide-react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Label from '../../components/ui/Label'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import Skeleton from '../../components/ui/Skeleton'

const fmtNaira = (n) => `NGN ${Number(n || 0).toLocaleString()}`

export default function VendorMarkupsPage() {
  const [products, setProducts] = useState(null)
  const [productId, setProductId] = useState('')
  const [prices, setPrices] = useState(null)
  const [msg, setMsg] = useState('')

  // Member search
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)

  // New price form
  const [pickMember, setPickMember] = useState(null) // { member_id, full_name }
  const [newPrice, setNewPrice] = useState('')
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const debounceRef = useRef(null)

  const selectedProduct = useMemo(() => (products || []).find((p) => String(p.id) === String(productId)), [products, productId])

  useEffect(() => {
    fetch('/api/vendor/exhibition/products?status=all', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setProducts(j.products)
          if (!productId && j.products.length) setProductId(String(j.products[0].id))
        }
      })
      .catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!productId) {
      setPrices([])
      return
    }
    setPrices(null)
    fetch(`/api/vendor/exhibition/member-prices?product_id=${productId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setPrices(j.prices)
        else setMsg(j.error || 'Failed to load prices')
      })
      .catch(() => setMsg('Failed to load prices'))
  }, [productId])

  // Debounced member search
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/vendor/exhibition/members/search?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
        const json = await res.json()
        setResults(json.ok ? json.members : [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [q])

  const savePrice = async () => {
    if (!pickMember) return
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch('/api/vendor/exhibition/member-prices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: Number(productId), member_id: pickMember.member_id, price: Number(newPrice), note: newNote }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save')
      setPickMember(null)
      setNewPrice('')
      setNewNote('')
      setQ('')
      setResults([])
      fetch(`/api/vendor/exhibition/member-prices?product_id=${productId}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => j.ok && setPrices(j.prices))
    } catch (e) {
      setMsg(e.message || 'Failed to save price')
    } finally {
      setSaving(false)
    }
  }

  const removePrice = async (p) => {
    if (!window.confirm(`Remove the negotiated price for ${p.member_id}?`)) return
    const res = await fetch('/api/vendor/exhibition/member-prices', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: Number(productId), member_id: p.member_id }),
    })
    const json = await res.json()
    if (json.ok) setPrices((prev) => (prev || []).filter((x) => x.id !== p.id))
    else setMsg(json.error || 'Failed to remove price')
  }

  const adminAdjusted = Number(selectedProduct?.admin_markup || 0) !== 0

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-h1 font-bold tracking-tight text-fg">Prices & Markups</h1>
        <p className="mt-1 text-sm text-muted">
          Like a real market, members who negotiate get their own price. Pick a product, then set that member&apos;s price.
        </p>
      </div>

      {!!msg && <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{msg}</div>}

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_260px]">
        <div>
          <Label htmlFor="mp-product">Product</Label>
          {products === null ? (
            <Skeleton className="h-10 w-full rounded-lg" />
          ) : (
            <Select id="mp-product" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!products?.length}>
              {!products?.length && <option value="">No products yet</option>}
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.sku} · {fmtNaira(p.final_price)}
                </option>
              ))}
            </Select>
          )}
        </div>
        {selectedProduct && (
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-chips text-muted">Listed price (all members)</p>
            <p className="mt-1 text-xl font-bold text-fg">{fmtNaira(selectedProduct.final_price)}</p>
            {adminAdjusted ? (
              <p className="mt-0.5 text-chips text-muted">
                base {fmtNaira(selectedProduct.vendor_price)} · admin adj {fmtNaira(selectedProduct.admin_markup)}
              </p>
            ) : (
              <p className="mt-0.5 text-chips text-muted">No admin adjustment</p>
            )}
          </div>
        )}
      </div>

      {selectedProduct && (
        <>
          <div className="mb-8 rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-sm font-bold text-fg">Set a negotiated price</h2>
            <p className="mt-1 text-chips text-muted">Search a member by staff ID or name, then give them their own price for this product.</p>

            {!pickMember ? (
              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search member… (min 2 characters)"
                  className="pl-9"
                />
                {q.trim().length >= 2 && (
                  <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
                    {searching ? (
                      <div className="px-4 py-3 text-sm text-muted">Searching…</div>
                    ) : results.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-muted">No members found</div>
                    ) : (
                      results.map((m) => (
                        <button
                          key={m.member_id}
                          type="button"
                          onClick={() => {
                            setPickMember(m)
                            setResults([])
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-subtle"
                        >
                          <UserRound className="h-4 w-4 shrink-0 text-brand" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-fg">{m.full_name || 'Member'}</p>
                            <p className="text-chips text-muted">
                              {m.member_id} · {m.branch || '—'}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-line bg-canvas/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-fg">{pickMember.full_name || 'Member'}</p>
                    <p className="text-chips text-muted">{pickMember.member_id} · {pickMember.branch || '—'}</p>
                  </div>
                  <button type="button" onClick={() => { setPickMember(null); setNewPrice(''); setNewNote('') }} aria-label="Change member" className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <div>
                    <Label htmlFor="mp-price">Negotiated price (₦)</Label>
                    <Input id="mp-price" type="number" min="1" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <Label htmlFor="mp-note">Note (optional)</Label>
                    <Input id="mp-note" value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="e.g. agreed at the stand" />
                  </div>
                  <Button variant="brand" onClick={savePrice} loading={saving} disabled={!newPrice || Number(newPrice) <= 0}>
                    Save price
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-sm font-bold text-fg">Negotiated prices</h2>
              <Badge tone="accent">{prices ? prices.length : '…'}</Badge>
            </div>
            {prices === null ? (
              <div className="space-y-2 p-5">
                <Skeleton className="h-12 w-full rounded-xl" />
                <Skeleton className="h-12 w-full rounded-xl" />
              </div>
            ) : prices.length === 0 ? (
              <EmptyState
                icon={BadgePercent}
                title="No negotiated prices yet"
                description="Search a member above and give them their own price for this product."
              />
            ) : (
              <div className="divide-y divide-line">
                {prices.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{p.member_id}</p>
                      {p.note && <p className="text-chips text-muted">{p.note}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-success-fg">{fmtNaira(p.price)}</p>
                      <p className="text-chips text-muted">
                        {Number(p.price) < Number(selectedProduct.final_price) ? 'below listed' : Number(p.price) > Number(selectedProduct.final_price) ? 'above listed' : 'at listed'}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" leftIcon={Trash2} onClick={() => removePrice(p)} aria-label={`Remove price for ${p.member_id}`} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
