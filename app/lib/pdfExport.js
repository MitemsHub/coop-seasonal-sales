// app/lib/pdfExport.js
// Shared helpers for the app's PDF exports (jsPDF + jspdf-autotable).
// Both libraries are imported lazily here, so they only load when an export
// actually runs — pages can import these helpers without inflating their
// initial bundle (same behaviour as the old inline `await import('jspdf')`).

// Strips ₦ to "NGN " and em/en dashes to "-" so exported text renders cleanly.
export const sanitizePdfText = (s) =>
  String(s ?? '').replace(/\u20A6|₦/g, 'NGN ').replace(/[\u2013\u2014]/g, '-')

// Creates an A4-landscape doc and draws the standard manifest header:
//   title (14pt) at (x, y), "Generated: …" (9pt) at (x, y + 6), meta (9pt) at (x, y + 12).
export async function createManifestDoc({
  title,
  meta,
  x = 12,
  y = 12,
  titleSize = 14,
  metaSize = 9,
  orientation = 'landscape',
} = {}) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  doc.setFontSize(titleSize)
  doc.text(title, x, y)
  doc.setFontSize(metaSize)
  doc.text(`Generated: ${new Date().toLocaleString()}`, x, y + 6)
  if (meta) doc.text(meta, x, y + 12)
  return doc
}

// Renders a table with the app's standard manifest styling.
// `variant` picks the two known base configs:
//   'food' — 8pt grid, 10mm side margins, top margin 28 (used by food + rep manifests)
//   'ram'  — 7pt, 12mm side margins (used by ram manifests)
// `head` accepts either a single row (['A', 'B']) or rows ([['A', 'B']]).
// Anything in `options` overrides the base config (e.g. didParseCell, foot, tableWidth).
export async function addManifestTable(doc, { head, body, columnStyles, startY, variant = 'food', options = {} } = {}) {
  const { default: autoTable } = await import('jspdf-autotable')
  const headRows = Array.isArray(head?.[0]) ? head : [head]
  const base =
    variant === 'ram'
      ? {
          styles: { fontSize: 7 },
          headStyles: { fillColor: [75, 85, 99] },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          margin: { left: 12, right: 12 },
        }
      : {
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', lineWidth: 0.1, lineColor: [0, 0, 0] },
          headStyles: { fillColor: [75, 85, 99], textColor: [255, 255, 255], fontSize: 9 },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          margin: { top: 28, left: 10, right: 10 },
        }
  autoTable(doc, {
    head: headRows,
    body,
    startY,
    rowPageBreak: 'avoid',
    columnStyles,
    ...base,
    ...options,
  })
  return doc
}

// Low-level escape hatch: lazy-imports autotable and renders with the exact
// options given (no app defaults applied). Use for non-manifest tables — e.g.
// signature blocks or receipt layouts that don't follow the standard styling.
export async function renderTable(doc, options) {
  const { default: autoTable } = await import('jspdf-autotable')
  autoTable(doc, options)
  return doc
}

// Convenience: manifest header + one table in a single call.
export async function createManifestPdf({ title, meta, head, body, columnStyles, startY, variant, header, table } = {}) {
  const doc = await createManifestDoc({ title, meta, ...header })
  return addManifestTable(doc, { head, body, columnStyles, startY, variant, options: table })
}
