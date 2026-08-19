'use client'

// app/contact/page.jsx — the MitemsHub contact page (footer credit link).
// Shares the landing page's header, section language, card styling and
// footer so every guest-facing route feels like one product.

import { useState } from 'react'
import { ArrowRight, ArrowUpRight, Globe, Mail, Palette, Phone, Send } from 'lucide-react'
import LandingHeader from '../components/LandingHeader'
import Reveal from '../components/ui/Reveal'

// Marketing anchors point back to the landing page's sections.
const CONTACT_NAV = [
  { href: '/#services', label: 'What we do' },
  { href: '/#how', label: 'How it works' },
  { href: '/#why', label: 'Why join' },
  { href: '/#faq', label: 'FAQ' },
]

function Icon({ name, className }) {
  // WhatsApp + LinkedIn are brand marks, kept as inline paths (not in lucide).
  if (name === 'whatsapp') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884" />
      </svg>
    )
  }
  if (name === 'linkedin') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.6 0 4.266 2.37 4.266 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 114.126 0 2.062 2.062 0 01-2.063 2.065zM6.814 20.452H3.86V9h2.954v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    )
  }
  return null
}

const LUCIDE_ICONS = { phone: Phone, mail: Mail, globe: Globe, palette: Palette }

function SocialButton({ href, label, icon, tint, sub }) {
  const external = href.startsWith('http')
  const Arrow = external ? ArrowUpRight : ArrowRight
  const LucideIcon = LUCIDE_ICONS[icon]
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint} transition-transform duration-200 group-hover:scale-105`}>
        {LucideIcon ? (
          <LucideIcon className="h-5 w-5" strokeWidth={2} />
        ) : (
          <Icon name={icon} className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-fg">{label}</span>
        {!!sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </span>
      <Arrow className="ml-auto h-4 w-4 shrink-0 text-subtext transition-colors duration-200 group-hover:text-fg" aria-hidden="true" />
    </a>
  )
}

const INPUT_CLS =
  'w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-fg placeholder:text-subtext focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-[border-color,box-shadow] duration-200'

export default function ContactPage() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [requests, setRequests] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState(null)

  const onSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setMsg(null)
    try {
      if (!String(name).trim()) throw new Error('Please enter your name')
      if (!String(phone).trim() && !String(email).trim()) throw new Error('Please enter a phone number or email')
      if (!String(requests).trim()) throw new Error('Please tell me what you need')

      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(name || '').trim(),
          phone: String(phone || '').trim(),
          email: String(email || '').trim(),
          requests: String(requests || '').trim(),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to send message')

      setMsg({ type: 'success', text: 'Message sent successfully. I will get back to you shortly.' })
      setName('')
      setPhone('')
      setEmail('')
      setRequests('')
    } catch (err) {
      setMsg({ type: 'error', text: err?.message || 'Please check the form and try again' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <LandingHeader navLinks={CONTACT_NAV} navLabel="Marketing" />

      {/* ============================== HERO ============================== */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:py-16 lg:px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
              Built by MitemsHub
            </span>
            <h1 className="mt-4 text-h1 font-bold tracking-tight text-fg">
              Let&apos;s build what you need.
            </h1>
            <p className="mt-3 text-sm leading-6 text-fg/80 sm:text-base">
              Custom portals, websites and management systems for your organization. Tell me what
              you want to build and I&apos;ll respond promptly.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ============================== CONTENT ============================== */}
      <section className="bg-canvas">
        <div className="mx-auto max-w-7xl px-4 py-12 lg:px-6 lg:py-16">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            {/* Form */}
            <Reveal className="lg:col-span-3">
              <div className="h-full rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-subtle text-brand">
                    <Mail className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <div className="leading-tight">
                    <h2 className="text-sm font-bold text-fg">Quick Message</h2>
                    <p className="mt-0.5 text-xs text-muted">Share what you need, and I&apos;ll reach out.</p>
                  </div>
                </div>

                {!!msg && (
                  <div
                    className={`mt-4 rounded-xl border p-3 text-sm ${
                      msg.type === 'error'
                        ? 'border-danger-border bg-danger-bg text-danger-fg'
                        : 'border-success-border bg-success-bg text-success-fg'
                    }`}
                    role="status"
                  >
                    {msg.text}
                  </div>
                )}

                <form onSubmit={onSubmit} className="mt-5 space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-name" className="mb-1.5 block text-xs font-semibold text-fg">
                        Your Name
                      </label>
                      <input
                        id="contact-name"
                        className={INPUT_CLS}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. John Doe"
                        autoComplete="name"
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-phone" className="mb-1.5 block text-xs font-semibold text-fg">
                        Phone Number
                      </label>
                      <input
                        id="contact-phone"
                        className={INPUT_CLS}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="e.g. 0812..."
                        autoComplete="tel"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="contact-email" className="mb-1.5 block text-xs font-semibold text-fg">
                      Email
                    </label>
                    <input
                      id="contact-email"
                      className={INPUT_CLS}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. you@company.com"
                      autoComplete="email"
                      inputMode="email"
                    />
                  </div>

                  <div>
                    <label htmlFor="contact-request" className="mb-1.5 block text-xs font-semibold text-fg">
                      Your Request
                    </label>
                    <textarea
                      id="contact-request"
                      className={`${INPUT_CLS} min-h-32 resize-y`}
                      value={requests}
                      onChange={(e) => setRequests(e.target.value)}
                      placeholder="Tell me what you want to build or improve (features, timeline, budget range, etc.)"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-on-accent shadow-xs transition-colors duration-200 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60"
                  >
                    <Send className="h-4 w-4" strokeWidth={2} />
                    {submitting ? 'Submitting…' : 'Submit'}
                  </button>
                </form>
              </div>
            </Reveal>

            {/* Contact channels */}
            <Reveal delay={0.08} className="lg:col-span-2">
              <div className="space-y-4">
                <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle text-accent">
                      <Phone className="h-5 w-5" strokeWidth={2} />
                    </span>
                    <div className="leading-tight">
                      <h2 className="text-sm font-bold text-fg">Reach Me Directly</h2>
                      <p className="mt-0.5 text-xs text-muted">Call, chat or email</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2.5">
                    <SocialButton href="tel:08122763992" label="Call" sub="08122763992" icon="phone" tint="bg-brand-subtle text-brand" />
                    <SocialButton href="tel:08149100561" label="Call" sub="08149100561" icon="phone" tint="bg-brand-subtle text-brand" />
                    <SocialButton href="https://wa.me/2348122763992" label="WhatsApp" icon="whatsapp" tint="bg-success-bg text-success-fg" />
                    <SocialButton href="mailto:chuksmitti@gmail.com" label="Email" icon="mail" tint="bg-accent-subtle text-accent" />
                  </div>
                </div>

                <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-info-bg text-info-fg">
                      <Globe className="h-5 w-5" strokeWidth={2} />
                    </span>
                    <div className="leading-tight">
                      <h2 className="text-sm font-bold text-fg">Social</h2>
                      <p className="mt-0.5 text-xs text-muted">Find me around the web</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2.5">
                    <SocialButton href="http://linkedin.com/in/mitems" label="LinkedIn" icon="linkedin" tint="bg-info-bg text-info-fg" />
                    <SocialButton href="https://mitemshub.github.io/mitems-portfolio/" label="Portfolio" icon="globe" tint="bg-brand-subtle text-brand" />
                    <SocialButton href="/design-system" label="Design System" icon="palette" tint="bg-accent-subtle text-accent" />
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ============================== FOOTER ============================== */}
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-center sm:flex-row sm:text-left lg:px-6">
          <p className="text-xs text-muted">© 2026 CBN Coop Seasonal Sales. All rights reserved.</p>
          <p className="text-xs text-muted">
            Need help?{' '}
            <span className="font-medium text-fg">
              customerservice@cbncoopng.com, 09096797982, 08180578550
            </span>
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            Powered by
            <span className="font-semibold text-brand">MitemsHub</span>
          </p>
        </div>
      </footer>
    </div>
  )
}
