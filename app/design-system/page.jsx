'use client'

// app/design-system/page.jsx
// Live showcase of the Coop Sakani design system — review the rebrand here before it ships.
import { useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ClipboardList,
  Info,
  Package,
  PackageX,
  Plus,
  ShoppingCart,
  Trash2,
  Truck,
  Users,
  XCircle,
} from 'lucide-react'
import ThemeToggle from '../components/ui/ThemeToggle'
import Button from '../components/ui/Button'
import ExportButton, { ExportButtons } from '../components/ui/ExportButton'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import StatCard from '../components/ui/StatCard'
import { Input, Textarea } from '../components/ui/Input'
import Select from '../components/ui/Select'
import Label from '../components/ui/Label'
import Tabs from '../components/ui/Tabs'
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'
import { useToast } from '../components/ui/Toast'
import { BarChart, LineChart } from '../components/ui/Charts'
import { ExhibitionOrderStepper, RamOrderStepper, FoodOrderStepper } from '../components/ui/OrderStepper'
import CycleCountdown from '../components/ui/CycleCountdown'

const BRAND_SCALE = [
  ['50', '#effaf3'],
  ['100', '#dbf2e4'],
  ['200', '#bce2cc'],
  ['300', '#93cdad'],
  ['400', '#69b48d'],
  ['500', '#479d73'],
  ['600', '#30825c'],
  ['700', '#1d6746'],
  ['800', '#134e34'],
  ['900', '#0d3926'],
  ['950', '#052315'],
]

const SEMANTIC = [
  ['Canvas', 'var(--bg-canvas)'],
  ['Surface', 'var(--bg-surface)'],
  ['Subtle', 'var(--bg-subtle)'],
  ['Inverse', 'var(--bg-inverse)'],
  ['FG default', 'var(--fg-default)'],
  ['FG muted', 'var(--fg-muted)'],
  ['Brand', 'var(--brand)'],
  ['Accent', 'var(--accent)'],
  ['Success', 'var(--success-solid)'],
  ['Warning', 'var(--warning-solid)'],
  ['Danger', 'var(--danger-solid)'],
  ['Info', 'var(--info-solid)'],
]

// Fluid type scale — mirrors the --fs-* clamps in globals.css (:root).
// Each entry: [token, utility, usage, mobile px (360), desktop px (1024)]
// Mobile anchors are compressed ~3px vs the original static sizes so the
// scale reads correctly on phones; desktop values are untouched.
const FLUID_TYPE = [
  ['display', 'text-display', 'Hero / landing headline', 19, 34],
  ['h1', 'text-h1', 'Page titles', 17, 30],
  ['h2', 'text-h2', 'Section headings', 15, 24],
  ['h3', 'text-h3', 'Card / group headings', 14, 20],
  ['h4', 'text-h4', 'Small sub-headings', 13, 16],
  ['body', 'text-body', 'Default body copy', 13, 16],
  ['caption', 'text-caption', 'Helper text / metadata', 10, 13],
  ['chips', 'text-chips', 'Chips, pills & tags', 10, 11],
  ['kicker', 'text-kicker', 'Uppercase eyebrow labels', 10, 10],
]

// Fluid spacing scale — mirrors the --sp-* clamps in globals.css (:root).
// Each entry: [token, utility, usage, mobile px (360), desktop px (1024)]
// The tokens drive the whole spacing family (p-, m-, gap-, mt-, mb-, px-, py-…).
const FLUID_SPACING = [
  ['sp-2xs', 'p-fluid-2xs', 'Tight gaps & chips', 3, 7],
  ['sp-xs', 'p-fluid-xs', 'Compact paddings', 5, 9],
  ['sp-sm', 'p-fluid-sm', 'Small gaps', 7, 11],
  ['sp-md', 'p-fluid-md', 'Card padding', 10, 18],
  ['sp-lg', 'p-fluid-lg', 'Section gaps', 14, 26],
  ['sp-xl', 'p-fluid-xl', 'Hero padding', 17, 34],
  ['sp-fluid', 'p-fluid', 'Page gutters', 10, 24],
]

// Fluid radii scale — mirrors the --radius-* clamps in globals.css (:root).
// Each entry: [token, utility, usage, mobile px (360), desktop px (1024)]
// Mobile anchors are compressed ~20% to match the tighter type and spacing
// on phones; corners breathe larger on wide screens. The standard rounded-*
// utilities use the same clamps.
const FLUID_RADIUS = [
  ['radius-xs', 'rounded-fluid-xs', 'Tight chips & tags', 3, 6],
  ['radius-sm', 'rounded-fluid-sm', 'Small buttons', 5, 8],
  ['radius-md', 'rounded-fluid-md', 'Inputs & controls', 7, 10],
  ['radius-lg', 'rounded-fluid-lg', 'Cards & panels', 10, 16],
  ['radius-xl', 'rounded-fluid-xl', 'Large surfaces', 13, 20],
  ['radius-2xl', 'rounded-fluid-2xl', 'Modals & hero cards', 20, 32],
  ['radius-3xl', 'rounded-fluid-3xl', 'Showcase & feature cards', 23, 36],
]

// Fluid shadows — the blur/y-offset grow with the viewport, so cards feel
// softer and more lifted on desktop. Each entry: [token, utility, usage,
// mobile blur (360), desktop blur (1024), mobile y-offset, desktop y-offset].
// Values mirror the --shadow-* clamps in globals.css exactly — the first
// layer interpolates on y-offset + blur, the second layer derives from it.
const FLUID_SHADOW = [
  ['shadow-xs', 'shadow-fluid-xs', 'Subtle inset separation', 2, 2, 1, 2],
  ['shadow-sm', 'shadow-fluid-sm', 'Hover & small cards', 3, 6, 1, 2],
  ['shadow-md', 'shadow-fluid-md', 'Default cards', 8, 16, 4, 6],
  ['shadow-lg', 'shadow-fluid-lg', 'Popovers & dropdowns', 16, 28, 12, 16],
  ['shadow-xl', 'shadow-fluid-xl', 'Floating actions', 24, 40, 20, 24],
  ['shadow-2xl', 'shadow-fluid-2xl', 'Modals & dialogs', 48, 72, 24, 32],
]

