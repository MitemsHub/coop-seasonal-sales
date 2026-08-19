'use client'

// app/admin/members/auth-onboarding/page.jsx
// Admin dashboard: Member Auth Onboarding
// Shows which members have completed Supabase Auth signup vs pending,
// with search, filtering, and the ability to resend OTP invitations.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock, RefreshCw, Search, Send, Users } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Button from '../../../components/ui/Button'
import Card from '../../../components/ui/Card'
import Input from '../../../components/ui/Input'
import Badge from '../../../components/ui/Badge'
import Skeleton from '../../../components/ui/Skeleton'

function StatCard({ label, value, icon: Icon, tone = 'brand' }) {
  const toneMap = {
    brand: 'bg-brand-subtle text-brand',
    success: 'bg-success-bg text-success-fg',
    warning: 'bg-warning-bg text-warning-fg',
    muted: 'bg-subtle text-muted',
  }
  return (
    <Card>
      <Card.Body className="flex items-center gap-3 p-4">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneMap[tone]}`}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-2xl font-bold text-fg">{value}</p>
          <p className="text-xs text-muted">{label}</p>
        </div>
      </Card.Body>
    </Card>
  )
}

function AuthOnboardingContent() {
  const [stats, setStats] = useState({ total: 0, signedUp: 0, pending: 0 })
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // 'all' | 'signed_up' | 'pending'
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [resending, setResending] = useState(null) // member_id currently being resent
  const [resendMsg, setResendMsg] = useState('') // success/error message
  const debounceRef = useRef(null)

  const fetchData = useCallback(async (pg = page, statusFilter = filter, searchTerm = search) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(pg),
        limit: '50',
        status: statusFilter,
      })
      if (searchTerm) params.set('search', searchTerm)

      const res = await fetch(`/api/admin/members/auth-status?${params}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load')
      setStats(json.stats)
      setMembers(json.members)
      setTotalPages(json.totalPages || 1)
    } catch (e) {
      console.error('Auth onboarding fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [page, filter, search])

  useEffect(() => {
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onFilterChange = (newFilter) => {
    setFilter(newFilter)
    setPage(1)
    fetchData(1, newFilter, search)
  }

  const onSearchInput = (value) => {
    setSearch(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(1)
      fetchData(1, filter, value)
    }, 300)
  }

  const refresh = () => fetchData(page, filter, search)

  // Resend OTP — calls the send-otp endpoint for the member's email.
  // In practice this triggers a new OTP to be sent to the member's email
  // on file, allowing them to continue the signup flow.
  const resendInvite = async (memberId, email) => {
    setResending(memberId)
    setResendMsg('')
    try {
      const res = await fetch('/api/members/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, email }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to resend')
      }
      setResendMsg(`OTP resent to ${email}`)
    } catch (e) {
      setResendMsg(`Error: ${e.message}`)
    } finally {
      setResending(null)
      setTimeout(() => setResendMsg(''), 4000)
    }
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 font-bold tracking-tight text-fg">Member Auth Onboarding</h1>
          <p className="text-sm text-muted">
            Track which members have completed Supabase Auth registration and resend invitations to pending members.
          </p>
        </div>
        <Button variant="secondary" leftIcon={RefreshCw} onClick={refresh} className="shrink-0">
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Members" value={stats.total} icon={Users} tone="brand" />
        <StatCard label="Signed Up" value={stats.signedUp} icon={CheckCircle2} tone="success" />
        <StatCard label="Pending" value={stats.pending} icon={Clock} tone="warning" />
      </div>

      {/* Filter + Search */}
      <Card>
        <Card.Body className="flex flex-col gap-3 sm:flex-row sm:items-center p-4">
          <div className="flex gap-2">
            {[
              { key: 'all', label: 'All' },
              { key: 'pending', label: 'Pending' },
              { key: 'signed_up', label: 'Signed Up' },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => onFilterChange(key)}
                className={[
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  filter === key
                    ? 'bg-brand text-on-accent'
                    : 'bg-subtle text-muted hover:bg-line hover:text-fg',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => onSearchInput(e.target.value)}
              placeholder="Search by name or staff ID…"
              className="pl-9"
            />
          </div>
        </Card.Body>
      </Card>

      {/* Resend message */}
      {resendMsg && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            resendMsg.startsWith('Error')
              ? 'border-danger-border bg-danger-bg text-danger-fg'
              : 'border-success-border bg-success-bg text-success-fg'
          }`}
        >
          {resendMsg}
        </div>
      )}

      {/* Member table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Staff ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-3">
                        <Skeleton className="h-8 w-full rounded-lg" />
                      </td>
                    </tr>
                  ))
                : members.map((m) => (
                    <tr key={m.memberId} className="hover:bg-subtle/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-fg">{m.memberId}</td>
                      <td className="px-4 py-3 text-fg">{m.fullName || '—'}</td>
                      <td className="px-4 py-3 text-muted">{m.email || '—'}</td>
                      <td className="px-4 py-3 text-muted">{m.branchCode || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {m.hasAuth ? (
                          <Badge variant="success" className="text-[11px]">
                            <CheckCircle2 className="inline h-3 w-3 mr-1 -mt-px" />
                            Signed Up
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="text-[11px]">
                            <Clock className="inline h-3 w-3 mr-1 -mt-px" />
                            Pending
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!m.hasAuth && m.email ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            leftIcon={Send}
                            onClick={() => resendInvite(m.memberId, m.email)}
                            loading={resending === m.memberId}
                          >
                            Resend
                          </Button>
                        ) : !m.hasAuth && !m.email ? (
                          <span className="text-xs text-muted">No email on file</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}

              {!loading && members.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted">
                    No members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <p className="text-xs text-muted">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { setPage((p) => Math.max(1, p - 1)); fetchData(Math.max(1, page - 1), filter, search) }}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); fetchData(Math.min(totalPages, page + 1), filter, search) }}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

export default function AuthOnboardingPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <AuthOnboardingContent />
    </ProtectedRoute>
  )
}
