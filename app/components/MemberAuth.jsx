// app/components/MemberAuth.jsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useRouter } from 'next/navigation'

// ─── Step constants ──────────────────────────────────────────────────────────
const STEP = {
  ENTER_ID: 'enter_id',
  ENTER_EMAIL: 'enter_email',
  ENTER_OTP: 'enter_otp',
  SET_PASSWORD: 'set_password',
  ENTER_PASSWORD: 'enter_password',
  FORGOT_PASSWORD: 'forgot_password',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const n = (id) => document.getElementById(id)

function MemberIdInput({ value, onChange, validation, memberStatus, isChecking, onSubmit }) {
  return (
    <form className="space-y-3 md:space-y-4" onSubmit={onSubmit}>
      <div className="relative">
        <input
          id="member-id"
          value={value}
          onChange={onChange}
          className={`w-full py-2 pl-3 pr-8 md:py-3 md:pl-4 md:pr-10 border-2 rounded-xl focus:ring-2 focus:ring-brand/20 transition-all duration-200 outline-none text-[13px] md:text-base text-fg placeholder:text-subtext ${
            !value
              ? 'border-line-subtle focus:border-brand'
              : validation.isValid
                ? 'border-success focus:border-success'
                : 'border-danger focus:border-danger'
          }`}
          placeholder="Your Staff ID"
          autoFocus
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 md:pr-3">
          {!value ? (
            <svg className="w-4 h-4 md:w-5 md:h-5 text-subtext" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          ) : validation.isValid ? (
            <svg className="w-4 h-4 md:w-5 md:h-5 text-success-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4 md:w-5 md:h-5 text-danger-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </div>
      </div>

      {/* Status feedback */}
      {value && (
        <div className="text-caption md:text-sm">
          {isChecking ? (
            <div className="flex items-center text-info-fg">
              <div className="animate-spin rounded-full h-3 w-3 md:h-4 md:w-4 border-b-2 border-info mr-1"></div>
              Checking member ID...
            </div>
          ) : memberStatus === 'not_found' ? (
            <div className="flex items-center text-danger-fg">
              <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Member ID not found in the system
            </div>
          ) : memberStatus === 'found' ? (
            <div className="flex items-center text-success-fg">
              <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Member found — ready to continue
            </div>
          ) : !validation.isValid ? (
            <div className="flex items-center text-danger-fg">
              <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {validation.message}
            </div>
          ) : validation.isValid && !isChecking && !memberStatus ? (
            <div className="flex items-center text-info-fg">
              <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Valid format — checking database...
            </div>
          ) : null}
        </div>
      )}

      <button
        type="submit"
        disabled={!validation.isValid || !memberStatus || isChecking || memberStatus === 'not_found'}
        className={`w-full inline-flex items-center justify-center px-4 py-2 md:px-6 md:py-3 text-sm md:text-base font-semibold rounded-xl transition-all duration-200 ${
          validation.isValid && memberStatus === 'found' && !isChecking
            ? 'bg-brand hover:bg-brand-hover text-on-accent shadow-lg hover:shadow-xl'
            : 'bg-subtle text-muted cursor-not-allowed'
        }`}
      >
        Continue
        <svg className="w-4 h-4 md:w-5 md:h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </button>
    </form>
  )
}

function EmailConfirm({ maskedEmail, error, isLoading, onSubmit, onBack }) {
  // The email must match the one on file — we show the masked email and ask
  // the user to confirm, rather than letting them type an arbitrary address.
  return (
    <form className="space-y-3 md:space-y-4" onSubmit={onSubmit}>
      <div className="rounded-xl border-2 border-line-subtle bg-subtle/50 px-4 py-3">
        <p className="text-xs text-muted">We&apos;ll send a verification code to</p>
        <p className="text-sm font-semibold text-fg mt-0.5">{maskedEmail || 'your registered email'}</p>
      </div>

      <p className="text-xs text-muted">
        The email must match the address on file for your account. If this is not your email, please contact an admin to update it.
      </p>

      {error && (
        <div className="flex items-center text-danger-fg text-caption md:text-sm">
          <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className={`w-full inline-flex items-center justify-center px-4 py-2 md:px-6 md:py-3 text-sm md:text-base font-semibold rounded-xl transition-all duration-200 ${
          !isLoading
            ? 'bg-brand hover:bg-brand-hover text-on-accent shadow-lg hover:shadow-xl'
            : 'bg-subtle text-muted cursor-not-allowed'
        }`}
      >
        {isLoading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 md:h-5 md:w-5 border-2 border-on-accent border-t-transparent mr-2"></div>
            Sending code...
          </>
        ) : (
          <>
            Send verification code
            <svg className="w-4 h-4 md:w-5 md:h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </>
        )}
      </button>

      <button
        type="button"
        onClick={onBack}
        disabled={isLoading}
        className="w-full inline-flex items-center justify-center gap-1.5 text-caption md:text-sm text-muted transition-colors duration-150 hover:text-fg disabled:opacity-50"
      >
        <svg className="h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to member ID
      </button>
    </form>
  )
}

function OtpInput({ otp, setOtp, error, isLoading, onSubmit, onBack }) {
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <form className="space-y-3 md:space-y-4" onSubmit={onSubmit}>
      <div>
        <label className="block text-xs font-medium text-muted mb-1.5">Verification code</label>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
          disabled={isLoading}
          className="w-full py-2 pl-3 pr-3 md:py-3 md:pl-4 border-2 rounded-xl focus:ring-2 focus:ring-brand/20 transition-all duration-200 outline-none text-[13px] md:text-base text-fg placeholder:text-subtext border-line-subtle focus:border-brand disabled:bg-subtle disabled:cursor-not-allowed tracking-[0.3em] text-center font-mono text-lg"
          placeholder="000000"
          maxLength={6}
        />

      </div>

      {error && (
        <div className="flex items-center text-danger-fg text-caption md:text-sm">
          <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || otp.length < 4}
        className={`w-full inline-flex items-center justify-center px-4 py-2 md:px-6 md:py-3 text-sm md:text-base font-semibold rounded-xl transition-all duration-200 ${
          otp.length >= 4 && !isLoading
            ? 'bg-brand hover:bg-brand-hover text-on-accent shadow-lg hover:shadow-xl'
            : 'bg-subtle text-muted cursor-not-allowed'
        }`}
      >
        {isLoading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 md:h-5 md:w-5 border-2 border-on-accent border-t-transparent mr-2"></div>
            Verifying...
          </>
        ) : (
          <>
            Verify code
            <svg className="w-4 h-4 md:w-5 md:h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </>
        )}
      </button>

      <button
        type="button"
        onClick={onBack}
        disabled={isLoading}
        className="w-full inline-flex items-center justify-center gap-1.5 text-caption md:text-sm text-muted transition-colors duration-150 hover:text-fg disabled:opacity-50"
      >
        <svg className="h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>
    </form>
  )
}

function PasswordSetup({ password, setPassword, confirmPassword, setConfirmPassword, error, isLoading, onSubmit, onBack }) {
  const pwValid = password.length >= 6
  const match = password && confirmPassword && password === confirmPassword

  return (
    <form className="space-y-3 md:space-y-4" onSubmit={onSubmit}>
      <div>
        <label className="block text-xs font-medium text-muted mb-1.5">Create a password</label>
        <input
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLoading}
          className={`w-full py-2 pl-3 pr-3 md:py-3 md:pl-4 border-2 rounded-xl focus:ring-2 focus:ring-brand/20 transition-all duration-200 outline-none text-[13px] md:text-base text-fg placeholder:text-subtext disabled:bg-subtle disabled:cursor-not-allowed ${
            !password ? 'border-line-subtle focus:border-brand' : pwValid ? 'border-success focus:border-success' : 'border-danger focus:border-danger'
          }`}
          placeholder="At least 6 characters"
          autoFocus
        />
        {password && !pwValid && (
          <p className="mt-1 text-caption text-danger-fg">Password must be at least 6 characters</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-muted mb-1.5">Confirm password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={isLoading || !pwValid}
          className={`w-full py-2 pl-3 pr-3 md:py-3 md:pl-4 border-2 rounded-xl focus:ring-2 focus:ring-brand/20 transition-all duration-200 outline-none text-[13px] md:text-base text-fg placeholder:text-subtext disabled:bg-subtle disabled:cursor-not-allowed ${
            !confirmPassword ? 'border-line-subtle focus:border-brand' : match ? 'border-success focus:border-success' : 'border-danger focus:border-danger'
          }`}
          placeholder="Re-enter password"
        />
        {confirmPassword && !match && (
          <p className="mt-1 text-caption text-danger-fg">Passwords do not match</p>
        )}
      </div>

      {error && (
        <div className="flex items-center text-danger-fg text-caption md:text-sm">
          <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || !pwValid || !match}
        className={`w-full inline-flex items-center justify-center px-4 py-2 md:px-6 md:py-3 text-sm md:text-base font-semibold rounded-xl transition-all duration-200 ${
          pwValid && match && !isLoading
            ? 'bg-brand hover:bg-brand-hover text-on-accent shadow-lg hover:shadow-xl'
            : 'bg-subtle text-muted cursor-not-allowed'
        }`}
      >
        {isLoading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 md:h-5 md:w-5 border-2 border-on-accent border-t-transparent mr-2"></div>
            Creating account...
          </>
        ) : (
          <>
            <svg className="w-4 h-4 md:w-5 md:h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Create account & sign in
          </>
        )}
      </button>

      <button
        type="button"
        onClick={onBack}
        disabled={isLoading}
        className="w-full inline-flex items-center justify-center gap-1.5 text-caption md:text-sm text-muted transition-colors duration-150 hover:text-fg disabled:opacity-50"
      >
        <svg className="h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>
    </form>
  )
}

function PasswordLogin({ maskedEmail, password, setPassword, error, isLoading, onSubmit, onForgotPassword, onBack }) {
  return (
    <form className="space-y-3 md:space-y-4" onSubmit={onSubmit}>
      {maskedEmail && (
        <p className="text-xs text-muted">
          Signing in as <span className="font-medium text-fg">{maskedEmail}</span>
        </p>
      )}

      <div>
        <label className="block text-xs font-medium text-muted mb-1.5">Password</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLoading}
          className="w-full py-2 pl-3 pr-3 md:py-3 md:pl-4 border-2 rounded-xl focus:ring-2 focus:ring-brand/20 transition-all duration-200 outline-none text-[13px] md:text-base text-fg placeholder:text-subtext border-line-subtle focus:border-brand disabled:bg-subtle disabled:cursor-not-allowed"
          placeholder="Enter your password"
          autoFocus
        />
      </div>

      {error && (
        <div className="flex items-center text-danger-fg text-caption md:text-sm">
          <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || !password.trim()}
        className={`w-full inline-flex items-center justify-center px-4 py-2 md:px-6 md:py-3 text-sm md:text-base font-semibold rounded-xl transition-all duration-200 ${
          password.trim() && !isLoading
            ? 'bg-brand hover:bg-brand-hover text-on-accent shadow-lg hover:shadow-xl'
            : 'bg-subtle text-muted cursor-not-allowed'
        }`}
      >
        {isLoading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 md:h-5 md:w-5 border-2 border-on-accent border-t-transparent mr-2"></div>
            Signing in...
          </>
        ) : (
          <>
            <svg className="w-4 h-4 md:w-5 md:h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
            Sign in
          </>
        )}
      </button>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 text-caption md:text-sm text-muted transition-colors duration-150 hover:text-fg disabled:opacity-50"
        >
          <svg className="h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <button
          type="button"
          onClick={onForgotPassword}
          disabled={isLoading}
          className="text-caption md:text-sm font-medium text-brand hover:text-brand-hover transition-colors duration-150"
        >
          Forgot password?
        </button>
      </div>
    </form>
  )
}

function ForgotPassword({ memberId, isLoading, setIsLoading, error, setError, success, setSuccess, onBack }) {
  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/members/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess('Check your email for a password reset link.')
      } else {
        setError(data.error || 'Something went wrong. Please try again.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form className="space-y-3 md:space-y-4" onSubmit={handleSubmit}>
      <p className="text-sm text-muted">
        We&apos;ll send a password reset link to the email associated with your account.
      </p>

      {error && (
        <div className="flex items-center text-danger-fg text-caption md:text-sm">
          <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center text-success-fg text-caption md:text-sm">
          <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {success}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className={`w-full inline-flex items-center justify-center px-4 py-2 md:px-6 md:py-3 text-sm md:text-base font-semibold rounded-xl transition-all duration-200 ${
          !isLoading
            ? 'bg-brand hover:bg-brand-hover text-on-accent shadow-lg hover:shadow-xl'
            : 'bg-subtle text-muted cursor-not-allowed'
        }`}
      >
        {isLoading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 md:h-5 md:w-5 border-2 border-on-accent border-t-transparent mr-2"></div>
            Sending...
          </>
        ) : (
          'Send reset link'
        )}
      </button>

      <button
        type="button"
        onClick={onBack}
        disabled={isLoading}
        className="w-full inline-flex items-center justify-center gap-1.5 text-caption md:text-sm text-muted transition-colors duration-150 hover:text-fg disabled:opacity-50"
      >
        <svg className="h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to sign in
      </button>
    </form>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function MemberAuth() {
  const { login } = useAuth()
  const router = useRouter()

  // ── State ──
  const [step, setStep] = useState(STEP.ENTER_ID)
  const [memberId, setMemberId] = useState('')
  const [validation, setValidation] = useState({ isValid: false, message: '' })
  const [isChecking, setIsChecking] = useState(false)
  const [memberStatus, setMemberStatus] = useState(null) // 'found' | 'not_found' | null

  // Member lookup data
  const [maskedEmail, setMaskedEmail] = useState('')
  const [rawEmail, setRawEmail] = useState('')

  // Signup flow
  const [otp, setOtp] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Login flow
  const [loginPassword, setLoginPassword] = useState('')

  // Loading / error
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // ── Member ID validation ──
  const validateMemberId = (id) => {
    if (!id || id.length === 0) return { isValid: false, message: '' }
    const trimmed = id.trim().toUpperCase()
    const validCategories = ['A', 'R', 'P', 'E']
    const firstChar = trimmed.charAt(0)

    if (!validCategories.includes(firstChar)) {
      if (/^\d/.test(trimmed)) return { isValid: false, message: 'Missing category letter (e.g., A12345)' }
      return { isValid: false, message: 'Invalid format. Use: A12345, R12345, P12345, or E12345' }
    }
    if (trimmed.length < 6) return { isValid: false, message: 'Need exactly 5 digits after category letter' }
    if (!/^[A-Z0-9]+$/.test(trimmed)) return { isValid: false, message: 'Invalid characters' }
    const numberPart = trimmed.slice(1)
    if (!/^\d+$/.test(numberPart)) return { isValid: false, message: 'Numbers must follow the category letter' }
    if (numberPart.length !== 5) return { isValid: false, message: 'Need exactly 5 digits after category letter' }
    return { isValid: true, message: 'Valid format' }
  }

  // ── Check member in database ──
  const checkMember = async (mid) => {
    setIsChecking(true)
    setMemberStatus(null)
    try {
      const res = await fetch('/api/members/auth/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: mid }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.exists) {
          setMemberStatus('found')
          setMaskedEmail(data.email || '')
          setRawEmail(data.rawEmail || '')
        } else {
          setMemberStatus('not_found')
        }
      } else {
        setMemberStatus('not_found')
      }
    } catch {
      setMemberStatus('not_found')
    } finally {
      setIsChecking(false)
    }
  }

  // Debounce timer ref for member lookup
  const debounceRef = useRef(null)

  // ── Handle ID input change ──
  const handleIdChange = (e) => {
    const value = e.target.value.toUpperCase()
    setMemberId(value)
    setMemberStatus(null)
    const v = validateMemberId(value)
    setValidation(v)
    // Clear any pending lookup
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (v.isValid) {
      debounceRef.current = setTimeout(() => checkMember(value), 500)
    }
  }

  // ── Step 1: Submit member ID → route to signup or login ──
  const handleIdSubmit = (e) => {
    e.preventDefault()
    const mid = memberId.trim().toUpperCase()
    if (!validation.isValid || memberStatus !== 'found') return
    // If the member has an auth account → login flow
    if (rawEmail) {
      setStep(STEP.ENTER_PASSWORD)
    } else {
      setStep(STEP.ENTER_EMAIL)
    }
  }

  // ── Step 2 (signup): Send OTP to email on file ──
  const handleEmailSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    try {
      // Send the email on file — the server validates it matches
      const res = await fetch('/api/members/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: memberId.trim().toUpperCase() }),
      })
      const data = await res.json()
      if (res.ok) {
        setStep(STEP.ENTER_OTP)
      } else {
        setError(data.error || 'Failed to send OTP')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // ── Step 3 (signup): Verify OTP ──
  const handleOtpSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    try {
      const res = await fetch('/api/members/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: memberId.trim().toUpperCase(),
          token: otp.trim(),
        }),
      })
      const data = await res.json()
      if (res.ok && data.accessToken) {
        setAccessToken(data.accessToken)
        setStep(STEP.SET_PASSWORD)
      } else {
        setError(data.error || 'Invalid or expired code')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // ── Step 4 (signup): Set password → create account → login ──
  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    if (password.length < 6 || password !== confirmPassword) return
    setIsLoading(true)
    setError('')
    try {
      const res = await fetch('/api/members/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: memberId.trim().toUpperCase(),
          accessToken,
          password,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        // Account created — log in via the AuthContext
        const claims = data.member
        login({
          type: 'member',
          id: memberId.trim().toUpperCase(),
          authenticated: true,
          ...(claims || {}),
        })
        await new Promise((r) => setTimeout(r, 400))
        router.push('/my-coop')
      } else {
        setError(data.error || 'Failed to create account')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // ── Step: Login with password ──
  const handleLoginSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    try {
      const res = await fetch('/api/members/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: memberId.trim().toUpperCase(),
          password: loginPassword.trim(),
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        const claims = data.member
        login({
          type: 'member',
          id: memberId.trim().toUpperCase(),
          authenticated: true,
          ...(claims || {}),
        })
        await new Promise((r) => setTimeout(r, 400))
        router.push('/my-coop')
      } else {
        setError(data.error || 'Invalid password')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // ── Navigation helpers ──
  const goToId = () => {
    setStep(STEP.ENTER_ID)
    setError('')
    setSuccess('')
  }
  const goToLogin = () => {
    setStep(STEP.ENTER_PASSWORD)
    setPassword('')
    setConfirmPassword('')
    setError('')
  }
  const goToForgot = () => {
    setStep(STEP.FORGOT_PASSWORD)
    setError('')
    setSuccess('')
  }

  // ── Title / subtitle per step ──
  const titles = {
    [STEP.ENTER_ID]: { title: 'Member sign in', sub: 'Enter your staff ID to continue' },
    [STEP.ENTER_EMAIL]: { title: 'Confirm your email', sub: 'We\u2019ll send a verification code to the email on file' },
    [STEP.ENTER_OTP]: { title: 'Enter verification code', sub: 'Enter the 6-digit code sent to your email' },
    [STEP.SET_PASSWORD]: { title: 'Create your password', sub: "Choose a password you'll use to sign in next time" },
    [STEP.ENTER_PASSWORD]: { title: 'Welcome back', sub: 'Enter your password to sign in' },
    [STEP.FORGOT_PASSWORD]: { title: 'Reset password', sub: "We'll help you get back into your account" },
  }

  const { title, sub } = titles[step] || titles[STEP.ENTER_ID]

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Step heading — skip on ENTER_ID since the portal page already shows it */}
      {step !== STEP.ENTER_ID && (
        <div className="mb-1">
          <h2 className="text-sm font-bold text-fg">{title}</h2>
          <p className="text-xs text-muted">{sub}</p>
        </div>
      )}

      {/* Step: Enter ID */}
      {step === STEP.ENTER_ID && (
        <MemberIdInput
          value={memberId}
          onChange={handleIdChange}
          validation={validation}
          memberStatus={memberStatus}
          isChecking={isChecking}
          onSubmit={handleIdSubmit}
        />
      )}

      {/* Step: Confirm email (signup) */}
      {step === STEP.ENTER_EMAIL && (
        <EmailConfirm
          maskedEmail={maskedEmail}
          error={error}
          isLoading={isLoading}
          onSubmit={handleEmailSubmit}
          onBack={goToId}
        />
      )}

      {/* Step: Enter OTP (signup) */}
      {step === STEP.ENTER_OTP && (
        <OtpInput
          otp={otp}
          setOtp={setOtp}
          error={error}
          isLoading={isLoading}
          onSubmit={handleOtpSubmit}
          onBack={() => { setStep(STEP.ENTER_EMAIL); setError('') }}
        />
      )}

      {/* Step: Set password (signup) */}
      {step === STEP.SET_PASSWORD && (
        <PasswordSetup
          password={password}
          setPassword={setPassword}
          confirmPassword={confirmPassword}
          setConfirmPassword={setConfirmPassword}
          error={error}
          isLoading={isLoading}
          onSubmit={handlePasswordSubmit}
          onBack={() => { setStep(STEP.ENTER_OTP); setError('') }}
        />
      )}

      {/* Step: Login with password */}
      {step === STEP.ENTER_PASSWORD && (
        <PasswordLogin
          maskedEmail={maskedEmail}
          password={loginPassword}
          setPassword={setLoginPassword}
          error={error}
          isLoading={isLoading}
          onSubmit={handleLoginSubmit}
          onForgotPassword={goToForgot}
          onBack={goToId}
        />
      )}

      {/* Step: Forgot password */}
      {step === STEP.FORGOT_PASSWORD && (
        <ForgotPassword
          memberId={memberId.trim().toUpperCase()}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          error={error}
          setError={setError}
          success={success}
          setSuccess={setSuccess}
          onBack={goToLogin}
        />
      )}
    </div>
  )
}
