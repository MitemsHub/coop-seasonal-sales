'use client'

// app/vendor/stand/page.jsx
// The stand's public profile: banner, where it is, when it is open, how to
// reach it, the minimum order and pickup instructions. Members see all of this
// on the stand page.
import { useEffect, useState } from 'react'
import { Image as ImageIcon, MapPin, Save } from 'lucide-react'
import Button from '../../components/ui/Button'

const FIELDS = [
  { key: 'banner_url', label: 'Banner image URL', placeholder: 'https://…', hint: 'Wide image shown at the top of your stand.' },
  { key: 'stand_number', label: 'Stand number', placeholder: 'e.g. 07' },
  { key: 'hall', label: 'Hall', placeholder: 'e.g. Hall B' },
  { key: 'opening_hours', label: 'Opening hours', placeholder: 'e.g. 9:00 – 18:00 daily' },
  { key: 'whatsapp', label: 'WhatsApp number', placeholder: 'e.g. 2348012345678' },
]

export default function VendorStandPage() {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/vendor/stand', { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (json?.ok) setForm(json.stand)
        else setMsg({ type: 'error', text: json?.error || 'Could not load your stand' })
      } catch {
        if (!cancelled) setMsg({ type: 'error', text: 'Could not reach the server.' })
      }
    })()
    return () => { cancelled = true }
  }, [])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/vendor/stand', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not save your stand')
      setForm(json.stand)
      setMsg({ type: 'success', text: 'Stand profile saved. Members see it on your stand page.' })
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  if (!form) {
    return <div className="p-4 text-sm text-muted">{msg?.text || 'Loading your stand…'}</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="font-display text-h1 font-semibold tracking-tight text-fg">Stand profile</h1>
      <p className="mt-1 text-sm text-muted">
        This is what members see when they open {form.name}. A complete stand gets more visits.
      </p>

      {msg && (
        <div
          className={[
            'mt-4 rounded-lg border px-3 py-2 text-sm',
            msg.type === 'success'
              ? 'border-success-border bg-success-bg/50 text-success-fg'
              : 'border-danger-border bg-danger-bg/50 text-danger-fg',
          ].join(' ')}
        >
          {msg.text}
        </div>
      )}

      <div className="mt-5 space-y-4 rounded-2xl border border-line bg-surface p-4">
        {form.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.banner_url} alt="Stand banner" className="h-36 w-full rounded-xl object-cover" />
        ) : (
          <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-line bg-subtle/60 text-chips text-muted">
            <ImageIcon className="mr-2 h-4 w-4" /> No banner yet
          </div>
        )}

        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs font-semibold text-fg">{f.label}</span>
            <input
              value={form[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.placeholder}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            />
            {f.hint && <span className="mt-1 block text-chips text-muted">{f.hint}</span>}
          </label>
        ))}

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-fg">Minimum order (₦)</span>
          <input
            type="number"
            min="0"
            value={form.min_order ?? 0}
            onChange={(e) => set('min_order', e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none sm:w-48"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-fg">Pickup instructions</span>
          <textarea
            rows={4}
            value={form.pickup_instructions ?? ''}
            onChange={(e) => set('pickup_instructions', e.target.value)}
            placeholder="Where to collect, what to bring, who to ask for…"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
          />
        </label>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-chips text-muted">
            <MapPin className="mr-1 inline h-3 w-3" />
            {form.address || 'No address on file'}
          </p>
          <Button variant="brand" leftIcon={Save} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </div>
    </div>
  )
}
