// scripts/verify-exports.mjs
// End-to-end verification of the export pipeline used across admin/rep pages.
// Mirrors the EXACT production code from app/admin/food/posted/page.jsx (the
// reference export), then validates the generated files:
//   - Excel: round-trips through exceljs; every title/meta/header/data cell checked.
//   - PDF:   captures drawn cell geometry via autoTable's didDrawCell hook to prove
//            nothing is clipped off-page, head rows repeat on every page, and all
//            body rows are present (single-page and multi-page runs).
// Run: node scripts/verify-exports.mjs
import { writeFileSync, readFileSync, rmSync } from 'node:fs'

let failures = 0
const ok = (cond, label) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures++
}

// ---------------------------------------------------------------------------
// Sample data shaped exactly like the production API response
// ---------------------------------------------------------------------------
const SAMPLE = [
  {
    order_id: 'ORD-2481',
    posted_at: '2026-08-10T09:15:00.000Z',
    member_id: 'MEM-1001',
    member_name_snapshot: 'Adeyemi O.',
    member_branch: { name: 'Lagos HQ' },
    delivery: { name: 'Victoria Island' },
    departments: { name: 'Groceries' },
    payment_option: 'Savings',
    order_lines: [
      { items: { sku: 'RICE-50', name: 'Rice 50kg' }, qty: 2, unit_price: 48500, amount: 97000 },
      { items: { sku: 'OIL-5L', name: 'Groundnut Oil 5L' }, qty: 1, unit_price: 12800, amount: 12800 },
    ],
  },
  {
    order_id: 'ORD-2482',
    posted_at: '2026-08-10T10:02:00.000Z',
    member_id: 'MEM-2002',
    member_name_snapshot: 'Okafor C.',
    member_branch: { name: 'Abuja' },
    delivery: { name: 'Abuja' },
    departments: { name: 'Proteins' },
    payment_option: 'Loan',
    order_lines: [
      { items: { sku: 'BEEF-1', name: 'Frozen Beef' }, qty: 5, unit_price: 9400, amount: 47000 },
    ],
  },
]

const ROW_SHAPE = SAMPLE.flatMap((o) =>
  (o.order_lines || []).map((l) => ({
    order_id: o.order_id,
    posted_at: o.posted_at,
    member_id: o.member_id,
    member_name: o.member_name_snapshot,
    member_branch: o.member_branch?.name || '',
    delivery_branch: o.delivery?.name || '',
    department: o.departments?.name || '',
    payment: o.payment_option,
    sku: l.items?.sku,
    item: l.items?.name,
    qty: l.qty,
    unit_price: l.unit_price,
    amount: l.amount,
  }))
)
const HEADERS = Object.keys(ROW_SHAPE[0])

// ---------------------------------------------------------------------------
// EXCEL — production code from exportExcel on posted
// ---------------------------------------------------------------------------
console.log('\n=== EXCEL (exceljs) ===')
const { default: ExcelJS } = await import('exceljs')
const wb = new ExcelJS.Workbook()
const ws = wb.addWorksheet('Posted')
ws.addRow(['Food Distribution · Posted Orders (Admin)'])
ws.addRow(['Search: All | Payment: All'])
ws.addRow(HEADERS)
for (const r of ROW_SHAPE) ws.addRow(HEADERS.map((h) => r[h]))
const buffer = await wb.xlsx.writeBuffer()
writeFileSync('scripts/export-test.xlsx', buffer)

const wb2 = new ExcelJS.Workbook()
await wb2.xlsx.load(buffer)
const ws2 = wb2.getWorksheet('Posted')
const readBack = []
ws2.eachRow((row) => readBack.push(row.values.slice(1)))

ok(ws2 !== undefined, 'workbook reloads with "Posted" worksheet')
ok(readBack.length === 3 + ROW_SHAPE.length, `row count = ${3 + ROW_SHAPE.length} (title + meta + header + ${ROW_SHAPE.length} data)`)
ok(readBack[0]?.[0] === 'Food Distribution · Posted Orders (Admin)', 'row 1 = title')
ok(readBack[1]?.[0] === 'Search: All | Payment: All', 'row 2 = search/meta line')
ok(JSON.stringify(readBack[2]) === JSON.stringify(HEADERS), 'row 3 = exact header row (13 columns)')

