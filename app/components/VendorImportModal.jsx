'use client'

// app/components/VendorImportModal.jsx
// Admin batch upload of vendor accounts. The admin supplies names (and
// optionally email/phone/address); the system generates a code and a
// professional passcode per stand and shows them once, with a CSV download or email to hand
// out. Passcodes are hashed at rest, so this table is the only place they appear.
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, Mail, Upload } from 'lucide-react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Label from './ui/Label'
import Select from './ui/Select'
import { pick, toCsv } from '../../lib/csvParse'
import { IMPORT_ACCEPT, readImportFile } from '../../lib/importSheet'
import { downloadExcelWorkbook } from '../../lib/excelExport'
import { VENDOR_EMAIL_INTERVAL_MS } from '../../lib/vendorEmailLimits'
import { sendVendorLoginEmails } from '../../lib/vendorLoginEmailQueue'

const IMPORT_LIMIT = 500
const CHUNK_SIZE = 50
const MAX_FILE_BYTES = 5 * 1024 * 1024

const TEMPLATE_ROWS = [
  { name: 'Mitams Foods', email: 'mitams@example.com', phone: '08030000000', address: 'Stand 12 - Main hall' },
  { name: 'Abuja Cars', email: 'abujacars@example.com', phone: '08031111111', address: 'Stand 4 - Car park' },
]

function downloadTemplate() {
  downloadExcelWorkbook('vendor-import-template.xlsx', [
    {
      name: 'Vendors',
      headers: { name: 'Vendor name', email: 'Email', phone: 'Phone', address: 'Address' },
      rows: TEMPLATE_ROWS,
    },
  ])
}

const NAME_KEYS = ['name', 'vendor', 'vendor name', 'business', 'stand name']
const EMAIL_KEYS = ['email', 'email address', 'e-mail', 'mail']
const PHONE_KEYS = ['phone', 'telephone', 'phone number', 'mobile', 'contact']
const ADDRESS_KEYS = ['address', 'address / stand', 'address/stand', 'location', 'stand location', 'stand address', 'stand']

