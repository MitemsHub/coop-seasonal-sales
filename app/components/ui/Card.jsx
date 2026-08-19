'use client'

// app/components/ui/Card.jsx
// Sakani card — bg/surface, 1px border, radius-xl (16px), padding 20, gap 16.
import { forwardRef } from 'react'

const Card = forwardRef(function Card(
  { interactive = false, className = '', children, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={[
        'flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-xs',
        'transition-[border-color,box-shadow,background-color] duration-200 ease-sakani',
        interactive && 'cursor-pointer hover:border-line-strong hover:shadow-md',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </div>
  )
})

function CardHeader({ className = '', children, ...props }) {
  return (
    <div className={['flex flex-col gap-1', className].join(' ')} {...props}>
      {children}
    </div>
  )
}

function CardTitle({ className = '', children, ...props }) {
  return (
    <h3 className={['m-0 text-base font-semibold leading-6 text-fg', className].join(' ')} {...props}>
      {children}
    </h3>
  )
}

function CardDescription({ className = '', children, ...props }) {
  return (
    <p className={['m-0 text-sm leading-5 text-muted', className].join(' ')} {...props}>
      {children}
    </p>
  )
}

function CardBody({ className = '', children, ...props }) {
  return (
    <div className={['text-sm text-fg', className].join(' ')} {...props}>
      {children}
    </div>
  )
}

function CardActions({ className = '', children, ...props }) {
  return (
    <div className={['flex items-center gap-2', className].join(' ')} {...props}>
      {children}
    </div>
  )
}

Card.Header = CardHeader
Card.Title = CardTitle
Card.Description = CardDescription
Card.Body = CardBody
Card.Actions = CardActions

export default Card
