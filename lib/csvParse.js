// lib/csvParse.js
// Tiny, dependency-free CSV reader used by the product and vendor batch
// uploads. Handles quoted fields, doubled quotes and embedded newlines, which
// is what real spreadsheets export. Header names are normalised to lowercase
// so "Product Name" and "product name" both work.
export function parseCsv(text) {
  const src = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')

  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }

  const cleaned = rows.filter((r) => r.some((c) => String(c).trim() !== ''))
  if (!cleaned.length) return { headers: [], records: [] }

  const headers = cleaned[0].map((h) => String(h).trim().toLowerCase())
  const records = cleaned.slice(1).map((r) => {
    const obj = {}
    headers.forEach((h, idx) => {
      if (!h) return
      obj[h] = String(r[idx] ?? '').trim()
    })
    return obj
  })
  return { headers, records }
}

// First non-empty value among several possible header spellings, so a
// spreadsheet with "Amount" or "Price (NGN)" still lands in the price column.
export function pick(record, names) {
  for (const name of names) {
    const value = record?.[name]
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

// Numbers coming out of a spreadsheet arrive as display text when the cell is
// formatted ("15,000", "₦15,000", "15 000", "15.000,50"), and Number() turns
// those into NaN. This strips the decoration and keeps the value.
export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  let text = String(value ?? '').trim()
  if (!text) return null
  text = text.replace(/[^0-9.,-]/g, '')
  if (!text || !/[0-9]/.test(text)) return null

  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever separator comes last is the decimal one.
    if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.')
    else text = text.replace(/,/g, '')
  } else if (lastComma !== -1) {
    const decimals = text.length - lastComma - 1
    const commas = (text.match(/,/g) || []).length
    // A single comma with 1-2 trailing digits is a decimal mark, not thousands.
    text = commas === 1 && decimals > 0 && decimals <= 2 ? text.replace(',', '.') : text.replace(/,/g, '')
  }

  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

export function toCsv(columns, rows) {
  const escape = (value) => {
    const s = value === null || value === undefined ? '' : String(value)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.map((c) => escape(c.header)).join(','), ...rows.map((r) => columns.map((c) => escape(c.value(r))).join(','))].join('\n')
}