let dataCellsOk = true
ROW_SHAPE.forEach((row, i) => {
  const got = readBack[3 + i]
  HEADERS.forEach((h, j) => {
    if (String(got?.[j] ?? '') !== String(row[h] ?? '')) dataCellsOk = false
  })
})
ok(dataCellsOk, `all ${ROW_SHAPE.length} data rows × ${HEADERS.length} cells match source exactly`)

// ---------------------------------------------------------------------------
// PDF — exercises the SHARED helper (app/lib/pdfExport.js), the same module
// the migrated pages now use
// ---------------------------------------------------------------------------
console.log('\n=== PDF (shared pdfExport helper) ===')
const { createManifestDoc, addManifestTable, sanitizePdfText } = await import('../app/lib/pdfExport.js')
const sanitize = sanitizePdfText

const PDF_HEADERS = ['Order', 'Member', 'Dept', 'Pay', 'SKU', 'Item', 'Qty', 'Unit Price', 'Amount']
const COLUMN_STYLES = {
  0: { cellWidth: 14 }, 1: { cellWidth: 40 }, 2: { cellWidth: 28 }, 3: { cellWidth: 16 },
  4: { cellWidth: 20 }, 5: { cellWidth: 58 }, 6: { cellWidth: 12, halign: 'right' },
  7: { cellWidth: 24, halign: 'right' }, 8: { cellWidth: 26, halign: 'right' },
}
const PAGE_W = 297 // A4 landscape, mm
const PAGE_H = 210

function buildPdfRow(o) {
  return (o.order_lines || []).map((l) => [
    sanitize(o.order_id),
    sanitize(o.member_name_snapshot || ''),
    sanitize(o.departments?.name || ''),
    sanitize(o.payment_option || ''),
    sanitize(l.items?.sku || ''),
    sanitize(l.items?.name || ''),
    String(l.qty || 0),
    `NGN ${Number(l.unit_price || 0).toLocaleString()}`,
    `NGN ${Number(l.amount || 0).toLocaleString()}`,
  ])
}

