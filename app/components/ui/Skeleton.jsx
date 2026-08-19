'use client'

// app/components/ui/Skeleton.jsx
// Static class map so Tailwind's scanner can see the full class names.
const ROUNDED = {
  none: '',
  xs: 'rounded-xs',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  full: 'rounded-full',
}

export default function Skeleton({ className = '', rounded = 'md', ...props }) {
  return (
    <div
      aria-hidden="true"
      className={['sakani-skeleton', ROUNDED[rounded] || 'rounded-md', className].join(' ')}
      {...props}
    />
  )
}
