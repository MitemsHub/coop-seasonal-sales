'use client'

// app/components/ui/Select.jsx
import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'

const Select = forwardRef(function Select(
  { className = '', children, placeholder, ...props },
  ref
) {
  return (
    <div className={['relative', className].join(' ')}>
      <select
        ref={ref}
        className={[
          'h-9 w-full appearance-none rounded-lg border border-line bg-surface pl-3 pr-9 text-sm text-fg',
          'transition-[border-color,box-shadow,background-color] duration-200 ease-sakani',
          'hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'placeholder:text-subtext',
        ].join(' ')}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" />
    </div>
  )
})

export default Select
