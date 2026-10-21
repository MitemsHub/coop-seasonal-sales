'use client'

// app/components/ui/Reveal.jsx
// Small motion helper — reveals sections gently on scroll.
// Shared by the landing page and the member portal so both pages animate
// with the same easing and timing.
//
// Motion profile (2026-10): a touch more pronounced than before — blur-in &
// a larger y offset over ~0.8s — so the reveal is clearly visible at a glance,
// while still soft enough to never shout. Re-triggers EVERY time a section
// re-enters the viewport (once:false) instead of animating only on first load,
// so scrolling back up re-plays the entrance on each visit.

import { motion, useReducedMotion } from 'framer-motion'

const EASE = [0.21, 0.47, 0.32, 0.98]

export default function Reveal({ children, delay = 0, className = '' }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 26, filter: 'blur(6px)' }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: false, margin: '-60px' }}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}
