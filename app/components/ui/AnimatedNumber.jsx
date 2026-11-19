'use client'

// app/components/ui/AnimatedNumber.jsx
// Counts a displayed value from its previous number to its new one (~600ms,
// ease-out), so a stat card or cart total visibly moves when fresh data lands
// instead of silently swapping text.
//
// Takes a number or an already-formatted string ("₦1,234,500", "12 orders"):
// the first numeric run is animated and the prefix/suffix are preserved, so
// callers keep owning their money formatting.
//
// The text is plain DOM text (no aria plumbing), and users with
// prefers-reduced-motion get the final value immediately.

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

const DURATION = 600

// Split "₦1,234.50 incl." → { prefix: '₦', number: 1234.5, suffix: ' incl.', decimals: 2 }
function splitValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return { prefix: '', number: value, suffix: '', decimals: Number.isInteger(value) ? 0 : 2 }
  }
  const str = String(value ?? '')
  const match = str.match(/-?\d[\d,]*(?:\.\d+)?/)
  if (!match) return null
  const number = Number(match[0].replace(/,/g, ''))
  if (!Number.isFinite(number)) return null
  return {
    prefix: str.slice(0, match.index),
    number,
    suffix: str.slice(match.index + match[0].length),
    decimals: match[0].includes('.') ? match[0].split('.')[1].length : 0,
  }
}

function format(parts, override) {
  if (!parts) return ''
  const body = (override === undefined ? parts.number : override).toLocaleString(undefined, {
    minimumFractionDigits: parts.decimals,
    maximumFractionDigits: parts.decimals,
  })
  return `${parts.prefix}${body}${parts.suffix}`
}

export default function AnimatedNumber({ value, className = '' }) {
  const parts = splitValue(value)
  const final = format(parts) || String(value ?? '')
  const reduce = useReducedMotion()
  const [text, setText] = useState(final)
  // The first appearance counts up from zero; the server HTML already carries
  // the final value, so hydration matches and only the first frame differs.
  const fromRef = useRef(parts ? 0 : null)

  useEffect(() => {
    const next = splitValue(value)
    const finalText = format(next) || String(value ?? '')
    const from = fromRef.current
    fromRef.current = next ? next.number : null

    if (!next || reduce || from === null || from === next.number) {
      setText(finalText)
      return
    }

    const to = next.number
    const startedAt = performance.now()
    let frame = 0
    // Safety net for dropped frames (throttled or hidden tab): land on the
    // final value instead of leaving a half-counted number on screen.
    const settle = setTimeout(() => {
      cancelAnimationFrame(frame)
      setText(finalText)
    }, DURATION + 80)

    const tick = (now) => {
      // rAF reports the frame's origin, which can predate `startedAt`; clamping
      // keeps progress inside 0…1 instead of easing to a negative number.
      const progress = Math.max(0, Math.min(1, (now - startedAt) / DURATION))
      const eased = 1 - Math.pow(1 - progress, 3)
      setText(format(next, from + (to - from) * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
      else clearTimeout(settle)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settle)
    }
  }, [value, reduce])

  return <span className={className}>{text}</span>
}
