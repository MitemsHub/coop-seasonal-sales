'use client'

// app/admin/members/page.jsx
// Members Settings — one home for member administration used by every module:
//   • Members Import (moved from the food Import page) with the import log
//   • Member details set/reset — name, phone, and account management
import { useCallback, useRef, useState } from 'react'
import { FileSpreadsheet, Pencil, RefreshCw, Search, UserRound } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import DraggableModal from '../../components/DraggableModal'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Input from '../../components/ui/Input'
import Label from '../../components/ui/Label'
import Badge from '../../components/ui/Badge'
import Skeleton from '../../components/ui/Skeleton'

function MembersImportSection() {
  const [membersFile, setMembersFile] = useState(null)
  const [log, setLog] = useState('')
  const [loading, setLoading] = useState(false)

  const upload = async () => {
    if (!membersFile) {
      setLog('Please choose a file first.')
      return
    }
    setLoading(true)
    setLog('')
    try {
      const fd = new FormData()
      fd.append('file', membersFile)
      const res = await fetch('/api/admin/import/members', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || `Upload failed with status ${res.status}`)
      setLog(JSON.stringify(json, null, 2))
    } catch (e) {
      setLog(`Error: ${e.message}`)
      console.error('Upload error:', e)
    } finally {
      setLoading(false)
    }
  }

  const dlTemplate = async () => {
    const ExcelJSMod = await import('exceljs')
    const ExcelJS = ExcelJSMod?.default ?? ExcelJSMod
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Members')
    const headers = ['member_id', 'full_name', 'grade', 'savings', 'loans', 'global_limit']
    const rows = [{ member_id: 'A12345', full_name: 'John Doe', grade: 'Director', savings: 2000000, loans: 0, global_limit: 40000000 }]
    ws.addRow(headers)
    for (const r of rows) ws.addRow(headers.map((h) => r[h]))
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Members_Template.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Members Import</Card.Title>
        <Card.Description>Expected columns: member_id, full_name, grade, savings, loans, global_limit</Card.Description>
      </Card.Header>
      <Card.Body className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setMembersFile(e.target.files?.[0] || null)}
            className="w-full sm:flex-1 text-sm p-2 border border-line rounded-lg bg-surface"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={upload} loading={loading} disabled={!membersFile} className="flex-1 sm:flex-none">
              Upload Members
            </Button>
            <Button variant="secondary" leftIcon={FileSpreadsheet} onClick={dlTemplate} className="flex-1 sm:flex-none">
              Download Template
            </Button>
          </div>
        </div>
        {log && <pre className="whitespace-pre-wrap rounded-lg bg-subtle p-3 text-xs text-fg overflow-x-auto">{log}</pre>}
      </Card.Body>
    </Card>
  )
}

