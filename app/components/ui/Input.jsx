'use client'

// app/components/ui/Input.jsx
import { forwardRef } from 'react'

const baseField =
  'w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-subtext ' +
  'transition-[border-color,box-shadow,background-color] duration-200 ease-sakani ' +
  'hover:border-line-strong focus:border-brand focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

const Input = forwardRef(function Input({ className = '', invalid = false, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={[
        baseField,
        'h-9',
        invalid && 'border-danger focus:border-danger',
        className,
      ].join(' ')}
      {...props}
    />
  )
})

const Textarea = forwardRef(function Textarea({ className = '', invalid = false, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={[
        baseField,
        'min-h-[84px] py-2',
        invalid && 'border-danger focus:border-danger',
        className,
      ].join(' ')}
      {...props}
    />
  )
})

export { Input, Textarea }
export default Input
