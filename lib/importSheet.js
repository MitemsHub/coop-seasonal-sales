// lib/importSheet.js
// One reader for the import modals: vendors hand back the Excel template we
// give them, but a CSV export still works. Both end up as { headers, records }
// with lowercase headers, exactly like parseCsv.
import { parseCsv } from './csvParse'

export const IMPORT_ACCEPT =
  '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'

export function isExcelFile(file) {
  const name = String(file?.name || '').toLowerCase()
  return name.endsWith('.xlsx') || name.endsWith('.xls')
}

function recordsFromRows(rows) {
  const cleaned = (rows || []).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''))
  if (!cleaned.length) return { headers: [], records: [] }

  const headers = cleaned[0].map((h) => String(h ?? '').trim().toLowerCase())
  const records = cleaned.slice(1).map((row) => {
    const obj = {}
    headers.forEach((header, index) => {
      if (!header) return
      obj[header] = String(row[index] ?? '').trim()
    })
    return obj
  })
  return { headers, records }
}

export async function readImportFile(file) {
  if (!file) return { headers: [], records: [] }

  if (isExcelFile(file)) {
    const mod = await import('xlsx')
    const XLSX = mod?.default ?? mod
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    if (!sheet) return { headers: [], records: [] }
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false })
    return recordsFromRows(rows)
  }

  const text = await file.text().catch(() => '')
  return parseCsv(text)
}
