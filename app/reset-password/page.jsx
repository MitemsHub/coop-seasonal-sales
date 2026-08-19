// app/reset-password/page.jsx
// Handles the Supabase Auth password-reset link. When the member clicks
// the link in their email, Supabase redirects here with the access + refresh
// tokens in the URL hash fragment (#access_token=...&refresh_token=...).
// The client extracts the access_token and submits the new password to our API.
'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const [accessToken, setAccessToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // Extract the access_token from the URL hash fragment
  useEffect(() => {
    const hash = window.location.hash
    if (hash) {
      const params = new URLSearchParams(hash.substring(1)) // strip the #
      const token = params.get('access_token')
      if (token) {
        setAccessToken(token)
        // Clean up the URL hash so the token isn't visible
        window.history.replaceState(null, '', window.location.pathname)
      }
    }
  }, [])

  const pwValid = password.length >= 6
  const match = password && confirmPassword && password === confirmPassword

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!pwValid || !match || !accessToken) return

    setIsLoading(true)
    setError('')
    try {
      const res = await fetch('/api/members/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, password }),
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess(true)
      } else {
        setError(data.error || 'Failed to reset password. The link may have expired.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!accessToken && !success) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-subtle text-danger">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-fg">Invalid or expired link</h1>
          <p className="mt-2 text-sm text-muted">
            This password reset link is invalid or has expired. Please request a new one.
          </p>
          <Link
            href="/portal"
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-on-accent hover:bg-brand-hover transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle text-success">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-fg">Password reset successful</h1>
          <p className="mt-2 text-sm text-muted">
            Your password has been updated. You can now sign in with your new password.
          </p>
          <Link
            href="/portal#member"
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-on-accent hover:bg-brand-hover transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-subtle text-brand">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-fg">Set new password</h1>
          <p className="mt-1 text-sm text-muted">Choose a strong password for your account</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              className={`w-full py-2.5 px-4 border-2 rounded-xl focus:ring-2 focus:ring-brand/20 transition-all duration-200 outline-none text-sm text-fg placeholder:text-subtext disabled:bg-subtle disabled:cursor-not-allowed ${
                !password ? 'border-line-subtle focus:border-brand' : pwValid ? 'border-success focus:border-success' : 'border-danger focus:border-danger'
              }`}
              placeholder="At least 6 characters"
              autoFocus
            />
            {password && !pwValid && (
              <p className="mt-1 text-xs text-danger-fg">Password must be at least 6 characters</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading || !pwValid}
              className={`w-full py-2.5 px-4 border-2 rounded-xl focus:ring-2 focus:ring-brand/20 transition-all duration-200 outline-none text-sm text-fg placeholder:text-subtext disabled:bg-subtle disabled:cursor-not-allowed ${
                !confirmPassword ? 'border-line-subtle focus:border-brand' : match ? 'border-success focus:border-success' : 'border-danger focus:border-danger'
              }`}
              placeholder="Re-enter password"
            />
            {confirmPassword && !match && (
              <p className="mt-1 text-xs text-danger-fg">Passwords do not match</p>
            )}
          </div>

          {error && (
            <div className="flex items-center text-danger-fg text-xs">
              <svg className="w-4 h-4 mr-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !pwValid || !match}
            className={`w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 ${
              pwValid && match && !isLoading
                ? 'bg-brand hover:bg-brand-hover text-on-accent shadow-lg hover:shadow-xl'
                : 'bg-subtle text-muted cursor-not-allowed'
            }`}
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-on-accent border-t-transparent mr-2"></div>
                Resetting...
              </>
            ) : (
              'Reset password'
            )}
          </button>
        </form>

        <div className="mt-4 text-center">
          <Link href="/portal#member" className="text-xs font-medium text-brand hover:text-brand-hover transition-colors">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand border-t-transparent"></div>
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  )
}
