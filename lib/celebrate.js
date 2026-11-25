// lib/celebrate.js
// A single, tiny celebration for the first item a member adds to the
// exhibition cart in a session.
//
// Kept out of React on purpose: every buying surface (shop, catalog, vendor
// hub, deals rail) can call it without threading state or a provider through
// the tree, and the burst is pure DOM that removes itself.
//
// Rules: once per session, never for a member who asked for reduced motion,
// and never blocks or intercepts a click (the host is pointer-events: none).
const FLAG = 'exhibition-celebrated'
const COLORS = ['#1d6746', '#479d73', '#12b76a', '#b45309', '#f2c26a', '#facc15']
const BITS = 18

let fired = false

export function celebrateFirstAdd() {
  if (fired) return
  fired = true
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  try {
    if (window.sessionStorage.getItem(FLAG)) return
    window.sessionStorage.setItem(FLAG, '1')
  } catch {
    // Private mode with storage blocked — fall through, still celebrate once.
  }

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  const host = document.createElement('div')
  host.className = 'confetti-host'
  host.setAttribute('aria-hidden', 'true')

  for (let i = 0; i < BITS; i += 1) {
    const bit = document.createElement('span')
    bit.className = 'confetti-bit'
    // A fan: bits spread left/right and rise, rather than raining over the page.
    const spread = (i / (BITS - 1)) * 2 - 1
    bit.style.background = COLORS[i % COLORS.length]
    bit.style.setProperty('--tx', `${Math.round(spread * 170 + (Math.random() * 24 - 12))}px`)
    bit.style.setProperty('--ty', `${Math.round(-140 - Math.random() * 150)}px`)
    bit.style.setProperty('--rot', `${Math.round(spread * 260 + (Math.random() * 90 - 45))}deg`)
    bit.style.setProperty('--delay', `${Math.round(Math.random() * 90)}ms`)
    host.appendChild(bit)
  }

  document.body.appendChild(host)
  window.setTimeout(() => host.remove(), 1400)
}
