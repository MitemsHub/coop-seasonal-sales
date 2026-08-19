'use client'

// app/components/ui/Table.jsx
// Sakani-style table primitives — semantic markup, subtle borders, hover rows.
import { forwardRef } from 'react'

export const Table = forwardRef(function Table({ className = '', children, ...props }, ref) {
  return (
    <div className="w-full overflow-x-auto">
      <table ref={ref} className={['w-full border-collapse text-sm', className].join(' ')} {...props}>
        {children}
      </table>
    </div>
  )
})

export const THead = forwardRef(function THead({ className = '', children, ...props }, ref) {
  return (
    <thead ref={ref} className={className} {...props}>
      {children}
    </thead>
  )
})

export const TBody = forwardRef(function TBody({ className = '', children, ...props }, ref) {
  return (
    <tbody ref={ref} className={className} {...props}>
      {children}
    </tbody>
  )
})

export const TR = forwardRef(function TR({ className = '', children, ...props }, ref) {
  return (
    <tr
      ref={ref}
      className={[
        'border-b border-line-subtle transition-colors duration-150 last:border-0 hover:bg-subtle/60',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </tr>
  )
})

export const TH = forwardRef(function TH({ className = '', children, ...props }, ref) {
  return (
    <th
      ref={ref}
      scope="col"
      className={[
        'whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted',
        'first:pl-0 last:pr-0',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </th>
  )
})

export const TD = forwardRef(function TD({ className = '', children, ...props }, ref) {
  return (
    <td
      ref={ref}
      className={['px-3 py-3 align-middle text-fg first:pl-0 last:pr-0', className].join(' ')}
      {...props}
    >
      {children}
    </td>
  )
})

export default Table
