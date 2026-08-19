// app/admin/pin/page.jsx
'use client'

import { useState } from 'react'
import { Lock, ShieldCheck } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAuth } from '../../contexts/AuthContext'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import EntryHeader from '../../components/EntryHeader'

export default function AdminPinPage() {
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()

  const submit = async () => {
    if (!pin || loading) return
    setLoading(true)
    setMsg('')
    try {
      const res = await fetch('/api/admin/pin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: pin }),
        credentials: 'include',
      })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Invalid passcode')

      login({ type: 'admin', id: 'admin', authenticated: true })

      // Force a page reload so middleware recognizes the cookie
      window.location.href = '/admin'
    } catch (e) {
      setMsg(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <EntryHeader subtitle="Admin Console" />
      <main className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        {/* Ambient brand + gold glows (matches the rep login) */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-accent/10 blur-3xl" aria-hidden="true" />

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="relative w-full max-w-sm"
        >
          <div className="ui-card relative p-6 sm:p-8">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="relative mb-4">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl font-bold text-on-accent shadow-lg shadow-brand/30">
                  C
                </span>
                <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-surface bg-accent" aria-hidden="true" />
              </div>
              <Badge tone="brand" variant="subtle" icon={ShieldCheck} className="mb-3">
                Admin only
              </Badge>
              <h1 className="text-h2 font-bold tracking-tight text-fg">Admin Console</h1>
            </div>

            <label htmlFor="admin-passcode" className="mb-1.5 block text-xs font-medium text-subtext">
              Passcode
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" />
              <input
                id="admin-passcode"
                type="password"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="Enter passcode"
                autoComplete="current-password"
                className={[
                  'h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-subtext',
                  'transition-[border-color,box-shadow] duration-200 ease-sakani',
                  'hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30',
                ].join(' ')}
              />
            </div>

            {msg && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg"
              >
                {msg}
              </div>
            )}

            <Button
              variant="brand"
              size="lg"
              className="mt-4 w-full"
              onClick={submit}
              disabled={!pin.trim()}
              loading={loading}
            >
              {loading ? 'Checking…' : 'Continue'}
            </Button>

            <p className="mt-5 text-center text-xs text-subtext">
              Authorized personnel only. All access is logged.
            </p>
          </div>
        </motion.div>
      </main>
    </div>
  )
}
