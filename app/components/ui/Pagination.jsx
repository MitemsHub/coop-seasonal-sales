'use client'

// app/components/ui/Pagination.jsx
// One pager for every list long enough to need one.
//
// The old footers only had Prev/Next and a "Page 7 of 60" label, so the last
// page of a long queue was unreachable without dozens of clicks — and approving
// on page 7 dropped the admin back on page 1. This keeps the whole range
// reachable (first, last and a window of numbers around the current page, which
// slides as you move) and gives every list the same controls in the same order.
//
// Nothing here holds state: page/pageCount come from the caller, because half
// these lists are paged on the server and half are sliced in the browser.
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

// A window of page numbers around the current one, with gaps collapsed: the
// first and last page are always there, so both ends are one click away.
function pageList(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const wanted = new Set([1, pageCount, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((p) => wanted.add(p))
  if (page >= pageCount - 2) [pageCount - 1, pageCount - 2, pageCount - 3].forEach((p) => wanted.add(p))
  const pages = [...wanted].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b)
  const out = []
  let previous = 0
  for (const p of pages) {
    if (previous && p - previous > 1) out.push(`gap-${p}`)
    out.push(p)
    previous = p
  }
  return out
}

const iconButton =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-fg transition-colors duration-150 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-40'

export default function Pagination({
  page,
  pageCount,
  pageSize,
  pageSizeOptions = [25, 50, 100],
  totalItems = 0,
  itemLabel = 'items',
  onPageChange,
  onPageSizeChange,
  showRange = true,
  disabled = false,
  // Set when the pager sits inside a toolbar that already draws its own frame.
  flush = false,
  className = '',
}) {
  const safePageCount = Math.max(1, Number(pageCount) || 1)
  const current = Math.min(Math.max(1, Number(page) || 1), safePageCount)
  const go = (next) => {
    const target = Math.min(Math.max(1, next), safePageCount)
    if (target === current || disabled) return
    onPageChange?.(target)
  }
  const blocks = pageList(current, safePageCount)
  const first = totalItems > 0 && pageSize ? (current - 1) * pageSize + 1 : 0
  const last = totalItems > 0 && pageSize ? Math.min(current * pageSize, totalItems) : 0

  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
        flush ? '' : 'border-t border-line px-4 py-3'
      } ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {showRange && totalItems > 0 && (
          <p className="text-xs text-muted">
            Showing <span className="font-medium text-fg tabular-nums">{first.toLocaleString()}</span>–
            <span className="font-medium text-fg tabular-nums">{last.toLocaleString()}</span> of{' '}
            <span className="font-medium text-fg tabular-nums">{Number(totalItems).toLocaleString()}</span> {itemLabel}
          </p>
        )}
        {onPageSizeChange && (
          <label className="flex items-center gap-2 text-xs text-muted">
            Rows
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              disabled={disabled}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg focus:border-brand focus:outline-none disabled:opacity-50"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <nav className="flex flex-wrap items-center gap-1.5" aria-label="Pagination">
        <button
          type="button"
          onClick={() => go(1)}
          disabled={disabled || current <= 1}
          className={iconButton}
          aria-label="First page"
          title="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => go(current - 1)}
          disabled={disabled || current <= 1}
          className={iconButton}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Numbers are hidden on phones; the label below carries the position
            there so the bar does not wrap into two rows. */}
        <span className="hidden items-center gap-1 sm:flex">
          {blocks.map((entry) =>
            typeof entry === 'string' ? (
              <span key={entry} className="px-1 text-xs text-subtext" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                onClick={() => go(entry)}
                disabled={disabled}
                aria-current={entry === current ? 'page' : undefined}
                aria-label={`Page ${entry}`}
                className={`h-8 min-w-8 rounded-lg px-2 text-xs font-semibold tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 ${
                  entry === current
                    ? 'bg-brand text-on-accent'
                    : 'border border-line bg-surface text-fg hover:bg-subtle'
                }`}
              >
                {entry}
              </button>
            )
          )}
        </span>
        <span className="px-1 text-xs font-medium text-muted sm:hidden">
          Page {current} of {safePageCount}
        </span>

        <button
          type="button"
          onClick={() => go(current + 1)}
          disabled={disabled || current >= safePageCount}
          className={iconButton}
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => go(safePageCount)}
          disabled={disabled || current >= safePageCount}
          className={iconButton}
          aria-label="Last page"
          title={`Last page (${safePageCount})`}
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </nav>
    </div>
  )
}
