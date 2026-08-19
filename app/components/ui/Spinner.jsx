'use client'

// app/components/ui/Spinner.jsx
export default function Spinner({ size = 16, className = '', strokeWidth = 2.5 }) {
  return (
    <svg
      className={['animate-spin', className].join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth={strokeWidth} />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  )
}
