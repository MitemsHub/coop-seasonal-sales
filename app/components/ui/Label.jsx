'use client'

// app/components/ui/Label.jsx
export default function Label({ htmlFor, className = '', children, ...props }) {
  return (
    <label
      htmlFor={htmlFor}
      className={['mb-1 block text-sm font-medium text-fg', className].join(' ')}
      {...props}
    >
      {children}
    </label>
  )
}
