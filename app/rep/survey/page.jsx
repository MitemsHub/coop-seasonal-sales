'use client'

// app/rep/survey/page.jsx
// Rep-portal food survey — the same form as /survey, but the branch is locked
// to the session branch and this branch's past responses are listed here so
// reps can re-open and correct them without a shared link.
import { useCallback, useEffect, useState } from 'react'
import ProtectedRoute from '../../components/ProtectedRoute'
import FoodSurveyForm from '../../components/FoodSurveyForm'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { ClipboardList, Pencil, Plus, RefreshCw } from 'lucide-react'

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-NG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function RepSurveyPage() {
  const [submissions, setSubmissions] = useState([])
  const [branchId, setBranchId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingSub, setEditingSub] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/rep/survey', { cache: 'no-store', credentials: 'same-origin' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Failed to load submissions')
      setSubmissions(json.submissions || [])
      setBranchId(json.branch_id ?? null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const startEdit = (sub) => {
    setEditingSub(sub)
    setShowForm(false)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <ProtectedRoute allowedRoles={['rep']}>
      <div className="mx-auto max-w-5xl p-3 sm:p-4 md:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">Food Distribution · Item Survey</h1>
            <p className="mt-1 text-sm text-muted">
              Submit prices and photos for your branch before the food cycle opens — or correct a previous response.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={load} loading={loading} leftIcon={RefreshCw}>
              Refresh
            </Button>
            {/* Only the admin can open or close the survey for everyone
                (SurveyStatusPanel). This button only starts or dismisses this
                rep's own draft — never the survey itself. */}
            {!editingSub &&
              (showForm ? (
                <Button variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              ) : (
                <Button onClick={() => setShowForm(true)} leftIcon={Plus}>
                  New response
                </Button>
              ))}
          </div>
        </div>

        {/* Editing an existing response */}
        {editingSub && (
          <div className="mb-6">
            <FoodSurveyForm
              key={`edit_${editingSub.id}`}
              variant="rep"
              presetBranchId={branchId}
              lockBranch
              initialSubmission={editingSub}
              onCancelEdit={() => setEditingSub(null)}
              onSubmitted={() => {
                setEditingSub(null)
                load()
              }}
            />
          </div>
        )}

        {/* New response */}
        {showForm && !editingSub && (
          <div className="mb-6">
            <FoodSurveyForm
              variant="rep"
              presetBranchId={branchId}
              lockBranch
              onCancelEdit={() => setShowForm(false)}
              onSubmitted={() => {
                setShowForm(false)
                load()
              }}
            />
          </div>
        )}

        {/* Branch submissions */}
        <div className="rounded-xl border border-line bg-surface shadow-xs">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-fg">Responses from your branch</h2>
            <p className="mt-0.5 text-xs text-muted">
              Everyone who submits with your branch&apos;s link appears here. Any of them can be corrected.
            </p>
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="sakani-skeleton h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : error ? (
            <div className="p-4">
              <div className="rounded-lg border border-danger-border bg-danger-bg p-3 text-sm text-danger-fg">
                {error}
              </div>
              <Button className="mt-3" variant="secondary" size="sm" onClick={load} leftIcon={RefreshCw}>
                Try again
              </Button>
            </div>
          ) : submissions.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No responses yet"
              description='Tap "New response" above to submit your branch’s first survey.'
            />
          ) : (
            <ul className="divide-y divide-line">
              {submissions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg">{s.rep_name}</span>
                      <Badge tone={s.source === 'admin' ? 'accent' : 'brand'} variant="subtle">
                        {s.source === 'admin' ? 'Admin entry' : 'Rep'}
                      </Badge>
                      {s.cycle && (
                        <Badge tone="info" variant="subtle">
                          {s.cycle.name}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {s.phone ? `${s.phone} · ` : ''}
                      {fmtDate(s.created_at)} · {s.entries?.length || 0} item
                      {(s.entries?.length || 0) === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" leftIcon={Pencil} onClick={() => startEdit(s)}>
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
