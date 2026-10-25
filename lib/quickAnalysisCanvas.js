'use client'

// lib/quickAnalysisCanvas.js
// Draws the Quick Analysis infographic onto a <canvas> and exports it as a
// PNG blob — the browser port of the matplotlib prototype (build_infographic.py).
// Layout is expressed on a 0–100 grid (x across, y downward) exactly like the
// prototype: one axes sized to the data, everything placed by coordinates, so
// changing the data resizes the image automatically (no manual H to tune).
//
// Rendered client-side on demand (no server round-trip, no image dependency):
// the reports page passes the model from lib/quickAnalysis.js and gets a Blob
// back to preview and download.

// ------------------------------------------------------------------ STYLE
const NAVY = '#0b2a6f'
const BLUE = '#1d4fc4'
const LIGHT = '#e6ebf5'
const GREEN = '#0f9d8a'
const ORANGE = '#e8890c'
const RED = '#c9302c'
const GREY = '#5b6577'
const CARD_EDGE = '#d5dcea'
const CHIP_EDGE = '#b9c3d9'
const HEADER_BLUE = '#0d3b9e'
const HEADER_SUB = '#cfdcff'
const CANVAS_BG = '#f2f5fb'

// Points → grid units: the prototype drew at 8in×150dpi with a 0–100 x-axis
// (100 units = 8in = 576pt, so 1pt = 100/576 units). Keeps our text and
// line weights visually identical to the matplotlib output.
const PT = 100 / 576
const fs = (pt) => pt * PT
const lw = (pt) => pt * PT

const FONT_STACK = '"Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif'

// ------------------------------------------------------------ MEASUREMENT
// A scratch context for measuring text during layout (chip wrapping needs it
// before the final canvas exists).
let measureCtx = null
function textWidth(s, sizePt, weight = 'normal') {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  measureCtx.font = `${weight} ${fs(sizePt)}px ${FONT_STACK}`
  return measureCtx.measureText(String(s)).width
}

