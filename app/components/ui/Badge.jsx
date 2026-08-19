'use client'

// app/components/ui/Badge.jsx
// Sakani badge — borderless pill, 12px/500, padding 2/8. Subtle + solid × all tones.
import { forwardRef } from 'react'

const TONES = {
  neutral: {
    subtle: 'bg-subtle text-muted',
    solid: 'bg-inverse text-on-inverse',
  },
  brand: {
    subtle: 'bg-brand-subtle text-brand-fg',
    solid: 'bg-brand text-on-accent',
  },
  accent: {
    subtle: 'bg-accent-subtle text-fg',
    solid: 'bg-accent text-accent-fg',
  },
  // Solid status tones use the dark 700-step fill (fg token) with inverted text,
  // so they pass WCAG AA in light mode (white on #027a48 ≈ 5.9:1) and dark mode
  // (dark text on the light 300-step fg ≈ 6:1). The 500-level solids fail white text.
  success: {
    subtle: 'bg-success-bg text-success-fg',
    solid: 'bg-success-fg text-on-accent',
  },
  warning: {
    subtle: 'bg-warning-bg text-warning-fg',
    solid: 'bg-warning-fg text-on-accent',
  },
  danger: {
    subtle: 'bg-danger-bg text-danger-fg',
    solid: 'bg-danger-fg text-on-accent',
  },
  info: {
    subtle: 'bg-info-bg text-info-fg',
    solid: 'bg-info-fg text-on-accent',
  },
}

const Badge = forwardRef(function Badge(
  { tone = 'neutral', variant = 'subtle', icon: Icon, className = '', children, ...props },
  ref
) {
  return (
    <span
      ref={ref}
      className={[
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium leading-4',
        TONES[tone]?.[variant] || TONES.neutral.subtle,
        className,
      ].join(' ')}
      {...props}
    >
      {Icon && <Icon className="h-3 w-3" strokeWidth={2.2} />}
      <span>{children}</span>
    </span>
  )
})

export default Badge
