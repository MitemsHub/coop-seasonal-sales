'use client'
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, KeyRound, Package, Phone, ShieldCheck, ShoppingBasket, Store } from 'lucide-react'
import EntryHeader from '../../components/EntryHeader'

export default function RepLoginPage() {
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawModule = (searchParams.get('module') || 'food').toLowerCase()
  const portalModule = rawModule === 'ram' ? 'ram' : rawModule === 'exhibition' ? 'exhibition' : 'food'
  const isRam = portalModule === 'ram'
  const isExhibition = portalModule === 'exhibition'
  const isFood = portalModule === 'food'

  const submit = async () => {
    setLoading(true); setMsg('')
    try {
      const res = await fetch('/api/rep/session', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ module: portalModule, passcode: code.trim().toUpperCase() })
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed')

      // Set user as authenticated rep
      const base = {
        type: 'rep',
        id: code.trim().toUpperCase(),
        authenticated: true,
        module: portalModule,
      }
      if (json.module === 'ram') {
        login({
          ...base,
          vendorId: json.vendor?.id ?? null,
          vendorName: json.vendor?.name ?? '',
          vendorCode: json.vendor?.code ?? '',
        })
        router.push('/rep')
        return
      }
      login({
        ...base,
        branchCode: json.branch?.code ?? code.trim().toUpperCase(),
        branchName: json.branch?.name ?? '',
        branchId: json.branch?.id ?? null,
      })

      if (isFood) {
        const phoneClean = phone.trim()
        if (phoneClean) {
          await fetch('/api/rep/profile/phone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ rep_phone: phoneClean }),
          }).catch(() => null)
        }
      }

      // Land every rep on the module-aware dashboard — the logged-in module
      // (food / ram / exhibition) drives what the dashboard shows.
      router.push('/rep')
    } catch (e) {
      setMsg(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <EntryHeader
        subtitle="Rep Portal"
        links={[{ href: '/rep/access', label: 'Change module', icon: ArrowLeft }]}
      />
      <main className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        {/* Ambient brand + gold glows (matches the module picker) */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-brand/10 blur-3xl" aria-hidden="true" />

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="relative w-full max-w-md"
        >
          <div className="ui-card relative p-6 sm:p-8">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="relative mb-4">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl font-bold text-on-accent shadow-lg shadow-brand/30">
                  R
                </span>
                <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-surface bg-brand-hover" aria-hidden="true" />
              </div>
              <h1 className="text-h2 font-bold tracking-tight text-fg">
                {isRam ? 'Ram Sales Rep Portal' : isExhibition ? 'Coop Exhibition Rep Portal' : 'Food Distribution Rep Portal'}
              </h1>
              <p className="mt-1 text-sm text-muted">Enter your passcode to continue.</p>

              <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-3 py-1 text-xs font-semibold text-brand-fg">
                {isRam ? <ShoppingBasket className="h-3.5 w-3.5" aria-hidden="true" /> : isExhibition ? <Store className="h-3.5 w-3.5" aria-hidden="true" /> : <Package className="h-3.5 w-3.5" aria-hidden="true" />}
                {isRam ? 'Ram Sales' : isExhibition ? 'Coop Exhibition' : 'Food Distribution'} module
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="rep-code" className="mb-1.5 block text-xs font-medium text-subtext">
                  Rep passcode
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" aria-hidden="true" />
                  <input
                    id="rep-code"
                    className="w-full rounded-lg border border-line bg-surface py-2 pl-10 pr-3 text-sm text-fg placeholder:text-subtext transition-colors duration-200 ease-sakani focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                    value={code}
                    onChange={e=>setCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
                    placeholder="Enter your passcode"
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck="false"
                  />
                </div>
              </div>

              {isFood && (
                <div>
                  <label htmlFor="rep-phone" className="mb-1.5 block text-xs font-medium text-subtext">
                    Rep phone number
                  </label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" aria-hidden="true" />
                    <input
                      id="rep-phone"
                      className="w-full rounded-lg border border-line bg-surface py-2 pl-10 pr-3 text-sm text-fg placeholder:text-subtext transition-colors duration-200 ease-sakani focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Rep phone number"
                      type="tel"
                      autoComplete="tel"
                    />
                  </div>
                </div>
              )}

              <button
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-on-accent transition-all duration-200 ease-sakani hover:bg-brand-hover active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={submit}
                disabled={loading || !code.trim()}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-on-accent border-t-transparent" />
                    <span>Checking…</span>
                  </span>
                ) : (
                  'Continue'
                )}
              </button>
            </div>

            {msg && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-lg border border-danger-border bg-danger-bg p-3 text-sm text-danger-fg"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{msg}</span>
              </div>
            )}
          </div>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Authorized personnel only. All access is logged.
          </p>
        </motion.div>
      </main>
    </div>
  )
}
