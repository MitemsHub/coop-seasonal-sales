'use client'

// Shared browser-side Excel download used by report screens. Keeps workbook
// styling and download behaviour uniform instead of hand-building a workbook
// in each page.
export async function downloadExcelWorkbook(filename, sheets) {
  const list = (sheets || []).filter(Boolean)
  if (!list.length) return

  const ExcelJSMod = await import('exceljs')
  const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CBN Coop'
  wb.created = new Date()

  for (const sheet of list) {
    const ws = wb.addWorksheet(sheet.name || 'Report')
    const rows = Array.isArray(sheet.rows) ? sheet.rows : []
    const headers = Object.keys(rows[0] || {})

    if (!headers.length) {
      ws.addRow(['No data'])
      continue
    }

    ws.columns = headers.map((header) => ({
      header: sheet.headers?.[header] ?? header,
      key: header,
      width: Math.min(
        42,
        Math.max(
          12,
          String(sheet.headers?.[header] ?? header).length + 4,
          ...rows.slice(0, 80).map((row) => String(row[header] ?? '').length + 2)
        )
      ),
    }))

    for (const row of rows) ws.addRow(row)

    const headerRow = ws.getRow(1)
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C3A' } }
    headerRow.alignment = { vertical: 'middle' }
    headerRow.height = 22
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
