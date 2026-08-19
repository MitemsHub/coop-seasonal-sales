// app/admin/inventory/page.jsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import ExportButton from '../../../components/ui/ExportButton'


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

// Department Inventory Section Component
function DepartmentInventorySection() {
  const [departmentData, setDepartmentData] = useState([])
  const [departments, setDepartments] = useState([])
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPDF, setExportingPDF] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState('All Branches')
  const [selectedDepartment, setSelectedDepartment] = useState('All Departments')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Safe JSON helper
  const safeJson = async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }

  // Load departments and branches
  useEffect(() => {
    const ac = new AbortController()
    loadDepartments(ac.signal)
    loadBranches(ac.signal)
    return () => {
      ac.abort()
    }
  }, [])

  // Load department inventory data when filters change
  useEffect(() => {
    loadDepartmentInventory()
  }, [selectedBranch, selectedDepartment])

  const loadDepartments = async (signal) => {
    try {
      const response = await fetch('/api/admin/inventory/department-status', {
        method: 'OPTIONS',
        signal
      })
      const data = await safeJson(response, '/api/admin/inventory/department-status (OPTIONS)')
      setDepartments(data.departments || [])
    } catch (error) {
      if (error?.name === 'AbortError' || /aborted|Abort|Failed to fetch|NETWORK_ERROR/i.test(error?.message || '')) {
        return
      }
      console.error('Error loading departments:', error)
    }
  }

  const loadBranches = async (signal) => {
    try {
      // Align with Branch section: load from /api/branches/list
      const res = await fetch('/api/branches/list', { cache: 'no-store', signal })
      const json = await res.json()
      if (json.ok) {
        setBranches(json.branches || [])
      }
    } catch (error) {
      if (error?.name === 'AbortError' || /aborted|Abort|Failed to fetch|NETWORK_ERROR/i.test(error?.message || '')) {
        return
      }
      console.error('Error loading branches:', error)
    }
  }

  const loadDepartmentInventory = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedBranch !== 'All Branches') params.append('branch', selectedBranch)
      if (selectedDepartment !== 'All Departments') params.append('department', selectedDepartment)
      
      const response = await fetch(`/api/admin/inventory/department-status?${params}`, { cache: 'no-store' })
      const result = await safeJson(response, '/api/admin/inventory/department-status')
      setDepartmentData(result.data || [])
    } catch (error) {
      if (error?.name === 'AbortError' || /aborted|Abort|Failed to fetch|NETWORK_ERROR/i.test(error?.message || '')) {
        // navigation or duplicate renders can abort fetches in dev; ignore
        setDepartmentData([])
        setLoading(false)
        return
      }
      console.error('Error loading department inventory:', error)
      setDepartmentData([])
    } finally {
      setLoading(false)
    }
  }

  // Pagination logic
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedData = useMemo(() => {
    return departmentData.slice(startIndex, startIndex + itemsPerPage)
  }, [departmentData, currentPage, itemsPerPage])

  const totalPages = Math.ceil(departmentData.length / itemsPerPage)
  const showPagination = departmentData.length > itemsPerPage

  const exportDepartmentExcel = async () => {
    if (!departmentData?.length) return
    setExportingExcel(true)
    try {
      const headers = ['Branch', 'Department', 'SKU', 'Item', 'Pending', 'Posted', 'Delivered', 'Total Demand']
      const rows = departmentData.map((row) => [
        row.branch_name,
        row.department_name,
        row.sku,
        row.item_name,
        row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0,
        row.confirmed_demand ?? row.pending_delivery_qty ?? 0,
        row.delivered_qty ?? row.delivered_demand ?? 0,
        row.total_demand ??
          (row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0) +
            (row.confirmed_demand ?? row.pending_delivery_qty ?? 0) +
            (row.delivered_qty ?? row.delivered_demand ?? 0),
      ])

      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Department Inventory')
      ws.addRow(['Food Distribution · Department Inventory'])
      ws.addRow([`Branch: ${selectedBranch} | Department: ${selectedDepartment}`])
      ws.addRow(headers)
      for (const r of rows) ws.addRow(r)

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `department_inventory_${selectedBranch.replace(/\s+/g, '_')}_${selectedDepartment.replace(/\s+/g, '_')}_${new Date()
        .toISOString()
        .split('T')[0]}.xlsx`
      a.click()
      window.URL.revokeObjectURL(url)
    } finally {
      setExportingExcel(false)
    }
  }

  const exportDepartmentPDF = async () => {
    setExportingPDF(true)
    try {
      // Check if there's data to export
      if (!departmentData || departmentData.length === 0) {
        alert('No data available to export. Please ensure there are items assigned to departments.')
        return
      }

      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      doc.setFontSize(16)
      doc.text('Department Inventory Report', 20, 20)
      doc.setFontSize(10)
      doc.text(`Branch: ${selectedBranch} | Department: ${selectedDepartment}`, 20, 30)
      doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 35)
      
      const tableData = departmentData.map(row => [
        row.branch_name || '',
        row.department_name || '',
        row.sku || '',
        row.item_name || '',
        (row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0),
        (row.confirmed_demand ?? row.pending_delivery_qty ?? 0),
        (row.delivered_qty ?? row.delivered_demand ?? 0),
        (row.total_demand ?? ((row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0) + (row.confirmed_demand ?? row.pending_delivery_qty ?? 0) + (row.delivered_qty ?? row.delivered_demand ?? 0)))
      ])
      
      autoTable(doc, {
        head: [['Branch', 'Department', 'SKU', 'Item', 'Pending', 'Posted', 'Delivered', 'Total Demand']],
        body: tableData,
        startY: 45,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', lineWidth: 0.1, lineColor: [0, 0, 0] },
        headStyles: { fillColor: [75, 85, 99], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        margin: { left: 10, right: 10 },
        columnStyles: {
          0: { cellWidth: 40 }, // Branch
          1: { cellWidth: 40 }, // Department
          2: { cellWidth: 24 }, // SKU
          3: { cellWidth: 80 }, // Item
          4: { cellWidth: 22, halign: 'right' }, // Pending
          5: { cellWidth: 22, halign: 'right' }, // Posted
          6: { cellWidth: 22, halign: 'right' }, // Delivered
          7: { cellWidth: 26, halign: 'right' }, // Total Demand
        },
      })
      
      const branchName = selectedBranch.replace(/\s+/g, '_')
      const deptName = selectedDepartment.replace(/\s+/g, '_')
      doc.save(`department_inventory_${branchName}_${deptName}_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (error) {
      console.error('PDF export error:', error)
      alert('PDF export failed. Please try again.')
    } finally {
      setExportingPDF(false)
    }
  }

  return (
    <div className="mt-8">
      <h2 className="text-h2 font-bold mb-4 sm:mb-6 text-fg">Admin · Inventory by Branch & Department</h2>
      
      {/* Filters and Controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4 sm:mb-6">
        <button
          onClick={loadDepartmentInventory}
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-brand text-on-accent hover:bg-brand-hover text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {loading && <Spinner />}
          <span>{loading ? 'Loading…' : 'Refresh'}</span>
        </button>
        
        <select
          value={selectedBranch}
          onChange={(e) => {
            setSelectedBranch(e.target.value)
            setCurrentPage(1)
          }}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="All Branches">All Branches</option>
          {branches.map(branch => (
            <option key={branch.code} value={branch.name}>{branch.name}</option>
          ))}
        </select>
        
        <select
          value={selectedDepartment}
          onChange={(e) => {
            setSelectedDepartment(e.target.value)
            setCurrentPage(1)
          }}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="All Departments">All Departments</option>
          {departments.map(dept => (
            <option key={dept.id} value={dept.name}>{dept.name}</option>
          ))}
        </select>
        
        <ExportButton
          format="excel"
          onClick={() => exportDepartmentExcel().catch(() => null)}
          disabled={departmentData.length === 0}
          busy={exportingExcel}
        />
        
        <ExportButton
          format="pdf"
          onClick={exportDepartmentPDF}
          disabled={departmentData.length === 0}
          busy={exportingPDF}
        />
      </div>
      
      {/* Data Summary */}
      {departmentData.length > 0 && (
        <div className="text-xs sm:text-sm text-muted mb-3 p-2 sm:p-0">
          Showing {Math.min(startIndex + 1, departmentData.length)} to {Math.min(startIndex + (paginatedData?.length || 0), departmentData.length)} of {departmentData.length} items
        </div>
      )}
      
      {/* Department Inventory Table */}
      <div className="bg-surface rounded-lg shadow-sm border border-line-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-subtle">
              <tr>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-medium text-fg">Branch</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-medium text-fg">Department</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-medium text-fg">SKU</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-medium text-fg">Item</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Pending</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Posted</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Delivered</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Total Demand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-2 sm:px-4 py-2 sm:py-3">
                        <div className="h-4 w-full bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center text-subtext">
                    No department inventory data found. Make sure to run the database migrations first.
                  </td>
                </tr>
              ) : (
                paginatedData.map((row, index) => (
                  <tr 
                    key={`${row.branch_code}-${row.department_id ?? 'no-dept'}-${row.item_id ?? row.sku ?? index}`}
                    className="hover:bg-subtle"
                  >
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-fg">{row.branch_name}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-fg">{row.department_name}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-fg font-mono text-xs">{row.sku}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-fg font-medium">{row.item_name}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-warning-fg">{row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-info-fg">{row.confirmed_demand ?? row.pending_delivery_qty ?? 0}</td>
                     <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-success-fg">{row.delivered_qty ?? row.delivered_demand ?? 0}</td>
                     <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-fg font-medium">{((row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0) + (row.confirmed_demand ?? row.pending_delivery_qty ?? 0) + (row.delivered_qty ?? row.delivered_demand ?? 0))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {showPagination && (
          <div className="flex items-center justify-between px-4 py-3 bg-subtle border-t border-line-subtle">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm border border-line rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-muted">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-sm border border-line rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
            <div className="text-sm text-subtext">
              Showing {Math.min((currentPage - 1) * itemsPerPage + 1, departmentData.length)} to {Math.min(currentPage * itemsPerPage, departmentData.length)} of {departmentData.length} items
            </div>
          </div>
        )}
      </div>
      
      <div className="text-xs sm:text-sm text-muted mt-2 sm:mt-3 p-2 sm:p-0">
        Department inventory shows demand allocation by department within each branch. Run the database migrations to enable this feature.
      </div>
    </div>
  )
}

// Items Inventory Section Component
function ItemsInventorySection() {
  const [itemsData, setItemsData] = useState([])
  const [loading, setLoading] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPDF, setExportingPDF] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Load items inventory data
  const loadItemsInventory = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/inventory/items', { cache: 'no-store' })
      const result = await response.json()
      if (result.ok) {
        setItemsData(result.data || [])
      } else {
        console.error('Failed to load items inventory:', result.error)
        setItemsData([])
      }
    } catch (error) {
      if (error?.name === 'AbortError' || /aborted|Abort|Failed to fetch|NETWORK_ERROR/i.test(error?.message || '')) {
        // Ignore aborts from navigation or duplicate dev renders
        setItemsData([])
        setLoading(false)
        return
      }
      console.error('Error loading items inventory:', error)
      setItemsData([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    const run = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/admin/inventory/items', { cache: 'no-store', signal: ac.signal })
        const result = await response.json()
        if (result.ok) {
          setItemsData(result.data || [])
        } else {
          console.error('Failed to load items inventory:', result.error)
          setItemsData([])
        }
      } catch (error) {
        if (error?.name === 'AbortError' || /aborted|Abort|Failed to fetch|NETWORK_ERROR/i.test(error?.message || '')) {
          return
        }
        console.error('Error loading items inventory:', error)
        setItemsData([])
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }
    run()
    return () => ac.abort()
  }, [])

  // Pagination logic
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedData = itemsData.slice(startIndex, endIndex)
  const totalPages = Math.ceil(itemsData.length / itemsPerPage)
  const showPagination = itemsData.length > itemsPerPage

  const exportItemsExcel = async () => {
    if (!itemsData?.length) return
    setExportingExcel(true)
    try {
      const headers = ['SKU', 'Item', 'Pending', 'Posted', 'Delivered', 'Total Demand']
      const rows = itemsData.map((row) => [
        row.sku,
        row.item_name,
        row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0,
        row.confirmed_demand ?? row.pending_delivery_qty ?? 0,
        row.delivered_qty ?? row.delivered_demand ?? 0,
        row.total_demand ??
          (row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0) +
            (row.confirmed_demand ?? row.pending_delivery_qty ?? 0) +
            (row.delivered_qty ?? row.delivered_demand ?? 0),
      ])

      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Items Inventory')
      ws.addRow(['Food Distribution · Items Inventory'])
      ws.addRow([`Generated: ${new Date().toLocaleString()}`])
      ws.addRow(headers)
      for (const r of rows) ws.addRow(r)

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `items_inventory_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      window.URL.revokeObjectURL(url)
    } finally {
      setExportingExcel(false)
    }
  }

  const exportItemsPDF = async () => {
    setExportingPDF(true)
    try {
      // Check if there's data to export
      if (!itemsData || itemsData.length === 0) {
        alert('No data available to export. Please ensure there are items in the inventory.')
        return
      }

      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      doc.setFontSize(16)
      doc.text('Items Inventory Report', 20, 20)
      doc.setFontSize(10)
      doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 30)
      
      const tableData = itemsData.map(row => [
        row.sku || '',
        row.item_name || '',
        (row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0),
        (row.confirmed_demand ?? row.pending_delivery_qty ?? 0),
        (row.delivered_qty ?? row.delivered_demand ?? 0),
        (row.total_demand ?? ((row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0) + (row.confirmed_demand ?? row.pending_delivery_qty ?? 0) + (row.delivered_qty ?? row.delivered_demand ?? 0)))
      ])
      
      autoTable(doc, {
        head: [['SKU', 'Item', 'Pending', 'Posted', 'Delivered', 'Total Demand']],
        body: tableData,
        startY: 40,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', lineWidth: 0.1, lineColor: [0, 0, 0] },
        headStyles: { fillColor: [75, 85, 99], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        margin: { left: 10, right: 10 },
        columnStyles: {
          0: { cellWidth: 30 }, // SKU
          1: { cellWidth: 140 }, // Item
          2: { cellWidth: 22, halign: 'right' }, // Pending
          3: { cellWidth: 22, halign: 'right' }, // Posted
          4: { cellWidth: 22, halign: 'right' }, // Delivered
          5: { cellWidth: 26, halign: 'right' }, // Total Demand
        },
      })
      
      doc.save(`items_inventory_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (error) {
      console.error('PDF export error:', error)
      alert('PDF export failed. Please try again.')
    } finally {
      setExportingPDF(false)
    }
  }

  return (
    <div className="mt-8">
      <h2 className="text-h2 font-bold mb-4 sm:mb-6 text-fg">Admin · Inventory by Items</h2>
      
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4 sm:mb-6">
        <button
          onClick={loadItemsInventory}
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-brand text-on-accent hover:bg-brand-hover text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {loading && <Spinner />}
          <span>{loading ? 'Loading…' : 'Refresh'}</span>
        </button>
        
        <ExportButton
          format="excel"
          onClick={() => exportItemsExcel().catch(() => null)}
          disabled={itemsData.length === 0}
          busy={exportingExcel}
        />
        
        <ExportButton
          format="pdf"
          onClick={exportItemsPDF}
          disabled={itemsData.length === 0}
          busy={exportingPDF}
        />
      </div>
      
      {/* Data Summary */}
      {itemsData.length > 0 && (
        <div className="text-xs sm:text-sm text-muted mb-3 p-2 sm:p-0">
          Showing {itemsData.length} items (aggregated across all branches)
        </div>
      )}
      
      {/* Items Inventory Table */}
      <div className="bg-surface rounded-lg shadow-sm border border-line-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-subtle">
              <tr>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-medium text-fg">SKU</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-medium text-fg">Item</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Pending</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Posted</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Delivered</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Total Demand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-2 sm:px-4 py-2 sm:py-3">
                        <div className="h-4 w-full bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center text-subtext">
                    No items inventory data found.
                  </td>
                </tr>
              ) : (
                paginatedData.map((row, index) => (
                  <tr key={`${row.item_id ?? row.sku ?? index}-${row.branch_code ?? row.branch_name ?? 'all'}`} className="hover:bg-subtle">
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-fg font-mono text-xs">{row.sku}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-fg font-medium">{row.item_name}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-warning-fg">
                      {row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0}
                    </td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-info-fg">
                      {row.confirmed_demand ?? row.pending_delivery_qty ?? 0}
                    </td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-success-fg">
                      {row.delivered_qty ?? row.delivered_demand ?? 0}
                    </td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-fg font-medium">
                      {row.total_demand ?? ( (row.pending_demand ?? ((row.allocated_qty || 0) - (row.pending_delivery_qty || 0)) ?? 0) + (row.confirmed_demand ?? row.pending_delivery_qty ?? 0) + (row.delivered_qty ?? row.delivered_demand ?? 0) )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {showPagination && (
          <div className="flex items-center justify-between px-4 py-3 bg-subtle border-t border-line-subtle">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm border border-line rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-muted">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-sm border border-line rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
            <div className="text-sm text-muted">
              Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, itemsData.length)} of {itemsData.length} items
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Delivery vs Branch Inventory Section (Applications counts)
function DeliveryMemberInventorySection() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [deliveryBranch, setDeliveryBranch] = useState('')
  const [memberBranch, setMemberBranch] = useState('')
  const [branches, setBranches] = useState([])
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPDF, setExportingPDF] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  useEffect(() => {
    const ac = new AbortController()
    const loadBranches = async () => {
      try {
        const res = await fetch('/api/branches/list', { cache: 'no-store', signal: ac.signal })
        const json = await res.json()
        if (json.ok) setBranches(json.branches || [])
      } catch (_) {}
    }
    loadBranches()
    return () => ac.abort()
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (deliveryBranch) params.append('delivery', deliveryBranch)
      if (memberBranch) params.append('member', memberBranch)
      const res = await fetch(`/api/admin/inventory/delivery-branch-member?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to load')
      setRows(json.data || [])
    } catch (e) {
      console.error('Load delivery vs branch failed:', e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    const run = async () => {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        if (deliveryBranch) params.append('delivery', deliveryBranch)
        if (memberBranch) params.append('member', memberBranch)
        const res = await fetch(`/api/admin/inventory/delivery-branch-member?${params.toString()}`, { cache: 'no-store', signal: ac.signal })
        const json = await res.json()
        if (json.ok) setRows(json.data || [])
      } catch (_) {}
      finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }
    run()
    return () => ac.abort()
  }, [deliveryBranch, memberBranch])

  // Pagination
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginated = rows.slice(startIndex, startIndex + itemsPerPage)
  const totalPages = Math.ceil(rows.length / itemsPerPage)

  useEffect(() => {
    setCurrentPage(1)
  }, [deliveryBranch, memberBranch])

  const exportExcel = async () => {
    if (!rows?.length) return
    setExportingExcel(true)
    try {
      const headers = ['Delivery Branch', 'Member Branch', 'Pending', 'Posted', 'Delivered', 'Total']
      const dataRows = rows.map((r) => [
        r.delivery_branch_name,
        r.branch_name,
        r.pending || 0,
        r.posted || 0,
        r.delivered || 0,
        r.total || 0,
      ])

      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Delivery vs Branch')
      ws.addRow(['Food Distribution · Delivery Branch & Branch'])
      ws.addRow([`Filters: Delivery=${deliveryBranch || 'All'} | Member=${memberBranch || 'All'}`])
      ws.addRow(headers)
      for (const r of dataRows) ws.addRow(r)

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const d = deliveryBranch ? deliveryBranch.replace(/\s+/g, '_') : 'all_delivery'
      const m = memberBranch ? memberBranch.replace(/\s+/g, '_') : 'all_member'
      a.download = `delivery_vs_branch_${d}_${m}_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      window.URL.revokeObjectURL(url)
    } finally {
      setExportingExcel(false)
    }
  }

  // Export PDF
  const exportPDF = async () => {
    setExportingPDF(true)
    try {
      if (!rows || rows.length === 0) return
      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF('l', 'mm', 'a4')
      doc.setFontSize(16)
      doc.text('Inventory · Delivery Branch & Branch', 14, 15)
      doc.setFontSize(10)
      doc.text(`Filters: Delivery=${deliveryBranch || 'All'} | Member=${memberBranch || 'All'}`, 14, 25)
      autoTable(doc, {
        head: [['Delivery Branch','Member Branch','Pending','Posted','Delivered','Total']],
        body: rows.map(r => [
          r.delivery_branch_name || '',
          r.branch_name || '',
          r.pending || 0,
          r.posted || 0,
          r.delivered || 0,
          r.total || 0
        ]),
        startY: 32,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak', lineWidth: 0.1, lineColor: [0, 0, 0] },
        headStyles: { fillColor: [75, 85, 99], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        margin: { left: 10, right: 10 },
        columnStyles: {
          0: { cellWidth: 85 }, // Delivery Branch
          1: { cellWidth: 85 }, // Member Branch
          2: { cellWidth: 22, halign: 'right' }, // Pending
          3: { cellWidth: 22, halign: 'right' }, // Posted
          4: { cellWidth: 22, halign: 'right' }, // Delivered
          5: { cellWidth: 22, halign: 'right' }, // Total
        },
      })
      const d = deliveryBranch ? deliveryBranch.replace(/\s+/g,'_') : 'all_delivery'
      const m = memberBranch ? memberBranch.replace(/\s+/g,'_') : 'all_member'
      doc.save(`delivery_vs_branch_${d}_${m}_${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (e) {
      console.error('PDF export error:', e)
    } finally {
      setExportingPDF(false)
    }
  }

  return (
    <div className="mt-8">
      <h2 className="text-h2 font-bold mb-4 sm:mb-6 text-fg">Admin · Inventory by Delivery Branch & Branch</h2>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4 sm:mb-6">
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-brand text-on-accent hover:bg-brand-hover text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {loading && <Spinner />}
          <span>{loading ? 'Loading…' : 'Refresh'}</span>
        </button>
        <select
          value={deliveryBranch}
          onChange={(e) => setDeliveryBranch(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="">All Delivery Branches</option>
          {branches.map(b => (<option key={`del-${b.code}`} value={b.name}>{b.name}</option>))}
        </select>
        <select
          value={memberBranch}
          onChange={(e) => setMemberBranch(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="">All Member Branches</option>
          {branches.map(b => (<option key={`mem-${b.code}`} value={b.name}>{b.name}</option>))}
        </select>
        <ExportButton
          format="excel"
          onClick={() => exportExcel().catch(() => null)}
          disabled={rows.length === 0}
          busy={exportingExcel}
        />
        <ExportButton
          format="pdf"
          onClick={exportPDF}
          disabled={rows.length === 0}
          busy={exportingPDF}
        />
      </div>

      <div className="bg-surface rounded-lg shadow-sm border border-line-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-subtle">
              <tr>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-medium text-fg">Delivery Branch</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-medium text-fg">Member Branch</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Pending</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Posted</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Delivered</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-2 sm:px-4 py-2 sm:py-3">
                        <div className="h-4 w-full bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paginated.length === 0 ? (
                <tr><td colSpan="6" className="px-4 py-8 text-center text-subtext">No data found.</td></tr>
              ) : (
                paginated.map((r, idx) => (
                  <tr key={`${r.delivery_branch_name}-${r.branch_name}-${idx}`} className="hover:bg-subtle">
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-fg">{r.delivery_branch_name}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-fg">{r.branch_name}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-warning-fg">{r.pending || 0}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-info-fg">{r.posted || 0}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-success-fg">{r.delivered || 0}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-fg font-medium">{r.total || 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 bg-subtle border-t border-line-subtle">
            <div className="flex items-center space-x-2">
              <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} className="px-3 py-1 text-sm border border-line rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
              <span className="text-sm text-muted">Page {currentPage} of {totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} className="px-3 py-1 text-sm border border-line rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
            </div>
            <div className="text-sm text-subtext">Showing {Math.min(startIndex + 1, rows.length)} to {Math.min(startIndex + paginated.length, rows.length)} of {rows.length} items</div>
          </div>
        )}
      </div>

      <div className="text-xs sm:text-sm text-muted mt-2 sm:mt-3 p-2 sm:p-0">
        This view groups applications by delivery branch (where items will be picked up) and member branch.
      </div>
    </div>
  )
}

function InventoryPageContent() {
  const [rows, setRows] = useState(null)
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPDF, setExportingPDF] = useState(false)
  const [branchCode, setBranchCode] = useState('')
  const [sku, setSku] = useState('')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  // Always use demand tracking mode
  const isDemandTrackingMode = true
  const modeLoading = false
  
  // New state for filtering and pagination
  const [selectedBranch, setSelectedBranch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)
  const [branches, setBranches] = useState([])

  // Safe JSON helper
  const safeJson = async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }

  const normalizeSignal = (v) => {
    if (!v) return undefined
    if (typeof v !== 'object') return undefined
    if (typeof v.aborted !== 'boolean') return undefined
    if (typeof v.addEventListener !== 'function') return undefined
    return v
  }

  const load = async (signalLike) => {
    setLoading(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/inventory/status', { cache: 'no-store', signal: normalizeSignal(signalLike) })
      const json = await safeJson(res, '/api/admin/inventory/status')
      if (!json.ok) throw new Error(json.error)
      setRows(json.rows || [])
    } catch (e) {
      if (e?.name === 'AbortError' || /aborted|Abort|Failed to fetch|NETWORK_ERROR/i.test(e?.message || '')) {
        setLoading(false)
        return
      }
      setMsg({ type: 'error', text: e.message })
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const loadBranches = async (signal) => {
    try {
      const res = await fetch('/api/branches/list', { cache: 'no-store', signal })
      const json = await res.json()
      if (json.ok) {
        setBranches(json.branches || [])
      }
    } catch (e) {
      if (e?.name === 'AbortError' || /aborted|Abort|Failed to fetch|NETWORK_ERROR/i.test(e?.message || '')) {
        return
      }
      console.error('Error loading branches:', e)
    }
  }



  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    loadBranches(ac.signal)
    return () => ac.abort()
  }, [])

  // Remove the checkDemandTrackingMode function since we're always in demand tracking mode

  const filteredAndPaginatedRows = useMemo(() => {
    let filtered = (rows || []).map(r => ({
      ...r,
      // highlight when remaining after Posted is <= 20
      low: Number(r.remaining_after_posted ?? 0) <= 20
    }))
    
    // Apply branch filter
    if (selectedBranch) {
      filtered = filtered.filter(r => r.branch_name === selectedBranch)
    }
    
    // Calculate pagination
    const totalItems = filtered.length
    const totalPages = Math.ceil(totalItems / itemsPerPage)
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const paginatedRows = filtered.slice(startIndex, endIndex)
    
    return {
      rows: paginatedRows,
      totalItems,
      totalPages,
      currentPage
    }
  }, [rows, selectedBranch, currentPage, itemsPerPage])

  const adjust = async () => {
    setMsg(null)
    try {
      const res = await fetch('/api/admin/inventory/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchCode: branchCode.trim(),
          sku: sku.trim(),
          qty: Number(qty),
          note
        })
      })
      const json = await safeJson(res, '/api/admin/inventory/adjust')
      if (!res.ok || !json.ok) throw new Error(json.error || 'Adjustment failed')
      setMsg({ type: 'success', text: 'Adjustment posted' })
      setBranchCode(''); setSku(''); setQty(''); setNote('')
      load()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    }
  }

  const exportToExcel = async () => {
    if (!rows?.length) return
    setExportingExcel(true)
    try {
      const headers = ['Branch', 'SKU', 'Item', 'Pending', 'Posted', 'Delivered', 'Total Demand']

      let dataToExport = rows
      if (selectedBranch) {
        dataToExport = dataToExport.filter((r) => r.branch_name === selectedBranch)
      }

      const tableData = dataToExport.map((r) => [
        r.branch_name || '',
        r.sku || '',
        r.item_name || '',
        r.pending_demand ?? 0,
        r.confirmed_demand ?? 0,
        r.delivered_qty ?? r.delivered_demand ?? 0,
        r.total_demand ??
          (r.pending_demand || 0) + (r.confirmed_demand || 0) + (r.delivered_qty || r.delivered_demand || 0) ??
          (r.allocated_qty || 0) + (r.delivered_qty || r.delivered_demand || 0) ??
          0,
      ])

      const ExcelJSMod = await import('exceljs')
      const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Inventory')
      ws.addRow(['Food Distribution · Inventory by Branch'])
      ws.addRow([`Filters: ${selectedBranch ? `Branch: ${selectedBranch}` : 'All branches'}`])
      ws.addRow(headers)
      for (const r of tableData) ws.addRow(r)

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const branchFilter = selectedBranch ? selectedBranch.replace(/\s+/g, '_') : 'all_branches'
      a.download = `inventory_${branchFilter}_${new Date().toISOString().split('T')[0]}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } finally {
      setExportingExcel(false)
    }
  }

  const exportToPDF = async () => {
    setExportingPDF(true)
    try {
      // Check if there's data to export
      if (!rows || rows.length === 0) {
        setMsg({ type: 'error', text: 'No data available to export. Please ensure there are items in the inventory.' })
        return
      }

      // Dynamic import to avoid SSR issues
      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      
      const doc = new jsPDF('l', 'mm', 'a4') // landscape orientation
      
      let dataToExport = rows
      if (selectedBranch) {
        dataToExport = dataToExport.filter(r => r.branch_name === selectedBranch)
      }

      // Check if filtered data is empty
      if (dataToExport.length === 0) {
        setMsg({ type: 'error', text: 'No data available for the selected filters. Please adjust your filters.' })
        return
      }
      
      const headers = ['Branch', 'SKU', 'Item', 'Pending', 'Posted', 'Delivered', 'Total Demand']
      
      const tableData = dataToExport.map(r => {
        return [
          r.branch_name || '',
          r.sku || '',
          r.item_name || '',
          (r.pending_demand ?? 0),
          (r.confirmed_demand ?? 0),
          (r.delivered_qty ?? r.delivered_demand ?? 0),
          (r.total_demand ?? ((r.pending_demand || 0) + (r.confirmed_demand || 0) + (r.delivered_qty || r.delivered_demand || 0)) ?? ((r.allocated_qty || 0) + (r.delivered_qty || r.delivered_demand || 0)) ?? 0)
        ]
      })
      
      // Add title
      doc.setFontSize(16)
      doc.text('Inventory Report', 14, 15)
      
      // Add filters info
      doc.setFontSize(10)
      let filterText = 'Filters: '
      if (selectedBranch) filterText += `Branch: ${selectedBranch} `
      if (!selectedBranch) filterText += 'All branches'
      doc.text(filterText, 14, 25)
      
      // Add table
      autoTable(doc, {
        head: [headers],
        body: tableData,
        startY: 30,
        rowPageBreak: 'avoid',
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', lineWidth: 0.1, lineColor: [0, 0, 0] },
        headStyles: { fillColor: [75, 85, 99], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: {
          0: { cellWidth: 25 }, // Branch
          1: { cellWidth: 20 }, // SKU
          2: { cellWidth: 90 }, // Item
          3: { cellWidth: 22, halign: 'right' }, // Pending
          4: { cellWidth: 22, halign: 'right' }, // Posted
          5: { cellWidth: 22, halign: 'right' }, // Delivered
          6: { cellWidth: 26, halign: 'right' }, // Total Demand
        },
        margin: { left: 10, right: 10 },
      })
      
      const branchFilter = selectedBranch ? selectedBranch.replace(/\s+/g, '_') : 'all_branches'
      doc.save(`inventory_${branchFilter}_${new Date().toISOString().split('T')[0]}.pdf`)
      
      // Show success message
      setMsg({ type: 'success', text: 'PDF exported successfully!' })
    } catch (error) {
      console.error('PDF export error:', error)
      setMsg({ type: 'error', text: 'PDF export failed. Please try again.' })
    } finally {
      setExportingPDF(false)
    }
  }

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [selectedBranch])

  const busy = loading || rows === null

  return (
    <div className="p-2 lg:p-3 xl:p-4 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 lg:mb-4">
        <h1 className="text-h2 font-bold mb-2 sm:mb-0">Admin · Inventory by Branch</h1>
      </div>

      {/* Post Adjustment section removed - only demand tracking mode */}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4 sm:mb-6">
        <button 
          onClick={() => load()}
          disabled={busy}
          className="px-3 py-2 rounded-lg bg-brand text-on-accent hover:bg-brand-hover text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {busy && <Spinner />}
          <span>{busy ? 'Loading…' : 'Refresh'}</span>
        </button>
        
        <select 
          value={selectedBranch}
          onChange={(e) => setSelectedBranch(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="">All Branches</option>
          {branches.map(branch => (
            <option key={branch.code} value={branch.name}>{branch.name}</option>
          ))}
        </select>
        
        <ExportButton
          format="excel"
          onClick={() => exportToExcel().catch(() => null)}
          disabled={!Array.isArray(rows) || rows.length === 0}
          busy={exportingExcel}
        />
        
        <ExportButton
          format="pdf"
          onClick={exportToPDF}
          disabled={!Array.isArray(rows) || rows.length === 0}
          busy={exportingPDF}
        />
      </div>
      
      {msg && (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${
            msg.type === 'error' ? 'bg-danger-bg border-danger-border text-danger-fg' : 'bg-success-bg border-success-border text-success-fg'
          }`}
        >
          {msg.text}
        </div>
      )}
      
      {/* Data Summary */}
      {busy && (!Array.isArray(rows) || rows.length === 0) ? (
        <div className="text-xs sm:text-sm text-muted mb-3 p-2 sm:p-0">
          <div className="h-4 w-64 bg-muted rounded animate-pulse" />
        </div>
      ) : filteredAndPaginatedRows.rows.length > 0 ? (
        <div className="text-xs sm:text-sm text-muted mb-3 p-2 sm:p-0">
          Showing {filteredAndPaginatedRows.rows.length} of {filteredAndPaginatedRows.totalItems} items
          {selectedBranch && ` (filtered by ${selectedBranch})`}
        </div>
      ) : null}

      {/* Data Table */}
      <div className="bg-surface rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-subtle">
              <tr>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-medium text-fg">Branch</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-medium text-fg">SKU</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-medium text-fg">Item</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Pending</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Posted</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Delivered</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-medium text-fg">Total Demand</th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-gray-200">
              {busy ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-2 sm:px-4 py-2 sm:py-3">
                        <div className="h-4 w-full bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredAndPaginatedRows.rows.length > 0 ? (
                filteredAndPaginatedRows.rows.map((row, index) => (
                  <tr key={index} className="hover:bg-subtle">
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-fg">{row.branch_name}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-fg font-mono text-xs">{row.sku}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-fg font-medium">{row.item_name}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-warning-fg">{row.pending_demand ?? 0}</td>
                     <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-info-fg">{row.confirmed_demand ?? 0}</td>
                     <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-success-fg">{row.delivered_qty ?? row.delivered_demand ?? 0}</td>
                     <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-fg font-medium">{row.total_demand ?? ((row.pending_demand || 0) + (row.confirmed_demand || 0) + (row.delivered_qty || row.delivered_demand || 0)) ?? ((row.allocated_qty || 0) + (row.delivered_qty || row.delivered_demand || 0)) ?? 0}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="px-4 sm:px-6 py-8 text-center text-sm text-subtext">
                    {selectedBranch ? `No data for ${selectedBranch}` : 'No data'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {filteredAndPaginatedRows.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 bg-subtle border-t border-line-subtle">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm border border-line rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-muted">
                Page {currentPage} of {filteredAndPaginatedRows.totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, filteredAndPaginatedRows.totalPages))}
                disabled={currentPage === filteredAndPaginatedRows.totalPages}
                className="px-3 py-1 text-sm border border-line rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
            <div className="text-sm text-subtext">
              Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filteredAndPaginatedRows.totalItems)} to {Math.min(currentPage * itemsPerPage, filteredAndPaginatedRows.totalItems)} of {filteredAndPaginatedRows.totalItems} items
            </div>
          </div>
        )}
      </div>
      
      <div className="text-xs sm:text-sm text-muted mt-2 sm:mt-3 p-2 sm:p-0">
        Branch inventory shows demand allocation across all branches. Items are tracked by demand rather than physical stock.
      </div>

      {/* Department-Level Inventory Section */}
      <DepartmentInventorySection />
      
      {/* Items-Level Inventory Section */}
      <ItemsInventorySection />

      {/* Delivery vs Branch Inventory Section */}
      <DeliveryMemberInventorySection />
    </div>
  )
}

export default function InventoryPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <InventoryPageContent />
    </ProtectedRoute>
  )
}
