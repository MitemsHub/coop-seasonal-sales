'use client'

// app/components/ProductImportModal.jsx
// Shared batch upload of products for the vendor portal and the admin console.
// The browser reads the CSV, shows a preview, then posts the rows; the API
// generates a SKU for every line and reports per-row failures. Photos and fine
// tuning happen afterwards from the normal edit screen.
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Label from './ui/Label'
import Select from './ui/Select'
import { parseCsv, pick } from '../../lib/csvParse'

const TEMPLATE = [
  'name,price,unit,qty',
  'Handwoven Ankara Tote,15000,each,25',
  'Fresh tomatoes (basket),8500,basket,40',
].join('\n')

const NAME_KEYS = ['name', 'product', 'product name', 'item', 'description']
const PRICE_KEYS = ['price', 'amount', 'vendor_price', 'vendor price', 'unit price']
const UNIT_KEYS = ['unit', 'uom', 'measure']
const QTY_KEYS = ['qty', 'quantity', 'stock', 'quantity in stock']

function saveFile(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function ProductImportModal({
  open,
  onClose,
  endpoint,
  onDone,
  cycles = [],
  vendors = [],
  requireTarget = false,
}) {
  const [cycleId, setCycleId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!open) return
    setCycleId('')
    setVendorId('')
    setFileName('')
    setRows([])
    setBusy(false)
    setError('')
    setResult(null)
  }, [open])

  const targetVendors = useMemo(
    () => (cycleId ? vendors.filter((v) => String(v.cycle_id) === String(cycleId)) : vendors),
    [vendors, cycleId]
  )

  const onFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setResult(null)
    setRows([])
    setFileName(file.name)
    if (file.size > 2 * 1024 * 1024) {
      setError('That file is larger than 2 MB. Split it into smaller lists.')
      return
    }
    const text = await file.text().catch(() => '')
    const { headers, records } = parseCsv(text)
    if (!records.length) {
      setError('No product rows found. Keep the header row and add at least one product.')
      return
    }
    if (!NAME_KEYS.some((key) => headers.includes(key))) {
      setError('No "name" column found. Download the template to see the expected columns.')
      return
    }
    setRows(
      records.map((record) => ({
        name: pick(record, NAME_KEYS),
        price: pick(record, PRICE_KEYS),
        unit: pick(record, UNIT_KEYS) || 'each',
        qty: pick(record, QTY_KEYS),
      }))
    )
  }

  const importRows = async () => {
    setError('')
    if (!rows.length) return setError('Choose a CSV file first.')
    if (requireTarget && (!cycleId || !vendorId)) {
      return setError('Pick the season and the vendor stand these products belong to.')
    }
    setBusy(true)
    try {
      const payload = { rows }
      if (requireTarget) {
        payload.cycle_id = Number(cycleId)
        payload.vendor_id = Number(vendorId)
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Import failed')
      setResult(json)
      if (json.created?.length) onDone?.()
    } catch (e) {
      setError(e.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    if (busy) return
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import products"
      description="Upload a CSV list. Every product gets a SKU automatically — edit details and add photos afterwards."
      size="lg"
      footer={
        result ? (
          <Button variant="brand" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="brand" onClick={importRows} loading={busy} disabled={!rows.length}>
              Import {rows.length ? `${rows.length} product${rows.length === 1 ? '' : 's'}` : ''}
            </Button>
          </>
        )
      }
    >
      {!!error && (
        <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">{error}</div>
      )}

      {result ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-success-border bg-success-bg px-4 py-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-fg" />
            <div>
              <p className="text-sm font-semibold text-success-fg">
                {result.created?.length || 0} product{result.created?.length === 1 ? '' : 's'} imported
              </p>
              <p className="mt-0.5 text-xs text-success-fg/80">
                SKUs were generated for each line. Open a product to adjust the price, stock or photo.
              </p>
            </div>
          </div>

          {!!result.created?.length && (
            <div className="max-h-52 overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-subtle text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {result.created.map((item) => (
                    <tr key={item.id || item.sku}>
                      <td className="px-3 py-2 text-fg">{item.name}</td>
                      <td className="px-3 py-2 font-mono text-muted">{item.sku}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!!result.failed?.length && (
            <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5">
              <p className="text-xs font-semibold text-warning-fg">{result.failed.length} row(s) skipped</p>
              <ul className="mt-1 space-y-2 text-xs text-warning-fg">
                {result.failed.map((item) => (
                  <li key={`${item.row}-${item.error}`}>
                    Row {item.row}: {item.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {requireTarget && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="imp-cycle">Season</Label>
                <Select
                  id="imp-cycle"
                  value={cycleId}
                  onChange={(e) => {
                    setCycleId(e.target.value)
                    setVendorId('')
                  }}
                  className="w-full"
                >
                  <option value="">Select season</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="imp-vendor">Vendor stand</Label>
                <Select id="imp-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full">
                  <option value="">Select vendor</option>
                  {targetVendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-dashed border-line bg-subtle px-4 py-6 text-center">
            <FileSpreadsheet className="mx-auto mb-2 h-7 w-7 text-muted" strokeWidth={1.6} />
            <p className="text-sm font-medium text-fg">{fileName || 'Choose a CSV file'}</p>
            <p className="mt-0.5 text-xs text-muted">Columns: name, price, unit, qty (only name and price are required). Add product photos after importing.</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-on-accent">
                <Upload className="h-3.5 w-3.5" />
                Choose file
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
              </label>
              <Button variant="secondary" size="sm" leftIcon={Download} onClick={() => saveFile('product-import-template.csv', TEMPLATE)}>
                Template
              </Button>
            </div>
          </div>

          {!!rows.length && (
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="flex items-center justify-between border-b border-line bg-subtle px-3 py-2 text-xs text-muted">
                <span>
                  {rows.length} row{rows.length === 1 ? '' : 's'} ready · showing first {Math.min(rows.length, 6)}
                </span>
                <span className="font-mono">SKUs auto-generated</span>
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Qty</th>
                      <th className="px-3 py-2 font-medium">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {rows.slice(0, 6).map((row, index) => (
                      <tr key={`${row.name}-${index}`}>
                        <td className="px-3 py-2 text-fg">{row.name || '—'}</td>
                        <td className="px-3 py-2 tabular-nums text-muted">{row.price ? `NGN ${Number(row.price).toLocaleString()}` : '—'}</td>
                        <td className="px-3 py-2 tabular-nums text-muted">{row.qty || '∞'}</td>
                        <td className="px-3 py-2 text-muted">{row.unit || 'each'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-muted">
            {requireTarget
              ? 'Admin imports go live immediately. The price you enter is the member price.'
              : 'Imported products wait for approval before they appear on the member shop.'}
          </p>
        </div>
      )}
    </Modal>
  )
}
