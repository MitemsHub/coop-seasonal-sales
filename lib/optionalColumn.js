// lib/optionalColumn.js
// Some deployed databases lag behind the migrations. Asking for a column a
// table does not have fails the whole select, and an insert carrying one is
// rejected (or its foreign key points at a row that was since replaced). The
// bulk item removal and its restore both want items.is_active and
// order_lines.branch_item_price_id only opportunistically — losing them costs
// the retired-SKU warning or the branch price pointer, not the operation — so
// the "retry once without that column" rule lives here instead of in each route.

const MISSING_COLUMN_CODES = ['42703', 'PGRST204']
// The referenced row is gone (e.g. the branch price was re-priced since).
const MISSING_REFERENCE_CODES = ['23503']

export function isOptionalColumnProblem(error, column) {
  if (!error) return false
  if (MISSING_COLUMN_CODES.includes(String(error.code || ''))) return true
  const msg = String(error.message || '').toLowerCase()
  return Boolean(column) && msg.includes(String(column).toLowerCase())
}

export function isOptionalFieldProblem(error, column) {
  return (
    isOptionalColumnProblem(error, column) ||
    MISSING_REFERENCE_CODES.includes(String(error?.code || ''))
  )
}

// SELECT: run the query with `columns`, and once more without `column` when the
// database says that column does not exist. `query(cols)` builds the request.
export async function selectWithOptionalColumn(columns, column, query) {
  const first = await query(columns)
  if (!isOptionalColumnProblem(first?.error, column)) return first

  const without = String(columns)
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c && c !== column)
    .join(', ')
  if (!without) return first
  return query(without)
}

// INSERT: try the row as-is, then the same row with `column` dropped when the
// database has no such column or the row it points at no longer exists.
export async function insertWithOptionalField(row, column, insert) {
  const first = await insert(row)
  if (!isOptionalFieldProblem(first?.error, column) || !(column in row)) return first

  const { [column]: _omitted, ...rest } = row
  return insert(rest)
}
