'use client'

// app/components/ui/Button.jsx
// Sakani-style button — 8px radius, weight 500, chromatic focus ring, 220ms transitions.
import { forwardRef } from 'react'
import Spinner from './Spinner'

const VARIANTS = {
  // text-on-accent inverts per theme (white on light fills, near-black on dark fills)
  // so solid buttons keep AA contrast in both modes (Mitems 06/12).
  brand: 'bg-brand text-on-accent hover:bg-brand-hover active:bg-brand-active shadow-xs',
  accent: 'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active shadow-xs',
  secondary:
    'bg-surface text-fg border border-line hover:bg-subtle hover:border-line-strong shadow-xs',
  outline: 'bg-transparent text-brand border border-brand hover:bg-brand-subtle',
  ghost: 'bg-transparent text-fg hover:bg-subtle',
  // danger-fg = the 700-step fill; white on #b42318 ≈ 5.5:1 (the 500 solid fails AA)
  danger: 'bg-danger-fg text-on-accent hover:brightness-110 active:brightness-95 shadow-xs',
}

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-10 px-5 text-sm gap-2',
}

const Button = forwardRef(function Button(
  {
    type = 'button',
    variant = 'brand',
    size = 'md',
    loading = false,
    disabled = false,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    className = '',
    children,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={[
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-medium',
        'transition-[background-color,border-color,box-shadow,color,opacity] duration-200 ease-sakani',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        'disabled:pointer-events-none disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(' ')}
      {...props}
    >
      {loading ? (
        <Spinner size={size === 'lg' ? 18 : size === 'sm' ? 13 : 15} className="text-current" />
      ) : (
        LeftIcon && <LeftIcon className={size === 'lg' ? 'h-4.5 w-4.5' : 'h-4 w-4'} strokeWidth={2} />
      )}
      {children}
      {!loading && RightIcon && (
        <RightIcon className={size === 'lg' ? 'h-4.5 w-4.5' : 'h-4 w-4'} strokeWidth={2} />
      )}
    </button>
  )
})

export default Button