async function renderPdf(orders, label) {
  const doc = await createManifestDoc({ title: 'Posted Orders Manifest (Admin)', meta: 'Search: All  |  Payment: All' })
  const geometry = { cells: [], headPages: new Set(), bodyRows: new Set(), rowHeights: {}, phantomRows: 0, pages: 0 }

  await addManifestTable(doc, {
    head: PDF_HEADERS,
    body: orders.flatMap(buildPdfRow),
    startY: 30,
    columnStyles: COLUMN_STYLES,
    options: {
      didDrawCell: (data) => {
        const page = data.doc.internal.getNumberOfPages()
        const cell = data.cell || {}
        geometry.cells.push({
          page,
          section: data.section,
          rowIndex: data.row?.index ?? -1,
          x: cell.x,
          y: cell.y,
          w: cell.width,
          h: cell.height,
        })
        if (data.section === 'head') geometry.headPages.add(page)
        if (data.section === 'body') geometry.bodyRows.add(data.row.index)
        if (data.section === 'body' && data.row.index === -1) geometry.phantomRows++
        if (data.section === 'body' && data.row.index >= 0) {
          geometry.rowHeights[data.row.index] = Math.max(geometry.rowHeights[data.row.index] || 0, cell.height || 0)
        }
      },
    },
  })

  const bytes = Buffer.from(doc.output('arraybuffer'))
  writeFileSync('scripts/export-test.pdf', bytes)
  geometry.pages = doc.internal.getNumberOfPages()

  // --- assertions ---
  console.log(`\n  [${label}] pages: ${geometry.pages}, body rows: ${geometry.bodyRows.size}, cells drawn: ${geometry.cells.length}`)
  const maxRight = Math.max(...geometry.cells.map((c) => c.x + c.w))
  const maxBottom = Math.max(...geometry.cells.map((c) => c.y + c.h))
  ok(bytes.subarray(0, 5).toString('latin1') === '%PDF-', 'file starts with %PDF magic')
  ok(bytes.toString('latin1').includes('%%EOF'), 'file has %%EOF terminator')
  ok(bytes.length > 5000, `file size ${bytes.length} bytes (non-trivial)`)

  const pageW = doc.internal.pageSize.getWidth()
  ok(Math.abs(pageW - PAGE_W) < 0.01, `page width ${pageW.toFixed(2)}mm (A4 landscape)`)

  const minX = Math.min(...geometry.cells.map((c) => c.x))
  ok(minX >= 10 - 0.01, `table left edge ${minX.toFixed(1)}mm at left margin`)
  ok(maxRight <= PAGE_W, `max right edge ${maxRight.toFixed(1)}mm <= page width ${PAGE_W}mm (NO CLIPPING)`)
  ok(maxBottom <= PAGE_H + 1, `max bottom edge ${maxBottom.toFixed(1)}mm within page height`)

  const headCellsPerPage = PDF_HEADERS.length
  const bodyCellCount = geometry.cells.filter((c) => c.section === 'body').length
  const expectedBodyRows = orders.reduce((n, o) => n + (o.order_lines || []).length, 0)
  const bodyRowCount = geometry.bodyRows.size
  ok(bodyRowCount === expectedBodyRows, `body rows drawn = ${bodyRowCount} (expected ${expectedBodyRows})`)
  ok(bodyCellCount === expectedBodyRows * headCellsPerPage, `body cells drawn = ${bodyCellCount} (= rows × ${headCellsPerPage} cols)`)
  ok(geometry.phantomRows === 0, `no phantom remainder rows (got ${geometry.phantomRows})`)
  const heights = Object.values(geometry.rowHeights)
  const maxH = Math.max(...heights, 0)
  const squashed = heights.filter((h) => h < maxH - 0.5).length
  ok(squashed === 0, `no squashed/clipped rows (${heights.length} rows, tallest ${maxH.toFixed(1)}mm, ${squashed} shorter)`)

  if (geometry.pages > 1) {
    ok(geometry.headPages.size === geometry.pages, `head row repeated on all ${geometry.pages} pages`)
    const headCellCount = geometry.cells.filter((c) => c.section === 'head').length
    ok(headCellCount === geometry.pages * headCellsPerPage, `head cells drawn = ${headCellCount} (${geometry.pages} pages × ${headCellsPerPage})`)
  } else {
    const headCellCount = geometry.cells.filter((c) => c.section === 'head').length
    ok(headCellCount === headCellsPerPage, `head row drawn once (single page)`)
  }
  return { geometry, maxRight }
}

const { geometry: g1 } = await renderPdf(SAMPLE, 'sample (3 lines)')
ok(g1.pages === 1, 'sample fits on one page')

// Multi-page stress: 120 rows across several orders
const BIG = Array.from({ length: 60 }, (_, i) => ({
  order_id: `ORD-3${String(i).padStart(3, '0')}`,
  posted_at: '2026-08-10T09:15:00.000Z',
  member_id: `MEM-${i}`,
  member_name_snapshot: `Member ${i}`,
  member_branch: { name: 'Lagos HQ' },
  delivery: { name: 'Victoria Island' },
  departments: { name: 'Groceries' },
  payment_option: 'Savings',
  order_lines: [
    { items: { sku: 'RICE-50', name: 'Rice 50kg' }, qty: 2, unit_price: 48500, amount: 97000 },
    { items: { sku: 'OIL-5L', name: 'Groundnut Oil 5L' }, qty: 1, unit_price: 12800, amount: 12800 },
  ],
}))
const { geometry: g2 } = await renderPdf(BIG, 'stress (120 lines)')
ok(g2.pages > 1, `stress run spans ${g2.pages} pages (multi-page path exercised)`)

// ---------------------------------------------------------------------------
// Cleanup + verdict
// ---------------------------------------------------------------------------
rmSync('scripts/export-test.xlsx', { force: true })
rmSync('scripts/export-test.pdf', { force: true })

console.log('\n============================================')
if (failures === 0) {
  console.log('ALL EXPORT CHECKS PASSED — Excel and PDF exports are well-formed and complete.')
  process.exit(0)
} else {
  console.log(`${failures} CHECK(S) FAILED`)
  process.exit(1)
}