function MemberLookupSection() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null) // null = not searched
  const [searching, setSearching] = useState(false)
  const [msg, setMsg] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [member, setMember] = useState(null)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [savings, setSavings] = useState('')
  const [loans, setLoans] = useState('')
  const [saving, setSaving] = useState(false)
  const debounceRef = useRef(null)

  const search = useCallback(async (term) => {
    if (String(term || '').trim().length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    setMsg('')
    try {
      const res = await fetch(`/api/admin/members/search?q=${encodeURIComponent(String(term).trim())}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Search failed')
      setResults(json.members || [])
    } catch (e) {
      setMsg(e.message || 'Search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const onSearchInput = (value) => {
    setQ(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 300)
  }

  const openEdit = (m) => {
    setMember(m)
    setFullName(m.full_name || '')
    setPhone(m.phone || '')
    setEmail(m.email || '')
    setSavings(m.savings != null && m.savings !== '' ? String(m.savings) : '')
    setLoans(m.loans != null && m.loans !== '' ? String(m.loans) : '')
    setMsg('')
    setModalOpen(true)
  }

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const payload = { member_id: member.member_id }
      if (fullName.trim() && fullName.trim() !== member.full_name) payload.full_name = fullName.trim()
      if (phone.trim() !== member.phone) payload.phone = phone.trim()
      const emailVal = email.trim().toLowerCase()
      if (emailVal !== (member.email || '').toLowerCase()) payload.email = emailVal
      const numField = (v, cur) => {
        if (String(v ?? '').trim() === '') return null
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0) throw new Error('Savings and loans must be non-negative numbers')
        return n
      }
      const savingsVal = numField(savings, member.savings)
      if (savingsVal != null && savingsVal !== Number(member.savings || 0)) payload.savings = savingsVal
      const loansVal = numField(loans, member.loans)
      if (loansVal != null && loansVal !== Number(member.loans || 0)) payload.loans = loansVal
      if (Object.keys(payload).length === 1) {
        setMsg('Nothing to update — make a change and try again.')
        return
      }
      const res = await fetch('/api/admin/members/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update')
      setMsg('')
      setModalOpen(false)
      search(q)
    } catch (e) {
      setMsg(e.message || 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Member details</Card.Title>
        <Card.Description>Look up a member and edit their name, phone, email, savings or loans.</Card.Description>
      </Card.Header>
      <Card.Body className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => onSearchInput(e.target.value)} placeholder="Search by staff ID, name or phone… (min 2 characters)" className="pl-9" />
        </div>

        {!!msg && <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg">{msg}</div>}

        {searching ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : results !== null && results.length === 0 ? (
          <p className="rounded-lg bg-subtle px-4 py-5 text-center text-sm text-muted">No members found.</p>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line">
            {(results || []).map((m) => (
              <div key={m.member_id} className="flex items-center gap-3 px-4 py-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                  <UserRound className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{m.full_name || m.member_id}</p>
                  <p className="text-chips text-muted">
                    {m.member_id} · {m.branch_name || '—'} · {m.phone || 'no phone'} · savings ₦{Number(m.savings || 0).toLocaleString()} · loans ₦{Number(m.loans || 0).toLocaleString()}
                  </p>
                </div>
                <Button size="sm" variant="secondary" leftIcon={Pencil} onClick={() => openEdit(m)}>
                  Edit
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card.Body>

      <DraggableModal open={modalOpen} onClose={() => setModalOpen(false)} title={`Edit member · ${member?.member_id || ''}`}>
        <div className="space-y-4">
          {member && (
            <div className="rounded-lg bg-subtle px-3 py-2 text-sm">
              <p className="font-semibold text-fg">{member.full_name || member.member_id}</p>
              <p className="text-xs text-muted">{member.branch_name || '—'} · savings ₦{Number(member.savings || 0).toLocaleString()} · loans ₦{Number(member.loans || 0).toLocaleString()} · limit ₦{Number(member.global_limit || 0).toLocaleString()}</p>
            </div>
          )}
          <div>
            <Label htmlFor="m-full-name">Full name</Label>
            <Input id="m-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Member name" />
          </div>
          <div>
            <Label htmlFor="m-phone">Phone number</Label>
            <Input id="m-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0803 123 4567" />
          </div>
          <div>
            <Label htmlFor="m-email">Email address</Label>
            <Input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="member@example.com" />
            <p className="mt-1 text-[11px] text-muted">Required for member auth signup — OTP will be sent to this email.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="m-savings">Savings (₦)</Label>
              <Input id="m-savings" type="number" min="0" step="0.01" value={savings} onChange={(e) => setSavings(e.target.value)} placeholder="e.g. 2000000" />
            </div>
            <div>
              <Label htmlFor="m-loans">Loans (₦)</Label>
              <Input id="m-loans" type="number" min="0" step="0.01" value={loans} onChange={(e) => setLoans(e.target.value)} placeholder="e.g. 500000" />
            </div>
          </div>
          {!!msg && <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg">{msg}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              Save changes
            </Button>
          </div>
        </div>
      </DraggableModal>
    </Card>
  )
}

function MembersSettingsContent() {
  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 font-bold tracking-tight text-fg">Members Settings</h1>
          <p className="text-sm text-muted">Member administration — imports, details and account management in one place.</p>
        </div>
      </div>
      <MembersImportSection />
      <MemberLookupSection />
    </div>
  )
}

export default function MembersSettingsPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <MembersSettingsContent />
    </ProtectedRoute>
  )
}
