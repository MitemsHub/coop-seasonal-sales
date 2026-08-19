'use client'

// app/components/ui/Tabs.jsx
// Sakani tabs — underline style with brand active state.
export default function Tabs({ tabs = [], active, onChange, className = '', size = 'md' }) {
  return (
    <div
      role="tablist"
      className={[
        'flex items-center gap-1 border-b border-line-subtle',
        size === 'lg' ? 'gap-2' : 'gap-1',
        className,
      ].join(' ')}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.value
        const TabIcon = tab.icon
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange?.(tab.value)}
            className={[
              'relative inline-flex items-center gap-1.5 rounded-t-md px-3 pb-2 pt-2.5 text-sm font-medium',
              'transition-colors duration-200 ease-sakani focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              isActive ? 'text-fg' : 'text-muted hover:text-fg',
            ].join(' ')}
          >
            {TabIcon && <TabIcon className="h-4 w-4" strokeWidth={2} />}
            {tab.label}
            {isActive && (
              <span className="absolute inset-x-1 bottom-[-1px] h-0.5 rounded-full bg-brand" aria-hidden="true" />
            )}
          </button>
        )
      })}
    </div>
  )
}