// ----------------------------------------------------------------- HELPERS
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// White rounded section box (prototype: FancyBboxPatch with rounding 2.2).
function card(ctx, y, h) {
  roundRectPath(ctx, 4, y, 92, h, 2.2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.strokeStyle = CARD_EDGE
  ctx.lineWidth = lw(1.2)
  ctx.stroke()
}

function txt(ctx, x, y, s, sizePt, color = NAVY, weight = 'normal', align = 'left') {
  ctx.font = `${weight} ${fs(sizePt)}px ${FONT_STACK}`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(String(s), x, y)
}

// Branch-name pills with an order-count badge. Wraps to a new row when the
// next pill would pass maxx. Returns the last row's y so callers continue
// below. Pills are sized from measured text (the prototype estimated width
// from string length, which drifted for wide glyphs).
function chips(ctx, items, xStart, yStart, color, { maxx = 93, rowh = 5.2, size = 9 } = {}) {
  let x = xStart
  let y = yStart
  for (const [name, orders] of items) {
    const label = String(name)
    const w = textWidth(label, size) + 3 + 5.2 // text + inner padding + badge
    if (x + w > maxx && x > xStart) {
      x = xStart
      y += rowh
    }
    roundRectPath(ctx, x, y - 2, w, 4, 2)
    ctx.fillStyle = LIGHT
    ctx.fill()
    ctx.strokeStyle = CHIP_EDGE
    ctx.lineWidth = lw(0.8)
    ctx.stroke()
    txt(ctx, x + 1.8, y, label, size, NAVY)
    ctx.beginPath()
    ctx.arc(x + w - 2.6, y, 1.8, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    txt(ctx, x + w - 2.6, y, orders, 8, '#ffffff', 'bold', 'center')
    x += w + 1.5
  }
  return y
}

// Wrap one group of pills into rows (used by layout to pre-compute heights).
function chipRows(items, xStart, maxx, size) {
  let rows = 1
  let x = xStart
  for (const [name] of items) {
    const w = textWidth(String(name), size) + 3 + 5.2
    if (x + w > maxx && x > xStart) {
      rows += 1
      x = xStart
    }
    x += w + 1.5
  }
  return rows
}

// ----------------------------------------------------------------- LAYOUT
// Two passes: first compute every section's y/height from the data (so the
// canvas is exactly the right size), then paint. This is what lets the
// prototype's "adjust H when data changes" step disappear.
function computeLayout(model) {
  const { top, mid, low, zero } = model
  const sections = []
  let y = 41 // below header + KPI cards (same as prototype)

  // Top 10 — fixed rows, footnote inside the card
  if (top.length) {
    const rowh = 5.3
    const h = 12 + top.length * rowh + 6
    sections.push({ kind: 'top', y, h, rowh })
    y += h + 3
  }

  // Mid-tier — card height follows wrapped pill rows. The prototype used a
  // fixed 22 for one row (pills start at +13, bottom padding 7), so:
  // 22 + (rows - 1) * 5.2.
  if (mid.length) {
    const rows = chipRows(mid.map((r) => [r.branch_name, r.orders]), 7, 93, 9)
    const h = 22 + (rows - 1) * 5.2
    sections.push({ kind: 'mid', y, h })
    y += h + 3
  }

  // <5 orders — one labelled sub-row per order count (4, 3, 2, 1).
  // `inner` tracks where the *next* row would start (each group advances by
  // rows*5 + 0.8). The card ends just past the last drawn pill row:
  // subtract the trailing advance (5.8) and add the pill bottom + padding (2.6)
  // — exactly the prototype's 38 for its 5 pill rows.
  if (low.length) {
    let inner = 13
    for (const k of [4, 3, 2, 1]) {
      const group = low.filter((r) => r.orders === k)
      if (!group.length) continue
      inner += chipRows(group.map((r) => [r.branch_name, r.orders]), 23, 93, 8.6) * 5 + 0.8
    }
    const h = inner - 3.2
    sections.push({ kind: 'low', y, h })
    y += h + 3
  }

  // Zero orders — two columns
  if (zero.length) {
    const rows = Math.ceil(zero.length / 2)
    const h = 14 + rows * 5.6 + 4
    sections.push({ kind: 'zero', y, h })
    y += h + 3
  }

  return { sections, endY: y }
}

// ------------------------------------------------------------------- PAINT
function paint(ctx, model, layout, { title, asAt }) {
  const { top, mid, low, zero, total, branchCount, topSum, topSharePct, lowSum, maxOrders } = model

  // Sections advance y by h + 3 (the prototype's inter-card gap), so endY is
  // already 3 units below the last card — the footer sits exactly there.
  ctx.fillStyle = CANVAS_BG
  ctx.fillRect(0, 0, 100, layout.endY + 6)

  // -------------------------------------------------------------- HEADER
  roundRectPath(ctx, 3, 3, 94, 17, 2.5)
  ctx.fillStyle = HEADER_BLUE
  ctx.fill()
  ctx.strokeStyle = NAVY
  ctx.lineWidth = lw(1.5)
  ctx.stroke()
  txt(ctx, 7, 10.5, title, 24, '#ffffff', 'bold')
  txt(ctx, 7, 16, `as at ${asAt}`, 11.5, HEADER_SUB)
  txt(ctx, 93, 10.5, total, 26, '#ffffff', 'bold', 'right')
  txt(ctx, 93, 16, 'total orders', 10, HEADER_SUB, 'normal', 'right')

  // ---------------------------------------------------------- KPI CARDS
  const kpis = [
    [branchCount, 'Branches'],
    [`${Math.round(topSharePct)}%`, 'Orders from Top 10'],
    [low.length, 'Branches with 1–4 orders'],
    [zero.length, 'Branches with 0 orders'],
  ]
  const kpiColors = [BLUE, GREEN, ORANGE, RED]
  const w = 21.6
  const gap = 1.9
  const x0 = 4
  kpis.forEach(([value, label], i) => {
    const x = x0 + i * (w + gap)
    roundRectPath(ctx, x, 23, w, 15, 1.8)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = CARD_EDGE
    ctx.lineWidth = lw(1.2)
    ctx.stroke()
    ctx.fillStyle = kpiColors[i]
    ctx.fillRect(x + 1.5, 23.9, w - 3, 0.8)
    txt(ctx, x + w / 2, 29.5, value, 19, kpiColors[i], 'bold', 'center')
    const label2 = label.replace(' with', '\nwith')
    const lines = label2.split('\n')
    // Two-line labels are centred as a block on y=34.5, lines 1.45 units
    // apart (matplotlib linespacing 1.1 × 7.6pt).
    lines.forEach((line, li) => {
      txt(ctx, x + w / 2, 34.5 + (li - (lines.length - 1) / 2) * 1.45, line, 7.6, GREY, 'normal', 'center')
    })
  })

  // ------------------------------------------------------------- SECTIONS
  for (const sec of layout.sections) {
    if (sec.kind === 'top') {
      card(ctx, sec.y, sec.h)
      txt(ctx, 50, sec.y + 6, 'TOP 10 PERFORMING BRANCHES', 15, NAVY, 'bold', 'center')
      top.forEach((row, i) => {
        const yy = sec.y + 14 + i * sec.rowh
        ctx.beginPath()
        ctx.arc(9.5, yy, 2.1, 0, Math.PI * 2)
        ctx.fillStyle = BLUE
        ctx.fill()
        txt(ctx, 9.5, yy, row.rank, 10, '#ffffff', 'bold', 'center')
        txt(ctx, 14, yy, row.branch_name, 11, NAVY)
        roundRectPath(ctx, 42, yy - 1.5, 42, 3, 1.5)
        ctx.fillStyle = LIGHT
        ctx.fill()
        ctx.strokeStyle = CHIP_EDGE
        ctx.lineWidth = lw(0.8)
        ctx.stroke()
        const barW = maxOrders > 0 ? Math.max((42 * row.orders) / maxOrders, 3) : 3
        roundRectPath(ctx, 42, yy - 1.5, barW, 3, 1.5)
        ctx.fillStyle = BLUE
        ctx.fill()
        txt(ctx, 92, yy, `(${row.orders})`, 11.5, NAVY, 'bold', 'right')
      })
      txt(
        ctx, 7, sec.y + 12 + top.length * sec.rowh + 3.2,
        `*Top 10 = ${topSum} of ${total} orders (${topSharePct.toFixed(1)}%). Tied branches share a rank.`,
        8, GREY
      )
    }

    if (sec.kind === 'mid') {
      card(ctx, sec.y, sec.h)
      // Match the prototype's data-driven range label (it read 5–6 from its
      // own data); a single-value tier collapses to "5 ORDERS".
      const hi = mid[0]?.orders ?? 5
      const range = hi > 5 ? `5–${hi}` : '5'
      txt(ctx, 7, sec.y + 5.5, `MID-TIER BRANCHES (${range} ORDERS)`, 13, NAVY, 'bold')
      txt(ctx, 93, sec.y + 5.5, `${mid.length} branches`, 9.5, GREY, 'normal', 'right')
      chips(ctx, mid.map((r) => [r.branch_name, r.orders]), 7, sec.y + 13, GREEN)
    }

    if (sec.kind === 'low') {
      card(ctx, sec.y, sec.h)
      txt(ctx, 7, sec.y + 5.5, 'BRANCHES WITH <5 ORDERS (1–4)', 13, NAVY, 'bold')
      txt(ctx, 93, sec.y + 5.5, `${low.length} branches · ${lowSum} orders`, 9.5, GREY, 'normal', 'right')
      let yy = sec.y + 13
      for (const k of [4, 3, 2, 1]) {
        const group = low.filter((r) => r.orders === k)
        if (!group.length) continue
        txt(ctx, 7, yy, `${k} order${k > 1 ? 's' : ''}`, 9, ORANGE, 'bold')
        chips(ctx, group.map((r) => [r.branch_name, r.orders]), 23, yy, ORANGE, { rowh: 5, size: 8.6 })
        yy += chipRows(group.map((r) => [r.branch_name, r.orders]), 23, 93, 8.6) * 5 + 0.8
      }
    }

    if (sec.kind === 'zero') {
      const rows = Math.ceil(zero.length / 2)
      card(ctx, sec.y, sec.h)
      txt(ctx, 7, sec.y + 6, 'BRANCHES YET TO APPLY (ZERO ORDERS)', 13, NAVY, 'bold')
      txt(ctx, 93, sec.y + 6, `${zero.length} branches`, 9.5, GREY, 'normal', 'right')
      zero.forEach((row, i) => {
        const col = Math.floor(i / rows)
        const r = i % rows
        const xx = 10 + col * 42
        const yy = sec.y + 14 + r * 5.6
        ctx.beginPath()
        ctx.arc(xx, yy, 0.9, 0, Math.PI * 2)
        ctx.fillStyle = RED
        ctx.fill()
        txt(ctx, xx + 3, yy, row.branch_name, 11, NAVY)
      })
    }
  }

  // -------------------------------------------------------------- FOOTER
  txt(
    ctx, 50, layout.endY,
    `All ${branchCount} branches shown · ${total} orders · Source: Food Distribution Report`,
    8, GREY, 'normal', 'center'
  )
}

// ------------------------------------------------------------------ ENTRY
/**
 * Render the infographic and return it as a PNG blob.
 *
 * @param {object} model  result of buildQuickAnalysisModel()
 * @param {{title?: string, asAt?: string, width?: number}} opts
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function renderQuickAnalysisPng(model, opts = {}) {
  const title = opts.title || 'NATIONWIDE ORDERS'
  // "Oct 24, 2026" — same phrasing as the prototype's header.
  const asAt = opts.asAt || new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
  const width = opts.width || 800 // CSS px, like the prototype's 8in figure
  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2)

  const layout = computeLayout(model)
  const gridW = width * dpr // device px for the 0–100 x-axis
  const unit = gridW / 100 // device px per grid unit (uniform for x and y
                            // so text never stretches)
  const height = Math.ceil(unit * (layout.endY + 6))

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(gridW)
  canvas.height = Math.round(height)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  // Scale the 0–100 grid up to device pixels; y already runs downward.
  ctx.scale(unit, unit)
  ctx.lineJoin = 'round'

  paint(ctx, model, layout, { title, asAt })

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png')
  })

  // The app's CSP restricts img-src to 'self' data: https:, so the preview
  // <img> can't load a blob: URL. Expose the same bytes as a data: URL for
  // display; the download keeps using the blob (same pattern as the page's
  // Excel exports) — no CSP change needed.
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('PNG encoding failed'))
    reader.readAsDataURL(blob)
  })

  return { blob, dataUrl, width: canvas.width, height: canvas.height }
}