// Compute the exact shadow a level resolves to at a given viewport — the
// blur and y-offset interpolate across the same 360→1024px clamp band as
// every other fluid token (displayed live on the demo cards below).
const fluidShadow = (blurM, blurD, yM, yD, viewport) => {
  const interp = (a, b) => a + ((b - a) * (viewport - 360)) / 664
  const blur = Math.max(blurM, Math.min(blurD, interp(blurM, blurD)))
  const y = Math.max(yM, Math.min(yD, interp(yM, yD)))
  const color = 'rgba(16, 15, 12, 0.1)'
  const soft = 'rgba(16, 15, 12, 0.06)'
  return `${Math.round(y)}px ${Math.round(blur)}px ${Math.round(blur * 0.6)}px -2px ${color}, 0 ${Math.round(y * 0.5)}px ${Math.round(blur * 0.4)}px -2px ${soft}`
}

// Compute the exact px a --fs-* clamp resolves to at a given viewport.
// Same math as the clamps in globals.css: the preferred value is
// `mobile + (desktop - mobile) * (viewport - 360) / 664` — the band
// runs 360→1024px and the desktop value is the clamp's max, so the
// demo stays truthful at any slider position, including past the
// desktop anchor (where the real clamp keeps the desktop value).
const fluidSize = (mobile, desktop, viewport) => {
  const preferred = mobile + ((desktop - mobile) * (viewport - 360)) / 664
  return Math.round(Math.min(desktop, Math.max(mobile, preferred)) * 100) / 100
}

// Demo dates for the countdown chip — computed relative to now so the gallery
// always shows a live-looking "closes in N days" regardless of when it's viewed.
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString()

const sampleOrders = [
  { id: 'ORD-2481', member: 'Adeyemi O.', branch: 'Lagos HQ', amount: '₦84,500', status: 'Pending', tone: 'warning' },
  { id: 'ORD-2482', member: 'Okafor C.', branch: 'Abuja', amount: '₦212,000', status: 'Posted', tone: 'info' },
  { id: 'ORD-2483', member: 'Bello M.', branch: 'Ibadan', amount: '₦46,750', status: 'Delivered', tone: 'success' },
  { id: 'ORD-2484', member: 'Eze N.', branch: 'Port Harcourt', amount: '₦129,300', status: 'Cancelled', tone: 'danger' },
]

