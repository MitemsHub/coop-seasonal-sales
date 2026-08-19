'use client'

// app/auth/confirm/page.jsx
// Displayed after the user clicks the "Confirm email address" link in the
// Supabase Auth email. Shows success / error and routes them back to sign in.
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'

function ConfirmContent() {
  const searchParams = useSearchParams()
  const success = searchParams.get('success') === 'true'
  const error = searchParams.get('error')

  if (success) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle text-success">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-fg">Email confirmed</h1>
          <p className="mt-2 text-sm text-muted">
            Your email address has been verified. You can now sign in with the OTP code sent to your email.
          </p>
          <Link
            href="/portal#member"
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-on-accent hover:bg-brand-hover transition-colors"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    )
  }

  // Error state
  const messages = {
    missing_token: {
      title: 'Invalid link',
      text: 'This confirmation link is missing a valid token. Please check your email and click the link again.',
    },
    expired: {
      title: 'Link expired',
      text: 'This confirmation link has expired or is no longer valid. Please request a new verification code from the sign-in page.',
    },
    server_error: {
      title: 'Something went wrong',
      text: 'We could not verify your email. Please try again or contact support.',
    },
  }

  const msg = messages[error] || messages.server_error

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-subtle text-danger">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-fg">{msg.title}</h1>
        <p className="mt-2 text-sm text-muted">{msg.text}</p>
        <Link
          href="/portal#member"
          className="mt-5 inline-flex items-center justify-center rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-on-accent hover:bg-brand-hover transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  )
}

export default function AuthConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-canvas flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand border-t-transparent" />
        </div>
      }
    >
      <ConfirmContent />
    </Suspense>
  )
}
