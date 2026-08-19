'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, BadgeCheck, ChevronDown, KeyRound, Search, Store } from 'lucide-react'
import EntryHeader from '../../components/EntryHeader'

export default function VendorLoginPage() {
  const router = useRouter()
  const [vendors, setVendors] = useState([])
  const [vendorsLoading, setVendorsLoading] = useState(true)
  const [vendorsError, setVendorsError] = useState('')
  const [hubOpen, setHubOpen] = useState(false)
  const [hubSearch, setHubSearch] = useState('')
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [passcode, setPasscode] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  // Load the selectable stands for the hub dropdown once.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/exhibition/stands', { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (json?.ok) setVendors(Array.isArray(json.vendors) ? json.vendors : [])
        else setVendorsError(json?.error || 'Could not load vendor stands')
      } catch {
        if (!cancelled) setVendorsError('Could not load vendor stands right now. You can still type your code.')
      } finally {
        if (!cancelled) setVendorsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const filteredVendors = useMemo(() => {
    const q = hubSearch.trim().toLowerCase()
    if (!q) return vendors
    return vendors.filter((v) => `${v.name} ${v.code} ${v.branch}`.toLowerCase().includes(q))
  }, [vendors, hubSearch])

  const pickVendor = (v) => {
    setSelectedVendor(v)
    setHubOpen(false)
    setHubSearch('')
  }

  // The stand's code is implicit in the selected hub — the passcode is the
  // single credential tied to that stand.
  const effectiveCode = (selectedVendor?.code || '').trim().toUpperCase()

  const submit = async (e) => {
    e?.preventDefault?.()
    setLoading(true)
    setMsg('')
    try {
      const res = await fetch('/api/vendor/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: effectiveCode, passcode }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Login failed')
      router.push('/vendor/dashboard')
    } catch (err) {
      setMsg(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <EntryHeader subtitle="Vendor Portal" backLabel="Back to Portal" backHref="/portal" />

      <div className="relative isolate overflow-hidden px-4 pb-16 pt-10 sm:pt-14">
        {/* Ambient glows */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-24 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-brand/15 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-64 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute bottom-10 left-0 h-56 w-64 rounded-full bg-brand/10 blur-3xl" />
        </div>

        <div className="mx-auto w-full max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="relative overflow-hidden rounded-2xl border border-line-subtle bg-surface/95 shadow-xl shadow-brand/5 backdrop-blur"
          >
            <div className="p-6 sm:p-8">
              {/* Brand tile */}
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-on-accent shadow-md shadow-brand/30">
                  <Store className="h-6 w-6" strokeWidth={2} />
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle px-2.5 py-1 text-chips font-medium text-muted">
                  <BadgeCheck className="h-3.5 w-3.5 text-brand" />
                  Coop Exhibition
                </span>
              </div>

              <h1 className="mt-5 text-h1 font-bold tracking-tight text-fg">Vendor sign in</h1>
              <p className="mt-1.5 text-sm text-muted">
                Sign in to manage your stand: products, prices and orders.
              </p>

              {!!msg && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-xl border border-danger-border bg-danger-bg px-3 py-2.5 text-sm text-danger-fg"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{msg}</span>
                </div>
              )}

              <form onSubmit={submit} className="mt-5 space-y-4">
                {/* Select your Hub — searchable list of vendor stands */}
                <div>
                  <label htmlFor="vendor-hub" className="mb-1.5 block text-sm font-medium text-fg">
                    Select your Hub
                  </label>
                  <div className="relative">
                    <Store className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <button
                      id="vendor-hub"
                      type="button"
                      onClick={() => setHubOpen((o) => !o)}
                      className={[
                        'flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-left text-sm transition-[border-color,box-shadow] duration-200 ease-sakani',
                        'hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30',
                        hubOpen ? 'border-brand ring-2 ring-brand/30' : '',
                      ].join(' ')}
                    >
                      <span className={selectedVendor ? 'min-w-0 flex-1 truncate text-fg' : 'text-subtext'}>
                        {selectedVendor ? selectedVendor.name : 'Select your hub…'}
                      </span>
                      <ChevronDown
                        className={[
                          'h-4 w-4 shrink-0 text-subtext transition-transform duration-200 ease-sakani',
                          hubOpen ? 'rotate-180' : '',
                        ].join(' ')}
                      />
                    </button>

                    {hubOpen && (
                      <>
                        {/* Click-outside catcher */}
                        <div className="fixed inset-0 z-10" onClick={() => setHubOpen(false)} aria-hidden="true" />
                        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-lg shadow-black/10">
                          <div className="relative border-b border-line-subtle">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                            <input
                              autoFocus
                              value={hubSearch}
                              onChange={(e) => setHubSearch(e.target.value)}
                              placeholder="Search stands…"
                              aria-label="Search vendor stands"
                              className="w-full bg-transparent py-2.5 pl-9 pr-3 text-sm text-fg placeholder:text-subtext focus:outline-none"
                            />
                          </div>
                          <ul className="max-h-52 overflow-y-auto py-1">
                            {vendorsLoading ? (
                              <li className="px-3 py-2.5 text-sm text-muted">Loading stands…</li>
                            ) : filteredVendors.length === 0 ? (
                              <li className="px-3 py-2.5 text-sm text-muted">
                                No stands match &ldquo;{hubSearch}&rdquo;
                              </li>
                            ) : (
                              filteredVendors.map((v) => (
                                <li key={v.id}>
                                  <button
                                    type="button"
                                    onClick={() => pickVendor(v)}
                                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
                                  >
                                    <span className="min-w-0 flex-1 truncate text-fg">{v.name}</span>
                                    <span className="shrink-0 text-chips font-medium text-muted">{v.code}</span>
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                        </div>
                      </>
                    )}
                  </div>
                  {!!vendorsError && (
                    <p className="mt-1.5 text-chips text-muted">{vendorsError}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="vendor-passcode" className="mb-1.5 block text-sm font-medium text-fg">
                    Passcode
                  </label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      id="vendor-passcode"
                      type="password"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      placeholder="Provided by the administrator"
                      autoComplete="off"
                      className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !effectiveCode || !passcode}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-on-accent shadow-sm transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Signing in…
                    </>
                  ) : (
                    'Sign in'
                  )}
                </button>
              </form>

              <p className="mt-6 flex items-center gap-1.5 text-chips text-muted">
                <ArrowLeft className="h-3.5 w-3.5" />
                Accounts are created by your Coop administrator.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
