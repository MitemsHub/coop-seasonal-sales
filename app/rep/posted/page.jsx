// app/rep/posted/page.jsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Package, Truck, XCircle, Zap } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { announceRepFoodStats, onRepFoodStatsChanged } from '../../lib/repFoodStatsSync'
import ProtectedRoute from '../../components/ProtectedRoute'
import DraggableModal from '../../components/DraggableModal'
import ExportButton from '../../components/ui/ExportButton'
import PrintOrderSheet from '../../components/PrintOrderSheet'
import { createManifestDoc, addManifestTable, renderTable, sanitizePdfText } from '../../lib/pdfExport'


const Spinner = ({ className = 'h-4 w-4 text-on-accent' }) => (
  <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
)

function RepPostedPageContent() {
  const [orders, setOrders] = useState([])
  const [departments, setDepartments] = useState([])
  const [dept, setDept] = useState('') // '' = All — initialized from user.department below
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [didLoadOnce, setDidLoadOnce] = useState(false)
  const [deliveringOrder, setDeliveringOrder] = useState(null) // Track which order is being delivered
  const [pageSize] = useState(50)
  const [cursorStack, setCursorStack] = useState([null])
  const [pageIndex, setPageIndex] = useState(0)
  const [nextCursor, setNextCursor] = useState(null)
  const [showModal, setShowModal] = useState(null)
  const [modalInput, setModalInput] = useState('')
  const [itemsPackLoading, setItemsPackLoading] = useState(false)
  const [excelLoading, setExcelLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  const [viewOrder, setViewOrder] = useState(null)
  const [sheetOrder, setSheetOrder] = useState(null) // order row for the print sheet
  const [stats, setStats] = useState(null)
  const { user } = useAuth()

  const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

  const safeJson = async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }

  const filteredOrders = useMemo(() => {
    const s = String(search || '').trim().toLowerCase()
    if (!s) return orders || []
    return (orders || []).filter((o) => {
      const hay = `${o.order_id} ${o.member_id} ${o.member_name_snapshot || ''}`.toLowerCase()
      return hay.includes(s)
    })
  }, [orders, search])

  const openView = (o) => {
    setViewOrder(o)
    setViewOpen(true)
  }

  useEffect(() => {
    if (user?.type !== 'rep' || !user?.authenticated) return
    ;(async () => {
      try {
        const res = await fetch('/api/departments/list', { cache: 'no-store' })
        const j = await res.json()
        if (j?.ok) setDepartments(j.departments || [])
      } catch {}
    })()
  }, [user])

  // Pre-select department from login prefs (set at login time)
  useEffect(() => {
    if (user?.type === 'rep' && user?.department && !dept) {
      setDept(user.department)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Branch summary strip — today's pending queue + this cycle's posted figures.
  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/rep/orders/stats', { cache: 'no-store' })
      const j = await res.json()
      if (j?.ok) setStats(j)
    } catch {
      // Best-effort — never block the page on the strip.
    }
  }, [])

  useEffect(() => {
    if (user?.type !== 'rep' || !user?.authenticated) return
    loadStats()
  }, [user, loadStats])

  // Keep the strip (and the current page's order list) fresh without a
  // reload: refetch on the shared rep-food-stats event (announced by admin
  // pages after post/deliver/cancel/restore and by this page after its own
  // deliver action), on tab re-focus, and on a 30s poll so posts made from
  // another device still show up.
  useEffect(() => {
    if (user?.type !== 'rep' || !user?.authenticated) return
    const refresh = () => {
      loadStats()
      fetchOrders(null, { silent: true })
    }
    const off = onRepFoodStatsChanged(refresh)
    const t = setInterval(refresh, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      off()
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => { 
    if (user?.type !== 'rep' || !user?.authenticated) return
    fetchOrders(null) 
  }, [dept, user])

  const resetPagination = () => {
    setCursorStack([null])
    setPageIndex(0)
    setNextCursor(null)
  }

  const fetchOrders = async (cursorOverride, opts = null) => {
    const silent = opts?.silent === true
    if (!silent) { setLoading(true); setMsg(null) }
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 5000)
    try {
      const cursor = cursorOverride !== undefined ? cursorOverride : cursorStack[pageIndex] || null
      const qs = new URLSearchParams({ status: 'Posted', limit: String(pageSize) })
      if (dept) qs.set('dept', dept)
      if (cursor) { qs.set('cursor', String(cursor)); qs.set('dir', 'next') }
      const res = await fetch(`/api/rep/orders/list?${qs.toString()}`, { cache: 'no-store', headers:{ 'Accept':'application/json' }, signal: ctl.signal })
      const json = await safeJson(res, '/api/rep/orders/list')
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed')
      setOrders(json.orders || [])
      setNextCursor(json.nextCursor || null)
    } catch (e) {
      if (e.name !== 'AbortError' && !silent) setMsg({ type:'error', text:e.message })
    } finally {
      clearTimeout(timer)
      if (!silent) setLoading(false)
      setDidLoadOnce(true)
    }
  }

  // Collect all posted orders for current filters (used by exports to avoid pagination truncation)
  const collectAllOrdersForExport = async () => {
    const base = new URLSearchParams({ status: 'Posted', limit: '200' })
    if (dept) base.set('dept', dept)
    let cursor = null
    let all = []
    for (let page = 0; page < 100; page++) { // hard cap to prevent infinite loops
      const qs = new URLSearchParams(base)
      if (cursor) { qs.set('cursor', cursor); qs.set('dir', 'next') }
      const res = await fetch(`/api/rep/orders/list?${qs.toString()}`, { cache: 'no-store', headers:{ 'Accept':'application/json' } })
      const j = await safeJson(res, '/api/rep/orders/list')
      if (!res.ok || !j.ok) throw new Error(j.error || 'Failed to collect orders for export')
      all = all.concat(j.orders || [])
      if (!j.nextCursor) break
      cursor = j.nextCursor
    }
    return all
  }

  const deliverOne = async (id) => {
    setShowModal({ 
      type: 'deliver', 
      orderId: id, 
      title: 'Deliver Order', 
      message: `Mark order ${id} as delivered?`,
      placeholder: 'Delivered by (name or rep)'
    })
    setModalInput('rep')
  }

  const handleDeliverSubmit = async () => {
    const { orderId } = showModal
    const deliveredBy = modalInput.trim() || 'rep'
    setDeliveringOrder(orderId)
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 8000)
      const res = await fetch('/api/rep/orders/deliver', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderId, deliveredBy }),
        signal: ctl.signal
      })
      const j = await safeJson(res, '/api/rep/orders/deliver')
      if (!res.ok || !j.ok) throw new Error(j.error || 'Deliver failed')
      setOrders(orders.filter(o => o.order_id !== orderId))
      setMsg({ type:'success', text:`Order ${orderId} delivered successfully` })
      setModalInput('')
      announceRepFoodStats()
      loadStats()
    } catch (e) {
      if (e.name === 'AbortError') {
        setMsg({ type:'error', text:'Delivery request timed out after 8s. Please check network and try again.' })
      } else {
        setMsg({ type:'error', text:e.message })
      }
    } finally {
      try { clearTimeout(timer) } catch {}
      setDeliveringOrder(null)
      // Always close the modal after finishing (success or error)
      setShowModal(null)
    }
  }

  const exportPDF = async () => {
    // Load all pages to prevent partial exports
    const sourceOrders = await collectAllOrdersForExport()
    if (!sourceOrders.length) return alert('No rows to export')
    setPdfLoading(true)
    try {
      // Determine delivery branch from filtered data
      const filteredForHeader = !search ? sourceOrders : sourceOrders.filter(o => {
        const s = search.toLowerCase()
        return String(o.order_id).toLowerCase().includes(s) || String(o.member_id).toLowerCase().includes(s)
      })
      const branchSet = new Set(filteredForHeader.map(o => o?.delivery?.name).filter(Boolean))
      const branchLabel = branchSet.size === 1 ? [...branchSet][0] : (branchSet.size > 1 ? 'Multiple Delivery Branches' : 'All Delivery Branches')

      const headers = ['ID','Order','Member','Dept','Pay','Item','Qty','Unit Price','Amount','Remarks','Sign']
      const sanitize = sanitizePdfText
      const doc = await createManifestDoc({
        title: 'Posted Orders Manifest',
        meta: `Delivery Branch: ${branchLabel}${dept ? '  |  Department: ' + dept : ''}`,
      })
    const filtered = !search ? sourceOrders : sourceOrders.filter(o => {
      const s = search.toLowerCase()
      return String(o.order_id).toLowerCase().includes(s) || String(o.member_id).toLowerCase().includes(s)
    })
    const rows = filtered.flatMap(o => (o.order_lines || [])
      .filter(l => {
        if (!dept) return true
        const orderDeptName = o.departments?.name
        const itemDeptId = l?.items?.department_id
        const orderMatches = String(orderDeptName || '').trim().toLowerCase() === String(dept).trim().toLowerCase()
        return orderMatches || Boolean(itemDeptId)
      })
      .map(l => ([
      sanitize(o.member_id),
      sanitize(o.order_id),
      sanitize(o.member_name_snapshot),
      sanitize(o.departments?.name),
      sanitize(o.payment_option),
      sanitize(l.items?.name),
      String(l.qty || 0),
      `NGN ${Number(l.unit_price || 0).toLocaleString()}`,
      `NGN ${Number(l.amount || 0).toLocaleString()}`,
      '',
      '',
    ])))

    // Compute totals for Qty and Amount
    const lineItems = filtered.flatMap(o => (o.order_lines || [])
      .filter(l => {
        if (!dept) return true
        const orderDeptName = o.departments?.name
        const itemDeptId = l?.items?.department_id
        const orderMatches = String(orderDeptName || '').trim().toLowerCase() === String(dept).trim().toLowerCase()
        return orderMatches || Boolean(itemDeptId)
      }))
    const totalQty = lineItems.reduce((acc, l) => acc + Number(l?.qty || 0), 0)
    const totalAmount = lineItems.reduce((acc, l) => acc + Number(l?.amount || 0), 0)
    // Create a foot row: label under Item, totals under Qty and Amount
    const footRow = headers.map((_, i) => {
      if (i === 5) return 'TOTAL'
      if (i === 6) return String(totalQty)
      if (i === 8) return `NGN ${Number(totalAmount).toLocaleString()}`
      return ''
    })

    await addManifestTable(doc, {
      head: headers,
      body: rows,
      startY: 30,
      columnStyles: {
        0: { cellWidth: 16 },   // ID
        1: { cellWidth: 14 },   // Order
        2: { cellWidth: 40 },   // Member
        3: { cellWidth: 28 },   // Dept
        4: { cellWidth: 16 },   // Pay
        5: { cellWidth: 45 },   // Item
        6: { cellWidth: 12, halign: 'right' },   // Qty
        7: { cellWidth: 22, halign: 'right' },   // Unit Price
        8: { cellWidth: 24, halign: 'right' },   // Amount
        9: { cellWidth: 36 },   // Remarks
        10: { cellWidth: 14 },  // Signature
      },
      options: {
        foot: [footRow],
        showFoot: 'lastPage',
        footStyles: { fillColor: [75, 85, 99], textColor: [255,255,255], fontStyle: 'bold', fontSize: 8, halign: 'right', lineWidth: 0.1 },
        headStyles: { fillColor: [75, 85, 99], fontSize: 9, halign: 'center', valign: 'middle', textColor: [255,255,255] },
        didParseCell: (data) => {
          if (data.section === 'foot') {
            if (data.column.index === 5) {
              data.cell.styles.halign = 'center' // TOTAL label under Item
            }
            if (data.column.index === 6 || data.column.index === 8) {
              data.cell.styles.halign = 'right' // Qty and Amount totals
            }
          }
        },
        didDrawPage: (data) => {
          // Repeat header on subsequent pages
          if (data.pageNumber > 1) {
            doc.setFontSize(14)
            doc.text('Posted Orders Manifest', 12, 12)
            doc.setFontSize(9)
            doc.text(`Generated: ${new Date().toLocaleString()}`, 12, 18)
            doc.text(`Delivery Branch: ${branchLabel}${dept ? '  |  Department: ' + dept : ''}`, 12, 24)
          }
        },
      },
    })
    // Footer rows appended after main table
    const makeRow = (mapper) => headers.map((_, i) => mapper(i))
    const sigDateRow = makeRow(i => i === 4 ? 'DATE' : (i === 5 ? 'SIGNATURE' : ''))
    const issuedRow = makeRow(i => i === 2 ? 'ITEMS ISSUED BY' : '')
    const receivedRow = makeRow(i => i === 2 ? 'ITEMS RECEIVED BY' : '')
    await renderTable(doc, {
      head: [],
      body: [sigDateRow, issuedRow, receivedRow],
      startY: (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 6 : undefined,
      rowPageBreak: 'avoid',
      styles: { fontSize: 9, lineWidth: 0.1, lineColor: [0,0,0], cellPadding: 2 },
      theme: 'grid'
    })
    doc.save('rep_posted_manifest.pdf')
    } catch (error) {
      console.error('Error exporting PDF:', error)
      alert(`PDF export failed: ${error.message}`)
    } finally {
      setPdfLoading(false)
    }
  }

  const exportExcel = async () => {
    setExcelLoading(true)
    // Load all pages to prevent partial exports
    const sourceOrders = await collectAllOrdersForExport()
    const filtered = !search ? sourceOrders : sourceOrders.filter(o => {
      const s = search.toLowerCase()
      return String(o.order_id).toLowerCase().includes(s) || String(o.member_id).toLowerCase().includes(s)
    })
    const rows = filtered.flatMap(o => (o.order_lines || [])
      .filter(l => {
        if (!dept) return true
        const orderDeptName = o.departments?.name
        const itemDeptId = l?.items?.department_id
        const orderMatches = String(orderDeptName || '').trim().toLowerCase() === String(dept).trim().toLowerCase()
        return orderMatches || Boolean(itemDeptId)
      })
      .map(l => ({
        id:o.member_id,
        order:o.order_id,
        member:o.member_name_snapshot,
        dept:o.departments?.name||'',
        pay:o.payment_option,
        item:l.items?.name,
        qty:Number(l.qty||0),
        unit_price:Number(l.unit_price||0),
        amount:Number(l.amount||0),
        remarks:'',
        signature:''
      })))
    if (!rows.length) return alert('No rows to export')

    try {
      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Posted Orders')

      const heading = 'Posted Orders Manifest'
      ws.addRow([heading])
      ws.mergeCells('A1','K1')
      ws.getRow(1).font = { bold: true, size: 14 }
      ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' }

      // Derive delivery branch from filtered rows
      const branchSet = new Set(filtered.map(o => o?.delivery?.name).filter(Boolean))
      const branchLabel = branchSet.size === 1 ? [...branchSet][0] : (branchSet.size > 1 ? 'Multiple Delivery Branches' : 'All Delivery Branches')
      const details = `Delivery Branch: ${branchLabel}${dept ? '  |  Department: ' + dept : ''}`
      ws.addRow([details])
      ws.mergeCells('A2','K2')
      ws.getRow(2).font = { italic: true }
      ws.getRow(2).alignment = { vertical: 'middle', horizontal: 'center' }

      const headers = ['ID','Order','Member','Dept','Pay','Item','Qty','Unit Price','Amount','Remarks','Sign']
      const headerRow = ws.addRow(headers)
      headerRow.font = { bold: true }
      headerRow.eachCell(cell => {
        cell.border = { top: {style: 'thin'}, left: {style: 'thin'}, bottom: {style: 'thin'}, right: {style: 'thin'} }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
      })

      rows.forEach(r => {
        const row = ws.addRow([r.id, r.order, r.member, r.dept, r.pay, r.item, r.qty, r.unit_price, r.amount, r.remarks, r.signature])
        row.eachCell(cell => {
          cell.border = { top: {style: 'thin'}, left: {style: 'thin'}, bottom: {style: 'thin'}, right: {style: 'thin'} }
        })
      })

      const totalQty = rows.reduce((acc, r) => acc + Number(r.qty||0), 0)
      const totalAmount = rows.reduce((acc, r) => acc + Number(r.amount||0), 0)
      const totalsRow = ws.addRow(['', '', 'TOTAL', '', '', '', totalQty, '', totalAmount, '', ''])
      totalsRow.eachCell(cell => {
        cell.border = { top: {style: 'thin'}, left: {style: 'thin'}, bottom: {style: 'thin'}, right: {style: 'thin'} }
        cell.font = { bold: true }
      })

      const totalsRowNumber = ws.rowCount

      ws.columns = [
        { width: 10 }, // ID
        { width: 10 }, // Order
        { width: 26 }, // Member
        { width: 18 }, // Dept
        { width: 10 }, // Pay
        { width: 26 }, // Item
        { width: 8 },  // Qty
        { width: 12 }, // Unit Price
        { width: 14 }, // Amount
        { width: 18 }, // Remarks
        { width: 14 }, // Signature
      ]

      for (let r = 3; r <= totalsRowNumber; r++) {
        ws.getCell(`G${r}`).numFmt = '#,##0'
        ws.getCell(`H${r}`).numFmt = '#,##0'
        ws.getCell(`I${r}`).numFmt = '#,##0'
      }

      // Footer rows: place labels under Column C and move DATE/SIGNATURE closer (E/F)
      const footerSigDate = ['', '', '', '', 'DATE', 'SIGNATURE', '', '', '', '', '']
      const footerIssued = ['', '', 'ITEMS ISSUED BY', '', '', '', '', '', '', '', '']
      const footerReceived = ['', '', 'ITEMS RECEIVED BY', '', '', '', '', '', '', '', '']
      const fsr1 = ws.addRow(footerSigDate)
      const fsr2 = ws.addRow(footerIssued)
      const fsr3 = ws.addRow(footerReceived)
      ;[fsr1, fsr2, fsr3].forEach(r => {
        r.eachCell(cell => {
          cell.border = { top: {style: 'thin'}, left: {style: 'thin'}, bottom: {style: 'thin'}, right: {style: 'thin'} }
        })
      })

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'rep_posted_manifest.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error exporting Excel:', error)
      alert(`Excel export failed: ${error.message}`)
    } finally {
      setExcelLoading(false)
    }
  }

  const exportItemsPack = async () => {
    try {
      setItemsPackLoading(true)
      const qs = new URLSearchParams()
      if (dept) qs.set('dept', dept)
      const res = await fetch(`/api/rep/items-pack?${qs.toString()}`, { cache: 'no-store' })
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) throw new Error(`Unexpected response (${res.status})`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load items pack')

      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Items Pack')

      const branchLabel = json.branch?.name || json.branch?.code || (user?.branchCode || 'Branch')
      const title = `Summary of Items from ${branchLabel}${dept ? ' · ' + dept : ''}`
      const headers = ['SN','Items','Category','Price','Quantity','Amount']

      ws.addRow([title])
      ws.addRow(headers)

      let sn = 0
      let totalQty = 0
      let totalAmount = 0

      const sorted = [...(json.rows || [])].sort((a,b)=>{
        const ac = String(a.category||'').toLowerCase()
        const bc = String(b.category||'').toLowerCase()
        if (ac < bc) return -1
        if (ac > bc) return 1
        const ai = String(a.items||'').toLowerCase()
        const bi = String(b.items||'').toLowerCase()
        if (ai < bi) return -1
        if (ai > bi) return 1
        return 0
      })

      for (const r of sorted) {
        sn += 1
        const original = Number(r.original_price || 0)
        const markup = Number(r.markup || 0)
        const qty = Number(r.quantity || 0)
        const price = original + markup
        const amount = price * qty
        totalQty += qty
        totalAmount += amount
        ws.addRow([sn, r.items, r.category || '', price, qty, amount])
      }

      // Totals row
      ws.addRow(['','TOTAL','','', totalQty, totalAmount])

      // Record the row number of totals to control numeric formatting
      const totalsRowNumber = ws.rowCount

      // Footer rows: SIGNATURE/DATE at right, move Issued/Received under column C
      ws.addRow(['', '', '', '', 'SIGNATURE', 'DATE'])
      ws.addRow(['', '', 'ITEMS ISSUED BY', '', '', ''])
      ws.addRow(['', '', 'ITEMS RECEIVED BY', '', '', ''])

      ws.mergeCells('A1','F1')
      ws.columns = [
        { key:'sn', width:6 },
        { key:'items', width:28 },
        { key:'category', width:18 },
        { key:'price', width:14 },
        { key:'qty', width:10 },
        { key:'amount', width:18 },
      ]
      const titleCell = ws.getCell('A1')
      titleCell.font = { bold:true, size:13 }
      titleCell.alignment = { horizontal:'center' }
      const headerRow = ws.getRow(2)
      headerRow.font = { bold:true }
      headerRow.alignment = { horizontal:'center' }
      const lastRow = ws.rowCount
      for (let r = 2; r <= lastRow; r++) {
        for (let c = 1; c <= 6; c++) {
          const cell = ws.getRow(r).getCell(c)
          cell.border = { top:{style:'thick'}, left:{style:'thick'}, bottom:{style:'thick'}, right:{style:'thick'} }
          // Apply numeric formats only for data and totals rows, not footer rows
          if (r >= 3 && r <= totalsRowNumber && c >= 4) {
            if (c === 5) cell.numFmt = '0'; else cell.numFmt = '#,##0'
          }
        }
      }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Items_Pack_${branchLabel}_${dept || 'ALL_DEPTS'}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Rep Items Pack export failed:', e)
      alert(`Items Pack export failed: ${e.message}`)
    } finally {
      setItemsPackLoading(false)
    }
  }

  const exportItemsPackPDF = async () => {
    try {
      const qs = new URLSearchParams()
      if (dept) qs.set('dept', dept)
      const res = await fetch(`/api/rep/items-pack?${qs.toString()}`, { cache: 'no-store' })
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) throw new Error(`Unexpected response (${res.status})`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load items pack')

      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

      const branchLabel = json.branch?.name || json.branch?.code || (user?.branchCode || 'Branch')
      const title = `Summary of Items from ${branchLabel}${dept ? ' · ' + dept : ''}`
      doc.setFontSize(16); doc.text(title, 14, 22)
      doc.setFontSize(10); doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30)

      const headers = ['SN','Items','Category','Price','Quantity','Amount']
      const sanitize = s => String(s ?? '').replace(/\u20A6|₦/g, 'NGN ')
      const sorted = [...(json.rows || [])].sort((a,b)=>{
        const ac = String(a.category||'').toLowerCase()
        const bc = String(b.category||'').toLowerCase()
        if (ac < bc) return -1
        if (ac > bc) return 1
        const ai = String(a.items||'').toLowerCase()
        const bi = String(b.items||'').toLowerCase()
        if (ai < bi) return -1
        if (ai > bi) return 1
        return 0
      })

      let sn = 0
      let totalQty = 0
      let totalAmount = 0
      const body = sorted.map(r => {
        sn += 1
        const original = Number(r.original_price || 0)
        const markup = Number(r.markup || 0)
        const qty = Number(r.quantity || 0)
        const price = original + markup
        const amount = price * qty
        totalQty += qty
        totalAmount += amount
        return [
          String(sn),
          sanitize(r.items),
          sanitize(r.category || ''),
          `NGN ${Number(price).toLocaleString()}`,
          Number(qty).toLocaleString(),
          `NGN ${Number(amount).toLocaleString()}`
        ]
      })

      const totalsRow = [ '', 'TOTAL', '', '', Number(totalQty).toLocaleString(), `NGN ${Number(totalAmount).toLocaleString()}` ]
      const tableData = [...body, totalsRow]

      autoTable(doc, {
        head: [headers],
        body: tableData,
        startY: 36,
        rowPageBreak: 'avoid',
        styles: { fontSize: 9, lineWidth: 0.1, lineColor: [0,0,0], cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [75, 85, 99], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        theme: 'grid',
        columnStyles: {
          0: { cellWidth: 12, halign: 'right' }, // SN
          1: { cellWidth: 92 }, // Items
          2: { cellWidth: 46 }, // Category
          3: { cellWidth: 26, halign: 'right' }, // Price
          4: { cellWidth: 26, halign: 'right' }, // Quantity
          5: { cellWidth: 32, halign: 'right' }, // Amount
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.row.index === tableData.length - 1) {
            data.cell.styles.fillColor = [75, 85, 99]
            data.cell.styles.textColor = [255, 255, 255]
            data.cell.styles.fontStyle = 'bold'
          }
        },
      })

      // Footer rows
      const makeRow = (mapper) => headers.map((_, i) => mapper(i))
      const sigDateRow = makeRow(i => i === headers.length - 2 ? 'SIGNATURE' : (i === headers.length - 1 ? 'DATE' : ''))
      const issuedRow = makeRow(i => i === 2 ? 'ITEMS ISSUED BY' : '')
      const receivedRow = makeRow(i => i === 2 ? 'ITEMS RECEIVED BY' : '')
      autoTable(doc, {
        head: [],
        body: [sigDateRow, issuedRow, receivedRow],
        startY: (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 6 : undefined,
      rowPageBreak: 'avoid',
        styles: { fontSize: 9, lineWidth: 0.1, lineColor: [0,0,0], cellPadding: 2 },
        theme: 'grid'
      })

      doc.save(`Items_Pack_${branchLabel}_${dept || 'ALL_DEPTS'}.pdf`)
    } catch (e) {
      console.error('Rep Items Pack PDF export failed:', e)
      alert(`Items Pack PDF export failed: ${e.message}`)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Branch summary strip — today's pending queue the rep clears, plus this
          cycle's posted / delivered totals, mirroring the exhibition strip. */}
      {stats && (
        <>
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand/5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-brand">
            <Zap className="h-3.5 w-3.5" strokeWidth={2.2} />
            Today's pending
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtext sm:justify-end">
            <span className="inline-flex items-center gap-1.5">
              <span className="font-semibold text-fg">
                {(stats.todayPending?.count || 0).toLocaleString()} order{(stats.todayPending?.count || 0) === 1 ? '' : 's'}
              </span>
              <span className="text-line-strong">·</span>
              <span className="font-semibold text-fg">{naira(stats.todayPending?.total || 0)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5 text-brand" strokeWidth={2.2} />
              Posted this cycle
              <span className="font-semibold text-fg">{(stats.postedCycle?.count || 0).toLocaleString()}</span>
              <span className="text-line-strong">·</span>
              <span className="font-semibold text-fg">{naira(stats.postedCycle?.total || 0)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5 text-brand" strokeWidth={2.2} />
              Delivered this cycle
              <span className="font-semibold text-fg">{(stats.deliveredCycle?.count || 0).toLocaleString()}</span>
              <span className="text-line-strong">·</span>
              <span className="font-semibold text-fg">{naira(stats.deliveredCycle?.total || 0)}</span>
            </span>
          </span>
        </div>
        {/* Branch-wide status cards — the same at-a-glance overview the
            exhibition pending view shows. The posted card is highlighted
            because that's the queue this page clears. */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {[
            { key: 'Pending', icon: Clock, delta: `${stats.todayPending?.count || 0} new today` },
            { key: 'Posted', icon: Package, delta: 'awaiting delivery' },
            { key: 'Delivered', icon: Truck, delta: 'handed to members' },
            { key: 'Cancelled', icon: XCircle, delta: 'admin can restore' },
          ].map(({ key, icon: Icon, delta }) => {
            const st = stats.statuses?.[key] || { count: 0, total: 0 }
            const active = key === 'Posted'
            return (
              <div
                key={key}
                className={[
                  'rounded-xl border bg-surface p-3 transition-colors duration-200 ease-sakani',
                  active ? 'border-brand/50 ring-1 ring-brand/25' : 'border-line-subtle',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                    <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                    {key}
                  </span>
                  {active && <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">Viewing</span>}
                </div>
                <p className="mt-1.5 text-[clamp(1.125rem,1.125rem+0.22vw,1.375rem)] font-semibold leading-tight tracking-tight text-fg">
                  {st.count.toLocaleString()}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-subtext">{naira(st.total)}</p>
                <p className="mt-1 truncate text-[10px] text-muted">{delta}</p>
              </div>
            )
          })}
        </div>
        </>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-h2 font-bold tracking-tight text-fg">Food Distribution · Posted</h1>
          <div className="text-xs text-muted">Current Branch: {user?.branchCode || '—'}</div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover disabled:opacity-50 whitespace-nowrap"
          disabled={itemsPackLoading}
          onClick={exportItemsPack}
          aria-busy={itemsPackLoading}
        >
          {itemsPackLoading && <Spinner className="h-4 w-4 text-on-accent" />}
          <span>{itemsPackLoading ? 'Downloading…' : 'Items Pack'}</span>
        </button>
      </div>

      <div className="ui-card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="bg-surface rounded-lg border border-line px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 w-full sm:w-56 shrink-0"
            value={dept}
            onChange={(e) => {
              const v = e.target.value
              setDept(v)
              resetPagination()
              setOrders([])
            }}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 flex-1 min-w-[240px] sm:max-w-[560px]">
            <input
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs sm:text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              placeholder="Search (Order / Member)"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearch(searchInput.trim())
              }}
            />
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50 whitespace-nowrap"
              onClick={() => setSearch(searchInput.trim())}
              disabled={loading}
            >
              Search
            </button>
          </div>

            <ExportButton
              format="excel"
              onClick={() => exportExcel().catch(() => null)}
              disabled={excelLoading}
              busy={excelLoading}
              busyText="Preparing…"
            />
            <ExportButton
              format="pdf"
              onClick={() => exportPDF().catch(() => null)}
              disabled={pdfLoading}
              busy={pdfLoading}
              busyText="Preparing…"
            />
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
              onClick={() => fetchOrders(undefined).catch(() => null)}
              disabled={loading}
              aria-busy={loading}
            >
              {loading && <Spinner className="h-4 w-4 text-on-accent" />}
              <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
            </button>
        </div>
      </div>

      {msg && <div className={`mb-3 text-sm ${msg.type==='error'?'text-danger-fg':'text-success-fg'}`}>{msg.text}</div>}

      <div className="ui-card overflow-hidden">
        <div className="p-4 border-b border-line bg-subtle flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-sm font-semibold">Posted Orders</div>
          <div className="flex items-center gap-2 text-xs font-normal text-subtext">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => {
                if (pageIndex <= 0) return
                const prevIndex = pageIndex - 1
                setPageIndex(prevIndex)
                fetchOrders(cursorStack[prevIndex] || null).catch(() => null)
              }}
              disabled={loading || pageIndex <= 0}
            >
              Prev
            </button>
            <div>Page {pageIndex + 1}</div>
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
              onClick={() => {
                if (!nextCursor) return
                const nextIndex = pageIndex + 1
                setCursorStack((prev) => {
                  const next = [...(prev || [])]
                  if (next.length <= nextIndex) next.push(nextCursor)
                  return next
                })
                setPageIndex(nextIndex)
                fetchOrders(nextCursor).catch(() => null)
              }}
              disabled={loading || !nextCursor}
            >
              Next
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-subtle border-b border-line">
              <tr>
                <th className="px-3 py-3 text-left font-semibold text-fg">Order</th>
                <th className="px-3 py-3 text-left font-semibold text-fg">Member</th>
                <th className="px-3 py-3 text-left font-semibold text-fg">Department</th>
                <th className="px-3 py-3 text-left font-semibold text-fg">Payment</th>
                <th className="px-3 py-3 text-right font-semibold text-fg">Total + Int</th>
                <th className="px-3 py-3 text-left font-semibold text-fg">Date</th>
                <th className="px-3 py-3 text-right font-semibold text-fg">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {!didLoadOnce || (loading && filteredOrders.length === 0) ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={`sk_${i}`}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={`sk_${i}_${j}`} className="px-3 py-3">
                        <div className="h-4 w-full sakani-skeleton rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted">
                    No Posted orders.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o) => (
                  <tr key={o.order_id} className="hover:bg-subtle">
                    <td className="px-3 py-3 font-medium text-fg">#{o.order_id}</td>
                    <td className="px-3 py-3">
                      <div className="text-fg">{o.member_name_snapshot}</div>
                      <div className="text-xs text-muted">{o.member_id}</div>
                    </td>
                    <td className="px-3 py-3">{o.departments?.name || '-'}</td>
                    <td className="px-3 py-3">{o.payment_option}</td>
                    <td className="px-3 py-3 text-right font-semibold">₦{Number(o.total_amount || 0).toLocaleString()}</td>
                    <td className="px-3 py-3">{new Date(o.posted_at || o.created_at).toLocaleString()}</td>
                    <td className="px-3 py-3 text-right">
                      <select
                        defaultValue=""
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none disabled:opacity-50"
                        onChange={(e) => {
                          const v = e.target.value
                          e.target.value = ''
                          if (!v) return
                          if (v === 'view') openView(o)
                          if (v === 'deliver') deliverOne(o.order_id)
                          if (v === 'sheet') setSheetOrder(o)
                        }}
                        disabled={deliveringOrder === o.order_id}
                      >
                        <option value="" disabled>
                          Actions
                        </option>
                        <option value="view">View</option>
                        <option value="deliver">Deliver</option>
                        <option value="sheet">Print sheet</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DraggableModal
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        title={viewOrder ? `Order #${viewOrder.order_id}` : 'Order'}
        widthClass="w-[94vw] max-w-4xl mx-4"
      >
        {!viewOrder ? (
          <div className="text-sm text-muted">No order selected.</div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">
              <div>
                <span className="text-muted">Member:</span> <span className="font-medium">{viewOrder.member_name_snapshot}</span>{' '}
                <span className="text-muted">({viewOrder.member_id})</span>
              </div>
              <div className="text-muted">
                {viewOrder.member_branch?.name ? `Member Branch: ${viewOrder.member_branch.name} • ` : ''}
                {viewOrder.delivery?.name ? `Delivery: ${viewOrder.delivery.name} • ` : ''}
                {viewOrder.departments?.name ? `Department: ${viewOrder.departments.name}` : 'Department: -'}
              </div>
              <div className="text-muted">
                Payment: <span className="font-medium">{viewOrder.payment_option}</span> • Total:{' '}
                <span className="font-semibold">₦{Number(viewOrder.total_amount || 0).toLocaleString()}</span>
              </div>
            </div>

            <div className="ui-card overflow-hidden">
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-xs sm:text-sm min-w-[560px]">
                  <thead className="sticky top-0 z-10 bg-surface">
                    <tr>
                      <th className="px-3 py-2 text-left w-40 hidden md:table-cell">SKU</th>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right w-20">Qty</th>
                      <th className="px-3 py-2 text-right w-28">Unit Price</th>
                      <th className="px-3 py-2 text-right w-28">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {(viewOrder.order_lines || []).length ? (
                      (viewOrder.order_lines || []).map((l) => (
                        <tr key={l.id}>
                          <td className="px-3 py-2 font-mono text-xs break-all hidden md:table-cell">{l.items?.sku || ''}</td>
                          <td className="px-3 py-2 whitespace-normal break-words min-w-[220px]">{l.items?.name || ''}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{Number(l.qty || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">₦{Number(l.unit_price || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">₦{Number(l.amount || 0).toLocaleString()}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-3 py-3 text-muted" colSpan={5}>
                          No items found for this order.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </DraggableModal>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-surface/10 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-surface p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h3 className="text-[15px] font-semibold mb-4">{showModal.title}</h3>
            <p className="text-muted mb-4">{showModal.message}</p>
            <input
              type="text"
              value={modalInput}
              onChange={(e) => setModalInput(e.target.value)}
              placeholder={showModal.placeholder}
              className="w-full p-2 border rounded mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 border rounded hover:bg-subtle"
                onClick={() => { setShowModal(null); setModalInput('') }}
              >
                Cancel
              </button>
              <button
                className={`px-4 py-2 rounded transition-all duration-200 ${
                  deliveringOrder === showModal.orderId 
                    ? 'cursor-not-allowed bg-muted text-on-accent' 
                    : 'bg-success-fg text-on-accent hover:brightness-110'
                }`}
                onClick={handleDeliverSubmit}
                disabled={deliveringOrder === showModal.orderId}
              >
                {deliveringOrder === showModal.orderId ? (
                  <div className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-1 h-4 w-4 text-on-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Delivering...
                  </div>
                ) : (
                  'Deliver'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print-optimized order sheet — hand this to the packer/delivery team */}
      <PrintOrderSheet
        open={!!sheetOrder}
        onClose={() => setSheetOrder(null)}
        module="food"
        order={sheetOrder}
      />
    </div>
  )
}

export default function RepPostedPage() {
  return (
    <ProtectedRoute allowedRoles={['rep']}>
      <RepPostedPageContent />
    </ProtectedRoute>
  )
}