function saveFile(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function VendorImportModal({ open, onClose, cycles = [], branches = [], onDone }) {
  const [cycleId, setCycleId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [emailing, setEmailing] = useState(false)
  const [emailNote, setEmailNote] = useState('')
  const [emailProgress, setEmailProgress] = useState({ done: 0, total: 0 })
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  useEffect(() => {
    if (!open) return
    setCycleId('')
    setBranchId('')
    setFileName('')
    setRows([])
    setBusy(false)
    setError('')
    setResult(null)
    setEmailing(false)
    setEmailNote('')
    setEmailProgress({ done: 0, total: 0 })
    setProgress({ done: 0, total: 0 })
  }, [open])

  const cycleBranches = useMemo(() => branches, [branches])

  const onFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setResult(null)
    setEmailNote('')
    setRows([])
    setFileName(file.name)
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is larger than 5 MB. Split it into smaller lists.')
      return
    }
    const { headers, records } = await readImportFile(file)
    if (!records.length) {
      setError('No vendor rows found. Keep the header row and add at least one vendor.')
      return
    }
    if (records.length > IMPORT_LIMIT) {
      setError(`Import at most ${IMPORT_LIMIT} vendors at a time. Split the file into smaller lists.`)
      return
    }
    if (!NAME_KEYS.some((key) => headers.includes(key))) {
      setError('No "name" column found. Download the template to see the expected columns.')
      return
    }
    setRows(
      records.map((record) => ({
        name: pick(record, NAME_KEYS),
        email: pick(record, EMAIL_KEYS),
        phone: pick(record, PHONE_KEYS),
        address: pick(record, ADDRESS_KEYS),
      }))
    )
  }

  const importRows = async () => {
    setError('')
    if (!cycleId || !branchId) return setError('Pick the season and the branch first.')
    if (!rows.length) return setError('Choose a CSV or Excel file first.')
    setBusy(true)
    setProgress({ done: 0, total: rows.length })
    const created = []
    const failed = []
    try {
      // The import API hashes passcodes, so it accepts a safe batch size only.
      // Send larger uploads in chunks and keep the admin on one progress screen.
      for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
        const chunk = rows.slice(start, start + CHUNK_SIZE)
        const end = start + chunk.length
        const res = await fetch('/api/admin/exhibition/vendors/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cycle_id: Number(cycleId),
            branch_id: Number(branchId),
            rows: chunk,
            reserved_passcodes: created.map((vendor) => vendor.passcode),
          }),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) {
          throw new Error(`Rows ${start + 1}–${end}: ${json?.error || 'Import failed'}`)
        }
        created.push(...(json.created || []))
        for (const item of json.failed || []) {
          failed.push({ ...item, row: start + Number(item.row || 0) })
        }
        setProgress({ done: end, total: rows.length })
      }
      setResult({ ok: true, created, failed })
      if (created.length) onDone?.()
    } catch (e) {
      if (created.length) {
        setResult({ ok: true, created, failed })
        setError(`${e.message}. ${created.length} vendor${created.length === 1 ? ' was' : 's were'} created before the import stopped — download their logins before closing.`)
        onDone?.()
      } else {
        setError(e.message || 'Import failed')
      }
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    if (busy || emailing) return
    onClose()
  }

  const loginsCsv = () =>
    toCsv(
      [
        { header: 'name', value: (v) => v.name },
        { header: 'email', value: (v) => v.email },
        { header: 'code', value: (v) => v.code },
        { header: 'passcode', value: (v) => v.passcode },
        { header: 'phone', value: (v) => v.phone },
      ],
      result?.created || []
    )

  const emailable = (result?.created || []).filter((v) => v.email)

  const emailLogins = async () => {
    if (!emailable.length) return
    setEmailing(true)
    setEmailNote('')
    setEmailProgress({ done: 0, total: emailable.length })

    const { sent, failed } = await sendVendorLoginEmails({
      vendors: emailable,
      send: async (vendor) => {
        const res = await fetch(`/api/admin/exhibition/vendors/${vendor.id}/send-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: vendor.passcode }),
        })
        const json = await res.json().catch(() => null)
        return { res, json }
      },
      onProgress: ({ done, total }) => setEmailProgress({ done, total }),
    })

    const failures = failed.map(({ vendor, error }) => `${vendor.name}: ${error}`)
    const visibleFailures = failures.slice(0, 5).join(' · ')
    const hiddenFailures = failures.length > 5 ? ` · …and ${failures.length - 5} more` : ''
    setEmailNote(
      failures.length
        ? `Sent ${sent} of ${emailable.length}. ${visibleFailures}${hiddenFailures}`
        : `Login details emailed to ${sent} vendor${sent === 1 ? '' : 's'}.`
    )
    setEmailing(false)
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import vendors"
      description={`Upload an Excel list of up to ${IMPORT_LIMIT} stands — the system creates a code and passcode for each one.`}
      size="lg"
      footer={
        result ? (
          <>
            <Button variant="secondary" leftIcon={Download} onClick={() => saveFile('vendor-logins.csv', loginsCsv())}>
              Download logins
            </Button>
            <Button
              variant="secondary"
              leftIcon={Mail}
              onClick={emailLogins}
              loading={emailing}
              disabled={!emailable.length || emailing}
            >
              {emailing && emailProgress.total
                ? `Sending ${emailProgress.done} / ${emailProgress.total}…`
                : `Email ${emailable.length ? `${emailable.length} login${emailable.length === 1 ? '' : 's'}` : 'logins'}`}
            </Button>
            <Button variant="brand" onClick={close} disabled={emailing}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="brand" onClick={importRows} loading={busy} disabled={!rows.length}>
              {busy && progress.total
                ? `Importing ${progress.done} / ${progress.total}…`
                : `Import ${rows.length ? `${rows.length} vendor${rows.length === 1 ? '' : 's'}` : ''}`}
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
                {result.created?.length || 0} vendor account{result.created?.length === 1 ? '' : 's'} created
              </p>
              <p className="mt-0.5 text-xs text-success-fg/80">
                Copy or download these passcodes now — they are stored securely and cannot be shown again.
              </p>
            </div>
          </div>

          {!!result.created?.length && (
            <div className="max-h-64 overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-subtle text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Vendor</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Passcode</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {result.created.map((vendor) => (
                    <tr key={vendor.id || vendor.code}>
                      <td className="px-3 py-2 text-fg">{vendor.name}</td>
                      <td className="px-3 py-2 text-muted">{vendor.email || '—'}</td>
                      <td className="px-3 py-2 font-mono text-muted">{vendor.code}</td>
                      <td className="px-3 py-2 font-mono font-semibold text-fg">{vendor.passcode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {emailing && (
            <p className="text-xs text-muted">
              Sending {Math.min(emailProgress.done + 1, emailProgress.total)} of {emailProgress.total} — emails are paced to protect the SMTP account.
            </p>
          )}

          {!!emailable.length && !emailing && !emailNote && (
            <p className="text-xs text-muted">
              Login emails are sent one at a time, about 6 per minute and no more than 450 per hour. {emailable.length} email{emailable.length === 1 ? '' : 's'} will take about {Math.ceil((emailable.length * VENDOR_EMAIL_INTERVAL_MS) / 60000)} minute{Math.ceil((emailable.length * VENDOR_EMAIL_INTERVAL_MS) / 60000) === 1 ? '' : 's'}. Keep this window open until sending finishes.
            </p>
          )}

          {!!emailNote && (
            <p className={`text-xs ${emailNote.startsWith('Login details emailed') ? 'text-success-fg' : 'text-warning-fg'}`}>
              {emailNote}
            </p>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="vi-cycle">Season</Label>
              <Select id="vi-cycle" value={cycleId} onChange={(e) => setCycleId(e.target.value)} className="w-full">
                <option value="">Select season</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="vi-branch">Branch</Label>
              <Select id="vi-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-full">
                <option value="">Select branch</option>
                {cycleBranches.map((b) => (
                  <option key={b.branch_id || b.id || b.code} value={b.branch_id || b.id || b.code}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-line bg-subtle px-4 py-6 text-center">
            <FileSpreadsheet className="mx-auto mb-2 h-7 w-7 text-muted" strokeWidth={1.6} />
            <p className="text-sm font-medium text-fg">{fileName || 'Choose a CSV or Excel file'}</p>
            <p className="mt-0.5 text-xs text-muted">Columns: name, email, phone, address. Only name is required — codes and passcodes are generated.</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-on-accent">
                <Upload className="h-3.5 w-3.5" />
                Choose file
                <input type="file" accept={IMPORT_ACCEPT} className="hidden" onChange={onFile} />
              </label>
              <Button variant="secondary" size="sm" leftIcon={Download} onClick={downloadTemplate}>
                Excel template
              </Button>
            </div>
          </div>

          {!!rows.length && (
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="border-b border-line bg-subtle px-3 py-2 text-xs text-muted">
                {rows.length} vendor{rows.length === 1 ? '' : 's'} ready · codes and passcodes will be generated
              </div>
              <div className="max-h-52 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">Phone</th>
                      <th className="px-3 py-2 font-medium">Stand</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {rows.slice(0, 8).map((row, index) => (
                      <tr key={`${row.name}-${index}`}>
                        <td className="px-3 py-2 text-fg">{row.name || '—'}</td>
                        <td className="px-3 py-2 text-muted">{row.email || '—'}</td>
                        <td className="px-3 py-2 text-muted">{row.phone || '—'}</td>
                        <td className="px-3 py-2 text-muted">{row.address || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
