'use client'

// app/components/ui/CycleSelector.jsx
// Dropdown for selecting a cycle in the admin dashboard.
// Shows cycle name + date range, with the active cycle highlighted.
import Select from './Select'

/**
 * @param {Object} props
 * @param {Array} props.cycles - Array of cycle objects { id, name, code, is_active, starts_at, ends_at, ... }
 * @param {number|null} props.value - Currently selected cycle ID
 * @param {function} props.onChange - Called with cycle ID when selection changes
 * @param {string} [props.label] - Optional label above the selector
 * @param {string} [props.className] - Additional CSS classes
 */
export default function CycleSelector({ cycles = [], value, onChange, label = 'Cycle', className = '' }) {
  if (!cycles.length) return null

  const fmtDate = (iso) => {
    if (!iso) return null
    try {
      return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    } catch {
      return null
    }
  }

  return (
    <div className={['flex items-center gap-2', className].join(' ')}>
      <span className="text-xs font-medium text-muted whitespace-nowrap">{label}:</span>
      <Select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="min-w-[220px] max-w-[320px]"
      >
        {cycles.map((c) => {
          const start = fmtDate(c.starts_at)
          const end = fmtDate(c.ends_at)
          const dates = start && end ? `${start} – ${end}` : start || end || 'No dates'
          const active = c.is_active || c.status === 'active'
          return (
            <option key={c.id} value={c.id}>
              {c.name || c.code || `Cycle #${c.id}`} {active ? '(Active)' : ''} — {dates}
            </option>
          )
        })}
      </Select>
    </div>
  )
}
