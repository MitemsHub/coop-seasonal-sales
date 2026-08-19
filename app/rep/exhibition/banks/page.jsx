'use client'

// app/rep/exhibition/banks/page.jsx
// Vendor bank accounts for the rep's own branch — the co-op's record of where
// to pay each stand after the season. Reps can set/edit accounts for vendors
// whose stands belong to their branch.
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Store } from 'lucide-react'
import DraggableModal from '../../../components/DraggableModal'
import Button from '../../../components/ui/Button'
import Skeleton from '../../../components/ui/Skeleton'

const toastMotion = {
  initial: { opacity: 0, y: -8, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.99 },
  transition: { duration: 0.18, ease: 'easeOut' },
}

function maskAccountNumber(s) {
  const v = String(s || '').replace(/\D/g, '')
  if (!v) return '—'
  if (v.length <= 4) return v
  return `${'*'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`
}

function RepExhibitionBanksContent() {
  const [vendors, setVendors] = useState([])
  const [term, setTerm] = useState('')
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [bankVendor, setBankVendor] = useState(null)
  const [bankName, setBankName] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')

  const fetchCtl = useRef(null)
  const safeJson = useCallback(async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      if (fetchCtl.current) fetchCtl.current.abort()
      const ctl = new AbortController()
      fetchCtl.current = ctl
      const res = await fetch('/api/rep/exhibition/vendor-banks/vendors', { cache: 'no-store', signal: ctl.signal })
      const json = await safeJson(res, '/api/rep/exhibition/vendor-banks/vendors')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      setVendors(json.vendors || [])
    } catch (e) {
      if (e?.name !== 'AbortError') setMsg({ type: 'error', text: e?.message || 'Failed to load' })
      setVendors([])
    } finally {
      setLoading(false)
    }
  }, [safeJson])

  useEffect(() => {
    load()
    return () => {
      if (fetchCtl.current) fetchCtl.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const t = String(term || '').trim().toLowerCase()
    if (!t) return vendors
    return vendors.filter((v) => {
      const a = `${v.name || ''} ${v.code || ''} ${v.phone || ''} ${v.bank?.bank_name || ''} ${v.bank?.account_name || ''} ${v.bank?.account_number || ''}`.toLowerCase()
      return a.includes(t)
    })
  }, [vendors, term])

  const openBank = (v) => {
    setBankVendor(v)
    setBankName(String(v.bank?.bank_name || ''))
    setAccountName(String(v.bank?.account_name || ''))
    setAccountNumber(String(v.bank?.account_number || ''))
    setModalOpen(true)
  }

  const saveBank = async () => {
    const id = Number(bankVendor?.id)
    if (!Number.isFinite(id) || id <= 0) return
    if (saving) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/rep/exhibition/vendor-banks/set-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          vendor_id: id,
          bank_name: bankName,
          account_name: accountName,
          account_number: accountNumber,
        }),
      })
      const json = await safeJson(res, '/api/rep/exhibition/vendor-banks/set-account')
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save')
      setVendors((prev) => (prev || []).map((v) => (Number(v.id) === id ? { ...v, bank: json.bank } : v)))
      setMsg({ type: 'success', text: 'Bank details saved' })
      setModalOpen(false)
      setBankVendor(null)
    } catch (e) {
      setMsg({ type: 'error', text: e?.message || 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-h2 font-semibold">Exhibition · Vendor Banks</h1>
          <div className="text-xs sm:text-sm text-muted">Bank accounts for the vendor stands in your branch</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search vendor / bank / account"
            className="w-full sm:w-72 px-3 py-2 border border-line rounded-lg text-sm bg-surface"
          />
          <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {msg && (
          <motion.div
            {...toastMotion}
            className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
              msg.type === 'error' ? 'bg-danger-bg text-danger-fg border-danger-border' : 'bg-success-bg text-success-fg border-success-border'
            }`}
          >
            {msg.text}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ui-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-subtle">
              <tr>
                <th className="text-left px-3 py-2 border-b">Vendor</th>
                <th className="text-left px-3 py-2 border-b">Bank</th>
                <th className="text-left px-3 py-2 border-b">Account Name</th>
                <th className="text-left px-3 py-2 border-b">Account No.</th>
                <th className="text-right px-3 py-2 border-b">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !filtered.length && (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`sk_${i}`}>
                    <td className="px-3 py-3 border-b"><Skeleton className="h-4 w-40" /></td>
                    <td className="px-3 py-3 border-b"><Skeleton className="h-4 w-28" /></td>
                    <td className="px-3 py-3 border-b"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-3 py-3 border-b"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-3 py-3 border-b text-right"><Skeleton className="ml-auto h-8 w-20" /></td>
                  </tr>
                ))
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center">
                    <Store className="mx-auto mb-2 h-8 w-8 text-muted" strokeWidth={1.5} />
                    <p className="text-sm text-muted">No vendors found for your branch yet.</p>
                  </td>
                </tr>
              )}

              {filtered.map((v) => (
                <tr key={v.id} className="hover:bg-subtle">
                  <td className="px-3 py-2 border-b">
                    <div className="font-medium text-fg">{v.name || '—'}</div>
                    <div className="font-mono text-xs text-subtext">{v.code}</div>
                  </td>
                  <td className="px-3 py-2 border-b">{v.bank?.bank_name || '—'}</td>
                  <td className="px-3 py-2 border-b">{v.bank?.account_name || '—'}</td>
                  <td className="px-3 py-2 border-b">{maskAccountNumber(v.bank?.account_number || '')}</td>
                  <td className="px-3 py-2 border-b text-right">
                    <Button size="sm" variant={v.bank ? 'secondary' : 'brand'} onClick={() => openBank(v)} disabled={loading}>
                      {v.bank ? 'Edit bank' : 'Set bank'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <DraggableModal open={modalOpen} onClose={() => setModalOpen(false)} title={`Bank Details · ${bankVendor?.name || ''}`}>
        <div className="space-y-3">
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="Bank name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={saving}
          />
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Account name"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={saving}
          />
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="Account number"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={saving}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} onClick={saveBank}>
              Save
            </Button>
          </div>
        </div>
      </DraggableModal>
    </div>
  )
}

export default function RepExhibitionBanksPage() {
  return <RepExhibitionBanksContent />
}
