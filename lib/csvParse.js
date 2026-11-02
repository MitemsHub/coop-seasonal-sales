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

export function toCsv(columns, rows) {
  const escape = (value) => {
    const s = value === null || value === undefined ? '' : String(value)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.map((c) => escape(c.header)).join(','), ...rows.map((r) => columns.map((c) => escape(c.value(r))).join(','))].join('\n')
}
