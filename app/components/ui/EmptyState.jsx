'use client'

// app/components/ui/EmptyState.jsx
export default function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className = '',
}) {
  return (
    <div className={['flex flex-col items-center justify-center px-6 py-12 text-center', className].join(' ')}>
      {Icon && (
        <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-subtle">
          <Icon className="h-6 w-6 text-brand" strokeWidth={1.8} />
        </span>
      )}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}