function Section({ id, title, description, children }) {
  return (
    <section id={id} className="scroll-mt-20 border-b border-line-subtle py-10 first:pt-0 last:border-0">
      <div className="mb-6">
        <h2 className="text-h2 font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}

// Shared viewport slider — one state drives both the type and spacing scales.
function ViewportSlider({ id, value, onChange }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted">
          Viewport width
        </label>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-2.5 py-0.5 text-xs font-bold tabular-nums text-brand-fg">
          {value}px
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={320}
        max={1440}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-brand"
        aria-label="Simulated viewport width"
      />
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted">
        <span>320</span>
        <span className="hidden sm:inline">360 mobile min</span>
        <span className="hidden sm:inline">1024 desktop max</span>
        <span>1440</span>
      </div>
    </div>
  )
}

export default function DesignSystemPage() {
  const [tab, setTab] = useState('pending')
  const [modalOpen, setModalOpen] = useState(false)
  const [viewport, setViewport] = useState(768)
  const [exportBusy, setExportBusy] = useState(false)
  const toast = useToast()

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-line-subtle bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="group flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-base font-bold text-on-accent transition-transform duration-200 group-hover:scale-105">
              C
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-fg group-hover:text-brand">Coop Sakani</div>
              <div className="text-xs text-muted">Design System · v1</div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="accent" size="sm" onClick={() => toast.success('Coop Sakani loaded.')}>
              Approve direction
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* Hero */}
        <div className="mb-10">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted transition-colors duration-200 hover:text-brand"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to home
          </Link>
          <Badge tone="brand" variant="subtle">
            Rebrand preview
          </Badge>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            The Coop Sakani design system
          </h1>
          <p className="mt-2 max-w-2xl text-muted">
            Warm stone neutrals, a Harvest-green brand with a gold accent, Geist typography and a token-driven component kit.
            Light and dark mode from a single source of truth. Toggle the theme in the header.
          </p>
        </div>

        {/* Brand colors */}
        <Section id="colors" title="Brand palette" description="The Harvest-green scale: warm stone neutrals, forest green brand, gold secondary accent.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-11">
            {BRAND_SCALE.map(([name, hex]) => (
              <div key={name} className="overflow-hidden rounded-lg border border-line">
                <div className="h-16" style={{ background: hex }} />
                <div className="bg-surface px-2 py-1.5">
                  <div className="text-xs font-semibold text-fg">{name}</div>
                  <div className="text-[10px] text-muted">{hex}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {SEMANTIC.map(([name, v]) => (
              <div key={name} className="flex items-center gap-2 rounded-lg border border-line bg-surface p-2.5">
                <span className="h-7 w-7 shrink-0 rounded-md border border-line" style={{ background: v }} />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-fg">{name}</div>
                  <div className="text-[10px] text-muted">semantic token</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Typography */}
        <Section id="type" title="Typography" description="Geist, Sakani's typeface, now self-hosted through next/font.">
          <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted">Display · 30px / 600</div>
              <div className="text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-fg">₦4,820,500.00</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted">Heading · 16px / 600</div>
              <div className="text-base font-semibold text-fg">Pending orders this cycle</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted">Body · 14px / 400</div>
              <div className="max-w-xl text-sm text-fg">
                Members can browse items, place orders and track delivery through their branch representative.
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted">Caption · 12px / 500</div>
              <div className="text-xs text-muted">Updated 2 minutes ago · Cycle 14 · Lagos HQ</div>
            </div>
          </div>
        </Section>

        {/* Fluid type scale */}
        <Section
          id="fluid-type"
          title="Fluid type scale"
          description="The responsive baseline. Every size is a clamp() that interpolates between a mobile value (at 360px) and a desktop value (at 1024px). The mobile anchors were compressed by ~3px so headings, body and chips read at phone-friendly sizes; desktop values are unchanged. Drag the slider to see the scale breathe."
        >
          <div className="rounded-xl border border-line bg-surface p-5">
            <ViewportSlider id="fluid-viewport" value={viewport} onChange={setViewport} />

            {/* Scale rows */}
            <div className="divide-y divide-line-subtle">
              {FLUID_TYPE.map(([token, cls, usage, mobilePx, desktopPx]) => {
                const px = fluidSize(mobilePx, desktopPx, viewport)
                return (
                  <div key={token} className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-3 sm:grid-cols-[110px_1fr_auto]">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-fg">{cls}</div>
                      <div className="text-[11px] text-muted">{usage}</div>
                    </div>
                    <div className="order-2 col-span-2 text-right sm:order-none sm:col-span-1">
                      <span className="text-xs font-bold tabular-nums text-brand">{px}px</span>
                      <span className="ml-1.5 text-[10px] tabular-nums text-muted">
                        {mobilePx}→{desktopPx}
                      </span>
                    </div>
                    <div
                      className="order-1 col-span-1 overflow-hidden truncate font-semibold text-fg sm:order-none sm:pl-2"
                      style={{ fontSize: px }}
                    >
                      S
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Mobile compression note + small-size guidance */}
            <div className="mt-6 rounded-lg border border-line-subtle bg-subtle/50 p-4">
              <div className="text-xs font-semibold text-fg">Mobile compression & the small sizes</div>
              <p className="mt-1 text-xs leading-5 text-muted">
                Every heading tier sits roughly <strong className="font-semibold text-fg">3px smaller on mobile</strong> than the
                original static sizes (18px → 15px titles, 16px → 13px card headings, and so on). The phones-first pass applied
                across the app. Desktop values at 1024px+ match the original design exactly, so wide screens are unaffected.
              </p>
              <p className="mt-2 text-xs leading-5 text-muted">
                For small UI text, prefer the two dedicated tiers instead of guessing:{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px] text-brand">text-caption</code> (10→13px) for
                helper text and metadata, and <code className="rounded bg-surface px-1 font-mono text-[11px] text-brand">text-chips</code>{' '}
                (10→11px) for chips, pills, tags and badges. Tighter than body copy, still legible on phones.
              </p>
            </div>

            {/* Base layer vs utilities */}
            <div className="mt-6 rounded-lg border border-line-subtle bg-subtle/50 p-4">
              <div className="text-xs font-semibold text-fg">Layer behavior</div>
              <p className="mt-1 text-xs leading-5 text-muted">
                Real <code className="rounded bg-surface px-1 font-mono text-[11px] text-brand">&lt;h1&gt;–&lt;h4&gt;</code> elements pick up
                these sizes automatically from the <code className="rounded bg-surface px-1 font-mono text-[11px]">@layer base</code> rule.
                Any explicit size utility (<code className="rounded bg-surface px-1 font-mono text-[11px]">text-xl</code>,{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">text-h1</code>) always wins. Layer base never overrides it.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-line bg-surface p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted">No utility: base default</div>
                  <h3 className="mt-1 font-semibold text-fg">Section heading</h3>
                </div>
                <div className="rounded-lg border border-line bg-surface p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted">Explicit text-sm wins</div>
                  <h3 className="mt-1 text-sm font-semibold text-fg">Section heading</h3>
                </div>
              </div>
            </div>

            {/* Reference table */}
            <div className="mt-6 overflow-x-auto rounded-lg border border-line-subtle" style={{ maxWidth: '100%' }}>
              <table className="w-full min-w-[300px] text-left text-xs">
                <thead>
                  <tr className="border-b border-line-subtle bg-subtle/60 text-[10px] uppercase tracking-widest text-muted">
                    <th className="px-3 py-2 font-semibold">Utility</th>
                    <th className="px-3 py-2 font-semibold">Use for</th>
                    <th className="px-3 py-2 text-right font-semibold">Mobile → desktop</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {FLUID_TYPE.map(([token, cls, usage, mobilePx, desktopPx]) => (
                    <tr key={token}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono font-medium text-brand">{cls}</td>
                      <td className="px-3 py-2 text-muted">{usage}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fg">
                        {mobilePx}px → {desktopPx}px
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        {/* Fluid spacing scale */}
        <Section
          id="fluid-spacing"
          title="Fluid spacing scale"
          description="Companion to the type scale. Every gap and padding clamp()s between a mobile value (at 360px) and a desktop value (at 1024px). The bars below render each token at its exact computed size for the current slider position."
        >
          <div className="rounded-xl border border-line bg-surface p-5">
            <ViewportSlider id="spacing-viewport" value={viewport} onChange={setViewport} />

            {/* Live bars */}
            <div className="divide-y divide-line-subtle">
              {FLUID_SPACING.map(([token, cls, usage, mobilePx, desktopPx]) => {
                const px = fluidSize(mobilePx, desktopPx, viewport)
                return (
                  <div key={token} className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-3 sm:grid-cols-[120px_1fr_auto]">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-fg">{cls}</div>
                      <div className="text-[11px] text-muted">{usage}</div>
                    </div>
                    <div className="order-2 col-span-2 text-right sm:order-none sm:col-span-1">
                      <span className="text-xs font-bold tabular-nums text-brand">{px}px</span>
                      <span className="ml-1.5 text-[10px] tabular-nums text-muted">
                        {mobilePx}→{desktopPx}
                      </span>
                    </div>
                    <div className="order-1 col-span-1 flex items-center sm:order-none sm:pl-2">
                      <div
                        className="h-4 rounded-sm bg-brand transition-[width] duration-100 ease-out"
                        style={{ width: Math.max(px * 2, 6) }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Prefix note — why fluid- */}
            <div className="mt-6 rounded-lg border border-line-subtle bg-subtle/50 p-4">
              <div className="text-xs font-semibold text-fg">Why the fluid- prefix</div>
              <p className="mt-1 text-xs leading-5 text-muted">
                The tokens are mapped as{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px] text-brand">--spacing-fluid-*</code> on purpose:
                a bare <code className="rounded bg-surface px-1 font-mono text-[11px]">--spacing-md</code> would collide with
                Tailwind's built-in <code className="rounded bg-surface px-1 font-mono text-[11px]">max-w-*</code> container scale and
                silently break every max-width in the app. Each token generates the full spacing family:{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">p-fluid-lg</code>,{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">gap-fluid-lg</code>,{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">mt-fluid-lg</code>,{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">px-fluid-2xs</code>, all sharing the same clamp.
              </p>
            </div>

            {/* Chips guidance — small sizes pairing */}
            <div className="mt-6 rounded-lg border border-line-subtle bg-subtle/50 p-4">
              <div className="text-xs font-semibold text-fg">Chips, pills & tags: the small-size pairing</div>
              <p className="mt-1 text-xs leading-5 text-muted">
                Pair the two tightest spacing steps with the chip type tier for small UI text:{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px] text-brand">sp-2xs</code> (3→7px) for vertical
                padding and <code className="rounded bg-surface px-1 font-mono text-[11px] text-brand">sp-xs</code> (5→9px) for
                horizontal padding, with <code className="rounded bg-surface px-1 font-mono text-[11px] text-brand">text-chips</code>{' '}
                (10→11px) for the label. A typical pill is{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">inline-flex items-center gap-1 rounded-full px-fluid-xs py-fluid-2xs text-chips font-semibold</code>.
                It scales down on phones and breathes on desktop without re-tuning.
              </p>
            </div>

            {/* Reference table */}
            <div className="mt-6 overflow-x-auto rounded-lg border border-line-subtle" style={{ maxWidth: '100%' }}>
              <table className="w-full min-w-[300px] text-left text-xs">
                <thead>
                  <tr className="border-b border-line-subtle bg-subtle/60 text-[10px] uppercase tracking-widest text-muted">
                    <th className="px-3 py-2 font-semibold">Token</th>
                    <th className="px-3 py-2 font-semibold">Utility (p- / gap- / m-…)</th>
                    <th className="px-3 py-2 font-semibold">Use for</th>
                    <th className="px-3 py-2 text-right font-semibold">Mobile → desktop</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {FLUID_SPACING.map(([token, cls, usage, mobilePx, desktopPx]) => (
                    <tr key={token}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono font-medium text-brand">--{token}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-fg">{cls}</td>
                      <td className="px-3 py-2 text-muted">{usage}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fg">
                        {mobilePx}px → {desktopPx}px
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        {/* Fluid radii scale */}
        <Section
          id="fluid-radii"
          title="Fluid radii scale"
          description="Clamp-based border-radius. The same 360→1024px band as type and spacing. Mobile anchors match the original static values, so phones are untouched; corners breathe a little larger on wide screens. Every rounded-* utility in the app now shares these clamps."
        >
          <div className="rounded-xl border border-line bg-surface p-5">
            <ViewportSlider id="radius-viewport" value={viewport} onChange={setViewport} />

            {/* Live corner previews */}
            <div className="divide-y divide-line-subtle">
              {FLUID_RADIUS.map(([token, cls, usage, mobilePx, desktopPx]) => {
                const px = fluidSize(mobilePx, desktopPx, viewport)
                return (
                  <div key={token} className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-3 sm:grid-cols-[130px_1fr_auto]">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-fg">{cls}</div>
                      <div className="text-[11px] text-muted">{usage}</div>
                    </div>
                    <div className="order-2 col-span-2 text-right sm:order-none sm:col-span-1">
                      <span className="text-xs font-bold tabular-nums text-brand">{px}px</span>
                      <span className="ml-1.5 text-[10px] tabular-nums text-muted">
                        {mobilePx}→{desktopPx}
                      </span>
                    </div>
                    <div className="order-1 col-span-1 flex items-center sm:order-none sm:pl-2">
                      <div
                        className="h-11 w-14 border border-line bg-brand-subtle"
                        style={{ borderRadius: px }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Note — how the scale reaches the app */}
            <div className="mt-6 rounded-lg border border-line-subtle bg-subtle/50 p-4">
              <div className="text-xs font-semibold text-fg">How the scale reaches the app</div>
              <p className="mt-1 text-xs leading-5 text-muted">
                The <code className="rounded bg-surface px-1 font-mono text-[11px] text-brand">--radius-*</code> tokens in{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">:root</code> are clamps, and the standard{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">rounded-*</code> utilities are generated from them, so
                buttons, inputs and cards inherit the fluid scale with no per-component changes.{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">rounded-fluid-*</code> is the explicit opt-in form.{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">rounded-full</code> stays a perfect pill at every width.
              </p>
              <p className="mt-2 text-xs leading-5 text-muted">
                As with the type and spacing scales, the bars above show the intended linear interpolation across the band. The
                live clamps resolve to their desktop anchor once the preferred size passes the max, which is how every{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">clamp()</code> in this system behaves.
              </p>
            </div>

            {/* Reference table */}
            <div className="mt-6 overflow-x-auto rounded-lg border border-line-subtle" style={{ maxWidth: '100%' }}>
              <table className="w-full min-w-[300px] text-left text-xs">
                <thead>
                  <tr className="border-b border-line-subtle bg-subtle/60 text-[10px] uppercase tracking-widest text-muted">
                    <th className="px-3 py-2 font-semibold">Utility</th>
                    <th className="px-3 py-2 font-semibold">Use for</th>
                    <th className="px-3 py-2 text-right font-semibold">Mobile → desktop</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {FLUID_RADIUS.map(([token, cls, usage, mobilePx, desktopPx]) => (
                    <tr key={token}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono font-medium text-brand">{cls}</td>
                      <td className="px-3 py-2 text-muted">{usage}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fg">
                        {mobilePx}px → {desktopPx}px
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        {/* Fluid shadows scale */}
        <Section
          id="fluid-shadows"
          title="Fluid shadows scale"
          description="Softer, more lifted shadows at larger viewports. Blur and spread grow across the same 360→1024px band, while phones keep today's crisp, flat depth. The demo cards render the exact interpolated shadow for the current slider position."
        >
          <div className="rounded-xl border border-line bg-surface p-5">
            <ViewportSlider id="shadow-viewport" value={viewport} onChange={setViewport} />

            {/* Live shadow cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FLUID_SHADOW.map(([token, cls, usage, blurM, blurD, yM, yD]) => {
                const shadow = fluidShadow(blurM, blurD, yM, yD, viewport)
                return (
                  <div key={token} className="flex flex-col rounded-lg border border-line bg-surface p-4">
                    <div
                      className="mx-auto h-24 w-full rounded-md bg-surface"
                      style={{ boxShadow: shadow }}
                    />
                    <div className="mt-3 flex items-center justify-between">
                      <div className="text-xs font-semibold text-fg">{cls}</div>
                      <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-[10px] font-bold tabular-nums text-brand-fg">
                        blur {Math.round(Math.max(blurM, Math.min(blurD, blurM + ((blurD - blurM) * (viewport - 360)) / 664)) * 100) / 100}px
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">{usage}</div>
                  </div>
                )
              })}
            </div>

            {/* Note — mobile vs desktop depth */}
            <div className="mt-6 rounded-lg border border-line-subtle bg-subtle/50 p-4">
              <div className="text-xs font-semibold text-fg">Why shadows grow with the viewport</div>
              <p className="mt-1 text-xs leading-5 text-muted">
                Small screens read depth best with tight, flat shadows. The mobile anchors match the original static values.{' '}
                On wide screens, larger blurs and offsets read as soft elevation instead of hard outlines. The standard{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px] text-brand">shadow-*</code> utilities use the same
                clamps, so cards, modals and toasts soften automatically at desktop widths.{' '}
                <code className="rounded bg-surface px-1 font-mono text-[11px]">shadow-fluid-*</code> is the explicit opt-in form.
              </p>
              <p className="mt-2 text-xs leading-5 text-muted">
                The demo cards interpolate the blur/offset linearly across the band, like the type and spacing sections. Real
                clamps cap at their desktop anchors, so nothing ever exceeds the values shown here.
              </p>
            </div>
          </div>
        </Section>

        {/* Buttons */}
        <Section id="buttons" title="Buttons" description="8px radius, weight 500, chromatic focus ring, 220ms motion.">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-5">
            <Button variant="brand" leftIcon={Plus}>Brand</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" leftIcon={Trash2}>Danger</Button>
            <Button variant="brand" loading>Loading</Button>
            <Button variant="secondary" disabled>Disabled</Button>
            <Button variant="brand" size="sm" rightIcon={ArrowRight}>Small</Button>
            <Button variant="brand" size="lg">Large</Button>
          </div>
        </Section>

        {/* Export buttons */}
        <Section
          id="export-buttons"
          title="Export buttons"
          description="The app-wide Excel/PDF export pair — accent pill + download icon for Excel, danger pill + file icon for PDF. One component, one import, used by every admin and rep page. Busy shows a spinner with an optional busyText; disabled dims to 50% opacity."
        >
          {/* Idle */}
          <div className="mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Idle</div>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-5">
            <ExportButtons
              onExcel={() => {}}
              onPdf={() => {}}
            />
            <Button variant="secondary" size="sm" onClick={() => setExportBusy((v) => !v)}>
              {exportBusy ? 'Stop busy' : 'Simulate busy'}
            </Button>
          </div>

          {/* Busy */}
          <div className="mt-6 mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Busy (busyText)</div>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-5">
            <ExportButtons
              onExcel={() => {}}
              onPdf={() => {}}
              excelBusy={exportBusy}
              pdfBusy={exportBusy}
              excelBusyText="Preparing…"
              pdfBusyText="Preparing…"
            />
            <ExportButton format="excel" onClick={() => {}} busy={exportBusy} />
            <ExportButton format="pdf" onClick={() => {}} busy={exportBusy} />
          </div>

          {/* Disabled */}
          <div className="mt-6 mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Disabled</div>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-5">
            <ExportButtons onExcel={() => {}} onPdf={() => {}} excelDisabled pdfDisabled />
            <ExportButton format="excel" onClick={() => {}} disabled />
            <ExportButton format="pdf" onClick={() => {}} disabled />
          </div>

          {/* Usage */}
          <div className="mt-6 rounded-xl border border-line bg-surface p-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Canonical usage</div>
            <pre className="overflow-x-auto rounded-lg bg-subtle p-4 text-[11px] leading-relaxed text-fg"><code>{`import ExportButton, { ExportButtons } from '@/components/ui/ExportButton'

{/* Single button */}
<ExportButton format="excel" onClick={exportExcel} disabled={!orders.length} />
<ExportButton format="pdf" onClick={exportPDF} busy={exportingPdf} busyText="Preparing…" />

{/* The pair */}
<ExportButtons onExcel={exportExcel} onPdf={exportPDF} excelDisabled pdfBusy />`}</code></pre>
          </div>
        </Section>

        {/* Badges */}
        <Section id="badges" title="Badges" description="Borderless pills for statuses: subtle and solid variants.">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-5">
            <Badge tone="neutral" variant="subtle">Neutral</Badge>
            <Badge tone="brand" variant="subtle">Brand</Badge>
            <Badge tone="success" variant="subtle" icon={CheckCircle2}>Delivered</Badge>
            <Badge tone="warning" variant="subtle" icon={AlertTriangle}>Pending</Badge>
            <Badge tone="info" variant="subtle" icon={Info}>Posted</Badge>
            <Badge tone="danger" variant="subtle" icon={XCircle}>Cancelled</Badge>
            <Badge tone="accent" variant="solid">Solid accent</Badge>
            <Badge tone="success" variant="solid">Solid success</Badge>
            <Badge tone="danger" variant="solid">Solid danger</Badge>
          </div>
        </Section>

        {/* Order progress */}
        <Section
          id="order-progress"
          title="Order progress"
          description="The shared order stepper. One generic component (ui/OrderStepper) renders any module's journey from its status metadata; the presets below are what pages import — Exhibition and Ram use Approved, Food uses Posted. Pending marks the current step in brand, completed steps in success, and Cancelled collapses to the danger chip."
        >
          {/* All four states */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { label: 'Pending', node: <ExhibitionOrderStepper status="Pending" /> },
              { label: 'Approved', node: <ExhibitionOrderStepper status="Approved" /> },
              { label: 'Delivered', node: <ExhibitionOrderStepper status="Delivered" /> },
              { label: 'Cancelled', node: <ExhibitionOrderStepper status="Cancelled" /> },
            ].map((row) => (
              <div key={row.label} className="rounded-xl border border-line bg-surface p-5">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{row.label}</div>
                {row.node}
              </div>
            ))}
          </div>

          {/* Module variants */}
          <div className="mt-6 rounded-xl border border-line bg-surface p-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Module presets</div>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div>
                <div className="mb-2 text-chips font-medium text-muted">Exhibition · Pending → Approved → Delivered</div>
                <ExhibitionOrderStepper status="Approved" />
              </div>
              <div>
                <div className="mb-2 text-chips font-medium text-muted">Ram · Pending → Approved → Delivered</div>
                <RamOrderStepper status="Approved" />
              </div>
              <div>
                <div className="mb-2 text-chips font-medium text-muted">Food · Pending → Posted → Delivered</div>
                <FoodOrderStepper status="Posted" />
              </div>
            </div>
          </div>

          {/* Usage */}
          <div className="mt-6 rounded-xl border border-line bg-surface p-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Canonical usage</div>
            <pre className="overflow-x-auto rounded-lg bg-subtle p-4 text-[11px] leading-relaxed text-fg"><code>{`import { ExhibitionOrderStepper, RamOrderStepper, FoodOrderStepper } from '@/components/ui/OrderStepper'

{/* Pages just pass the order status — the preset binds the module's steps */}
<ExhibitionOrderStepper status={order.status} />
<RamOrderStepper status={order.status} />
<FoodOrderStepper status={order.status} />

{/* The generic accepts any meta + steps (kit escape hatch) */}
<OrderStepper status={status} meta={RAM_STATUS_META} steps={APPROVE_STEPS} />`}</code></pre>
          </div>
        </Section>

        {/* Cycle countdown */}
        <Section
          id="cycle-countdown"
          title="Cycle countdown"
          description={'The shared season closing-date chip (ui/CycleCountdown). One component renders the identical \'closes in N days\' treatment on the My Coop module cards, the rep access cards and the admin dashboard module switcher — the exact close date lives in the hover tooltip. prefix adds the cycle name; variant="bare" drops the pill so it can sit inside tabs and other pills.'}
        >
          {/* States */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Days out', node: <CycleCountdown endsAt={inDays(12)} /> },
              { label: 'With cycle name (prefix)', node: <CycleCountdown endsAt={inDays(12)} prefix="Food Cycle 2026" /> },
              { label: 'Closes tomorrow', node: <CycleCountdown endsAt={inDays(1)} /> },
              { label: 'Closes today', node: <CycleCountdown endsAt={inDays(0)} /> },
            ].map((row) => (
              <div key={row.label} className="rounded-xl border border-line bg-surface p-5">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{row.label}</div>
                {row.node}
              </div>
            ))}
          </div>

          {/* Bare variant */}
          <div className="mt-6 rounded-xl border border-line bg-surface p-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Bare variant (inside a pill)</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-warning-bg px-1.5 py-0.5 text-[10px] font-semibold leading-none text-warning-fg">
                <CycleCountdown endsAt={inDays(12)} variant="bare" />
              </span>
              <span className="inline-flex items-center rounded-full bg-brand px-3 py-1.5 text-chips font-medium text-on-accent">
                <CycleCountdown endsAt={inDays(12)} variant="bare" />
              </span>
            </div>
          </div>

          {/* Usage */}
          <div className="mt-6 rounded-xl border border-line bg-surface p-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Canonical usage</div>
            <pre className="overflow-x-auto rounded-lg bg-subtle p-4 text-[11px] leading-relaxed text-fg"><code>{`import CycleCountdown from '@/components/ui/CycleCountdown'

{/* My Coop module cards — Food passes its own tooltip noun */}
<CycleCountdown endsAt={foodCycle.ends_at} noun="Cycle" />
<CycleCountdown endsAt={ramCycle.ends_at} />
<CycleCountdown endsAt={exhibitionCycle.ends_at} />

{/* Rep access cards — cycle name shown before the countdown */}
<CycleCountdown endsAt={cycle.ends_at} prefix={cycle.name} />

{/* Admin dashboard switcher — transparent, inherits the tab pill */}
<CycleCountdown endsAt={activeCycle.ends_at} variant="bare" />`}</code></pre>
          </div>
        </Section>

        {/* Stat cards */}
        <Section id="stats" title="Stat cards" description="The KPI building blocks for the admin dashboard.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={ClipboardList}
              title="Total orders"
              value="₦4.8M"
              delta="+12.5%"
              trend="up"
              sparkline={[12, 18, 14, 22, 19, 28, 25, 34, 31, 40]}
            />
            <StatCard
              icon={Package}
              title="Pending"
              value="342"
              delta="+3.1%"
              trend="up"
              sparkline={[10, 12, 11, 15, 14, 17, 16, 19]}
            />
            <StatCard
              icon={Truck}
              title="Delivered"
              value="2,180"
              delta="-1.2%"
              trend="down"
              sparkline={[30, 28, 29, 25, 26, 22, 23, 20]}
            />
            <StatCard
              icon={PackageX}
              title="Low stock"
              value="7"
              delta="2 alerts"
              trend="flat"
              featured
              sparkline={[4, 5, 4, 6, 5, 7, 6, 7]}
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard loading icon={Users} title="Loading" value="" />
            <StatCard loading icon={Banknote} title="Loading" value="" />
            <StatCard loading icon={Activity} title="Loading" value="" />
            <StatCard loading icon={ShoppingCart} title="Loading" value="" />
          </div>
        </Section>

        {/* Charts */}
        <Section
          id="charts"
          title="Charts"
          description="Theme-aware bar and line charts built on the --chart-* tokens. They flip automatically between light and dark. Stacked bars take { label, [seriesKey]: value } rows; the line chart takes { label, value } rows. Hover for tooltips; empty states fall back to a muted panel."
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <Card.Header>
                <Card.Title>Bar chart: orders by branch</Card.Title>
                <Card.Description>Stacked series, animated grow-in, hover tooltip with totals.</Card.Description>
              </Card.Header>
              <Card.Body>
                <BarChart
                  height={220}
                  data={[
                    { label: 'Lagos HQ', Pending: 12, Posted: 28, Delivered: 34 },
                    { label: 'Abuja', Pending: 8, Posted: 19, Delivered: 22 },
                    { label: 'Ibadan', Pending: 6, Posted: 14, Delivered: 17 },
                    { label: 'PH', Pending: 4, Posted: 9, Delivered: 12 },
                  ]}
                  series={[
                    { key: 'Pending', label: 'Pending', color: 'var(--warning-solid)' },
                    { key: 'Posted', label: 'Posted', color: 'var(--info-solid)' },
                    { key: 'Delivered', label: 'Delivered', color: 'var(--success-solid)' },
                  ]}
                  formatValue={(v) => `${v} orders`}
                  empty="No branch data yet"
                />
              </Card.Body>
            </Card>

            <Card>
              <Card.Header>
                <Card.Title>Line chart: cycle value trend</Card.Title>
                <Card.Description>Smooth area line, hover crosshair and value tooltip.</Card.Description>
              </Card.Header>
              <Card.Body>
                <LineChart
                  height={220}
                  data={[
                    { label: 'Mon', value: 12 },
                    { label: 'Tue', value: 18 },
                    { label: 'Wed', value: 14 },
                    { label: 'Thu', value: 24 },
                    { label: 'Fri', value: 21 },
                    { label: 'Sat', value: 30 },
                    { label: 'Sun', value: 26 },
                  ]}
                  formatValue={(v) => `${v} orders`}
                  empty="No trend data yet"
                />
              </Card.Body>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="bg-accent-subtle">
              <Card.Header>
                <Card.Title>Chart tokens</Card.Title>
                <Card.Description>--chart-1…5 flip between light and dark; series colors can be any semantic token.</Card.Description>
              </Card.Header>
              <Card.Body>
                <div className="flex flex-wrap gap-3">
                  {['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'].map((c, i) => (
                    <span key={c} className="inline-flex items-center gap-1.5 text-chips text-muted">
                      <span className="h-3 w-3 rounded-md border border-line" style={{ background: c }} />
                      chart-{i + 1}
                    </span>
                  ))}
                </div>
              </Card.Body>
            </Card>

            <Card>
              <Card.Header>
                <Card.Title>Empty states</Card.Title>
                <Card.Description>Pass empty to render a muted panel instead of a broken axis.</Card.Description>
              </Card.Header>
              <Card.Body>
                <BarChart height={140} data={[]} series={[]} empty="No data to chart yet" />
              </Card.Body>
            </Card>
          </div>
        </Section>

        {/* Cards */}
        <Section id="cards" title="Cards" description="Surface cards with header, description and actions.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <Card.Header>
                <Card.Title>Branch summary</Card.Title>
                <Card.Description>Orders consolidated by delivery branch.</Card.Description>
              </Card.Header>
              <Card.Body>
                <div className="space-y-2">
                  {['Lagos HQ · 1,204', 'Abuja · 876', 'Ibadan · 542'].map((row) => (
                    <div key={row} className="flex items-center justify-between rounded-lg bg-subtle px-3 py-2 text-sm">
                      <span className="text-fg">{row.split(' · ')[0]}</span>
                      <span className="font-medium text-fg">{row.split(' · ')[1]}</span>
                    </div>
                  ))}
                </div>
              </Card.Body>
              <Card.Actions className="justify-between">
                <Badge tone="brand" variant="subtle">This cycle</Badge>
                <Button variant="ghost" size="sm" rightIcon={ArrowRight}>View report</Button>
              </Card.Actions>
            </Card>

            <Card interactive onClick={() => toast.info('Interactive card clicked.')}>
              <Card.Header>
                <Card.Title>Interactive card</Card.Title>
                <Card.Description>Hover raises the border and shadow, like Sakani's interactive surface.</Card.Description>
              </Card.Header>
              <Card.Actions>
                <Button variant="secondary" size="sm">Try me</Button>
              </Card.Actions>
            </Card>

            <Card className="bg-accent-subtle">
              <Card.Header>
                <Card.Title>Featured surface</Card.Title>
                <Card.Description>Accent-subtle background for emphasis cards.</Card.Description>
              </Card.Header>
              <Card.Body>
                <p className="text-sm text-fg">
                  Used for featured stats, alerts and highlighted panels without breaking the token system.
                </p>
              </Card.Body>
            </Card>
          </div>
        </Section>

        {/* Forms */}
        <Section id="forms" title="Form controls" description="Inputs, selects and textareas: brand focus ring in both themes.">
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="demo-item">Item name</Label>
              <Input id="demo-item" placeholder="e.g. 50kg Rice" />
            </div>
            <div>
              <Label htmlFor="demo-cat">Category</Label>
              <Select id="demo-cat" placeholder="Choose a category" defaultValue="">
                <option value="grains">Grains</option>
                <option value="oils">Oils & fats</option>
                <option value="proteins">Proteins</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="demo-qty">Quantity</Label>
              <Input id="demo-qty" type="number" defaultValue="25" />
            </div>
            <div>
              <Label htmlFor="demo-branch">Branch</Label>
              <Select id="demo-branch" defaultValue="lagos">
                <option value="lagos">Lagos HQ</option>
                <option value="abuja">Abuja</option>
                <option value="ibadan">Ibadan</option>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="demo-notes">Notes</Label>
              <Textarea id="demo-notes" placeholder="Delivery instructions, remarks…" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="demo-invalid">Invalid state</Label>
              <Input id="demo-invalid" invalid defaultValue="Not a valid amount" aria-invalid="true" />
            </div>
          </div>
        </Section>

        {/* Tabs */}
        <Section id="tabs" title="Tabs" description="Brand underline for the active tab.">
          <div className="overflow-x-auto rounded-xl border border-line bg-surface p-5">
            <Tabs
              tabs={[
                { value: 'pending', label: 'Pending', icon: Package },
                { value: 'posted', label: 'Posted', icon: ClipboardList },
                { value: 'delivered', label: 'Delivered', icon: Truck },
                { value: 'cancelled', label: 'Cancelled', icon: XCircle },
              ]}
              active={tab}
              onChange={setTab}
            />
            <div className="mt-4 rounded-lg bg-subtle px-4 py-6 text-center text-sm text-muted">
              Showing the <span className="font-medium text-fg">{tab}</span> tab content area.
            </div>
          </div>
        </Section>

        {/* Table */}
        <Section id="table" title="Data table" description="Subtle borders, hover rows, status badges.">
          <div className="overflow-x-auto rounded-xl border border-line bg-surface p-2 sm:p-3">
            <Table>
              <THead>
                <TR className="border-0">
                  <TH>Order</TH>
                  <TH>Member</TH>
                  <TH>Branch</TH>
                  <TH>Amount</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {sampleOrders.map((o) => (
                  <TR key={o.id}>
                    <TD className="font-medium">{o.id}</TD>
                    <TD>{o.member}</TD>
                    <TD className="text-muted">{o.branch}</TD>
                    <TD className="font-medium">{o.amount}</TD>
                    <TD>
                      <Badge tone={o.tone} variant="subtle">
                        {o.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Section>

        {/* Modal, Empty, Skeleton, Toasts */}
        <Section id="interactions" title="Modal · Empty state · Skeleton · Toasts">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-5">
            <Button variant="accent" onClick={() => setModalOpen(true)}>
              Open modal
            </Button>
            <Button variant="secondary" onClick={() => toast.success('Order posted successfully.')}>
              Success toast
            </Button>
            <Button variant="secondary" onClick={() => toast.error('Failed to save changes.')}>
              Error toast
            </Button>
            <Button variant="secondary" onClick={() => toast.warning('Low stock: 50kg Rice.')}>
              Warning toast
            </Button>
            <Button variant="secondary" onClick={() => toast.info('Imported 240 members.')}>
              Info toast
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface">
              <EmptyState
                icon={PackageX}
                title="No pending orders"
                description="There are no orders waiting for approval in this cycle. New member orders will appear here."
              >
                <Button size="sm" variant="secondary">Refresh</Button>
              </EmptyState>
            </div>
            <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
              <div className="flex items-center gap-3">
                <Skeleton rounded="full" className="h-9 w-9" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3.5 w-1/3" />
                </div>
              </div>
              <Skeleton className="h-24 w-full" />
              <div className="flex justify-end gap-2">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-28" />
              </div>
            </div>
          </div>
        </Section>

        {/* Footer nav */}
        <footer className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-line-subtle py-6 sm:flex-row">
          <div className="text-xs text-muted">
            Coop Sakani v1 · light/dark tokens · Geist · Lucide · tokens in globals.css
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button size="sm" variant="brand" onClick={() => toast.success('Direction approved. Ship it.')}>
              Looks great
            </Button>
          </div>
        </footer>
      </div>

      {/* Modal demo */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Approve bulk posting?"
        description="This will post 12 pending orders to their branches."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => { setModalOpen(false); toast.success('12 orders posted.') }}>
              Post orders
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-fg">
          <p>Posted orders move to the <span className="font-medium">Posted</span> queue and are no longer editable by members.</p>
          <p className="text-muted">This action can be rolled back from the posted screen if needed.</p>
        </div>
      </Modal>
    </div>
  )
}
