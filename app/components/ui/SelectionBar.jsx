'use client'

// app/components/ui/SelectionBar.jsx
// The bar above a list that can be worked on in bulk.
//
// The admin catalogue and the vendor's own product list each grew their own
// version: same intent, different checkbox, different count chip, different
// wording — and the vendor's Control looked like nothing else in the app. This
// is the one control both use, so "select these" reads and behaves the same on
// either side of the co-op. Page-specific bulk actions are passed in as
// children so the bar itself stays identical.
export default function SelectionBar({
  selectedCount = 0,
  selectAllLabel,
  allSelected = false,
  someSelected = false,
  onToggleSelectAll,
  onClear,
  selectAllDisabled = false,
  busy = false,
  hint = '',
  children,
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-subtle/60 px-3 py-2">
      <label className="flex items-center gap-2 text-xs font-medium text-muted">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleSelectAll}
          ref={(el) => {
            if (el) el.indeterminate = !allSelected && someSelected
          }}
          disabled={selectAllDisabled || busy}
          aria-label={selectAllLabel}
          className="h-4 w-4 rounded border-line accent-brand disabled:opacity-40"
        />
        {selectAllLabel}
      </label>

      {selectedCount > 0 && (
        <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-semibold text-brand">
          {selectedCount.toLocaleString()} selected
        </span>
      )}
      {hint && <span className="text-chips text-muted">{hint}</span>}
      {selectedCount > 0 && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-medium text-muted underline-offset-2 hover:text-fg hover:underline"
        >
          Clear
        </button>
      )}

      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
