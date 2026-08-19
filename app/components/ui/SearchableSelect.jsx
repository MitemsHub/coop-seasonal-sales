'use client'

// app/components/ui/SearchableSelect.jsx
// Searchable combobox for long option lists (e.g. 100+ exhibition vendor
// hubs) where a native <select> or chip wall stops being usable. Mirrors the
// ui/Select styling so it looks like the rest of the form controls:
//   - click to open, type to filter (name or value substring, case-insensitive)
//   - keyboard: ↑/↓ move, Enter selects, Escape closes
//   - click outside / blur closes
//
// Props:
//   options  — [{ value, label }]
//   value    — selected value (string) or null/'' for the "all" option
//   onSelect — (value: string | null) => void
//   allLabel — label of the reset option, e.g. "All vendors (100)"
//   ariaLabel, className
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

export default function SearchableSelect({
  options = [],
  value = null,
  onSelect,
  allLabel = 'All',
  ariaLabel = 'Select an option',
  className = '',
  placeholder = 'Search…',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  // Selected label for the trigger button.
  const selected = useMemo(() => options.find((o) => o.value === value) || null, [options, value])

  // Filtered options — the "all" reset always stays at the top so members can
  // clear the filter even while typing.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = q
      ? options.filter(
          (o) => o.label.toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q)
        )
      : options
    return [{ value: '', label: allLabel }, ...matches]
  }, [options, query, allLabel])

  useEffect(() => {
    if (!open) return
    setHighlight(0)
    setQuery('')
    // Focus the search box as soon as the panel opens.
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  // Keep the highlighted option visible while navigating with the keyboard.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector(`[data-index="${highlight}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight, open])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (opt) => {
    onSelect(opt.value ? String(opt.value) : null)
    setOpen(false)
  }

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[highlight]) choose(filtered[highlight])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={[
          'flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface pl-3 pr-2 text-sm text-fg',
          'transition-[border-color,box-shadow,background-color] duration-200 ease-sakani',
          'hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
          'disabled:cursor-not-allowed disabled:opacity-60',
        ].join(' ')}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-subtext" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate text-left">
          {selected ? selected.label : allLabel}
        </span>
        <ChevronDown
          className={['h-4 w-4 shrink-0 text-subtext transition-transform duration-200 ease-sakani', open ? 'rotate-180' : ''].join(' ')}
        />
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-line bg-surface shadow-lg shadow-black/5">
          <div className="relative border-b border-line">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtext" strokeWidth={2} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-label="Search vendors"
              className="h-9 w-full bg-transparent pl-8 pr-8 text-sm text-fg placeholder:text-subtext focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-subtext hover:bg-subtle hover:text-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <ul
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-56 overflow-y-auto py-1"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2.5 text-sm text-muted">No vendors match “{query}”.</li>
            )}
            {filtered.map((opt, i) => {
              const isActive = opt.value === value || (opt.value === '' && value == null)
              return (
                <li key={opt.value || '__all__'} role="option" aria-selected={isActive} data-index={i}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => choose(opt)}
                    className={[
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                      i === highlight ? 'bg-subtle text-fg' : 'text-fg',
                    ].join(' ')}
                  >
                    <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                    {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2.5} />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
