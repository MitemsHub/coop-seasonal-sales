'use client'

// app/components/ShelfPicker.jsx
// One fixed shelf picker for the vendor product form and the admin desk. It
// lists exactly the shelves the shop shows, so a listing is shelved at the
// source instead of being guessed from its name later.
//
// The default is Automatic: the shop's own reading of the name and description
// is shown as the suggestion, so leaving it alone keeps the previous behaviour
// while choosing a shelf is one tap away.
import Label from './ui/Label'
import Select from './ui/Select'
import { SHELVES, suggestShelfKey } from '../../lib/exhibitionShelf'

const labelOf = (key) => SHELVES.find((shelf) => shelf.key === key)?.label || ''

export default function ShelfPicker({
  id = 'shelf',
  categories = [],
  name = '',
  description = '',
  value = '',
  onChange = () => {},
  photoNote = '',
}) {
  const suggestion = labelOf(suggestShelfKey({ name, description }))
  const options = SHELVES.filter((shelf) => shelf.key !== 'other')
    .map((shelf) => ({
      key: shelf.key,
      label: shelf.label,
      category: categories.find(
        (c) => String(c.name || '').trim().toLowerCase() === shelf.label.toLowerCase()
      ),
    }))
    .filter((shelf) => shelf.category)

  if (!options.length) return null

  return (
    <div>
      <Label htmlFor={id}>Shelf</Label>
      <Select id={id} value={value || ''} onChange={(e) => onChange(e.target.value)} className="w-full">
        <option value="">Automatic{suggestion ? ` — suggested: ${suggestion}` : ''}</option>
        {options.map((shelf) => (
          <option key={shelf.key} value={shelf.category.id}>
            {shelf.label}
          </option>
        ))}
      </Select>
      {!!photoNote && <p className="mt-1 text-chips font-medium text-brand">{photoNote}</p>}
      <p className="mt-1 text-chips text-muted">
        {value
          ? 'This listing goes on the shelf you picked, wherever its name would have sent it.'
          : suggestion
            ? 'Leave on Automatic and the shop shelves it by name, as it does now.'
            : 'Leave on Automatic if you are unsure — the co-op can change it later.'}
      </p>
    </div>
  )
}
